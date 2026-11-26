'use strict';
// Small helpers with no Electron in them, so they can be tested with plain Node.
const crypto = require('crypto');

const HTTPS_PORT = 8443; // the phone's secure website
const HTTP_PORT = 8080;  // the phone's plain port (only a redirect, unless the secure one could not start)

/** What the user typed into "Phone address", as a list of places to try, best first. Null if it is not an address. */
function parseAddress(input) {
  let text = String(input || '').trim();
  if (!text) return null;
  let scheme = null;
  const m = /^(https?):\/\//i.exec(text);
  if (m) { scheme = m[1].toLowerCase(); text = text.slice(m[0].length); }
  text = text.split(/[\/?#]/)[0];
  const hp = /^([A-Za-z0-9](?:[A-Za-z0-9.-]{0,98}[A-Za-z0-9])?)(?::(\d{1,5}))?$/.exec(text);
  if (!hp) return null;
  const host = hp[1].toLowerCase();
  const port = hp[2] ? parseInt(hp[2], 10) : null;
  if (port !== null && (port < 1 || port > 65535)) return null;
  if (scheme === 'https') return [{ scheme, host, port: port || HTTPS_PORT }];
  if (scheme === 'http') return [{ scheme, host, port: port || HTTP_PORT }];
  if (port === HTTP_PORT) return [{ scheme: 'http', host, port }];
  if (port) return [{ scheme: 'https', host, port }, { scheme: 'http', host, port }];
  return [{ scheme: 'https', host, port: HTTPS_PORT }, { scheme: 'http', host, port: HTTP_PORT }];
}

/** SHA-256 of a DER certificate in the form the phone shows (AB:CD:EF...). */
function fingerprintOf(der) {
  return crypto.createHash('sha256').update(der).digest('hex').toUpperCase().match(/../g).join(':');
}

function sameFingerprint(a, b) {
  const clean = (x) => String(x || '').replace(/[^0-9A-Fa-f]/g, '').toLowerCase();
  return clean(a) !== '' && clean(a) === clean(b);
}

/** A file name that Windows accepts, taken from a name the phone sent. */
function safeFileName(name) {
  let n = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(n)) n = '_' + n;
  if (n.length > 180) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 12 ? n.slice(dot) : '';
    n = n.slice(0, 180 - ext.length) + ext;
  }
  return n || 'file';
}

// Files that can run programs on Windows. They can be saved, but the app never opens them for you.
const RUNNABLE = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'msp', 'scr', 'pif', 'cpl', 'lnk', 'url', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js',
  'jse', 'wsf', 'wsh', 'hta', 'jar', 'reg', 'dll', 'sys', 'appx', 'msix', 'appinstaller', 'application', 'gadget', 'inf',
  'docm', 'xlsm', 'pptm', 'dotm', 'xlam', 'ppam', 'sct', 'ws', 'msc', 'scf', 'iso', 'vhd', 'vhdx', 'diagcab',
]);

function extensionOf(name) {
  const dot = String(name).lastIndexOf('.');
  return dot < 0 ? '' : String(name).slice(dot + 1).toLowerCase();
}

function canOpenDirectly(name) {
  const ext = extensionOf(name);
  return ext !== '' && !RUNNABLE.has(ext);
}

/** The query string the phone expects for a file inside a shared folder. */
function fileQuery(lib, parts) {
  return 'lib=' + encodeURIComponent(lib) + '&path=' + encodeURIComponent(parts.join('/'));
}

function randomId(bytes) {
  return crypto.randomBytes(bytes || 8).toString('hex');
}

module.exports = {
  HTTPS_PORT, HTTP_PORT, parseAddress, fingerprintOf, sameFingerprint, safeFileName, canOpenDirectly, extensionOf, fileQuery, randomId,
};
