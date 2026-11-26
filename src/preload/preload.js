'use strict';
// The only door between the app's page and the rest of the computer. The page can ask for the requests
// listed here and listen for the three events below, and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

const REQUESTS = [
  'app:info',
  'servers:list', 'servers:probe', 'servers:trust', 'servers:connect', 'servers:disconnect', 'servers:remove', 'servers:rename',
  'session:login', 'session:register', 'session:logout', 'session:me', 'session:password',
  'api:get', 'api:post', 'legal:get', 'pair:qr', 'monitor:fast', 'media:base',
  'file:save', 'file:open', 'file:cancel', 'file:reveal',
  'player:info', 'player:list', 'player:launch', 'player:set', 'player:forget', 'player:choose',
  'media:stats', 'app:openHelp',
];
const EVENTS = ['conn:status', 'conn:signed-out', 'download:progress'];

contextBridge.exposeInMainWorld('pt', {
  invoke(channel, ...args) {
    if (!REQUESTS.includes(channel)) return Promise.resolve({ ok: false, error: { message: 'Unknown request.', code: 'BAD_REQUEST', status: 0 } });
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, callback) {
    if (!EVENTS.includes(channel) || typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
