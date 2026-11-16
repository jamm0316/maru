'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maru', {
  ptyStart: (cols, rows) => ipcRenderer.invoke('pty:start', cols, rows),
  ptyRestart: (cols, rows) => ipcRenderer.invoke('pty:restart', cols | 0, rows | 0),
  ptyWrite: (data) => ipcRenderer.send('pty:write', String(data)),
  ptyResize: (cols, rows) => ipcRenderer.send('pty:resize', cols | 0, rows | 0),
  onPtyData: (cb) => { ipcRenderer.on('pty:data', (_e, d) => cb(d)); },
  onPtyExit: (cb) => { ipcRenderer.on('pty:exit', (_e, c) => cb(c)); },
  onPtyRestart: (cb) => { ipcRenderer.on('pty:restart-request', () => cb()); },
  getPanels: () => ipcRenderer.invoke('panels:get'),
  fillQuest: (index, shown) => ipcRenderer.invoke('quest:fill', index | 0, String(shown)),
  notifyRendered: () => ipcRenderer.send('app:rendered'),
});
