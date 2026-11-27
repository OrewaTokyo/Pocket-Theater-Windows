'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./store');
const { createHandlers } = require('./handlers');
const { startProxy } = require('./proxy');
const players = require('./players');

app.setAppUserModelId('com.pockettheater.windows');

const rendererDir = path.join(__dirname, '..', 'renderer');

/** True only for the app's own page. Compared by its path, so spaces and drive letters in the install folder do not matter. */
function isOurPage(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && decodeURIComponent(u.pathname).toLowerCase().endsWith('/src/renderer/index.html');
  } catch (err) {
    return false;
  }
}

let win = null;
let handlers = null;
let proxy = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0d0a1f',
    title: 'Pocket Theater',
    autoHideMenuBar: true,
    show: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  // The window only ever shows the app's own page. Nothing else may open or navigate.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOurPage(url)) event.preventDefault();
  });
  // The mouse's back and forward buttons and the keyboard's browser keys move through the app's pages.
  win.on('app-command', (_event, command) => {
    if (!win) return;
    if (command === 'browser-backward' && win.webContents.navigationHistory.canGoBack()) win.webContents.navigationHistory.goBack();
    if (command === 'browser-forward' && win.webContents.navigationHistory.canGoForward()) win.webContents.navigationHistory.goForward();
  });
  win.loadFile(path.join(rendererDir, 'index.html'));
}

async function main() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  await app.whenReady();
  if (app.isPackaged) Menu.setApplicationMenu(null);

  // No page may ask for the camera, location, notifications and so on.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const store = new Store(app.getPath('userData'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (buffer) => safeStorage.decryptString(buffer),
  });

  proxy = await startProxy(() => (handlers ? handlers.state.conn : null));
  handlers = createHandlers({
    store, proxy, dialog, shell, app, players,
    send,
    getWindow: () => win,
    tempDir: path.join(app.getPath('temp'), 'PocketTheater-open'),
    docsDir: app.getAppPath(), // TERMS.md, PRIVACY.md, SECURITY.md and AUTHOR.md ship next to the program
    quit: () => app.quit(),
  });

  for (const channel of handlers.channels) {
    ipcMain.handle(channel, (event, ...args) => {
      // Only the app's own page may ask for things.
      const from = event.senderFrame && event.senderFrame.url;
      if (!from || !isOurPage(from)) return { ok: false, error: { message: 'Not allowed.', code: 'BAD_REQUEST', status: 0 } };
      return handlers.invoke(channel, ...args);
    });
  }

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    if (handlers) handlers.cleanup();
    if (proxy) proxy.close();
  });
}

main().catch((err) => {
  console.error(err);
  dialog.showErrorBox('Pocket Theater could not start', String((err && err.message) || err));
  app.quit();
});
