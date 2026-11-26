'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

// Video players that can open a web link directly (a link is how the app hands them the video).
// `folders` are where each one usually installs, inside Program Files and similar places.
const KNOWN = [
  { id: 'vlc', name: 'VLC', exes: ['vlc.exe'], folders: [['VideoLAN', 'VLC'], ['vlc', 'current']] },
  { id: 'mpv', name: 'mpv', exes: ['mpv.exe'], folders: [['mpv'], ['mpv-player'], ['mpv', 'current']] },
  { id: 'mpvnet', name: 'mpv.net', exes: ['mpvnet.exe'], folders: [['mpv.net']] },
  { id: 'mpc-hc', name: 'MPC-HC', exes: ['mpc-hc64.exe', 'mpc-hc.exe'], folders: [['MPC-HC'], ['K-Lite Codec Pack', 'MPC-HC64'], ['K-Lite Codec Pack', 'MPC-HC']] },
  { id: 'mpc-be', name: 'MPC-BE', exes: ['mpc-be64.exe', 'mpc-be.exe'], folders: [['MPC-BE x64'], ['MPC-BE']] },
  { id: 'potplayer', name: 'PotPlayer', exes: ['PotPlayerMini64.exe', 'PotPlayerMini.exe'], folders: [['DAUM', 'PotPlayer'], ['PotPlayer']] },
  { id: 'kmplayer', name: 'KMPlayer', exes: ['KMPlayer64.exe', 'KMPlayer.exe'], folders: [['KMPlayer 64X'], ['KMPlayer']] },
  { id: 'gom', name: 'GOM Player', exes: ['GOM.exe'], folders: [['GRETECH', 'GomPlayer']] },
  { id: 'smplayer', name: 'SMPlayer', exes: ['smplayer.exe'], folders: [['SMPlayer']] },
  { id: 'wmp', name: 'Windows Media Player', exes: ['wmplayer.exe'], folders: [['Windows Media Player']] },
];

function roots(env) {
  const list = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432];
  if (env.LOCALAPPDATA) list.push(path.join(env.LOCALAPPDATA, 'Programs'), env.LOCALAPPDATA);
  if (env.USERPROFILE) list.push(path.join(env.USERPROFILE, 'scoop', 'apps'));
  return list.filter(Boolean);
}

/** The program path in the text `reg query` prints, with %variables% filled in. */
function parseRegistryValue(text, env) {
  const m = /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(text || '');
  if (!m) return null;
  const value = m[1].trim().replace(/^"(.*)"$/, '$1');
  return value.replace(/%([^%]+)%/g, (_all, name) => (env[name] !== undefined ? env[name] : '%' + name + '%'));
}

const APP_PATH_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\',
];

/** Windows keeps the place of installed programs under "App Paths". Asks for one program by its file name. */
function appPathFromRegistry(exe, env) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const ask = (key) => new Promise((resolve) => {
    execFile('reg', ['query', key + exe, '/ve'], { windowsHide: true, timeout: 4000 }, (err, stdout) => resolve(err ? null : parseRegistryValue(stdout, env)));
  });
  return Promise.all(APP_PATH_KEYS.map(ask)).then((all) => all.find(Boolean) || null);
}

/**
 * The known video players that are installed on this PC: [{ id, name, path }].
 * options (for tests): { env, exists, registry(exeName) }
 */
async function detect(options) {
  const o = options || {};
  const env = o.env || process.env;
  const exists = o.exists || fs.existsSync;
  const registry = o.registry || ((exe) => appPathFromRegistry(exe, env));
  const rootList = roots(env);

  const found = await Promise.all(KNOWN.map(async (player) => {
    for (const root of rootList) {
      for (const folder of player.folders) {
        for (const exe of player.exes) {
          const candidate = path.join(root, ...folder, exe);
          if (exists(candidate)) return { id: player.id, name: player.name, path: candidate };
        }
      }
    }
    for (const exe of player.exes) {
      const viaRegistry = await registry(exe);
      if (viaRegistry && exists(viaRegistry)) return { id: player.id, name: player.name, path: viaRegistry };
    }
    return null;
  }));

  const seen = new Set();
  return found.filter((p) => {
    if (!p) return false;
    const key = p.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Starts the player on a link and lets go of it, so it keeps running when this app closes. */
function launch(exePath, url) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, [url], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

module.exports = { detect, launch, parseRegistryValue, KNOWN };
