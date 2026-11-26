'use strict';
const https = require('https');
const http = require('http');
const tls = require('tls');
const net = require('net');
const { EventEmitter } = require('events');
const { AppError, fromNetworkError } = require('./errors');
const { fingerprintOf, sameFingerprint } = require('./util');

const COOKIE_NAME = 'pt_session';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'PocketTheaterWindows/0.1 (Windows NT 10.0; Win64; x64)';

/** Reads a whole response, giving up if it is bigger than `max`. */
function readAll(res, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) { res.destroy(); reject(new AppError('The phone sent more data than expected.', 'HTTP')); return; }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', (err) => reject(fromNetworkError(err)));
    res.on('aborted', () => reject(new AppError('The connection to the phone dropped.', 'NETWORK')));
  });
}

/**
 * One phone. Every request goes through here, so the certificate check, the sign-in cookie and the
 * "are you there?" watching live in one place.
 *
 * server: { scheme: 'https' | 'http', host, port, fingerprint }
 * Events: 'status' ({ online, me, signedOut }), 'signed-out'
 */
class Connection extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.secure = server.scheme === 'https';
    this.cookie = '';
    this.creds = null;           // { username, password }, only kept while the person asked to stay signed in
    this.online = true;
    this.failures = 0;
    this.fast = false;
    this.closed = false;
    this.timer = null;
    this.signedOutSent = false;
    this._reauthPromise = null;
    this._lastReauthFailure = 0;
    this.agent = this.secure ? this._pinnedAgent() : new http.Agent({ keepAlive: true, maxSockets: 32 });
  }

  /**
   * An agent that only hands a connection to a request after the phone showed the exact certificate that was
   * trusted. A different certificate closes the connection before anything (like a password) is sent.
   */
  _pinnedAgent() {
    const agent = new https.Agent({ keepAlive: true, maxSockets: 32 });
    const { host, port, fingerprint } = this.server;
    agent.createConnection = (_options, callback) => {
      const opts = { host, port, rejectUnauthorized: false, minVersion: 'TLSv1.2' };
      if (!net.isIP(host)) opts.servername = host;
      const socket = tls.connect(opts);
      let settled = false;
      const settle = (err) => {
        if (settled) return;
        settled = true;
        socket.setTimeout(0);
        if (err) { socket.destroy(); callback(err); } else callback(null, socket);
      };
      socket.setTimeout(8000, () => settle(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      socket.once('error', (err) => settle(err));
      socket.once('secureConnect', () => {
        const cert = socket.getPeerCertificate(false);
        if (!cert || !cert.raw || !sameFingerprint(fingerprintOf(cert.raw), fingerprint)) {
          settle(Object.assign(new Error('certificate changed'), { code: 'CERT_CHANGED' }));
        } else {
          settle(null);
        }
      });
    };
    return agent;
  }

  get base() {
    return this.server.scheme + '://' + this.server.host + ':' + this.server.port;
  }

  _captureCookie(res) {
    const lines = res.headers['set-cookie'];
    if (!lines) return;
    for (const line of lines) {
      const m = new RegExp('^' + COOKIE_NAME + '=([^;]*)').exec(line);
      if (m) this.cookie = m[1];
    }
  }

  /** Sends a request and resolves as soon as the answer's headers arrive. The body is left to the caller. */
  open(method, pathname, options) {
    const opts = options || {};
    return new Promise((resolve, reject) => {
      const lib = this.secure ? https : http;
      const payload = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body));
      const headers = Object.assign({ 'User-Agent': USER_AGENT, Accept: '*/*' }, opts.headers || {});
      if (this.cookie) headers.Cookie = COOKIE_NAME + '=' + this.cookie;
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = payload.length;
      }
      const req = lib.request(
        { host: this.server.host, port: this.server.port, method, path: pathname, agent: this.agent, headers, signal: opts.signal },
        (res) => { this._captureCookie(res); resolve(res); }
      );
      req.on('error', (err) => reject(fromNetworkError(err)));
      if (opts.timeout) {
        req.setTimeout(opts.timeout, () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      }
      if (payload) req.end(payload); else req.end();
    });
  }

  /** A JSON call. Errors from the phone come back as plain sentences in err.message. */
  async json(method, pathname, body, options) {
    const opts = options || {};
    for (let attempt = 0; ; attempt++) {
      const res = await this.open(method, pathname, { body, timeout: opts.timeout || 12000 });
      const buffer = await readAll(res, MAX_JSON_BYTES);
      let data = {};
      try { data = buffer.length ? JSON.parse(buffer.toString('utf8')) : {}; } catch (err) { data = {}; }
      if (res.statusCode === 401 && opts.reauth !== false && attempt === 0 && this.creds && (await this._reauth())) continue;
      if (res.statusCode >= 200 && res.statusCode < 300) return data;
      const message = (data && data.error) || 'Something went wrong (' + res.statusCode + ').';
      throw new AppError(message, res.statusCode === 401 ? 'SIGNED_OUT' : 'HTTP', res.statusCode);
    }
  }

  /** An answer whose body is streamed (files, subtitles). Signs in again once if the session ran out. */
  async stream(pathname, options) {
    const opts = options || {};
    for (let attempt = 0; ; attempt++) {
      const res = await this.open('GET', pathname, { headers: opts.headers, signal: opts.signal });
      if (res.statusCode === 401 && attempt === 0 && this.creds) {
        res.resume();
        if (await this._reauth()) continue;
      }
      return res;
    }
  }

  /** A small file as bytes, for example the QR picture. */
  async buffer(pathname, max) {
    const res = await this.stream(pathname);
    const data = await readAll(res, max || MAX_JSON_BYTES);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      let message = 'Something went wrong (' + res.statusCode + ').';
      try { message = JSON.parse(data.toString('utf8')).error || message; } catch (err) { /* keep the generic sentence */ }
      throw new AppError(message, 'HTTP', res.statusCode);
    }
    return data;
  }

  // ---- accounts ----

  async login(username, password) {
    const data = await this.json('POST', '/api/login', { username, password }, { reauth: false });
    this.signedOutSent = false;
    return data;
  }

  async register(username, password, agree) {
    return this.json('POST', '/api/register', { username, password, agree: !!agree }, { reauth: false });
  }

  async logout() {
    this.creds = null;
    try { await this.json('POST', '/api/logout', {}, { reauth: false }); } catch (err) { /* leaving anyway */ }
    this.cookie = '';
  }

  /** Keeps a password in memory so an expired session can be renewed without asking again. */
  remember(creds) {
    this.creds = creds ? { username: creds.username, password: creds.password } : null;
  }

  async _reauth() {
    if (!this.creds) return false;
    if (this._reauthPromise) return this._reauthPromise;
    // After a failure, wait before trying again so a changed password cannot lock the person out with retries.
    if (Date.now() - this._lastReauthFailure < 30000) return false;
    this._reauthPromise = (async () => {
      try {
        await this.login(this.creds.username, this.creds.password);
        return true;
      } catch (err) {
        this._lastReauthFailure = Date.now();
        if (err.status === 401 || err.status === 403) {
          this.creds = null; // the password is no longer right; keep asking would only get the phone to block this PC
          this.emit('creds-rejected');
        }
        return false;
      } finally {
        this._reauthPromise = null;
      }
    })();
    return this._reauthPromise;
  }

  // ---- watching the link ----

  startMonitor() {
    this.closed = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._tick(), 50);
  }

  /** While a pairing code is on the screen, ask more often so the admin page opens right away. */
  setFast(on) {
    this.fast = !!on;
  }

  _delay() {
    if (this.online) return this.failures > 0 ? 1500 : this.fast ? 1500 : 3000;
    return Math.min(1500 + this.failures * 500, 6000);
  }

  async _tick() {
    if (this.closed) return;
    let me = null;
    let reachable = true;
    let signedOut = false;
    try {
      me = await this.json('GET', '/api/me', undefined, { timeout: 4000 });
    } catch (err) {
      if (err.code === 'SIGNED_OUT') signedOut = true;
      else if (err.code === 'NETWORK' || err.code === 'CERT') reachable = false;
      // any other answer from the phone still means it is there
    }
    if (this.closed) return;
    if (reachable) {
      this.failures = 0;
      this.online = true;
    } else {
      this.failures += 1;
      if (this.failures >= 2) this.online = false; // two misses in a row, so one hiccup does not flash a warning
    }
    if (signedOut && !this.signedOutSent) {
      this.signedOutSent = true;
      this.emit('signed-out');
    }
    if (!signedOut) this.signedOutSent = false;
    this.emit('status', { online: this.online, me, signedOut });
    this.timer = setTimeout(() => this._tick(), this._delay());
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.agent.destroy();
    this.removeAllListeners();
  }
}

module.exports = { Connection, readAll, COOKIE_NAME, USER_AGENT };
