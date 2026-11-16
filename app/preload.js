'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  // 파일 끌어다 놓기: sandbox 렌더러에는 File.path 가 없어 webUtils 로 경로 문자열만 얻어 보낸다(내용은 읽지 않는다)
  dropFiles: (id, files) => {
    const list = Array.prototype.slice.call(files || [], 0, 11); // 11개 이상이면 main 이 too-many 로 거부
    const paths = [];
    for (const f of list) {
      let p = '';
      try { p = webUtils.getPathForFile(f); } catch (x) { p = ''; }
      if (typeof p !== 'string' || !p) return Promise.resolve({ ok: false, reason: 'missing' });
      paths.push(p);
    }
    return ipcRenderer.invoke('files:drop', String(id), paths);
  },
  getPanels: () => ipcRenderer.invoke('panels:get'),
  fillQuest: (id, index, shown) => ipcRenderer.invoke('quest:fill', String(id), index | 0, String(shown)),
  // 할 일 완료/안 함: 위치·본 항목 문자열·종류만 싣는다(main 이 자기 항목과 대조). 되돌리기는 main 이 준 id 만.
  markTodo: (index, shown, kind) => ipcRenderer.invoke('todos:mark', index | 0, String(shown).slice(0, 400), String(kind).slice(0, 8)),
  undoTodoMark: (id) => ipcRenderer.invoke('todos:undo', String(id).slice(0, 32)),
  // 프로젝트 추적: 키·상태·짧은 이름 문자열만 싣는다(경로·문장은 받지 않는다). main 이 자기 목록과 대조한다.
  getProjectDetail: (key) => ipcRenderer.invoke('projects:detail', String(key).slice(0, 40)),
  setProjectStatus: (key, status) => ipcRenderer.invoke('projects:set-status', String(key).slice(0, 40), String(status).slice(0, 8)),
  renameProject: (key, title) => ipcRenderer.invoke('projects:rename', String(key).slice(0, 40), String(title).slice(0, 400)),
  mergeProject: (key, into) => ipcRenderer.invoke('projects:merge', String(key).slice(0, 40), String(into).slice(0, 40)),
  continueProject: (id, key, shown) => ipcRenderer.invoke('projects:continue', String(id), String(key).slice(0, 40), String(shown).slice(0, 200)),
  // 기억 보기(읽기 전용): 인자 없음. main 이 읽어 정리한 목록만 받는다.
  getMemories: () => ipcRenderer.invoke('memories:list'),
  // 알림과 승인함: 종류('squad'|'skill')와 slug 문자열만 싣는다(내용·경로는 받지 않는다). main 이 자기 목록과 대조하고 설치·거절은 네이티브 확인 창을 띄운다.
  inboxDetail: (kind, slug) => ipcRenderer.invoke('inbox:detail', String(kind).slice(0, 8), String(slug).slice(0, 48)),
  inboxInstallSquad: (slug, digest) => ipcRenderer.invoke('inbox:install-squad', String(slug).slice(0, 48), typeof digest === 'string' ? digest.slice(0, 80) : ''), // digest: 화면에 보인 검증 결과의 것(main 이 64 hex 와 새 검사 결과를 대조한다)
  inboxReject: (kind, slug) => ipcRenderer.invoke('inbox:reject', String(kind).slice(0, 8), String(slug).slice(0, 48)),
  inboxRequestSkill: (id, slug) => ipcRenderer.invoke('inbox:request-skill', String(id), String(slug).slice(0, 48)),
  inboxMarkSeen: () => ipcRenderer.invoke('inbox:mark-seen'),
  // 순서·접힘: 종류·키·태그·불리언만 싣는다. main 이 자기 목록과 대조하고 다른 카테고리로의 이동은 거부한다.
  setCategoryCollapsed: (tag, on) => ipcRenderer.invoke('projects:set-collapsed', String(tag).slice(0, 12), on === true),
  reorderProject: (kind, id, before) => ipcRenderer.invoke('projects:reorder', String(kind).slice(0, 8), String(id).slice(0, 40), before === null || before === undefined ? null : String(before).slice(0, 40)),
  // ⌘숫자(main 메뉴): 'workspace'|'project' 와 id 문자열만 받는다
  onGoto: (cb) => { ipcRenderer.on('ui:goto', (_e, kind, id) => cb(String(kind), String(id))); },
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
