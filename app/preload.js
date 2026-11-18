'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('maru', {
  // pty·작업 공간: 모든 채널이 작업 공간 id(문자열)를 싣는다. 경로는 받지 않는다(폴더 선택은 main 의 네이티브 창).
  ptyStart: (id, cols, rows) => ipcRenderer.invoke('pty:start', String(id), cols | 0, rows | 0),
  ptyRestart: (id, cols, rows) => ipcRenderer.invoke('pty:restart', String(id), cols | 0, rows | 0),
  ptyEsc: (id) => ipcRenderer.send('pty:esc', String(id)),
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
  openTodo: (index, shown, choice) => ipcRenderer.invoke('todos:open', index | 0, String(shown).slice(0, 400), choice === 'new' || choice === 'original' ? choice : null),
  retryTodoFill: (token) => ipcRenderer.invoke('todos:retry-fill', String(token).slice(0, 32)),
  markTodo: (index, shown, kind) => ipcRenderer.invoke('todos:mark', index | 0, String(shown).slice(0, 400), String(kind).slice(0, 8)),
  undoTodoMark: (id) => ipcRenderer.invoke('todos:undo', String(id).slice(0, 32)),
  // 프로젝트 추적: 키·상태·짧은 이름 문자열만 싣는다(경로·문장은 받지 않는다). main 이 자기 목록과 대조한다.
  getProjectDetail: (key) => ipcRenderer.invoke('projects:detail', String(key).slice(0, 40)),
  setProjectStatus: (key, status) => ipcRenderer.invoke('projects:set-status', String(key).slice(0, 40), String(status).slice(0, 8)),
  renameProject: (key, title) => ipcRenderer.invoke('projects:rename', String(key).slice(0, 40), String(title).slice(0, 400)),
  mergeProject: (key, into) => ipcRenderer.invoke('projects:merge', String(key).slice(0, 40), String(into).slice(0, 40)),
  continueProject: (id, key, shown) => ipcRenderer.invoke('projects:continue', String(id), String(key).slice(0, 40), String(shown).slice(0, 200)),
  // 달력 카드·하루 보기(읽기 전용): 'YYYY-MM' / 'YYYY-MM-DD' 문자열만 싣는다. main 이 다시 검증한다.
  getMonthDays: (ym) => ipcRenderer.invoke('days:month', String(ym).slice(0, 7)),
  getDayDetail: (day) => ipcRenderer.invoke('days:detail', String(day).slice(0, 10)),
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
  // 하위 세션: 작업 공간 id·불리언만 싣는다. 보고는 읽기 전용 목록(main 이 검증해 보낸 평문)
  getReports: (id) => ipcRenderer.invoke('reports:get', String(id)),
  setWsCollapsed: (id, on) => ipcRenderer.invoke('ws:set-collapsed', String(id), on === true),
  // 동의 창 답: 한 번만 쓰는 토큰과 'open'|'cancel' 만. main 이 토큰·보낸 창을 다시 검증한다
  answerChildConsent: (token, answer, squad) => ipcRenderer.invoke('child:answer', String(token).slice(0, 64), answer === 'open' ? 'open' : 'cancel', typeof squad === 'string' ? squad.slice(0, 40) : null), // squad: 고른 팀 slug 또는 null(팀 없이). main 이 설치된 목록과 다시 대조한다
  requestSquadCreate: (text) => ipcRenderer.invoke('squads:request-create', typeof text === 'string' ? text.slice(0, 2000) : ''), // 글만 보낸다(작업 공간·경로는 main 이 정한다)
  resumePrevious: (id) => ipcRenderer.invoke('ws:resume-prev', String(id)),
  setResume: (on) => ipcRenderer.invoke('resume:set', on === true),
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
  // 첫 설정·첫 만남: 경로는 받지 않는다(이름·언어 문자열, 작업 공간 id 만)
  setupGet: () => ipcRenderer.invoke('setup:get'),
  setupPrereqs: (force) => ipcRenderer.invoke('setup:prereqs', force === true),
  setupTerminal: (kind, lang) => ipcRenderer.invoke('setup:terminal', String(kind).slice(0, 20), String(lang).slice(0, 8)), // 명령은 main 이 정한다: 종류(enum)와 안내 언어만
  setupOpenGuide: () => ipcRenderer.invoke('setup:open-guide'),
  setupCreateHome: (name, lang) => ipcRenderer.invoke('setup:create-home', { name: String(name).slice(0, 200), lang: String(lang).slice(0, 8) }),
  setupConnectLater: () => ipcRenderer.invoke('setup:connect-later'),
  setupFinish: () => ipcRenderer.invoke('setup:finish'),
  meetGet: () => ipcRenderer.invoke('meet:get'),
  meetStart: (id) => ipcRenderer.invoke('meet:start', String(id)),
  meetDismiss: () => ipcRenderer.invoke('meet:dismiss'),
  onMeet: (cb) => { ipcRenderer.on('ui:meet', () => cb()); },
  onOpenSettings: (cb) => { ipcRenderer.on('ui:open-settings', () => cb()); },
});
