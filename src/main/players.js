'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/** Where VLC usually lives on Windows. Returns the first one that exists, or null. */
function findVlc(env) {
  const e = env || process.env;
  const roots = [e.ProgramFiles, e['ProgramFiles(x86)'], e.ProgramW6432, e.LOCALAPPDATA && path.join(e.LOCALAPPDATA, 'Programs')]
    .filter(Boolean);
  for (const root of roots) {
    const candidate = path.join(root, 'VideoLAN', 'VLC', 'vlc.exe');
    try { if (fs.existsSync(candidate)) return candidate; } catch (err) { /* keep looking */ }
  }
  return null;
}

/** Starts the player on a link and lets go of it, so it keeps running when this app closes. */
function launch(exePath, url) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, [url], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

module.exports = { findVlc, launch };
