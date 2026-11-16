'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maru', {
  // pty·작업 공간: 모든 채널이 작업 공간 id(문자열)를 싣는다. 경로는 받지 않는다(폴더 선택은 main 의 네이티브 창).
  ptyStart: (id, cols, rows) => ipcRenderer.invoke('pty:start', String(id), cols | 0, rows | 0),
  ptyRestart: (id, cols, rows) => ipcRenderer.invoke('pty:restart', String(id), cols | 0, rows | 0),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', String(id), String(data)),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', String(id), cols | 0, rows | 0),
  onPtyData: (cb) => { ipcRenderer.on('pty:data', (_e, id, d) => cb(String(id), d)); },
  onPtyExit: (cb) => { ipcRenderer.on('pty:exit', (_e, id, c) => cb(String(id), c)); },
  onPtyRestart: (cb) => { ipcRenderer.on('pty:restart-request', (_e, id) => cb(String(id))); },
  getWorkspaces: () => ipcRenderer.invoke('ws:get'),
  activateWorkspace: (id) => ipcRenderer.invoke('ws:activate', String(id)),
  newWorkspace: () => ipcRenderer.invoke('ws:new'),
  closeWorkspace: (id) => ipcRenderer.invoke('ws:close', String(id)),
  onCloseRequest: (cb) => { ipcRenderer.on('ui:close-request', () => cb()); },
  onWorkspacesChanged: (cb) => { ipcRenderer.on('ws:changed', () => cb()); },
  getPanels: () => ipcRenderer.invoke('panels:get'),
  fillQuest: (id, index, shown) => ipcRenderer.invoke('quest:fill', String(id), index | 0, String(shown)),
  // 프로젝트 추적: 키·상태·짧은 이름 문자열만 싣는다(경로·문장은 받지 않는다). main 이 자기 목록과 대조한다.
  getProjectDetail: (key) => ipcRenderer.invoke('projects:detail', String(key).slice(0, 40)),
  setProjectStatus: (key, status) => ipcRenderer.invoke('projects:set-status', String(key).slice(0, 40), String(status).slice(0, 8)),
  renameProject: (key, title) => ipcRenderer.invoke('projects:rename', String(key).slice(0, 40), String(title).slice(0, 400)),
  mergeProject: (key, into) => ipcRenderer.invoke('projects:merge', String(key).slice(0, 40), String(into).slice(0, 40)),
  continueProject: (id, key, shown) => ipcRenderer.invoke('projects:continue', String(id), String(key).slice(0, 40), String(shown).slice(0, 200)),
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
