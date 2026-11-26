'use strict';
const fs = require('fs');
const path = require('path');
const { Connection, readAll } = require('./connection');
const { probeCertificate } = require('./tls-trust');
const { AppError, fromNetworkError, CERT_MESSAGE } = require('./errors');
const { parseAddress, sameFingerprint, safeFileName, canOpenDirectly, fileQuery, randomId } = require('./util');
const { downloadFile } = require('./files');

const GET_ALLOWED = /^\/api\/(me|libraries|list\?[^\s]*|admin\/(overview|users|devices))$/;
const POST_ALLOWED = /^\/api\/(pair\/(start|cancel)|admin\/(end|device|user))$/;
const LEGAL_DOCS = new Set(['terms', 'privacy', 'security']);

/**
 * Everything the window can ask for. Electron things (dialogs, the shell, folders) come in through `ctx`, so
 * tests can run all of this with plain Node.
 *
 * ctx: { store, proxy, dialog, shell, app: { getPath(name), getVersion() }, players, send(channel, payload),
 *        getWindow(), tempDir }
 */
function createHandlers(ctx) {
  const state = { conn: null, serverId: null, username: null, downloads: new Map(), saved: new Map() };

  function need() {
    if (!state.conn) throw new AppError('Not connected to a phone.', 'NOT_CONNECTED');
    return state.conn;
  }

  function closeConnection() {
    if (state.conn) state.conn.close();
    for (const d of state.downloads.values()) d.controller.abort();
    state.conn = null;
    state.serverId = null;
    state.username = null;
  }

  /** Asks a place for /api/me and checks that it really is a Pocket Theater phone. */
  async function verifyIsPocketTheater(server) {
    const conn = new Connection(server);
    try {
      const res = await conn.open('GET', '/api/me', { timeout: 6000 });
      const body = await readAll(res, 64 * 1024);
      let data = null;
      try { data = JSON.parse(body.toString('utf8')); } catch (err) { data = null; }
      const isTheater = data && typeof data === 'object' && (typeof data.error === 'string' || typeof data.username === 'string');
      if (res.statusCode >= 300 && res.statusCode < 400) {
        throw new AppError('That address sent the app somewhere else. Try https://' + server.host + ':8443', 'NOT_THEATER');
      }
      if (!isTheater) throw new AppError('Something answered at that address, but it is not a Pocket Theater phone.', 'NOT_THEATER');
    } finally {
      conn.close();
    }
  }

  function fileArgs(args) {
    const lib = args && args.lib;
    const parts = args && args.parts;
    if (typeof lib !== 'string' || !lib || !Array.isArray(parts) || !parts.length || !parts.every((p) => typeof p === 'string' && p)) {
      throw new AppError('That file could not be found.', 'BAD_REQUEST');
    }
    return { lib, parts, name: parts[parts.length - 1] };
  }

  // ---- video players on this PC ----
  const allowedPlayers = new Set();
  let playerCache = { at: 0, list: [] };

  async function detectPlayers(fresh) {
    if (!fresh && Date.now() - playerCache.at < 30000) return playerCache.list;
    const list = await ctx.players.detect();
    playerCache = { at: Date.now(), list };
    list.forEach((p) => allowedPlayers.add(p.path));
    return list;
  }

  function savedPlayer() {
    const saved = ctx.store.settings().externalPlayer;
    if (!saved || !fs.existsSync(saved)) return null;
    allowedPlayers.add(saved);
    return saved;
  }

  function playerName(exe) {
    const known = playerCache.list.find((p) => p.path === exe);
    return known ? known.name : path.basename(exe).replace(/\.exe$/i, '');
  }

  function startDownload(conn, lib, parts, destPath, open) {
    const name = parts[parts.length - 1];
    const id = randomId(6);
    const controller = new AbortController();
    state.downloads.set(id, { controller });
    const report = (extra) => ctx.send('download:progress', Object.assign({ id, name }, extra));
    report({ state: 'running', received: 0, total: 0, opening: open });
    downloadFile(conn, lib, parts, destPath, {
      signal: controller.signal,
      onProgress: (received, total) => report({ state: 'running', received, total, opening: open }),
    }).then(async (bytes) => {
      if (open) {
        const problem = await ctx.shell.openPath(destPath);
        if (problem) { report({ state: 'error', message: "Windows could not open that file: " + problem, path: destPath }); return; }
      }
      if (!open) state.saved.set(id, destPath);
      report({ state: 'done', received: bytes, total: bytes, path: destPath, opening: open });
    }).catch((err) => {
      report(err.code === 'ABORT' ? { state: 'canceled' } : { state: 'error', message: err.message || 'The download failed.' });
    }).finally(() => state.downloads.delete(id));
    return { id, name };
  }

  const handlers = {
    // ---- the app ----
    'app:info': async () => ({ version: ctx.app.getVersion(), platform: process.platform, canRemember: ctx.store.canRemember() }),

    // ---- phones ----
    'servers:list': async () => ctx.store.list().map((s) => ctx.store.publicView(s)),

    'servers:probe': async (address) => {
      const candidates = parseAddress(address);
      if (!candidates) throw new AppError('That does not look like an address. Try something like 192.168.1.20', 'BAD_ADDRESS');
      let lastError = null;
      for (const c of candidates) {
        try {
          if (c.scheme === 'https') {
            const cert = await probeCertificate(c.host, c.port);
            await verifyIsPocketTheater({ scheme: 'https', host: c.host, port: c.port, fingerprint: cert.fingerprint });
            return { scheme: 'https', host: c.host, port: c.port, secure: true, fingerprint: cert.fingerprint, subject: cert.subject, validTo: cert.validTo };
          }
          await verifyIsPocketTheater({ scheme: 'http', host: c.host, port: c.port });
          return { scheme: 'http', host: c.host, port: c.port, secure: false, fingerprint: null };
        } catch (err) {
          const e = fromNetworkError(err);
          if (!lastError || e.code === 'NOT_THEATER') lastError = e;
        }
      }
      throw lastError || new AppError("Can't reach the phone.", 'NETWORK');
    },

    'servers:trust': async (candidate, name) => {
      const c = candidate || {};
      if (!/^https?$/.test(c.scheme) || !/^[a-z0-9.-]{1,100}$/.test(c.host || '') || !Number.isInteger(c.port)) {
        throw new AppError('That phone could not be saved.', 'BAD_REQUEST');
      }
      if (c.scheme === 'https') {
        // Look again: the fingerprint the person compared must still be the one the phone shows.
        const cert = await probeCertificate(c.host, c.port);
        if (!sameFingerprint(cert.fingerprint, c.fingerprint)) throw new AppError(CERT_MESSAGE, 'CERT');
      }
      const label = String(name || '').trim().slice(0, 40) || c.host;
      const saved = ctx.store.save({ name: label, scheme: c.scheme, host: c.host, port: c.port, fingerprint: c.scheme === 'https' ? c.fingerprint : null });
      return ctx.store.publicView(saved);
    },

    'servers:connect': async (id) => {
      const record = ctx.store.get(id);
      if (!record) throw new AppError('That phone is not saved any more.', 'NOT_FOUND');
      closeConnection();
      const conn = new Connection(record);
      let username = null;
      let note = null;
      try {
        const saved = ctx.store.getCredentials(id);
        if (saved) {
          try {
            await conn.login(saved.username, saved.password);
            conn.remember(saved);
            username = saved.username;
          } catch (err) {
            if (err.status === 401 || err.status === 403) {
              if (err.status === 401) ctx.store.clearCredentials(id);
              note = err.message;
            } else {
              throw err;
            }
          }
        } else {
          try { await conn.json('GET', '/api/me', undefined, { reauth: false, timeout: 8000 }); } catch (err) { if (err.code !== 'SIGNED_OUT') throw err; }
        }
      } catch (err) {
        conn.close();
        throw err;
      }
      state.conn = conn;
      state.serverId = id;
      state.username = username;
      ctx.store.touch(id);
      conn.on('status', (s) => ctx.send('conn:status', s));
      conn.on('signed-out', () => ctx.send('conn:signed-out'));
      conn.on('creds-rejected', () => ctx.store.clearCredentials(id));
      conn.startMonitor();
      const view = ctx.store.publicView(ctx.store.get(id));
      if (!username) return { server: view, state: 'login', note, username: view.username };
      const me = await conn.json('GET', '/api/me');
      return { server: view, state: 'signed-in', username, me };
    },

    'servers:disconnect': async () => { closeConnection(); return true; },

    'servers:remove': async (id) => {
      if (state.serverId === id) closeConnection();
      ctx.store.remove(id);
      return true;
    },

    'servers:rename': async (id, name) => {
      const label = String(name || '').trim().slice(0, 40);
      if (!label) throw new AppError('Give the phone a name.', 'BAD_REQUEST');
      ctx.store.update(id, { name: label });
      return true;
    },

    // ---- accounts ----
    'session:login': async (form) => {
      const conn = need();
      const username = String((form && form.username) || '').trim().toLowerCase();
      const password = String((form && form.password) || '');
      await conn.login(username, password);
      const remember = !!(form && form.remember);
      let remembered = false;
      if (remember) {
        remembered = ctx.store.setCredentials(state.serverId, username, password);
        conn.remember(remembered ? { username, password } : null);
      } else {
        conn.remember(null);
        ctx.store.setCredentials(state.serverId, username, null);
      }
      state.username = username;
      const me = await conn.json('GET', '/api/me');
      return { username, me, remembered };
    },

    'session:register': async (form) => {
      const conn = need();
      const username = String((form && form.username) || '').trim().toLowerCase();
      await conn.register(username, String((form && form.password) || ''), !!(form && form.agree));
      return { ok: true };
    },

    'session:logout': async () => {
      const conn = need();
      await conn.logout();
      ctx.store.clearCredentials(state.serverId);
      state.username = null;
      return true;
    },

    'session:me': async () => need().json('GET', '/api/me'),

    'session:password': async (form) => {
      const conn = need();
      const next = String((form && form.next) || '');
      await conn.json('POST', '/api/password', { current: String((form && form.current) || ''), next });
      // The phone signed this PC in again with the new password. Keep a remembered password up to date.
      if (conn.creds && state.username) {
        const stored = ctx.store.setCredentials(state.serverId, state.username, next);
        conn.remember(stored ? { username: state.username, password: next } : null);
      }
      return true;
    },

    // ---- talking to the phone ----
    'api:get': async (pathname) => {
      if (typeof pathname !== 'string' || !GET_ALLOWED.test(pathname)) throw new AppError('That request is not allowed.', 'BAD_REQUEST');
      return need().json('GET', pathname);
    },

    'api:post': async (pathname, body) => {
      if (typeof pathname !== 'string' || !POST_ALLOWED.test(pathname)) throw new AppError('That request is not allowed.', 'BAD_REQUEST');
      return need().json('POST', pathname, body && typeof body === 'object' ? body : {});
    },

    'legal:get': async (which) => {
      if (!LEGAL_DOCS.has(which)) throw new AppError('Unknown page.', 'BAD_REQUEST');
      return (await need().buffer('/legal/' + which + '.md', 512 * 1024)).toString('utf8');
    },

    'pair:qr': async () => 'data:image/png;base64,' + (await need().buffer('/api/pair/qr', 512 * 1024)).toString('base64'),

    'monitor:fast': async (on) => { if (state.conn) state.conn.setFast(!!on); return true; },

    'media:base': async () => ctx.proxy.base,

    // ---- files ----
    'file:save': async (args) => {
      const conn = need();
      const { lib, parts, name } = fileArgs(args);
      const result = await ctx.dialog.showSaveDialog(ctx.getWindow(), { defaultPath: path.join(ctx.app.getPath('downloads'), safeFileName(name)) });
      if (result.canceled || !result.filePath) return { canceled: true };
      return startDownload(conn, lib, parts, result.filePath, false);
    },

    'file:open': async (args) => {
      const conn = need();
      const { lib, parts, name } = fileArgs(args);
      if (!canOpenDirectly(name)) {
        throw new AppError('This kind of file can run programs, so it can only be saved, never opened from here. Use Save.', 'UNSAFE');
      }
      const dir = path.join(ctx.tempDir, randomId(4));
      fs.mkdirSync(dir, { recursive: true });
      return startDownload(conn, lib, parts, path.join(dir, safeFileName(name)), true);
    },

    'file:reveal': async (id) => {
      const saved = state.saved.get(id);
      if (!saved) throw new AppError('That file is not in the list any more.', 'NOT_FOUND');
      ctx.shell.showItemInFolder(saved);
      return true;
    },

    'file:cancel': async (id) => {
      const d = state.downloads.get(id);
      if (d) d.controller.abort();
      return true;
    },

    // ---- outside players ----
    // The app hands the player a link on this PC (never the phone's own address). Which programs may be used:
    // the ones found on this PC, plus one the person picked with the file chooser.
    'player:info': async () => {
      const saved = savedPlayer();
      const list = await detectPlayers(false);
      const chosen = saved || (list.find((p) => p.id === 'vlc') || {}).path || null;
      return { player: chosen ? playerName(chosen) : null, saved: !!saved };
    },

    'player:list': async () => ({ players: await detectPlayers(true), saved: savedPlayer() }),

    'player:launch': async (args) => {
      need();
      const { lib, parts } = fileArgs(args);
      await detectPlayers(false);
      let exe = null;
      if (args.playerPath) {
        if (!allowedPlayers.has(args.playerPath) || !fs.existsSync(args.playerPath)) throw new AppError('That player is not available.', 'BAD_REQUEST');
        exe = args.playerPath;
        if (args.remember) ctx.store.setSettings({ externalPlayer: exe });
      } else {
        exe = savedPlayer() || (playerCache.list.find((p) => p.id === 'vlc') || {}).path || null;
      }
      if (!exe) throw new AppError('No video player is chosen yet.', 'NO_PLAYER');
      await ctx.players.launch(exe, ctx.proxy.base + '/file?' + fileQuery(lib, parts));
      return { player: playerName(exe) };
    },

    'player:set': async (args) => {
      const exe = args && args.path;
      if (!exe || !allowedPlayers.has(exe) || !fs.existsSync(exe)) throw new AppError('That player is not available.', 'BAD_REQUEST');
      ctx.store.setSettings({ externalPlayer: exe });
      return { player: playerName(exe) };
    },

    'player:forget': async () => { ctx.store.setSettings({ externalPlayer: null }); return true; },

    'player:choose': async () => {
      const result = await ctx.dialog.showOpenDialog(ctx.getWindow(), {
        title: 'Choose a video player',
        properties: ['openFile'],
        filters: [{ name: 'Programs', extensions: ['exe'] }],
      });
      if (result.canceled || !result.filePaths || !result.filePaths[0]) return { canceled: true };
      const exe = result.filePaths[0];
      if (!/\.exe$/i.test(exe)) throw new AppError('Pick a program (an .exe file).', 'BAD_REQUEST');
      allowedPlayers.add(exe);
      return { path: exe, name: playerName(exe) };
    },

    'media:stats': async () => ctx.proxy.stats(),

    'app:openHelp': async (which) => {
      if (which !== 'vlc') throw new AppError('Unknown page.', 'BAD_REQUEST');
      await ctx.shell.openExternal('https://www.videolan.org/vlc/');
      return true;
    },
  };

  /** Runs a handler and turns any error into { ok: false, error } so the window always gets a sentence. */
  async function invoke(channel, ...args) {
    const handler = handlers[channel];
    if (!handler) return { ok: false, error: { message: 'Unknown request.', code: 'BAD_REQUEST', status: 0 } };
    try {
      return { ok: true, data: await handler(...args) };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: { message: err.message, code: err.code, status: err.status } };
      if (err && typeof err.code === 'string') {
        const known = fromNetworkError(err); // a Node network error such as ECONNREFUSED
        return { ok: false, error: { message: known.message, code: known.code, status: 0 } };
      }
      console.error('Unexpected error in', channel, err);
      return { ok: false, error: { message: 'Something went wrong inside the app.', code: 'INTERNAL', status: 0 } };
    }
  }

  function cleanup() {
    closeConnection();
    try { fs.rmSync(ctx.tempDir, { recursive: true, force: true }); } catch (err) { /* a program may still have a file open */ }
  }

  return { invoke, channels: Object.keys(handlers), cleanup, state };
}

module.exports = { createHandlers };
