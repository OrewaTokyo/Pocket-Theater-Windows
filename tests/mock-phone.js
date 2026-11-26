'use strict';
// A pretend phone for testing and demos. It speaks the same web API as the real Pocket Theater server
// (same addresses, same answers, same sign-in cookie), over HTTPS with its own certificate.
//
//   npm run mock        starts it and prints the address and a demo account
//
// It is a development tool only. It is never part of the app.
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const FIXTURES = path.join(__dirname, 'fixtures');

// ---- little generated files ----

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A sunset-coloured picture, made on the spot. */
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = Math.min(255, 70 + Math.round((y / h) * 185));
      raw[o + 1] = Math.round(40 + (x / w) * 90);
      raw[o + 2] = Math.round(140 - (y / h) * 90);
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', head), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

function makePdf() {
  return Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
    '4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 40 100 Td (Pocket Theater) Tj ET\nendstream endobj\n' +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}

function patterned(size, seed) {
  const buf = Buffer.alloc(size);
  let x = seed;
  for (let i = 0; i < size; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; buf[i] = x >>> 16; }
  return buf;
}

function file(name, data, mime) { return { name, dir: false, data, mime: mime || 'application/octet-stream', modified: Date.now() - 86400000 }; }
function dir(name, children) { return { name, dir: true, children }; }

function sampleLibraries() {
  const video = fs.existsSync(path.join(FIXTURES, 'sample.webm')) ? fs.readFileSync(path.join(FIXTURES, 'sample.webm')) : patterned(200000, 3);
  const vtt = fs.existsSync(path.join(FIXTURES, 'sample.en.vtt')) ? fs.readFileSync(path.join(FIXTURES, 'sample.en.vtt')) : Buffer.from('WEBVTT\n');
  const sub = (base) => file(base + '.en.vtt', vtt, 'text/vtt');
  return [
    { id: 'lib-detectives', name: 'Midnight Detectives', category: 'Series', tree: dir('', [
      dir('Season 1', [file('S01E01 - Pilot.webm', video, 'video/webm'), sub('S01E01 - Pilot'), file('S01E02 - The Letter.webm', video, 'video/webm'), file('S01E03 - Harbour Lights.webm', video, 'video/webm')]),
      dir('Season 2', [file('S02E01 - Return.webm', video, 'video/webm')]),
      file('cover.png', makePng(640, 360), 'image/png'),
    ]) },
    { id: 'lib-anime', name: 'Sakura Academy', category: 'Anime', tree: dir('', [file('Episode 01.webm', video, 'video/webm'), file('Episode 02.webm', video, 'video/webm')]) },
    { id: 'lib-movies', name: 'Weekend Movies', category: 'Movies', tree: dir('', [file('Tiny Cinema (2024).webm', video, 'video/webm'), sub('Tiny Cinema (2024)')]) },
    { id: 'lib-games', name: 'Retro Games', category: 'Games', tree: dir('', [file('readme.txt', Buffer.from('Games folder\n'), 'text/plain'), file('setup.exe', patterned(5000, 9), 'application/x-msdownload'), file('save-data.bin', patterned(3 * 1024 * 1024 + 123, 5))]) },
    { id: 'lib-docs', name: 'Books and notes', category: 'Documents', tree: dir('', [file('guide.pdf', makePdf(), 'application/pdf'), file('notes.txt', Buffer.from('Remember to buy popcorn.\n'), 'text/plain'), file('page.html', Buffer.from('<script>alert(1)</script>'), 'text/html')]) },
  ];
}

// ---- the server ----

function startMockPhone(options) {
  const opts = Object.assign({ port: 0, secure: true, certFile: null, keyFile: null, autoPair: false, signupsOpen: true }, options || {});
  const libraries = sampleLibraries();
  const state = {
    users: new Map([['demo', { password: 'theater-demo-1', status: 'active', created: Date.now() - 86400000 * 3 }], ['alice', { password: 'alice-secret-1', status: 'pending', created: Date.now() - 3600000 }]]),
    sessions: new Map(),
    pairings: new Map(),
    requests: [],
    signupsOpen: opts.signupsOpen,
    adminPassword: 'admin-demo-1',
    dropFileAfter: 0,
    dropsLeft: 0,
    expireSessions() { state.sessions.clear(); },
    /** Pretends the phone scanned the code and the admin typed the password. */
    completePairing(code) {
      for (const [token, p] of state.pairings) {
        if (p.code === code) { const s = state.sessions.get(token); if (s) s.admin = true; state.pairings.delete(token); return true; }
      }
      return false;
    },
  };

  const json = (res, status, body, headers) => {
    const text = JSON.stringify(body);
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) }, headers || {}));
    res.end(text);
  };
  const err = (res, status, message) => json(res, status, { error: message });

  const cookieOf = (req) => {
    const m = /(?:^|;\s*)pt_session=([^;]*)/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
  };
  const sessionOf = (req) => { const t = cookieOf(req); const s = t && state.sessions.get(t); return s ? Object.assign({ token: t }, s) : null; };

  function walk(lib, parts) {
    let node = lib.tree;
    for (const p of parts) {
      if (!node.dir) return null;
      node = node.children.find((c) => c.name === p);
      if (!node) return null;
    }
    return node;
  }

  const isVideo = (n) => /\.(webm|mp4|mkv)$/i.test(n.name);
  const isSub = (n) => /\.(vtt|srt|ass|ssa)$/i.test(n.name);
  const stem = (name) => name.replace(/\.[^.]+$/, '');

  function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname;
    state.requests.push({ method: req.method, path: pathname, cookie: cookieOf(req), ua: req.headers['user-agent'] });
    const session = sessionOf(req);

    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch (e) { return err(res, 400, 'That request could not be read.'); }
        post(req, res, pathname, body, session);
      });
      return;
    }

    if (pathname === '/api/me') {
      if (!session) return err(res, 401, 'Sign in first.');
      const me = { username: session.name, admin: !!session.admin, admin_ready: true };
      const pair = state.pairings.get(session.token);
      if (pair) me.pair = { code: pair.code, expires_in: 280, scanned: !!pair.scanned };
      return json(res, 200, me);
    }
    if (pathname.startsWith('/legal/') && pathname.endsWith('.md')) {
      const name = path.basename(pathname, '.md');
      const text = '# ' + name.toUpperCase() + '\n\nThis is the **' + name + '** page of the mock phone.\n\n- Be kind\n- Watch together\n';
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      return res.end(text);
    }
    if (pathname === '/api/pair/qr') {
      if (!session) return err(res, 401, 'Sign in first.');
      if (!state.pairings.get(session.token)) return err(res, 404, 'Nothing to pair.');
      const png = makePng(160, 160);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'no-store' });
      return res.end(png);
    }
    if (pathname.startsWith('/api/admin/')) return admin(req, res, pathname, session);
    if (pathname === '/api/libraries') {
      if (!session) return err(res, 401, 'Sign in first.');
      return json(res, 200, { libraries: libraries.map((l) => ({ id: l.id, name: l.name, category: l.category, items: l.tree.children.length })) });
    }
    if (pathname === '/api/list') {
      if (!session) return err(res, 401, 'Sign in first.');
      const lib = libraries.find((l) => l.id === url.searchParams.get('lib'));
      if (!lib) return err(res, 404, 'Unknown folder');
      const parts = (url.searchParams.get('path') || '').split('/').filter(Boolean);
      if (parts.some((p) => p === '..' || p.startsWith('.'))) return err(res, 400, 'Invalid path');
      const node = walk(lib, parts);
      if (!node) return err(res, 404, 'Folder not found');
      if (!node.dir) return err(res, 400, 'Not a folder');
      const subs = node.children.filter((c) => !c.dir && isSub(c));
      const entries = node.children.filter((c) => c.dir || !isSub(c)).map((c) => {
        const e = { name: c.name, dir: c.dir, size: c.dir ? -1 : c.data.length, mime: c.dir ? '' : c.mime, modified: c.modified || 0 };
        if (!c.dir && isVideo(c)) {
          const found = subs.filter((s) => s.name.startsWith(stem(c.name) + '.'));
          if (found.length) e.subs = found.map((s) => ({ label: 'English', lang: 'en', path: parts.concat(s.name).join('/') }));
        }
        return e;
      });
      return json(res, 200, { library: { id: lib.id, name: lib.name, category: lib.category }, path: parts, entries });
    }
    if (pathname === '/file' || pathname === '/subtitle') {
      if (!session) return err(res, 401, 'Sign in first.');
      const lib = libraries.find((l) => l.id === url.searchParams.get('lib'));
      const parts = (url.searchParams.get('path') || '').split('/').filter(Boolean);
      const node = lib && parts.length && !parts.some((p) => p.startsWith('.')) ? walk(lib, parts) : null;
      if (!node) return err(res, 404, 'File not found');
      if (node.dir) return err(res, 400, 'That is a folder');
      let data = node.data;
      let mime = node.mime;
      const headers = {};
      if (pathname === '/subtitle') { mime = 'text/vtt; charset=utf-8'; }
      else if (/^(text\/html|application\/javascript)/.test(mime)) { mime = 'application/octet-stream'; headers['Content-Disposition'] = 'attachment'; }
      const total = data.length;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      headers['Content-Type'] = mime;
      headers['Accept-Ranges'] = 'bytes';
      let status = 200;
      let body = data;
      if (range && pathname === '/file') {
        const start = range[1] === '' ? total - parseInt(range[2], 10) : parseInt(range[1], 10);
        const end = range[1] === '' || range[2] === '' ? total - 1 : Math.min(parseInt(range[2], 10), total - 1);
        if (start > end || start >= total) { res.writeHead(416, { 'Content-Range': 'bytes */' + total }); return res.end(); }
        headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + total;
        status = 206;
        body = data.subarray(start, end + 1);
      }
      headers['Content-Length'] = body.length;
      res.writeHead(status, headers);
      // Test switch: cut the connection part-way, like a Wi-Fi hiccup or a phone that gives up on a slow reader.
      if (pathname === '/file' && state.dropFileAfter > 0 && state.dropsLeft > 0 && body.length > state.dropFileAfter * 2) {
        state.dropsLeft--;
        res.write(body.subarray(0, state.dropFileAfter));
        return setTimeout(() => res.socket.destroy(), 30);
      }
      return res.end(body);
    }
    if (pathname === '/' || pathname === '/login.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<h1>Mock phone</h1>'); }
    return err(res, 404, 'Not found');
  }

  function post(req, res, pathname, body, session) {
    if (pathname === '/api/login') {
      const name = String(body.username || '').toLowerCase();
      const user = state.users.get(name);
      if (!user || user.password !== body.password) return err(res, 401, 'Wrong username or password.');
      if (user.status === 'pending') return err(res, 403, 'Your request is still waiting for the admin to approve it.');
      if (user.status === 'off') return err(res, 403, 'This account is turned off. Ask the admin.');
      const token = crypto.randomBytes(24).toString('base64url');
      state.sessions.set(token, { name, admin: false, since: Date.now(), label: 'Browser on Windows' });
      return json(res, 200, { username: name }, { 'Set-Cookie': 'pt_session=' + token + '; Path=/; Max-Age=1209600; HttpOnly; SameSite=Strict' + (opts.secure ? '; Secure' : '') });
    }
    if (pathname === '/api/register') {
      if (!state.signupsOpen) return err(res, 403, 'New sign-ups are closed right now. Ask the admin.');
      const name = String(body.username || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(name)) return err(res, 400, 'Username must be 3 to 20 letters, numbers or _ (lowercase).');
      if (String(body.password || '').length < 8) return err(res, 400, 'Password needs at least 8 characters.');
      if (!body.agree) return err(res, 400, 'Please accept the Terms of Use and the Privacy Policy.');
      if (state.users.has(name)) return err(res, 400, 'That username is taken.');
      state.users.set(name, { password: body.password, status: 'pending', created: Date.now() });
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/logout') {
      const t = cookieOf(req); if (t) state.sessions.delete(t);
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'pt_session=; Path=/; Max-Age=0' });
    }
    if (!session) return err(res, 401, 'Sign in first.');
    if (pathname === '/api/password') {
      const user = state.users.get(session.name);
      if (user.password !== body.current) return err(res, 403, 'Your current password is wrong.');
      if (String(body.next || '').length < 8) return err(res, 400, 'Password needs at least 8 characters.');
      user.password = body.next;
      state.sessions.delete(session.token);
      const token = crypto.randomBytes(24).toString('base64url');
      state.sessions.set(token, { name: session.name, admin: false, since: Date.now(), label: 'Browser on Windows' });
      return json(res, 200, { username: session.name }, { 'Set-Cookie': 'pt_session=' + token + '; Path=/; Max-Age=1209600; HttpOnly; SameSite=Strict' });
    }
    if (pathname === '/api/pair/start') {
      const code = crypto.randomBytes(5).toString('hex').slice(0, 8).toUpperCase();
      state.pairings.set(session.token, { code, scanned: false });
      if (opts.autoPair) setTimeout(() => { const p = state.pairings.get(session.token); if (p) p.scanned = true; }, 2500), setTimeout(() => state.completePairing(code), 5000);
      return json(res, 200, { code, expires_in: 280, scanned: false });
    }
    if (pathname === '/api/pair/cancel') { state.pairings.delete(session.token); return json(res, 200, { ok: true }); }
    if (!session.admin) return err(res, 403, 'Admin access is not open on this device. Tap Admin sign-in at the top of the site and scan the QR code with the phone.');
    if (pathname === '/api/admin/end') { session.admin = false; const s = state.sessions.get(session.token); if (s) s.admin = false; return json(res, 200, { ok: true }); }
    if (pathname === '/api/admin/user') {
      const name = String(body.name || '').toLowerCase();
      const user = state.users.get(name);
      if (!user) return err(res, 404, 'No such account.');
      if (name === session.name) return err(res, 400, 'Use the phone to change your own account.');
      const out = { ok: true };
      switch (body.action) {
        case 'approve': user.status = 'active'; break;
        case 'decline': case 'delete': state.users.delete(name); break;
        case 'off': user.status = 'off'; break;
        case 'on': user.status = 'active'; break;
        case 'reset': user.password = 'reset-pass-' + Math.floor(Math.random() * 90 + 10); out.password = 'k7m3q9x2pa'; break;
        default: return err(res, 400, 'Unknown action.');
      }
      return json(res, 200, out);
    }
    if (pathname === '/api/admin/device') {
      for (const [t, s] of state.sessions) {
        if (t.slice(0, 8) === body.id) { if (body.action === 'signout') state.sessions.delete(t); else s.admin = false; }
      }
      return json(res, 200, { ok: true });
    }
    return err(res, 404, 'Not found');
  }

  function admin(req, res, pathname, session) {
    if (!session) return err(res, 401, 'Sign in first.');
    if (!session.admin) return err(res, 403, 'Admin access is not open on this device. Tap Admin sign-in at the top of the site and scan the QR code with the phone.');
    if (pathname === '/api/admin/overview') {
      const members = [...state.users.values()].filter((u) => u.status !== 'pending').length;
      const waiting = [...state.users.values()].filter((u) => u.status === 'pending').length;
      return json(res, 200, { awake: '2 h 14 min', awake_total: '41 h', members, waiting, online: state.sessions.size, data_total: '12.4 GB', data_session: '1.1 GB', requests_total: '8,204', requests_session: '312', cpu: 14, ram: 52, battery: 83, charging: true });
    }
    if (pathname === '/api/admin/users') {
      const pending = [], members = [];
      for (const [name, u] of state.users) (u.status === 'pending' ? pending : members).push(u.status === 'pending' ? { name, created: u.created } : { name, status: u.status === 'off' ? 'off' : 'active', created: u.created });
      return json(res, 200, { pending, members });
    }
    if (pathname === '/api/admin/devices') {
      const devices = [...state.sessions].map(([t, s]) => ({ id: t.slice(0, 8), user: s.name, label: s.label, ip: '192.168.1.40', since: s.since, admin: !!s.admin, you: t === session.token }));
      return json(res, 200, { devices });
    }
    return err(res, 404, 'Not found');
  }

  const server = opts.secure
    ? https.createServer({ cert: fs.readFileSync(opts.certFile), key: fs.readFileSync(opts.keyFile) }, handle)
    : http.createServer(handle);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        state,
        server,
        close: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections(); }),
      });
    });
  });
}

/** Makes a throw-away certificate with the openssl program, the way the phone makes its own. Returns file paths. */
function makeCertificate(dirPath, name) {
  fs.mkdirSync(dirPath, { recursive: true });
  const certFile = path.join(dirPath, (name || 'phone') + '-cert.pem');
  const keyFile = path.join(dirPath, (name || 'phone') + '-key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '30', '-subj', '/CN=Pocket Theater'], { stdio: 'ignore' });
  return { certFile, keyFile };
}

module.exports = { startMockPhone, makeCertificate, makePng };

if (require.main === module) {
  (async () => {
    const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-mock-'));
    const { certFile, keyFile } = makeCertificate(dirPath);
    const phone = await startMockPhone({ port: Number(process.env.PORT) || 8443, certFile, keyFile, autoPair: true });
    const { X509Certificate } = require('crypto');
    const fp = new X509Certificate(fs.readFileSync(certFile)).fingerprint256;
    console.log('Mock phone ready.');
    console.log('  Address:      127.0.0.1:' + phone.port);
    console.log('  Fingerprint:  ' + fp);
    console.log('  Sign in:      demo / theater-demo-1   (admin password for pairing: pairing completes by itself)');
    console.log('Press Ctrl+C to stop.');
  })();
}
