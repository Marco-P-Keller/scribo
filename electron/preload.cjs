'use strict';
// Sandboxed bridge: the only things the renderer may ask the operating system for.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const info = ipcRenderer.sendSync('app:info');

function on(channel, cb) {
  ipcRenderer.on(channel, (_e, ...args) => cb(...args));
}

contextBridge.exposeInMainWorld('scribo', {
  platform: info.platform,
  version: info.version,
  e2e: !!info.e2e,
  pickFiles: () => ipcRenderer.invoke('file:pick'),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  writeFile: (path, data, opts) => ipcRenderer.invoke('file:write', path, data, opts ?? {}),
  pickSavePath: (name) => ipcRenderer.invoke('file:pickSave', name),
  setDocumentState: (s) => ipcRenderer.send('win:state', s),
  takeLaunchPaths: () => ipcRenderer.invoke('win:launch'),
  onOpenPaths: (cb) => on('open-paths', cb),
  onCloseRequested: (cb) => on('close-requested', cb),
  confirmDiscard: (name) => ipcRenderer.invoke('win:confirmDiscard', name),
  closeWindow: () => ipcRenderer.send('win:close'),
  newWindow: (path) => ipcRenderer.send('win:new', path),
  openExternal: (url) => ipcRenderer.send('shell:open', url),
  showInFolder: (p) => ipcRenderer.send('shell:show', p),
  setFullscreen: (on) => ipcRenderer.send('win:fullscreen', !!on),
  onFullscreen: (cb) => on('fullscreen', cb),
  onUpdate: (cb) => on('update', cb),
  installUpdate: () => ipcRenderer.send('update:install'),
  addRecent: (p) => ipcRenderer.send('app:recent', p),
  setTheme: (dark) => ipcRenderer.send('win:theme', !!dark),
});
