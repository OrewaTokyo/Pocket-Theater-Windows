'use strict';
const fs = require('fs');
const path = require('path');
const { randomId } = require('./util');

/**
 * Saved phones and app settings, as two small JSON files.
 * `secrets` encrypts a remembered password (Windows DPAPI through Electron's safeStorage). If it cannot,
 * passwords are simply not remembered.
 * secrets: { available(): boolean, encrypt(text): Buffer, decrypt(buffer): string }
 */
class Store {
  constructor(dir, secrets) {
    this.dir = dir;
    this.secrets = secrets;
    this.serversFile = path.join(dir, 'servers.json');
    this.settingsFile = path.join(dir, 'settings.json');
  }

  _read(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return fallback;
    }
  }

  _write(file, data) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file); // never leaves a half-written file behind
  }

  _servers() {
    const data = this._read(this.serversFile, { servers: [] });
    return Array.isArray(data.servers) ? data.servers : [];
  }

  /** Every saved phone, newest use first. Secrets stay inside. */
  list() {
    return this._servers().slice().sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  }

  get(id) {
    return this._servers().find((s) => s.id === id) || null;
  }

  /** What the screens may see about a phone: never the stored password. */
  publicView(server) {
    return {
      id: server.id, name: server.name, scheme: server.scheme, host: server.host, port: server.port,
      fingerprint: server.fingerprint || null, secure: server.scheme === 'https',
      username: server.username || null, remembered: !!server.secret, lastUsed: server.lastUsed || 0,
    };
  }

  /** Adds a phone, or updates the one at the same address (for example after trusting a renewed certificate). */
  save(server) {
    const servers = this._servers();
    const at = servers.findIndex((s) => s.host === server.host && s.port === server.port);
    if (at >= 0) {
      const keep = servers[at];
      servers[at] = Object.assign({}, keep, server, { id: keep.id, name: server.name || keep.name });
      this._write(this.serversFile, { servers });
      return servers[at];
    }
    const added = Object.assign({ id: randomId(6), lastUsed: 0 }, server);
    servers.push(added);
    this._write(this.serversFile, { servers });
    return added;
  }

  update(id, changes) {
    const servers = this._servers();
    const at = servers.findIndex((s) => s.id === id);
    if (at < 0) return null;
    servers[at] = Object.assign({}, servers[at], changes);
    this._write(this.serversFile, { servers });
    return servers[at];
  }

  remove(id) {
    this._write(this.serversFile, { servers: this._servers().filter((s) => s.id !== id) });
  }

  touch(id) {
    this.update(id, { lastUsed: Date.now() });
  }

  // ---- remembered sign-in ----

  canRemember() {
    try { return !!this.secrets && this.secrets.available(); } catch (err) { return false; }
  }

  setCredentials(id, username, password) {
    if (!password || !this.canRemember()) {
      this.update(id, { username: username || null, secret: null });
      return false;
    }
    this.update(id, { username, secret: this.secrets.encrypt(password).toString('base64') });
    return true;
  }

  clearCredentials(id) {
    this.update(id, { secret: null });
  }

  getCredentials(id) {
    const server = this.get(id);
    if (!server || !server.secret || !server.username || !this.canRemember()) return null;
    try {
      return { username: server.username, password: this.secrets.decrypt(Buffer.from(server.secret, 'base64')) };
    } catch (err) {
      return null; // for example the file was copied from another Windows account
    }
  }

  // ---- settings ----

  settings() {
    return Object.assign({ externalPlayer: null }, this._read(this.settingsFile, {}));
  }

  setSettings(changes) {
    this._write(this.settingsFile, Object.assign(this.settings(), changes));
  }
}

module.exports = { Store };
