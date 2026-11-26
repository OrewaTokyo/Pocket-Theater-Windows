'use strict';
// Runs the app's engine (everything except the window itself) against a pretend phone.
// Needs only Node and the openssl program. Run: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { startMockPhone, makeCertificate } = require('./mock-phone');
const { Connection } = require('../src/main/connection');
const { startProxy } = require('../src/main/proxy');
const { Store } = require('../src/main/store');
const { createHandlers } = require('../src/main/handlers');
const { probeCertificate } = require('../src/main/tls-trust');
const util = require('../src/main/util');
const players = require('../src/main/players');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); } catch (err) { failures.push(name); console.log('  FAIL ' + name + '\n       ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(40); }
  throw new Error('timed out waiting');
}
function get(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-test-'));
  let certs;
  try { certs = makeCertificate(tmp, 'a'); } catch (err) { console.log('The openssl program is needed to run these tests.'); process.exit(2); }
  const otherCerts = makeCertificate(tmp, 'b');

  console.log('\nHelpers');
  await test('parseAddress understands the ways people type an address', () => {
    assert.deepStrictEqual(util.parseAddress('192.168.1.20'), [{ scheme: 'https', host: '192.168.1.20', port: 8443 }, { scheme: 'http', host: '192.168.1.20', port: 8080 }]);
    assert.deepStrictEqual(util.parseAddress('https://192.168.1.20:8443/'), [{ scheme: 'https', host: '192.168.1.20', port: 8443 }]);
    assert.deepStrictEqual(util.parseAddress('192.168.1.20:8080'), [{ scheme: 'http', host: '192.168.1.20', port: 8080 }]);
    assert.deepStrictEqual(util.parseAddress('http://phone.local'), [{ scheme: 'http', host: 'phone.local', port: 8080 }]);
    assert.strictEqual(util.parseAddress(''), null);
    assert.strictEqual(util.parseAddress('not an address'), null);
    assert.strictEqual(util.parseAddress('1.2.3.4:99999'), null);
    assert.deepStrictEqual(util.parseAddress('http://phone.local/<script>'), [{ scheme: 'http', host: 'phone.local', port: 8080 }]); // a path is dropped, the host is kept
    assert.strictEqual(util.parseAddress('ht!tp://x'), null);
  });
  await test('safeFileName and canOpenDirectly', () => {
    assert.strictEqual(util.safeFileName('a:b*c?.mp4'), 'a_b_c_.mp4');
    assert.strictEqual(util.safeFileName('..\\..\\evil.txt'), '.._.._evil.txt');
    assert.strictEqual(util.safeFileName('CON.txt'), '_CON.txt');
    assert.strictEqual(util.safeFileName(''), 'file');
    assert.strictEqual(util.canOpenDirectly('movie.mkv'), true);
    assert.strictEqual(util.canOpenDirectly('setup.EXE'), false);
    assert.strictEqual(util.canOpenDirectly('run.ps1'), false);
    assert.strictEqual(util.canOpenDirectly('noextension'), false);
  });
  await test('sameFingerprint ignores case and separators', () => {
    assert.ok(util.sameFingerprint('AB:CD:EF', 'abcdef'));
    assert.ok(!util.sameFingerprint('AB:CD:EF', 'abcdee'));
    assert.ok(!util.sameFingerprint('', ''));
  });

  await test('player detection finds installed players in the usual places and through the registry', async () => {
    const mk = (f) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); return f; };
    const pf = path.join(tmp, 'pf');
    mk(path.join(pf, 'VideoLAN', 'VLC', 'vlc.exe'));
    mk(path.join(pf, 'MPC-HC', 'mpc-hc64.exe'));
    const odd = mk(path.join(tmp, 'Weird', 'PotPlayerMini64.exe'));
    const found = await players.detect({ env: { ProgramFiles: pf }, registry: async (exe) => (exe === 'PotPlayerMini64.exe' ? odd : null) });
    assert.deepStrictEqual(found.map((p) => p.name).sort(), ['MPC-HC', 'PotPlayer', 'VLC']);
    assert.deepStrictEqual(await players.detect({ env: { ProgramFiles: path.join(tmp, 'empty') }, registry: async () => null }), []);
    assert.deepStrictEqual(await players.detect({ env: { ProgramFiles: pf }, registry: async () => path.join(tmp, 'gone.exe') }).then((l) => l.map((p) => p.name).sort()), ['MPC-HC', 'VLC'], 'a registry entry for a program that is gone is ignored');
    assert.strictEqual(players.parseRegistryValue('    (Default)    REG_SZ    C:\\Program Files\\VideoLAN\\VLC\\vlc.exe\r\n', {}), 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe');
    assert.strictEqual(players.parseRegistryValue('(Default)  REG_EXPAND_SZ  "%ProgramFiles%\\x\\p.exe"', { ProgramFiles: 'C:\\PF' }), 'C:\\PF\\x\\p.exe');
    assert.strictEqual(players.parseRegistryValue('nothing here', {}), null);
  });

  console.log('\nStore');
  await test('store saves phones, hides passwords and encrypts them', () => {
    const secrets = { available: () => true, encrypt: (t) => Buffer.from('enc:' + t), decrypt: (b) => b.toString().replace(/^enc:/, '') };
    const store = new Store(path.join(tmp, 'store1'), secrets);
    const saved = store.save({ name: 'Phone', scheme: 'https', host: '1.2.3.4', port: 8443, fingerprint: 'AA' });
    store.setCredentials(saved.id, 'demo', 'secret-pass-1');
    const raw = fs.readFileSync(path.join(tmp, 'store1', 'servers.json'), 'utf8');
    assert.ok(!raw.includes('secret-pass-1'), 'password must not be stored in plain text');
    assert.deepStrictEqual(store.getCredentials(saved.id), { username: 'demo', password: 'secret-pass-1' });
    assert.strictEqual(store.publicView(store.get(saved.id)).remembered, true);
    assert.ok(!JSON.stringify(store.publicView(store.get(saved.id))).includes('secret'));
    const again = store.save({ name: 'Renamed', scheme: 'https', host: '1.2.3.4', port: 8443, fingerprint: 'BB' });
    assert.strictEqual(again.id, saved.id, 'same address updates the same phone');
    assert.strictEqual(store.get(saved.id).fingerprint, 'BB');
    assert.ok(store.getCredentials(saved.id), 'sign-in is kept when the certificate is re-trusted');
    store.clearCredentials(saved.id);
    assert.strictEqual(store.getCredentials(saved.id), null);
  });
  await test('store does not remember passwords when encryption is missing', () => {
    const store = new Store(path.join(tmp, 'store2'), { available: () => false });
    const s = store.save({ name: 'P', scheme: 'https', host: 'h', port: 1, fingerprint: 'x' });
    assert.strictEqual(store.setCredentials(s.id, 'demo', 'secret-pass-1'), false);
    assert.strictEqual(store.getCredentials(s.id), null);
    assert.ok(!fs.readFileSync(path.join(tmp, 'store2', 'servers.json'), 'utf8').includes('secret-pass-1'));
  });

  const phone = await startMockPhone({ certFile: certs.certFile, keyFile: certs.keyFile });
  const impostor = await startMockPhone({ certFile: otherCerts.certFile, keyFile: otherCerts.keyFile });
  const probe = await probeCertificate('127.0.0.1', phone.port);
  const server = { scheme: 'https', host: '127.0.0.1', port: phone.port, fingerprint: probe.fingerprint };

  console.log('\nConnection and certificate pinning');
  await test('probe reads the fingerprint the phone shows', async () => {
    const expected = new (require('crypto').X509Certificate)(fs.readFileSync(certs.certFile)).fingerprint256;
    assert.strictEqual(probe.fingerprint, expected);
  });
  await test('sign in works and sends the app name', async () => {
    const c = new Connection(server);
    assert.deepStrictEqual(await c.login('demo', 'theater-demo-1'), { username: 'demo' });
    assert.strictEqual((await c.json('GET', '/api/me')).username, 'demo');
    assert.ok(/PocketTheaterWindows/.test(phone.state.requests.slice(-1)[0].ua));
    c.close();
  });
  await test('wrong password gives the phone\'s own sentence', async () => {
    const c = new Connection(server);
    await assert.rejects(() => c.login('demo', 'nope-nope-1'), (e) => e.message === 'Wrong username or password.' && e.status === 401);
    c.close();
  });
  await test('a different certificate is refused before anything is sent', async () => {
    const before = impostor.state.requests.length;
    const c = new Connection({ scheme: 'https', host: '127.0.0.1', port: impostor.port, fingerprint: probe.fingerprint });
    await assert.rejects(() => c.login('demo', 'theater-demo-1'), (e) => e.code === 'CERT');
    assert.strictEqual(impostor.state.requests.length, before, 'the impostor must not receive a single request');
    c.close();
  });
  await test('pending and turned-off accounts get the phone\'s explanation', async () => {
    const c = new Connection(server);
    await assert.rejects(() => c.login('alice', 'alice-secret-1'), (e) => e.status === 403 && /waiting/.test(e.message));
    c.close();
  });
  await test('unreachable phone is reported as a network problem', async () => {
    const c = new Connection({ scheme: 'https', host: '127.0.0.1', port: 1, fingerprint: probe.fingerprint });
    await assert.rejects(() => c.json('GET', '/api/me'), (e) => e.code === 'NETWORK');
    c.close();
  });
  await test('an expired session is renewed once, quietly, when a password is remembered', async () => {
    const c = new Connection(server);
    await c.login('demo', 'theater-demo-1');
    c.remember({ username: 'demo', password: 'theater-demo-1' });
    phone.state.expireSessions();
    const data = await c.json('GET', '/api/libraries');
    assert.ok(Array.isArray(data.libraries) && data.libraries.length >= 4);
    c.close();
  });
  await test('without a remembered password an expired session is reported as signed out', async () => {
    const c = new Connection(server);
    await c.login('demo', 'theater-demo-1');
    phone.state.expireSessions();
    await assert.rejects(() => c.json('GET', '/api/libraries'), (e) => e.code === 'SIGNED_OUT');
    c.close();
  });
  await test('a rejected remembered password is dropped and not retried in a loop', async () => {
    const c = new Connection(server);
    await c.login('demo', 'theater-demo-1');
    c.remember({ username: 'demo', password: 'not-the-password' });
    let rejected = 0;
    c.on('creds-rejected', () => rejected++);
    phone.state.expireSessions();
    await assert.rejects(() => c.json('GET', '/api/libraries'), (e) => e.code === 'SIGNED_OUT');
    assert.strictEqual(rejected, 1);
    assert.strictEqual(c.creds, null);
    c.close();
  });

  console.log('\nLink monitor');
  await test('monitor reports offline after two misses and back online when the phone returns', async () => {
    const temp = await startMockPhone({ certFile: certs.certFile, keyFile: certs.keyFile });
    const port = temp.port;
    const c = new Connection({ scheme: 'https', host: '127.0.0.1', port, fingerprint: probe.fingerprint });
    await c.login('demo', 'theater-demo-1');
    const seen = [];
    c.on('status', (s) => seen.push(s.online));
    c.startMonitor();
    await waitFor(() => seen.length >= 1);
    await temp.close();
    await waitFor(() => seen.includes(false), 9000);
    const again = await startMockPhone({ port, certFile: certs.certFile, keyFile: certs.keyFile });
    again.state.sessions.clear();
    await waitFor(() => seen[seen.length - 1] === true, 9000);
    c.close();
    await again.close();
  });

  console.log('\nMedia proxy');
  let current = null;
  const proxy = await startProxy(() => current);
  const lib = 'lib-games';
  const fileUrl = (extra) => proxy.base + '/file?lib=' + lib + '&path=' + encodeURIComponent('save-data.bin') + (extra || '');
  await test('proxy streams a file with Range support through the pinned connection', async () => {
    current = new Connection(server);
    await current.login('demo', 'theater-demo-1');
    const whole = await get(fileUrl());
    assert.strictEqual(whole.status, 200);
    assert.strictEqual(whole.body.length, 3 * 1024 * 1024 + 123);
    const part = await get(fileUrl(), { Range: 'bytes=100-199' });
    assert.strictEqual(part.status, 206);
    assert.strictEqual(part.headers['content-range'], 'bytes 100-199/' + whole.body.length);
    assert.ok(part.body.equals(whole.body.subarray(100, 200)));
    assert.strictEqual(part.headers['access-control-allow-origin'], '*');
  });
  await test('proxy refuses a wrong token, a wrong Host and odd methods', async () => {
    assert.strictEqual((await get(proxy.base.replace(proxy.token, 'x'.repeat(32)) + '/file?lib=a&path=b')).status, 404);
    assert.strictEqual((await get(fileUrl(), { Host: 'evil.example' })).status, 403);
    const post = await new Promise((resolve) => { const r = http.request(fileUrl(), { method: 'POST' }, (res) => resolve(res.statusCode)); r.end(); });
    assert.strictEqual(post, 405);
  });
  await test('proxy does not let page names or other routes through', async () => {
    assert.strictEqual((await get(proxy.base + '/api/me')).status, 404);
    assert.strictEqual((await get(proxy.base + '/file?lib=lib-games')).status, 400);
    assert.strictEqual((await get(proxy.base + '/file?lib=lib-games&path=..%2F..%2Fetc%2Fpasswd')).status, 404);
  });
  await test('proxy passes subtitles and keeps runnable pages as downloads', async () => {
    const sub = await get(proxy.base + '/subtitle?lib=lib-movies&path=' + encodeURIComponent('Tiny Cinema (2024).en.vtt'));
    assert.strictEqual(sub.status, 200);
    assert.ok(sub.body.toString().startsWith('WEBVTT'));
    const html = await get(proxy.base + '/file?lib=lib-docs&path=page.html');
    assert.strictEqual(html.headers['content-type'], 'application/octet-stream');
    assert.strictEqual(html.headers['content-disposition'], 'attachment');
  });
  await test('proxy without a connection answers 503', async () => {
    const saved = current; current = null;
    assert.strictEqual((await get(fileUrl())).status, 503);
    current = saved;
  });
  await test('proxy renews an expired session by itself', async () => {
    phone.state.expireSessions();
    current.remember({ username: 'demo', password: 'theater-demo-1' });
    assert.strictEqual((await get(fileUrl(), { Range: 'bytes=0-9' })).status, 206);
  });
  await test('proxy carries on by itself when the phone drops the connection part-way', async () => {
    const before = proxy.stats().reconnects;
    phone.state.dropsLeft = 0;
    const clean = await get(fileUrl());
    phone.state.dropFileAfter = 200000;
    phone.state.dropsLeft = 3;
    const whole = await get(fileUrl());
    assert.strictEqual(whole.status, 200);
    assert.ok(whole.body.equals(clean.body), 'not a byte lost or repeated after three drops');
    assert.ok(proxy.stats().reconnects - before >= 3, 'the drops were recovered from');
    phone.state.dropsLeft = 2;
    const part = await get(fileUrl(), { Range: 'bytes=1000-1999999' });
    assert.strictEqual(part.status, 206);
    assert.ok(part.body.equals(clean.body.subarray(1000, 2000000)), 'a ranged request survives drops too');
    phone.state.dropFileAfter = 0;
    phone.state.dropsLeft = 0;
  });
  await test('proxy gives up cleanly when the phone is gone for good', async () => {
    const doomed = await startMockPhone({ certFile: certs.certFile, keyFile: certs.keyFile });
    const link = new Connection({ scheme: 'https', host: '127.0.0.1', port: doomed.port, fingerprint: probe.fingerprint });
    await link.login('demo', 'theater-demo-1');
    doomed.state.dropFileAfter = 100000;
    doomed.state.dropsLeft = 1;
    const quick = await startProxy(() => link, { readAheadBytes: 1024 * 1024, maxResumes: 3, retryDelayMs: 20 });
    const outcome = await new Promise((resolve) => {
      let n = 0;
      http.get(quick.base + '/file?lib=lib-games&path=save-data.bin', (res) => {
        res.on('data', (c) => { n += c.length; if (n >= 100000) doomed.close(); });
        res.on('end', () => resolve({ n, complete: res.complete }));
        res.on('error', () => resolve({ n, complete: false }));
        res.on('aborted', () => resolve({ n, complete: false }));
        res.on('close', () => resolve({ n, complete: res.complete }));
      }).on('error', () => resolve({ n, complete: false }));
    });
    assert.strictEqual(outcome.complete, false, 'the player is told the file is broken, not silently shortened');
    assert.ok(outcome.n >= 100000 && outcome.n < 3 * 1024 * 1024);
    link.close();
    await quick.close();
  });
  await test('proxy stats report speed and reconnects', () => {
    const stats = proxy.stats();
    assert.ok(stats.bytesPerSecond === null || stats.bytesPerSecond > 0);
    assert.ok(Number.isInteger(stats.reconnects) && stats.reconnects >= 3);
  });
  current.close();

  console.log('\nHandlers (what the window asks for)');
  const events = [];
  const fakeDialog = { savePath: null, showSaveDialog: async () => (fakeDialog.savePath ? { canceled: false, filePath: fakeDialog.savePath } : { canceled: true }), showOpenDialog: async () => ({ canceled: true }) };
  const opened = [];
  const revealed = [];
  const visited = [];
  const secrets = { available: () => true, encrypt: (t) => Buffer.from(t).reverse(), decrypt: (b) => Buffer.from(b).reverse().toString() };
  const store = new Store(path.join(tmp, 'app'), secrets);
  const launches = [];
  const fakeVlc = path.join(tmp, 'VLC', 'vlc.exe');
  const fakeMpc = path.join(tmp, 'MPC-HC', 'mpc-hc64.exe');
  const browsed = path.join(tmp, 'Other', 'PotPlayerMini64.exe');
  const custom = path.join(tmp, 'Other', 'cool-player.exe');
  for (const f of [fakeVlc, fakeMpc, browsed, custom]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); }
  let detected = [{ id: 'vlc', name: 'VLC', path: fakeVlc }, { id: 'mpc-hc', name: 'MPC-HC', path: fakeMpc }];
  const handlers = createHandlers({
    store, proxy,
    dialog: fakeDialog,
    shell: { openPath: async (p) => { opened.push(p); return ''; }, showItemInFolder: (p) => { revealed.push(p); }, openExternal: async (u) => { visited.push(u); } },
    app: { getPath: () => tmp, getVersion: () => '0.1.0' },
    players: { detect: async () => detected, launch: async (exe, url) => { launches.push({ exe, url }); } },
    send: (channel, payload) => events.push({ channel, payload }),
    getWindow: () => null,
    tempDir: path.join(tmp, 'open'),
  });
  const call = async (ch, ...a) => { const r = await handlers.invoke(ch, ...a); if (!r.ok) { const e = new Error(r.error.message); e.code = r.error.code; throw e; } return r.data; };
  let savedPhone;

  await test('probe finds the phone, shows the fingerprint, and rejects things that are not a phone', async () => {
    const found = await call('servers:probe', 'https://127.0.0.1:' + phone.port);
    assert.strictEqual(found.fingerprint, probe.fingerprint);
    assert.strictEqual(found.secure, true);
    const plain = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>Router</h1>'); });
    await new Promise((r) => plain.listen(0, '127.0.0.1', r));
    await assert.rejects(() => call('servers:probe', 'http://127.0.0.1:' + plain.address().port), (e) => e.code === 'NOT_THEATER');
    plain.close();
    await assert.rejects(() => call('servers:probe', 'nonsense here'), (e) => e.code === 'BAD_ADDRESS');
  });
  await test('trusting a phone checks the fingerprint again', async () => {
    const found = await call('servers:probe', '127.0.0.1:' + phone.port);
    await assert.rejects(() => call('servers:trust', Object.assign({}, found, { fingerprint: 'AA:BB' }), 'x'), (e) => e.code === 'CERT');
    savedPhone = await call('servers:trust', found, 'Living room phone');
    assert.strictEqual(savedPhone.name, 'Living room phone');
    assert.strictEqual((await call('servers:list')).length, 1);
  });
  await test('connect, sign in with remember, reconnect signed in automatically', async () => {
    const first = await call('servers:connect', savedPhone.id);
    assert.strictEqual(first.state, 'login');
    const done = await call('session:login', { username: ' Demo ', password: 'theater-demo-1', remember: true });
    assert.strictEqual(done.username, 'demo');
    assert.strictEqual(done.remembered, true);
    assert.ok(!fs.readFileSync(path.join(tmp, 'app', 'servers.json'), 'utf8').includes('theater-demo-1'));
    await call('servers:disconnect');
    const second = await call('servers:connect', savedPhone.id);
    assert.strictEqual(second.state, 'signed-in');
    assert.strictEqual(second.username, 'demo');
  });
  await test('browse shelves and folders', async () => {
    const libs = await call('api:get', '/api/libraries');
    assert.deepStrictEqual([...new Set(libs.libraries.map((l) => l.category))].sort(), ['Anime', 'Documents', 'Games', 'Movies', 'Series']);
    const listing = await call('api:get', '/api/list?lib=lib-detectives&path=' + encodeURIComponent('Season 1'));
    assert.strictEqual(listing.entries.length, 3, 'the subtitle file is not listed on its own');
    assert.ok(listing.entries[0].subs && listing.entries[0].subs[0].lang === 'en');
  });
  await test('only known phone addresses can be requested', async () => {
    await assert.rejects(() => call('api:get', '/file?lib=a&path=b'), (e) => e.code === 'BAD_REQUEST');
    await assert.rejects(() => call('api:get', '/api/../etc'), (e) => e.code === 'BAD_REQUEST');
    await assert.rejects(() => call('api:post', '/api/login', {}), (e) => e.code === 'BAD_REQUEST');
    await assert.rejects(() => call('legal:get', '../x'), (e) => e.code === 'BAD_REQUEST');
    assert.ok((await call('legal:get', 'terms')).includes('TERMS'));
  });
  await test('request access sends the sign-up the way the phone expects', async () => {
    await call('session:register', { username: 'newbie', password: 'newbie-pass-1', agree: true });
    assert.strictEqual(phone.state.users.get('newbie').status, 'pending');
    await assert.rejects(() => call('session:register', { username: 'newbie2', password: 'newbie-pass-1', agree: false }), (e) => /accept/.test(e.message));
  });
  await test('download saves the whole file and reports progress', async () => {
    phone.state.dropFileAfter = 0;
    phone.state.dropsLeft = 0;
    const dest = path.join(tmp, 'saved.bin');
    fakeDialog.savePath = dest;
    events.length = 0;
    const started = await call('file:save', { lib: 'lib-games', parts: ['save-data.bin'] });
    await waitFor(() => events.some((e) => e.channel === 'download:progress' && e.payload.id === started.id && e.payload.state === 'done'));
    assert.strictEqual(fs.statSync(dest).size, 3 * 1024 * 1024 + 123);
    assert.ok(!fs.existsSync(dest + '.part'));
    fakeDialog.savePath = null;
    assert.deepStrictEqual(await call('file:save', { lib: 'lib-games', parts: ['save-data.bin'] }), { canceled: true });
  });
  await test('the preload lets through exactly the requests the engine answers', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload.js'), 'utf8');
    const listed = [...text.slice(text.indexOf('const REQUESTS'), text.indexOf('];')).matchAll(/'([a-z]+:[A-Za-z]+)'/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual(listed, handlers.channels.slice().sort());
  });
  await test('Show in folder only works for files this app saved', async () => {
    const dest = path.join(tmp, 'reveal.bin');
    fakeDialog.savePath = dest;
    events.length = 0;
    const started = await call('file:save', { lib: 'lib-docs', parts: ['notes.txt'] });
    await waitFor(() => events.some((e) => e.payload && e.payload.id === started.id && e.payload.state === 'done'));
    await call('file:reveal', started.id);
    assert.deepStrictEqual(revealed, [dest]);
    await assert.rejects(() => call('file:reveal', 'not-an-id'), (e) => e.code === 'NOT_FOUND');
    fakeDialog.savePath = null;
  });
  await test('a download survives the phone dropping the connection', async () => {
    const dest = path.join(tmp, 'resumed.bin');
    fakeDialog.savePath = dest;
    phone.state.dropFileAfter = 300000;
    phone.state.dropsLeft = 4;
    events.length = 0;
    const started = await call('file:save', { lib: 'lib-games', parts: ['save-data.bin'] });
    await waitFor(() => events.some((e) => e.payload && e.payload.id === started.id && (e.payload.state === 'done' || e.payload.state === 'error')), 15000);
    assert.strictEqual(events.filter((e) => e.payload && e.payload.id === started.id).pop().payload.state, 'done');
    assert.ok(fs.readFileSync(dest).equals(fs.readFileSync(path.join(tmp, 'saved.bin'))), 'the saved file is identical, not a byte lost or repeated');
    phone.state.dropFileAfter = 0;
    phone.state.dropsLeft = 0;
    fakeDialog.savePath = null;
  });
  await test('opening with the default app downloads to a temp folder first; programs are never opened', async () => {
    events.length = 0;
    const started = await call('file:open', { lib: 'lib-docs', parts: ['notes.txt'] });
    await waitFor(() => events.some((e) => e.payload && e.payload.id === started.id && e.payload.state === 'done'));
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(fs.readFileSync(opened[0], 'utf8'), 'Remember to buy popcorn.\n');
    await assert.rejects(() => call('file:open', { lib: 'lib-games', parts: ['setup.exe'] }), (e) => e.code === 'UNSAFE');
    assert.strictEqual(opened.length, 1);
  });
  await test('a download can be cancelled and leaves nothing behind', async () => {
    const dest = path.join(tmp, 'cancel.bin');
    fakeDialog.savePath = dest;
    events.length = 0;
    const started = await call('file:save', { lib: 'lib-games', parts: ['save-data.bin'] });
    await call('file:cancel', started.id);
    await waitFor(() => events.some((e) => e.payload && e.payload.id === started.id && (e.payload.state === 'canceled' || e.payload.state === 'done')));
    const last = events.filter((e) => e.payload && e.payload.id === started.id).pop().payload.state;
    if (last === 'canceled') assert.ok(!fs.existsSync(dest) && !fs.existsSync(dest + '.part'));
    fakeDialog.savePath = null;
  });
  await test('outside player gets a link to the local proxy, never a phone address', async () => {
    const r = await call('player:launch', { lib: 'lib-movies', parts: ['Tiny Cinema (2024).webm'] });
    assert.strictEqual(r.player, 'VLC', 'VLC is used when it is installed and nothing else is chosen');
    assert.strictEqual(launches[0].exe, fakeVlc);
    assert.ok(launches[0].url.startsWith(proxy.base + '/file?lib=lib-movies&path='));
    assert.ok(!launches[0].url.includes(String(phone.port)));
    await assert.rejects(() => call('player:launch', { lib: 'x', parts: [] }), (e) => e.code === 'BAD_REQUEST');
  });
  await test('player list, choose, remember and forget', async () => {
    detected = [{ id: 'mpc-hc', name: 'MPC-HC', path: fakeMpc }, { id: 'potplayer', name: 'PotPlayer', path: browsed }]; // this PC has no VLC
    const listed = await call('player:list');
    assert.deepStrictEqual(listed.players.map((p) => p.name), ['MPC-HC', 'PotPlayer']);
    assert.strictEqual(listed.saved, null);
    await assert.rejects(() => call('player:launch', { lib: 'lib-movies', parts: ['Tiny Cinema (2024).webm'] }), (e) => e.code === 'NO_PLAYER');
    await assert.rejects(() => call('player:launch', { lib: 'lib-movies', parts: ['x.webm'], playerPath: path.join(tmp, 'not-listed.exe') }), (e) => e.code === 'BAD_REQUEST');
    launches.length = 0;
    const r = await call('player:launch', { lib: 'lib-movies', parts: ['Tiny Cinema (2024).webm'], playerPath: fakeMpc, remember: true });
    assert.strictEqual(r.player, 'MPC-HC');
    assert.strictEqual(launches[0].exe, fakeMpc);
    assert.strictEqual((await call('player:info')).saved, true);
    launches.length = 0;
    await call('player:launch', { lib: 'lib-movies', parts: ['Tiny Cinema (2024).webm'] });
    assert.strictEqual(launches[0].exe, fakeMpc, 'the remembered player is used without asking');
    await call('player:forget');
    assert.strictEqual((await call('player:info')).saved, false);
  });
  await test('a player picked with the file chooser is allowed, and a non-program is refused', async () => {
    fakeDialog.openPath = custom;
    fakeDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fakeDialog.openPath] });
    const picked = await call('player:choose');
    assert.strictEqual(picked.path, custom);
    assert.strictEqual(picked.name, 'cool-player');
    const r = await call('player:launch', { lib: 'lib-movies', parts: ['Tiny Cinema (2024).webm'], playerPath: custom });
    assert.strictEqual(r.player, 'cool-player');
    fakeDialog.openPath = path.join(tmp, 'readme.txt');
    await assert.rejects(() => call('player:choose'), (e) => e.code === 'BAD_REQUEST');
    await call('player:set', { path: custom });
    assert.strictEqual((await call('player:info')).player, 'cool-player');
    await call('player:forget');
  });
  await test('the VLC download page can be opened, nothing else', async () => {
    await call('app:openHelp', 'vlc');
    assert.deepStrictEqual(visited, ['https://www.videolan.org/vlc/']);
    await assert.rejects(() => call('app:openHelp', 'https://evil.example'), (e) => e.code === 'BAD_REQUEST');
  });
  await test('admin: pairing code, QR, and the admin page open after the phone approves', async () => {
    await assert.rejects(() => call('api:get', '/api/admin/overview'), (e) => /Admin access is not open/.test(e.message));
    const pair = await call('api:post', '/api/pair/start', {});
    assert.strictEqual(pair.code.length, 8);
    assert.ok((await call('pair:qr')).startsWith('data:image/png;base64,'));
    phone.state.completePairing(pair.code);
    const me = await call('session:me');
    assert.strictEqual(me.admin, true);
    const overview = await call('api:get', '/api/admin/overview');
    assert.strictEqual(overview.battery, 83);
    const users = await call('api:get', '/api/admin/users');
    assert.ok(users.pending.some((p) => p.name === 'alice'));
    await call('api:post', '/api/admin/user', { action: 'approve', name: 'alice' });
    assert.strictEqual(phone.state.users.get('alice').status, 'active');
    const reset = await call('api:post', '/api/admin/user', { action: 'reset', name: 'alice' });
    assert.strictEqual(reset.password.length, 10);
    await call('api:post', '/api/admin/end', {});
    assert.strictEqual((await call('session:me')).admin, false);
  });
  await test('change password keeps the remembered password up to date', async () => {
    await call('session:password', { current: 'theater-demo-1', next: 'brand-new-pass-2' });
    await call('servers:disconnect');
    const again = await call('servers:connect', savedPhone.id);
    assert.strictEqual(again.state, 'signed-in', 'reconnects with the new password');
    await assert.rejects(() => call('session:password', { current: 'wrong-one-1', next: 'whatever-pass-3' }), (e) => /current password is wrong/.test(e.message));
  });
  await test('sign out forgets the remembered password', async () => {
    await call('session:logout');
    assert.strictEqual(store.getCredentials(savedPhone.id), null);
    await call('servers:disconnect');
    assert.strictEqual((await call('servers:connect', savedPhone.id)).state, 'login');
  });
  await test('removing a phone disconnects and forgets it', async () => {
    await call('servers:remove', savedPhone.id);
    assert.strictEqual((await call('servers:list')).length, 0);
    await assert.rejects(() => call('api:get', '/api/me'), (e) => e.code === 'NOT_CONNECTED');
  });
  await test('unknown requests and internal errors become plain sentences', async () => {
    const r = await handlers.invoke('nope:nothing');
    assert.strictEqual(r.ok, false);
    await assert.rejects(() => call('servers:connect', 'missing'), (e) => e.code === 'NOT_FOUND');
  });

  handlers.cleanup();
  await proxy.close();
  await phone.close();
  await impostor.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  process.exit(failures.length ? 1 : 0);
})();
