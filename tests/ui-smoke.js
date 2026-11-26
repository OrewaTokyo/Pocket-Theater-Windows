'use strict';
// Drives the real window (page, scripts, preload, engine) in a headless browser against the pretend phone,
// and saves screenshots. Developer tool: needs Playwright and the openssl program. Run: node tests/ui-smoke.js [shots-folder]
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
let playwright;
try { playwright = require('playwright'); } catch (err) { playwright = require('/opt/npm-tools/node_modules/playwright'); }
const { startMockPhone, makeCertificate } = require('./mock-phone');
const { Store } = require('../src/main/store');
const { createHandlers } = require('../src/main/handlers');
const { startProxy } = require('../src/main/proxy');

const shotsDir = process.argv[2] || path.join(os.tmpdir(), 'pt-shots');
fs.mkdirSync(shotsDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let step = 0;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-ui-'));
  const { certFile, keyFile } = makeCertificate(tmp);
  const phone = await startMockPhone({ certFile, keyFile });
  const store = new Store(path.join(tmp, 'app'), { available: () => true, encrypt: (t) => Buffer.from(t).reverse(), decrypt: (b) => Buffer.from(b).reverse().toString() });
  let handlers;
  const proxy = await startProxy(() => (handlers ? handlers.state.conn : null));

  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
  const problems = [];
  page.on('pageerror', (err) => problems.push('page error: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') problems.push('console: ' + msg.text()); });

  const opened = [];
  const launches = [];
  handlers = createHandlers({
    store, proxy,
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(tmp, 'saved-by-ui.bin') }), showOpenDialog: async () => ({ canceled: true }) },
    shell: { openPath: async (p) => { opened.push(p); return ''; }, showItemInFolder: () => {} },
    app: { getPath: () => tmp, getVersion: () => '0.1.0' },
    players: { findVlc: () => null, launch: async (exe, url) => { launches.push(url); } },
    send: (channel, payload) => { page.evaluate(([c, p]) => window.__emit && window.__emit(c, p), [channel, payload]).catch(() => {}); },
    getWindow: () => null,
    tempDir: path.join(tmp, 'open'),
  });

  await page.exposeFunction('__invoke', (channel, args) => handlers.invoke(channel, ...args));
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload.js'), 'utf8');
  await page.addInitScript(`(function () {
    const listeners = {};
    const electron = {
      contextBridge: { exposeInMainWorld: (name, api) => { window[name] = api; } },
      ipcRenderer: {
        invoke: (channel, ...args) => window.__invoke(channel, args),
        on: (channel, fn) => { (listeners[channel] = listeners[channel] || []).push(fn); },
        removeListener: (channel, fn) => { listeners[channel] = (listeners[channel] || []).filter((f) => f !== fn); },
      },
    };
    window.__emit = (channel, payload) => (listeners[channel] || []).forEach((fn) => fn({}, payload));
    const require = (name) => { if (name === 'electron') return electron; throw new Error('not available: ' + name); };
    ${preload}
  })();`);

  async function shot(name) {
    step++;
    const file = path.join(shotsDir, String(step).padStart(2, '0') + '-' + name + '.png');
    await page.screenshot({ path: file });
    console.log('  shot ' + path.basename(file));
  }
  const text = (t, opts) => page.getByText(t, opts);

  await page.goto('file://' + path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

  console.log('First run: add the phone');
  await page.locator('#address').waitFor();
  await shot('add-phone');
  await page.fill('#address', '127.0.0.1:' + phone.port);
  await page.click('text=Find phone');
  await text('Found your phone').waitFor();
  assert.ok(await page.locator('.fingerprint').innerText().then((t) => /^([0-9A-F]{2}:){15}[0-9A-F]{2}/.test(t)), 'fingerprint is shown');
  await shot('trust');
  await page.fill('#phone-name', 'Living room phone');
  await page.click('text=It matches, continue');

  console.log('Request access, then sign in');
  await text('Request access').first().waitFor();
  await page.click('button.tab:has-text("Request access")');
  await page.fill('#username', 'newbie');
  await page.fill('#password', 'short');
  await page.click('button[type=submit]');
  await text('Password needs at least 8 characters.').waitFor();
  await page.fill('#password', 'newbie-pass-1');
  await page.click('button.linklike:has-text("Terms of Use")');
  await text('TERMS').first().waitFor();
  await shot('terms');
  await page.click('.modal button:has-text("Close")');
  await page.check('#agree');
  await page.click('button[type=submit]');
  await text('Request sent. You can sign in once the admin approves it.').waitFor();
  await page.fill('#username', 'demo');
  await page.fill('#password', 'theater-demo-1');
  await page.click('button[type=submit]');

  console.log('Home and shelves');
  await text('Welcome, demo').waitFor();
  await page.locator('.tile:has-text("Series")').waitFor();
  await shot('home');
  await page.click('.tile:has-text("Series")');
  await page.locator('.card-link:has-text("Midnight Detectives")').click();
  await page.locator('.ticket:has-text("Season 1")').waitFor();
  await shot('folder-root');
  await page.locator('.ticket-main:has-text("Season 1")').click();
  await page.locator('.ticket:has-text("S01E01")').waitFor();
  assert.strictEqual(await page.locator('.ticket').count(), 3, 'three episodes, the subtitle file is not listed');
  await page.fill('input.filter', 'harbour');
  assert.strictEqual(await page.locator('.ticket:visible').count(), 1);
  await shot('folder-filter');
  await page.fill('input.filter', '');

  console.log('Play a video with subtitles');
  await page.locator('.ticket-main:has-text("S01E01")').click();
  await page.locator('video').waitFor();
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2; }, null, { timeout: 8000 });
  assert.strictEqual(await page.evaluate(() => document.querySelectorAll('video track').length), 1, 'subtitle track attached');
  assert.ok(await page.evaluate(() => document.querySelector('video').duration > 5), 'the video has a length');
  await page.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 1; Array.from(v.textTracks).forEach((t) => { t.mode = 'showing'; }); });
  await sleep(500);
  await shot('video');
  await page.keyboard.press('Control+ArrowRight');
  await page.locator('.viewer-title:has-text("S01E02 - The Letter.webm")').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#viewer-root').waitFor({ state: 'hidden' });

  console.log('Play in VLC with no player, runnable files, saving');
  await page.locator('.ticket:has-text("S01E01") >> text=Play in VLC').click();
  await text('No outside player found').waitFor();
  await shot('no-player');
  await page.click('.modal button:has-text("Close")');
  assert.strictEqual(launches.length, 0);

  await page.goto(page.url().replace(/#.*/, '') + '#/lib/lib-games');
  await page.locator('.ticket:has-text("setup.exe")').waitFor();
  await page.locator('.ticket:has-text("setup.exe") >> text=Open').click();
  await text('This file can run programs').waitFor();
  await shot('unsafe');
  await page.click('.modal button:has-text("Save it instead")');
  await page.locator('.dl:has-text("setup.exe")').waitFor();
  await page.locator('.dl:has-text("setup.exe") >> text=Show in folder').waitFor();
  await shot('downloads');
  assert.ok(fs.existsSync(path.join(tmp, 'saved-by-ui.bin')));

  console.log('Pictures and PDFs');
  await page.goto(page.url().replace(/#.*/, '') + '#/lib/lib-detectives');
  await page.locator('.ticket-main:has-text("cover.png")').click();
  await page.locator('img.fit').waitFor();
  await page.waitForFunction(() => { const i = document.querySelector('.viewer img'); return i && i.complete && i.naturalWidth > 0; });
  await shot('image');
  await page.keyboard.press('Escape');
  await page.goto(page.url().replace(/#.*/, '') + '#/lib/lib-docs');
  await page.locator('.ticket-main:has-text("guide.pdf")').click();
  await page.locator('iframe.pdf').waitFor();
  await page.keyboard.press('Escape');

  console.log('Admin sign-in');
  await page.goto(page.url().replace(/#.*/, '') + '#/');
  await page.click('button.nav-item:has-text("Admin sign-in")');
  await page.locator('.pair-code').waitFor();
  await page.locator('img.qr').waitFor();
  const code = await page.locator('.pair-code').innerText();
  await shot('pairing');
  phone.state.completePairing(code);
  await page.locator('h1:has-text("Admin")').waitFor({ timeout: 8000 });
  await page.locator('.stat-value:has-text("83%")').waitFor();
  await page.locator('.arow:has-text("alice") >> text=Approve').click();
  await text('alice was approved.').waitFor();
  await shot('admin');
  await page.click('text=End admin session');
  await page.locator('h1:has-text("Welcome")').waitFor();

  console.log('Account');
  await page.click('a.nav-item:has-text("Account")');
  await page.locator('h1:has-text("Account")').waitFor();
  await text('This PC keeps you signed in.').waitFor();
  await page.fill('#cur', 'theater-demo-1');
  await page.fill('#new', 'a-better-password-9');
  await page.click('button:has-text("Change password")');
  await text('Password changed.').waitFor();
  await shot('account');

  console.log('Lost connection and coming back');
  await phone.close();
  await page.locator('.banner.offline').waitFor({ timeout: 12000 });
  await shot('offline');

  console.log('Sign out');
  await page.click('a.nav-item:has-text("Home")').catch(() => {});

  await browser.close();
  await proxy.close();
  handlers.cleanup();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (problems.length) {
    console.log('\nProblems seen in the page:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('\nUI smoke test finished without problems. Screenshots: ' + shotsDir);
})().catch((err) => { console.error('\nFAILED: ' + (err && err.stack || err)); process.exit(1); });
