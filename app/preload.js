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
  // 프로필·설정·업그레이드: URL·경로는 받지 않는다(키·불리언·짧은 문자열만)
  getProfile: () => ipcRenderer.invoke('profile:get'),
  setProfile: (patch) => {
    const p = {};
    if (patch && typeof patch.name === 'string') p.name = patch.name.slice(0, 200);
    if (patch && typeof patch.lang === 'string') p.lang = patch.lang;
    return ipcRenderer.invoke('profile:set', p);
  },
  setCalendar: (on) => ipcRenderer.invoke('calendar:set', on === true),
  getSettings: (recheckCalendar) => ipcRenderer.invoke('settings:get', recheckCalendar === true),
  openPane: (key) => ipcRenderer.invoke('settings:open-pane', String(key)),
  copyLogin: () => ipcRenderer.invoke('settings:copy-login'),
  hooksPreview: () => ipcRenderer.invoke('hooks:preview'),
  hooksInstall: () => ipcRenderer.invoke('hooks:install'),
  updateNotice: () => ipcRenderer.invoke('update:notice'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updatePull: () => ipcRenderer.invoke('update:pull'),
  onUpdateProgress: (cb) => { ipcRenderer.on('update:progress', (_e, p) => cb(Number(p) || 0)); },
  onOpenSettings: (cb) => { ipcRenderer.on('ui:open-settings', () => cb()); },
});
