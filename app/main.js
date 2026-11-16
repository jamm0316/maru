'use strict';
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, powerMonitor, session, systemPreferences, shell, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const pty = require('node-pty');
const L = require('./lib');
const I18N = require('./i18n');
let updater = null; // 다른 모듈이 맡는 업데이트 계약. 없으면 '미설정'으로 취급
try { updater = require('./updater'); } catch { /* 미설정 */ }

// 소유자가 현재 사용자이고 group/other 쓰기 권한이 없어야 한다(저장소 스크립트를 실행하므로)
function safeOwned(st) { return st.uid === process.getuid() && (st.mode & 0o022) === 0; }
function isRepo(dir) {
  try {
    const d = fs.statSync(dir);
    const s = fs.statSync(path.join(dir, 'scripts', 'maru-status.sh'));
    const c = fs.statSync(path.join(dir, 'CLAUDE.md'));
    return d.isDirectory() && s.isFile() && c.isFile() && safeOwned(d) && safeOwned(s);
  } catch { return false; }
}
const found = L.resolveRoot({
  env: process.env, home: os.homedir(), isPackaged: app.isPackaged, appDir: __dirname,
  io: {
    readConfig: () => { const r = readRegular(path.join(os.homedir(), '.config', 'maru', 'root'), 4096, false); return r ? r.text : null; },
    isRepo,
  },
});
const ROOT = found ? found.root : null; // null 이면 저장소를 못 찾은 것(패널 비움, 셸은 홈에서)
const SMOKE = process.env.MARU_APP_SMOKE === '1';
const REFRESH_MS = 30000;
const VERSION = app.getVersion();
const TEST_UI = !app.isPackaged && ['menu', 'settings', 'update', 'project', 'party', 'inbox'].includes(process.env.MARU_APP_UI) ? process.env.MARU_APP_UI : null; // 시험 전용(패키징 빌드에서는 무시)
const TEST_FX = !app.isPackaged && process.env.MARU_APP_FX === '1'; // 시험 전용: 가짜 작업 공간 3개(claude 대신 echo). 패키징 빌드에서는 무시
const PERSIST = !SMOKE && !TEST_FX; // 작업 공간 목록을 data/workspaces.json 에 저장·복원할지
// 파티: 마루(지휘) + 저장소 .claude/agents/*.md 의 frontmatter(name, model). 읽기 실패·비면 기본 3개(lib.js)
const AGENT_FILE_MAX = 8192;
function readAgentParty() {
  if (!ROOT) return L.buildAgentParty([]);
  const dir = path.join(ROOT, '.claude', 'agents');
  const list = [];
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return L.buildAgentParty([]);
    for (const name of fs.readdirSync(dir).filter((n) => /^[A-Za-z0-9_-]{1,40}\.md$/.test(n)).sort()) {
      if (list.length >= L.PARTY_MAX) break;
      const r = readRegular(path.join(dir, name), AGENT_FILE_MAX, false); // 정규 파일만(심볼릭 링크 거부)
      const a = r ? L.parseAgentFile(r.text) : null;
      if (a) list.push(a);
    }
  } catch { /* 폴더 없음 */ }
  return L.buildAgentParty(list);
}
const partyCache = L.ttlCache(20000, readAgentParty);
function projectModel() { // 프로젝트 설정의 model(없으면 null)
  if (!ROOT) return null;
  const r = readRegular(path.join(ROOT, '.claude', 'settings.json'), 1 << 20, false);
  try { const m = r ? JSON.parse(r.text).model : null; return L.validModelId(m) ? m : null; } catch { return null; }
}

let win = null;
let tray = null;
let reloads = [];
let hangAsking = false;
let quitting = false;
let smokeOut = '';
let rendered = false;
let smokeDone = false;
let refreshed = false;

// ---- 작업 공간 표 ----  id(main 이 만든 임의 문자열) -> { id, cwd, title, term, sessionId, bracketed, seqTail, lastOutputAt, exited, unavailable, fx }
const wss = new Map();
let activeId = null;
const wsOf = (id) => L.lookupWs(wss, id); // 표에 없는·닫힌·이상한 id 는 null
const wsOrder = () => [...wss.values()];
const STATE_DIR = () => path.join(ROOT, 'data', 'state', 'app');
const stateFile = (w) => (ROOT && w.sessionId ? path.join(STATE_DIR(), w.sessionId + '.json') : null);
function removeStateFile(w) { w.lastTranscript = null; w.lastModel = null; const f = stateFile(w); if (f) try { fs.unlinkSync(f); } catch { /* 없음 */ } clearSubs(w); }
// ---- 서브에이전트: <id>.subs/<agent_id> 파일 하나가 실행 중 하나(내용: agent_type). 정규 파일만, 최대 32개, 30분 넘으면 지운다 ----
const SUBS_MAX = 32; const SUBS_SCAN_MAX = 512; const SUBS_TTL_MS = 30 * 60 * 1000;
const subsDir = (w) => (ROOT && w.sessionId ? path.join(STATE_DIR(), w.sessionId + '.subs') : null);
function clearSubs(w) {
  const d = subsDir(w); if (!d) return;
  try {
    if (!fs.lstatSync(d).isDirectory()) return; // 심볼릭 링크면 lstat 가 isDirectory false
    for (const n of fs.readdirSync(d)) { try { const f = path.join(d, n); if (fs.lstatSync(f).isFile()) fs.unlinkSync(f); } catch { /* 무시 */ } }
    fs.rmdirSync(d);
  } catch { /* 없음 */ }
}
function readSubs(w) {
  const d = subsDir(w);
  if (!d || !w.term) return [];
  const st = wsState(w);
  if (st !== 'busy' && st !== 'waiting') return []; // 세션이 쉬면 남은 것은 무시
  const types = [];
  try {
    if (!fs.lstatSync(d).isDirectory()) return [];
    for (const n of fs.readdirSync(d).filter(L.validSubFileName).slice(0, SUBS_SCAN_MAX)) { // 전부 lstat 해 오래된 것을 지운 뒤에 32개로 자른다
      const f = path.join(d, n);
      try {
        const ls = fs.lstatSync(f);
        if (!ls.isFile()) continue;
        if (Date.now() - ls.mtimeMs > SUBS_TTL_MS) { fs.unlinkSync(f); continue; }
        const r = readRegular(f, 256, false);
        const t = r ? L.parseSubType(r.text) : null;
        if (t) types.push(t);
      } catch { /* 무시 */ }
    }
  } catch { return []; }
  return L.summarizeSubs(types.slice(0, SUBS_MAX));
}
// ---- 마루(지휘) 모델: 상태 파일의 model -> transcript 마지막 assistant 항목 -> 프로젝트 설정 -> '—' ----
const TRANSCRIPT_TAIL = 256 * 1024;
const modelCache = new Map(); // 실제 경로 -> { mtimeMs, size, model }
function transcriptModel(file) {
  try {
    const real = fs.realpathSync(file);
    if (!L.pathInside(real, fs.realpathSync(path.join(claudeDir(), 'projects'))) || !real.endsWith('.jsonl')) return null;
    const st = fs.statSync(real);
    if (!st.isFile()) return null;
    const c = modelCache.get(real);
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.model;
    const r = readTail(real, TRANSCRIPT_TAIL); // 일반 파일만(O_NOFOLLOW), 끝 256KB
    const model = r ? L.parseTranscriptModel(r.text, r.truncated) : null;
    if (modelCache.size >= 50) modelCache.clear();
    modelCache.set(real, { mtimeMs: st.mtimeMs, size: st.size, model });
    return model;
  } catch { return null; }
}
function leadModel(w) {
  const rec = w ? readAgentState(w) : null;
  if (w && rec && rec.transcript) w.lastTranscript = rec.transcript; // 레코드에 없으면(훅 입력이 잘린 경우 등) 마지막 경로를 쓴다
  const tp = rec && rec.transcript ? rec.transcript : (w && w.lastTranscript);
  const id = (rec && rec.model) || (tp && transcriptModel(tp)) || null;
  if (w && id) w.lastModel = id; // 한 번도 못 읽었을 때만 프로젝트 설정값
  return L.shortModelName(id) || L.shortModelName(w && w.lastModel) || L.shortModelName(projectModel()) || '—';
}
function readAgentState(w) {
  const f = stateFile(w);
  const r = f ? readRegular(f, 4096, false) : null;
  return r ? L.parseAgentRecord(r.text) : null;
}
// busy | idle | waiting | none | pending(시작 전) | exited | unavailable(폴더 없음)
function wsState(w) {
  if (w.unavailable) return 'unavailable';
  if (TEST_UI === 'party' && w.term) return 'busy'; // 시험 전용: 화면 확인용
  if (w.term) return L.effectiveAgent(readAgentState(w), Date.now(), w.lastOutputAt);
  return w.exited ? 'exited' : 'pending';
}
// 하루 넘은 상태 파일·임시 파일 정리(일반 파일만)
function cleanOldStateFiles() {
  if (!ROOT) return;
  const dir = STATE_DIR();
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return;
    for (const name of fs.readdirSync(dir)) {
      if (!(name.startsWith('.') || name.endsWith('.json') || name.endsWith('.subs'))) continue;
      try { // 항목마다 따로 감싸 하나가 실패해도 나머지를 계속한다
        const f = path.join(dir, name);
        const st = fs.lstatSync(f);
        if (st.isDirectory() && name.endsWith('.subs') && Date.now() - st.mtimeMs > 24 * 3600 * 1000) { // 오래된 서브에이전트 폴더(안은 일반 파일만)
          for (const n of fs.readdirSync(f)) { try { const g = path.join(f, n); if (fs.lstatSync(g).isFile()) fs.unlinkSync(g); } catch { /* 무시 */ } }
          fs.rmdirSync(f); continue;
        }
        if (st.isFile() && Date.now() - st.mtimeMs > 24 * 3600 * 1000) fs.unlinkSync(f);
      } catch { /* 이 항목만 건너뜀 */ }
    }
  } catch { /* 디렉터리 없음 */ }
}
const INDEX_URL = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
let cache = {
  status: null, todosRaw: [], todos: [], skills: [], notifs: [], battery: null, disk: null,
};
// 프로젝트·기억 캐시는 refresh() 가 통째로 바꾸는 cache 와 따로 둔다(예전에 cache = {...} 교체가 memMetasAt 을 지워 관련 기억이 항상 비던 회귀 방지)
const proj = { raw: { registry: [], entries: [] }, list: [], view: { open: [], done: [], doneCount: 0 } };
const memMetasCache = L.ttlCache(20000, () => { const md = memDir(); return md ? L.readMemoryMetas(md) : []; });

// ---- 프로젝트 추적(lib.js 의 순수 함수로 계산; 여기서는 파일 읽기·쓰기와 IPC 만) ----
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const projStateFile = () => path.join(ROOT, 'data', 'project-state.json');
let projState = {};
const projUiFile = () => path.join(ROOT, 'data', 'project-ui.json');
let projUi = L.defaultProjectUi(); // 카테고리·프로젝트 순서, 접힘(data/project-ui.json). PERSIST 가 아니면 메모리에만 둔다
let projUiLoaded = false;
function memDir() {
  if (!ROOT) return null;
  let real; try { real = fs.realpathSync(ROOT); } catch { return null; }
  return path.join(claudeDir(), 'projects', L.projectSlug(real), 'memory');
}
function loadProjState() {
  const r = L.readProjectStateFile(projStateFile());
  if (r.status === 'corrupt') L.backupCorruptFile(projStateFile()); // 망가진 파일은 .bak 으로 옮기고 새로 시작(workspaces.json 과 같다)
  projState = r.data;
}
function loadProjUi() {
  if (!ROOT) return;
  const r = L.readProjectUiFile(projUiFile());
  if (r.status === 'corrupt' && PERSIST) L.backupCorruptFile(projUiFile()); // 시험·스모크 실행은 실제 data 를 건드리지 않는다
  projUi = r.data; // 없는 태그·키는 적용 때 무시되고(applyProjectUi), 다음 저장 때 사라진다(pruneProjectUi)
  projUiLoaded = true;
}
function recomputeProjects() {
  proj.list = L.buildProjects({ registry: proj.raw.registry, entries: proj.raw.entries, state: projState, todos: cache.todos, today: todayStr() });
  proj.view = { ...L.groupProjects(proj.list, projUi), collapsed: L.pruneProjectUi(projUi, proj.list).collapsed }; // 접힌 태그는 존재하는 것만 렌더러에 보낸다
  syncMenu();
}
function readProjectsRaw() {
  const md = memDir();
  const reg = readHead(path.join(ROOT, 'data', 'projects.txt'), L.PROJ_REG_MAX_BYTES);
  proj.raw = { registry: reg ? L.parseProjectRegistry(reg.text, reg.truncated) : [], entries: md ? L.readJournalEntries(md) : [] };
}
// main 이 가진 요약 목록에 있는 키만 인정한다(렌더러가 보낸 키는 이 목록과 대조)
const findProject = (key) => (typeof key === 'string' && key.length <= 40 ? proj.list.find((x) => x.key === key) || null : null);
const projectMetas = () => memMetasCache.get();

// ---- 할 일 완료/안 함 표시(앱 소유 data/todo-done.txt; data/todos.txt 는 셸 소유라 건드리지 않는다) ----
const nowSec = () => Math.floor(Date.now() / 1000);
const todoDoneFile = () => path.join(ROOT, 'data', 'todo-done.txt');
let todoDone = []; let todoDoneLoaded = false;
function loadTodoDone() {
  if (!ROOT) return;
  const r = L.readTodoDoneFile(todoDoneFile());
  if (r.status === 'error') return; // EMFILE·EACCES 같은 일시 오류: 메모리 값을 그대로 두고 파일은 .bak 으로 치우지 않는다
  if (r.status === 'corrupt' && PERSIST) L.backupCorruptFile(todoDoneFile()); // 시험·스모크 실행은 실제 data 를 건드리지 않는다
  todoDone = r.data; todoDoneLoaded = true;
}
function applyTodoFilter() { cache.todos = L.filterTodos(cache.todosRaw, todoDone, nowSec()); }
// 새 기록 목록을 쓰고(PERSIST 가 아니면 메모리에만) 화면용 목록·프로젝트 요약을 다시 만든다
function commitTodoDone(next) {
  if (PERSIST && (!ROOT || !L.saveTodoDone(todoDoneFile(), next))) return false;
  todoDone = next; applyTodoFilter(); recomputeProjects(); refreshTray();
  return true;
}
const recentMarks = new Map(); // 되돌리기용: main 이 방금 쓴 줄만 기억한다(id -> entries)
function rememberMarks(entries) {
  const id = crypto.randomBytes(8).toString('hex');
  if (recentMarks.size >= 20) recentMarks.delete(recentMarks.keys().next().value);
  recentMarks.set(id, entries);
  return id;
}

// ---- 데이터 수집(고정 경로만) ----
function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 10000, maxBuffer: 1 << 20, cwd: ROOT || os.homedir(), ...opts }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

function readRegular(file, maxBytes, fromEnd) { return L.readRegular(file, maxBytes, fromEnd); } // 일반 파일만 읽는 공용 헬퍼(lib.js)
const readHead = (f, n) => readRegular(f, n, false);
const readTail = (f, n) => readRegular(f, n, true);

function skillDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name);
  } catch { return []; }
}

let refreshing = false;
async function refresh() {
  if (refreshing || !ROOT) { if (!ROOT) refreshed = true; return; }
  refreshing = true;
  try {
    const [st, batt, df] = await Promise.all([
      run(path.join(ROOT, 'scripts', 'maru-status.sh'), ['--json', '--no-auth']),
      run('/usr/bin/pmset', ['-g', 'batt']),
      run('/bin/df', ['-k', '/']),
    ]);
    let status = null;
    try { status = st ? JSON.parse(st) : null; } catch { status = null; }

    const sug = readHead(path.join(ROOT, 'data', 'suggestions.txt'), L.SUGGESTIONS_MAX_BYTES);
    const todoRes = readHead(path.join(ROOT, 'data', 'todos.txt'), L.SUGGESTIONS_MAX_BYTES);
    const logs = ['dream', 'reflect'].map((k) => {
      const r = readTail(path.join(ROOT, 'data', 'logs', `${k}.log`), L.LOG_TAIL_BYTES);
      return r ? L.parseLogEvents(r.text, k, r.truncated) : [];
    });
    cache = {
      status,
      todosRaw: L.resolveTodos(todoRes, sug), // todos.txt 우선, 없거나 유효 항목이 없으면 suggestions.txt. 화면·번호·⌘목록은 완료 표시를 걸러 낸 todos 를 쓴다
      todos: [],
      skills: L.mergeSkillNames(
        skillDirs(path.join(os.homedir(), '.claude', 'skills')),
        skillDirs(path.join(ROOT, '.claude', 'skills')),
      ),
      notifs: L.mergeBriefing(logs, L.INBOX_NOTIF_MAX),
      battery: batt ? L.parseBattery(batt) : null,
      disk: df ? L.parseDiskFree(df) : null,
    };
    if (PERSIST || !todoDoneLoaded) loadTodoDone(); // 시험·스모크에서는 처음 한 번만 읽는다(메모리 변경을 덮지 않게)
    applyTodoFilter();
    loadProjState();
    if (PERSIST || !projUiLoaded) loadProjUi(); // 시험·스모크에서는 처음 한 번만 읽는다(메모리 변경을 덮지 않게)
    readProjectsRaw();
    recomputeProjects();
    if (PERSIST || !inboxSeenLoaded) loadInboxSeen(); // 시험·스모크에서는 처음 한 번만 읽는다
    refreshInbox(); // 기다리지 않는다(스쿼드 검증은 바뀐 제안에만 돌고 순서대로 하나씩)
    refreshed = true;
    refreshTray();
  } finally { refreshing = false; }
}

// ---- 스쿼드: scripts/squads.py meta 한 줄 JSON 을 엄격 검증해 캐시한다. 실패·없음이면 빈 목록(앱은 그대로 동작) ----
const PY_CANDS = ['/Library/Developer/CommandLineTools/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3']; // 저장소 스크립트(lib.sh)와 같은 도구 폴더 순서. /usr/bin/python3 셔임은 쓰지 않는다
function pythonBin() {
  for (const c of PY_CANDS) { try { fs.accessSync(c, fs.constants.X_OK); if (fs.statSync(c).isFile()) return c; } catch { /* 다음 후보 */ } }
  return null;
}
const FAKE_SQUADS = L.parseSquadMeta(JSON.stringify({ squads: [ // 시험 전용(MARU_APP_UI=party)
  { slug: 'dev', name: '개발', description: '', source: 'builtin', lead: { agent: 'sq-dev-lead', model: 'sonnet' }, members: [
    { role: 'builder', agent: 'sq-dev-builder', model: 'sonnet' }, { role: 'tester', agent: 'sq-dev-tester', model: 'haiku' }, { role: 'reviewer', agent: 'sq-dev-reviewer', model: 'opus' }] },
  { slug: 'notes', name: '글쓰기', description: '', source: 'personal', lead: { agent: 'sq-notes-lead', model: 'inherit' }, members: [{ role: 'editor', agent: 'sq-notes-editor', model: 'sonnet' }] },
] }));
let squads = []; let squadsBusy = false;
async function refreshSquads() {
  if (squadsBusy || TEST_UI === 'party') return;
  squadsBusy = true;
  try {
    const script = ROOT ? path.join(ROOT, 'scripts', 'squads.py') : null;
    const py = script && isFileSafe(script) ? pythonBin() : null;
    const out = py ? await run(py, ['-I', script, 'meta'], { timeout: 3000, maxBuffer: L.SQUAD_META_MAX_BYTES, killSignal: 'SIGKILL', env: childEnv() }) : null;
    squads = out ? L.parseSquadMeta(out) : [];
  } catch { squads = []; } finally { squadsBusy = false; }
}
// 작업 공간에서 claude 대신 실행할 래퍼: 저장소 scripts/maru-claude.sh 가 정규 실행 파일(링크 아님, 소유자·쓰기 권한 검사 통과)일 때만
function claudeWrapper() {
  if (!ROOT) return null;
  try {
    const f = path.join(ROOT, 'scripts', 'maru-claude.sh');
    const st = fs.lstatSync(f);
    if (!st.isFile() || !safeOwned(st)) return null;
    fs.accessSync(f, fs.constants.X_OK);
    return f;
  } catch { return null; }
}

function partyView() {
  const lead = leadModel(wsOf(activeId));
  return [{ name: null, roleKey: 'lead', model: lead, lead: true }, ...partyCache.get().map((m) => (m.model === 'inherit' ? { ...m, model: lead } : m))];
}
function panels() {
  const st = cache.status || {};
  const party = partyView();
  const lv = L.levelInfo(typeof st.memoryFiles === 'number' ? st.memoryFiles : 0);
  return {
    rootMissing: !ROOT,
    rootName: ROOT ? path.basename(ROOT) : '-',
    level: lv,
    lastReflect: st.lastReflect || null,
    lastDream: st.lastDream || null,
    pendingSkillProposals: typeof st.pendingSkillProposals === 'number' ? st.pendingSkillProposals : 0,
    todos: cache.todos,
    projects: proj.view, // 목록은 가볍게(요약만). 상세는 projects:detail 로 요청 시
    skills: cache.skills,
    inbox: inboxView(),
    battery: cache.battery,
    disk: cache.disk,
    party, // 기본 팀. name null = 앱 이름(i18n app.title)
    squads: L.squadView(TEST_UI === 'party' ? FAKE_SQUADS : squads, party[0].model), // 스쿼드별 묶음(총괄 + 팀원)
    subs: TEST_UI === 'party' ? [{ type: 'worker', count: 2 }, { type: 'Explore', count: 1 }, { type: 'sq-dev-lead', count: 1 }, { type: 'sq-dev-builder', count: 2 }, { type: 'sq-ghost-lead', count: 1 }] : (wsOf(activeId) ? readSubs(wsOf(activeId)) : []),
    calendar: profile && profile.calendar && cal.ok ? cal.events : [], // 메모리에만 둔다(디스크·로그 금지)
    updateAvailable: upd.view.status === 'available',
  };
}

// ---- pty (작업 공간마다 하나) ----
const FX_DEFS = [{ name: 'blog', state: 'busy', start: true }, { name: 'maru-app', state: 'waiting', start: true }, { name: 'notes', state: 'idle', start: false }]; // 시험 전용 가짜 작업 공간
const SMOKE_LINE = 'maru-ok 한글 명조 정렬 테스트 가나다라마바사';
function trackBracketed(w, d) {
  const s = w.seqTail + d;
  const h = s.lastIndexOf('\x1b[?2004h');
  const l = s.lastIndexOf('\x1b[?2004l');
  if (h > l) w.bracketed = true; else if (l > h) w.bracketed = false;
  w.seqTail = s.slice(-7); // 시퀀스 길이(8)보다 짧게 남겨 중복 처리 방지
}
function sendToRenderer(ch, ...args) { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); }
function writeFxState(w) {
  if (!TEST_FX || !ROOT || !w.sessionId || !w.fx) return;
  try { fs.mkdirSync(STATE_DIR(), { recursive: true }); fs.writeFileSync(stateFile(w), JSON.stringify({ state: w.fx.state, at: new Date().toISOString() }) + '\n'); } catch { /* 시험용 */ }
}

function spawnPty(w, cols, rows) {
  if (w.term) return true;
  if (w.unavailable) { if (dirOk(w.cwd)) { w.unavailable = false; wsChanged(false); } else return false; } // 디스크가 다시 연결됐으면 시작 가능
  if (!dirOk(w.cwd)) { w.unavailable = true; wsChanged(false); return false; }
  const shellBin = process.env.SHELL || '/bin/zsh';
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_') || k.startsWith('MARU_APP')) delete env[k];
  const sid = L.newSessionId(() => crypto.randomUUID()); // 셸 env 에는 넣지 않고 claude 실행 명령에만 붙인다
  let self;
  try {
    self = pty.spawn(shellBin, ['-l'], { name: 'xterm-256color', cols, rows, cwd: w.cwd, env });
  } catch { w.exited = true; wsChanged(false); return false; }
  removeStateFile(w);
  w.sessionId = sid; w.term = self; w.exited = false; w.bracketed = false; w.seqTail = ''; w.lastOutputAt = 0;
  self.onData((d) => {
    if (w.term !== self) return;
    w.lastOutputAt = Date.now();
    trackBracketed(w, d);
    if (SMOKE) smokeOut += d;
    sendToRenderer('pty:data', w.id, d);
    if (SMOKE) checkSmoke();
  });
  self.onExit(({ exitCode }) => {
    if (w.term !== self) return;
    w.term = null; w.bracketed = false; w.exited = true; removeStateFile(w);
    sendToRenderer('pty:exit', w.id, exitCode);
    wsChanged(false);
  });
  // 스모크·시험에서는 claude 대신 echo. 평소에는 claude 가 있을 때만 교체(없으면 셸 유지)
  if (w.fx) { self.write('echo ' + SMOKE_LINE + '; echo fixture-' + w.fx.name + '\r'); writeFxState(w); }
  else if (SMOKE) self.write('echo ' + SMOKE_LINE + '\r');
  else if (ROOT) self.write(L.claudeLaunchCommand(sid, claudeWrapper())); // 래퍼가 있으면 스쿼드를 실은 claude, 없으면 그냥 claude
  wsChanged(false);
  return true;
}

// pty 의 프로세스 그룹에 SIGHUP(터미널을 닫을 때와 같다). 2초 안에 안 끝나면 SIGKILL.
const dying = new Set();
function killPty(w) {
  const old = w.term; w.term = null; w.bracketed = false; removeStateFile(w);
  if (!old) return;
  let dead = false; const pid = old.pid;
  dying.add(pid); // 닫는 중인 그룹: 이 사이에 앱이 끝나면 killAllSync 가 마저 정리한다
  try { old.onExit(() => { dead = true; dying.delete(pid); }); } catch { /* 무시 */ }
  try { process.kill(-pid, 'SIGHUP'); } catch { try { old.kill(); } catch { /* 이미 종료 */ } }
  setTimeout(() => { if (!dead) { try { process.kill(-pid, 'SIGKILL'); } catch { /* 이미 종료 */ } } dying.delete(pid); }, 2000);
}

// 종료 경로: 모든 프로세스 그룹에 SIGHUP → 짧게(300ms) 기다림 → SIGKILL. 타이머에 기대지 않고 동기로 끝낸다.
function killAllSync() {
  const pids = [...dying]; dying.clear();
  for (const w of wsOrder()) { if (w.term) { pids.push(w.term.pid); w.term = null; w.bracketed = false; } removeStateFile(w); }
  if (!pids.length) return;
  for (const pid of pids) { try { process.kill(-pid, 'SIGHUP'); } catch { /* 이미 종료 */ } }
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); } catch { /* 무시 */ }
  for (const pid of pids) { try { process.kill(-pid, 'SIGKILL'); } catch { /* 이미 종료 */ } }
}

// ---- 작업 공간 관리 ----
function dirOk(p) { try { return L.workspaceDirOk(fs.statSync(fs.realpathSync(p)), process.getuid()); } catch { return false; } }
const wsFile = () => path.join(ROOT, 'data', 'workspaces.json');
let saveTimer = null;
function saveWsNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!PERSIST || !ROOT) return;
  const order = wsOrder();
  L.saveWorkspaces(wsFile(), order.map((w) => ({ cwd: w.cwd, title: w.title })), order.findIndex((w) => w.id === activeId)); // 사용 불가 항목도 그대로 둔다
}
function saveWsLater() { if (!saveTimer) saveTimer = setTimeout(saveWsNow, 1000); } // 활성 전환은 1초 모아서 저장
const saveWs = saveWsNow;
// structural: true = 목록이 바뀜(즉시 저장), 'active' = 활성만 바뀜(1초 뒤 저장), false = 상태만 바뀜.
function wsChanged(structural) {
  if (structural === true) saveWsNow(); else if (structural === 'active') saveWsLater();
  sendToRenderer('ws:changed');
  syncMenu();
  refreshTray();
}
function addWorkspace(cwd, title, fx, unavailable) {
  const id = crypto.randomBytes(8).toString('hex');
  const w = { id, cwd, title: L.uniqueTitle(title || L.workspaceTitle(cwd, tr('ws.untitled')), wsOrder().map((x) => x.title)), term: null, sessionId: null, bracketed: false, seqTail: '', lastOutputAt: 0, exited: false, unavailable: !!unavailable, fx: fx || null };
  wss.set(id, w);
  return w;
}
function initWorkspaces() {
  const base = ROOT || os.homedir();
  if (TEST_FX) {
    for (const d of FX_DEFS) { const c = path.join(base, 'projects', d.name); addWorkspace(dirOk(c) ? c : base, d.name, d); }
    activeId = wsOrder()[1].id;
    for (const w of wsOrder()) if (w.fx.start) spawnPty(w, 80, 24); // 시험: 일부는 미리 시작하고 나머지는 '시작 전'으로 둔다
    return;
  }
  if (PERSIST && ROOT) {
    const r = L.readWorkspacesFile(wsFile(), dirOk, { fallbackTitle: tr('ws.untitled') });
    if (r.status === 'corrupt') L.backupCorruptFile(wsFile()); // 망가진 파일은 .bak 으로 옮기고(예전 .bak 은 덮어씀) 새로 시작
    else if (r.status === 'ok' && r.data.list.length) {
      for (const e of r.data.list) addWorkspace(e.cwd, e.title, null, e.unavailable); // 폴더가 없어도 버리지 않는다
      activeId = wsOrder()[r.data.active].id;
      return;
    }
  }
  activeId = addWorkspace(base).id; // 파일이 없거나 비면 저장소 루트 하나(예전 동작)
  saveWsNow();
}
const wsView = () => wsOrder().map((w) => ({ id: w.id, title: w.title, path: L.shortenPath(w.cwd, os.homedir()), state: wsState(w), bp: w.bracketed }));
const attention = () => wsOrder().filter((w) => { const s = wsState(w); return s === 'busy' || s === 'waiting'; });
function activate(id) { if (!wsOf(id) || id === activeId) return; activeId = id; wsChanged('active'); }
function activateOffset(d) {
  const order = wsOrder(); if (order.length < 2) return;
  const i = order.findIndex((w) => w.id === activeId);
  activate(order[(i + d + order.length) % order.length].id);
}
function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  try { app.focus({ steal: true }); } catch { /* 무시 */ }
}
const box = (opts) => (win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));

let picking = false;
async function newWorkspaceFlow() {
  if (picking) return { ok: false, reason: 'busy' };
  const tooMany = () => box({ type: 'info', buttons: [tr('common.confirm')], noLink: true, message: tr('dlg.max.title', { n: L.WS_MAX }), detail: tr('dlg.max.detail') });
  if (wss.size >= L.WS_MAX) { showWindow(); await tooMany(); return { ok: false, reason: 'max' }; }
  picking = true;
  try {
    showWindow();
    const opts = { title: tr('dlg.pick.title'), buttonLabel: tr('dlg.pick.ok'), defaultPath: ROOT || os.homedir(), properties: ['openDirectory'] };
    const r = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !Array.isArray(r.filePaths) || r.filePaths.length !== 1) return { ok: false, reason: 'cancel' };
    let real = null; try { real = fs.realpathSync(r.filePaths[0]); } catch { real = null; }
    if (!real || !dirOk(real)) { await box({ type: 'warning', buttons: [tr('common.confirm')], noLink: true, message: tr('dlg.dir.title'), detail: tr('dlg.dir.detail') }); return { ok: false, reason: 'dir' }; }
    if (wss.size >= L.WS_MAX) { await tooMany(); return { ok: false, reason: 'max' }; }
    activeId = addWorkspace(real).id;
    wsChanged(true);
    return { ok: true };
  } finally { picking = false; }
}

let closing = false;
async function closeWorkspace(id) {
  const w = wsOf(id);
  if (!w) return { ok: false, reason: 'invalid' };
  if (closing) return { ok: false, reason: 'busy' };
  closing = true;
  try {
    const st = wsState(w);
    if (L.confirmClose(st)) {
      const ans = await box({ type: 'warning', buttons: [tr('dlg.close.ok'), tr('common.cancel')], defaultId: 1, cancelId: 1, noLink: true, message: tr('dlg.close.title', { title: w.title }), detail: tr('dlg.close.detail') });
      if (ans.response !== 0) return { ok: false, reason: 'cancel' };
      if (!wss.has(id)) return { ok: true };
    }
    killPty(w); removeStateFile(w);
    const idx = wsOrder().findIndex((x) => x.id === id);
    wss.delete(id);
    if (activeId === id) { const rest = wsOrder(); activeId = rest.length ? rest[Math.min(idx, rest.length - 1)].id : null; }
    wsChanged(true);
    return { ok: true };
  } finally { closing = false; }
}

// ---- 종료 ----
let quitAsking = false;
async function confirmQuit() {
  if (quitAsking) return;
  quitAsking = true;
  try {
    showWindow();
    const n = attention().length;
    const ans = await box({ type: 'warning', buttons: [tr('dlg.quit.ok'), tr('common.cancel')], defaultId: 1, cancelId: 1, noLink: true, message: tr('dlg.quit.title'), detail: tr('dlg.quit.detail', { n }) });
    if (ans.response === 0) { quitting = true; app.quit(); }
  } finally { quitAsking = false; }
}
function cleanup() { saveWsNow(); killAllSync(); }
let restarting = false;
async function restartActive() {
  const w = wsOf(activeId);
  if (!w || restarting) return;
  if (L.confirmRestart(wsState(w))) {
    restarting = true;
    try {
      const ans = await box({ type: 'warning', buttons: [tr('dlg.restart.ok'), tr('common.cancel')], defaultId: 1, cancelId: 1, noLink: true, message: tr('dlg.restart.title', { title: w.title }), detail: tr('dlg.restart.detail') });
      if (ans.response !== 0) return;
    } finally { restarting = false; }
    if (!wss.has(w.id)) return;
  }
  sendToRenderer('pty:restart-request', w.id);
}

// ---- 트레이(메뉴 막대) ----
let traySig = '';
function createTray() {
  try {
    const img = nativeImage.createFromPath(L.trayIconPath({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appDir: __dirname }));
    if (img.isEmpty()) return;
    img.setTemplateImage(true);
    tray = new Tray(img);
    refreshTray(true);
  } catch { tray = null; } // 트레이 없이도 앱은 동작한다
}
function refreshTray(force) {
  if (!tray) return;
  const view = wsView();
  const sig = JSON.stringify([view, activeId, L.trayTodoTitles(cache.todos), curLang()]);
  if (!force && sig === traySig) return;
  traySig = sig;
  const model = L.trayMenuModel({ workspaces: view, activeId, todos: cache.todos, t: tr });
  const tpl = model.map((m) => {
    if (m.type === 'separator') return { type: 'separator' };
    if (m.type === 'header' || m.type === 'todo') return { label: m.label, enabled: false };
    if (m.type === 'workspace') return { label: m.label, type: 'checkbox', checked: m.checked, click: () => { activate(m.id); showWindow(); } };
    const act = {
      show: () => showWindow(),
      new: () => { newWorkspaceFlow(); },
      settings: () => { showWindow(); sendToRenderer('ui:open-settings'); },
      quit: () => app.quit(),
    }[m.id];
    return { label: m.label, click: act };
  });
  tray.setContextMenu(Menu.buildFromTemplate(tpl));
  tray.setTitle(L.trayTitle(view.map((w) => w.state)));
  tray.setToolTip(tr('tray.tip'));
}

function checkSmoke() {
  if (smokeDone || !rendered || !refreshed || !/^maru-ok 한글 .*\r?$/m.test(smokeOut.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))) return;
  smokeDone = true;
  const p = app.isPackaged ? null : { ...panels(), workspaces: wsView(), active: activeId };
  console.log('SMOKE OK pty-output=maru-ok panels-rendered=true root-source=' + (found ? found.source : 'none') + ' packaged=' + app.isPackaged);
  if (app.isPackaged) { app.exit(ROOT ? 0 : 1); return; } // 패키징 빌드의 스모크는 한 줄을 찍자마자 스스로 끝낸다(상주 모드로 쓸 수 없다)
  if (!ROOT) { console.error('SMOKE FAIL: 저장소를 찾지 못함'); app.exit(1); return; }
  if (!app.isPackaged) console.log(JSON.stringify(p, null, 2)); // 패널 내용은 개발 실행에서만 출력
  const shot = app.isPackaged ? null : process.env.MARU_APP_SHOT; // 선택(개발 전용): 스모크 때 화면 캡처 경로. 패키징 빌드에서는 무시
  if (shot && win) {
    setTimeout(() => win.webContents.capturePage().then((img) => { fs.writeFileSync(shot, img.toPNG()); app.exit(0); }, () => app.exit(0)), TEST_UI ? 4000 : TEST_FX ? 2000 : 800);
    return;
  }
  app.exit(0);
}

// ---- 프로필·언어 ----
let profile = null; // 유효한 data/profile.json 이 있을 때만 객체
const profilePath = () => path.join(ROOT, 'data', 'profile.json');
const curLang = () => (profile ? profile.lang : L.defaultLang(app.getLocale()));
const tr = (k, p) => I18N.t(curLang(), k, p);
// ⌘1~9: 왼쪽 패널 순서(작업 공간들, 이어서 보이는 프로젝트 줄). 렌더러의 번호 힌트와 같은 L.numberTargets 를 쓴다.
const gotoTargets = () => L.numberTargets(wsOrder().map((w) => w.id), L.visibleProjectKeys(proj.view.open, proj.view.collapsed));
function gotoLabel(n, t) {
  if (!t) return tr('menu.gotoNone', { n });
  if (t.kind === 'workspace') { const w = wsOf(t.id); return w ? tr('menu.gotoWs', { n }) + ' · ' + w.title : tr('menu.gotoNone', { n }); }
  const s = findProject(t.id);
  if (!s) return tr('menu.gotoNone', { n });
  return tr('menu.gotoProj', { n }) + ' · ' + (s.kind === 'unclassified' ? tr('proj.unclassified') + ' (' + s.tag + ')' : s.title);
}
function gotoNumber(n) {
  const t = gotoTargets()[n - 1];
  if (!t) return;
  if (t.kind === 'workspace') { if (!wsOf(t.id)) return; activate(t.id); sendToRenderer('ui:goto', 'workspace', t.id); } // 렌더러는 열려 있던 프로젝트 상세를 닫는다
  else if (findProject(t.id)) sendToRenderer('ui:goto', 'project', t.id); // 모달이 열려 있으면 렌더러가 무시한다
}
let menuSig = null; let menuBuilt = false;
function syncMenu() { // 번호 -> 대상 매핑이나 제목이 바뀌었을 때만 메뉴를 다시 만든다
  if (!menuBuilt) return;
  const sig = JSON.stringify([curLang(), gotoTargets().map((t, i) => gotoLabel(i + 1, t))]);
  if (sig !== menuSig) buildMenu();
}
function buildMenu() {
  const targets = gotoTargets();
  menuSig = JSON.stringify([curLang(), targets.map((t, i) => gotoLabel(i + 1, t))]); menuBuilt = true;
  const goto = Array.from({ length: L.GOTO_MAX }, (_, i) => ({ label: gotoLabel(i + 1, targets[i]), accelerator: 'CmdOrCtrl+' + (i + 1), click: () => gotoNumber(i + 1) })); // 대상이 없는 번호도 키는 삼킨다(터미널로 새지 않게)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: tr('menu.workspace'), submenu: [
      { label: tr('menu.newWs'), accelerator: 'CmdOrCtrl+T', click: () => { newWorkspaceFlow(); } },
      { label: tr('menu.closeWs'), accelerator: 'CmdOrCtrl+W', click: () => {
        if (!win || win.isDestroyed() || !win.isVisible()) return;
        if (wss.size === 0) win.hide(); else sendToRenderer('ui:close-request'); // 열린 창·메뉴가 있으면 렌더러가 그것부터 닫는다
      } },
      { type: 'separator' },
      { label: tr('menu.nextWs'), accelerator: 'CmdOrCtrl+Shift+]', click: () => activateOffset(1) },
      { label: tr('menu.prevWs'), accelerator: 'CmdOrCtrl+Shift+[', click: () => activateOffset(-1) },
      { type: 'separator' },
      ...goto,
    ] },
    { label: tr('menu.terminal'), submenu: [{
      label: tr('menu.restart'), accelerator: 'CmdOrCtrl+Shift+R',
      click: () => { restartActive(); },
    }] },
    { label: tr('set.title'), submenu: [{
      label: tr('menu.openSettings'), accelerator: 'CmdOrCtrl+,',
      click: () => { sendToRenderer('ui:open-settings'); },
    }] },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
  ]));
}

// ---- 자식 프로세스 (고정 argv, 셸 문자열 보간 없음) ----
function childEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_') || k.startsWith('MARU_APP')) delete env[k];
  const home = os.homedir();
  const extra = [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  env.PATH = [...new Set([...extra, ...String(env.PATH || '').split(':').filter(Boolean)])].join(':');
  if (ROOT) env.MARU_HOME = ROOT;
  return env;
}
// -> { err, code, stdout, stderr } (실패해도 reject 하지 않는다)
function exec(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 10000, maxBuffer: 1 << 20, killSignal: 'SIGKILL', env: childEnv(), cwd: ROOT || os.homedir(), ...opts }, (err, stdout, stderr) => {
      resolve({ err: err || null, code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms).unref())]);
const isFileSafe = (f) => { try { const st = fs.statSync(f); return st.isFile() && safeOwned(st); } catch { return false; } };

// pty 가 쓰는 claude: 로그인 셸의 `command -v claude`(없으면 흔한 설치 위치)
let claudeBin;
async function resolveClaude() {
  if (claudeBin) return claudeBin;
  const home = os.homedir();
  const cands = [];
  const r = await exec(process.env.SHELL || '/bin/zsh', ['-l', '-c', 'command -v claude'], { timeout: 6000 });
  const line = r.stdout.split('\n').map((x) => x.trim()).filter((x) => x.startsWith('/')).pop();
  if (line) cands.push(line);
  cands.push(path.join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude');
  for (const c of cands) {
    try { fs.accessSync(c, fs.constants.X_OK); if (fs.statSync(c).isFile()) { claudeBin = c; return c; } } catch { /* 다음 후보 */ }
  }
  return null;
}

// ---- 설정 화면: 읽기 전용 점검 ----
const claudeDir = () => (process.env.CLAUDE_CONFIG_DIR && path.isAbsolute(process.env.CLAUDE_CONFIG_DIR) ? process.env.CLAUDE_CONFIG_DIR : path.join(os.homedir(), '.claude'));
const row = (id, status, key, params, action, extra) => ({ id, status, detail: { key, params: params || {} }, action: action || null, ...(extra || {}) });

async function checkAuth() {
  const bin = await resolveClaude();
  if (!bin) return row('auth', 'unknown', 'auth.noClaude', null, 'copyLogin');
  const r = await exec(bin, ['auth', 'status'], { timeout: 10000, cwd: os.homedir() });
  const a = L.parseAuthStatus(r.stdout); // 이메일·조직 필드는 여기서 버려진다
  if (!a) return row('auth', 'unknown', 'auth.fail', null, 'copyLogin');
  if (!a.loggedIn) return row('auth', 'need', 'auth.out', null, 'copyLogin');
  if (a.state === 'expired') return row('auth', 'need', 'auth.expired', { date: a.expiresAt }, 'copyLogin');
  if (a.state === 'soon') return row('auth', 'need', 'auth.soon', { plan: a.plan, date: a.expiresAt, days: a.daysLeft }, 'copyLogin');
  return a.expiresAt ? row('auth', 'ok', 'auth.ok', { plan: a.plan, date: a.expiresAt }) : row('auth', 'ok', 'auth.okNoDate', { plan: a.plan });
}

async function checkHooks() {
  const installable = !!ROOT && isFileSafe(path.join(ROOT, 'install.sh'));
  if (!ROOT) return row('hooks', 'unknown', 'hooks.noInstall');
  const f = path.join(claudeDir(), 'settings.json');
  const res = readRegular(f, 1 << 20, false);
  let settings = {};
  if (!res) {
    let exists = true;
    try { fs.lstatSync(f); } catch { exists = false; }
    if (exists) return row('hooks', 'unknown', 'hooks.fail');
  } else {
    if (res.truncated) return row('hooks', 'unknown', 'hooks.fail');
    try { settings = JSON.parse(res.text); } catch { return row('hooks', 'unknown', 'hooks.fail'); }
  }
  let real = ROOT; try { real = fs.realpathSync(ROOT); } catch { /* 그대로 */ }
  const st = L.hookStatus(settings, [ROOT, real]);
  const missing = L.HOOK_EVENTS.filter((e) => !st[e]);
  if (!missing.length) return row('hooks', 'ok', 'hooks.ok');
  return row('hooks', 'need', 'hooks.missing', { list: missing.join(', ') }, installable ? 'install' : null);
}

async function checkDream() {
  const r = await exec('/bin/launchctl', ['print', 'gui/' + process.getuid() + '/com.maru.dream'], { timeout: 5000 });
  if (r.code === 0) return row('dream', 'ok', 'dream.ok');
  if (r.code !== null) return row('dream', 'need', 'dream.no');
  return row('dream', 'unknown', 'set.fail');
}

function checkAccessibility() {
  let ok = false;
  try { ok = systemPreferences.isTrustedAccessibilityClient(false) === true; } catch { return row('acc', 'unknown', 'set.fail', null, 'openAccessibility'); }
  return ok ? row('acc', 'ok', 'acc.ok') : row('acc', 'need', 'acc.no', null, 'openAccessibility');
}
function checkScreen() {
  let s = 'unknown';
  try { s = systemPreferences.getMediaAccessStatus('screen'); } catch { /* unknown */ }
  if (s === 'granted') return row('screen', 'ok', 'screen.granted');
  if (s === 'denied' || s === 'restricted' || s === 'not-determined') return row('screen', 'need', 'screen.' + s, null, 'openScreen');
  return row('screen', 'unknown', 'screen.unknown', null, 'openScreen');
}
const checkAutomation = () => row('auto', 'unknown', 'auto.unknown', null, 'openAutomation');

function checkCalendar() {
  const on = !!(profile && profile.calendar);
  const toggle = { on, available: !!profile };
  if (!on) return row('cal', 'optional', 'cal.off', null, null, { toggle });
  if (cal.pending) return row('cal', 'unknown', 'cal.pending', null, null, { toggle });
  if (cal.ok) return row('cal', 'ok', 'cal.ok', { n: cal.events.length }, null, { toggle });
  return row('cal', 'need', 'cal.fail', null, 'openCalendars', { toggle });
}

// 텔레그램: 토큰·.env 는 읽지 않는다. tmux 세션(maru-telegram)과 launchd 등록 여부만 본다.
async function checkTelegram() {
  for (const tmux of ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux']) {
    if (!fs.existsSync(tmux)) continue;
    const r = await exec(tmux, ['has-session', '-t', '=maru-telegram'], { timeout: 3000 });
    if (r.code === 0) return row('tg', 'ok', 'tg.running');
    break;
  }
  const l = await exec('/bin/launchctl', ['print', 'gui/' + process.getuid() + '/com.maru.telegram'], { timeout: 5000 });
  if (l.code === 0) return row('tg', 'ok', 'tg.registered');
  return row('tg', 'optional', 'tg.off');
}

function checkMemory() {
  if (!ROOT) return row('mem', 'unknown', 'set.fail');
  let real; try { real = fs.realpathSync(ROOT); } catch { return row('mem', 'unknown', 'set.fail'); }
  const mem = path.join(claudeDir(), 'projects', L.projectSlug(real), 'memory');
  let names;
  try { names = fs.readdirSync(mem, { withFileTypes: true }); } catch { return row('mem', 'need', 'mem.none'); }
  const n = names.filter((d) => d.isFile() && d.name.endsWith('.md') && d.name !== 'MEMORY.md').length;
  const d = new Date();
  const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  let journal = false;
  try { journal = fs.lstatSync(path.join(mem, 'journal', day + '.md')).isFile(); } catch { /* 없음 */ }
  return row('mem', 'ok', 'mem.ok', { n, j: journal ? 'yes' : 'no' });
}

// 각 점검은 병렬·개별 타임아웃. 초과/예외는 '확인 불가'.
async function settingsRows(recheckCalendar) {
  if (recheckCalendar && profile && profile.calendar) await readCalendar();
  const guard = (id, fn, ms) => withTimeout(Promise.resolve().then(fn).catch(() => row(id, 'unknown', 'set.fail')), ms, row(id, 'unknown', 'set.fail'));
  return Promise.all([
    guard('auth', checkAuth, 20000), guard('hooks', checkHooks, 5000), guard('dream', checkDream, 6000),
    guard('acc', checkAccessibility, 3000), guard('screen', checkScreen, 3000), guard('auto', checkAutomation, 1000),
    guard('cal', checkCalendar, 1000), guard('tg', checkTelegram, 8000), guard('mem', checkMemory, 3000),
  ]);
}

// 시스템 설정 창 열기: 허용 목록(L.SETTINGS_PANES)의 딥링크만. 그 밖의 URL 은 열지 않는다.
function openSettingsPane(key) {
  const url = L.settingsPaneUrl(key);
  if (!url) return false;
  shell.openExternal(url).catch(() => { /* 열기 실패는 무시 */ });
  return true;
}

// ---- install.sh (미리보기 → 확인 → 실제 실행) ----
let installPreviewAt = 0;
let installPreviewHash = null; // 미리보기 때 install.sh 의 sha256
let installPreviewCount = 0;
const hashInstall = () => { try { return crypto.createHash('sha256').update(fs.readFileSync(installSh())).digest('hex'); } catch { return null; } };
let installBusy = false;
const installSh = () => (ROOT ? path.join(ROOT, 'install.sh') : null);
async function previewInstall() {
  if (!ROOT || !isFileSafe(installSh())) return { ok: false, reason: 'noInstall' };
  if (installBusy) return { ok: false, reason: 'busy' };
  installBusy = true;
  try {
    const r = await exec('/bin/bash', [installSh(), '--dry-run'], { timeout: 60000, maxBuffer: 1 << 20 });
    const output = L.cleanBlock(r.stdout + (r.stderr ? '\n' + r.stderr : ''));
    if (r.err) { installPreviewAt = 0; installPreviewHash = null; return { ok: false, reason: 'failed', output }; }
    installPreviewAt = Date.now(); installPreviewHash = hashInstall(); installPreviewCount = L.parseInstallSections(r.stdout).length;
    return { ok: true, output, sections: L.parseInstallSections(r.stdout) };
  } finally { installBusy = false; }
}
async function runInstall() {
  if (!ROOT || !isFileSafe(installSh())) return { ok: false, reason: 'noInstall' };
  if (installBusy) return { ok: false, reason: 'busy' };
  if (!installPreviewAt || Date.now() - installPreviewAt > 10 * 60 * 1000) return { ok: false, reason: 'expired' }; // 미리보기를 본 뒤에만
  const want = installPreviewHash; const count = installPreviewCount;
  installPreviewAt = 0; installPreviewHash = null;
  if (!want || hashInstall() !== want) return { ok: false, reason: 'changed' }; // 미리보기 이후 install.sh 가 바뀌면 거부
  installBusy = true;
  try {
    // main 에서도 한 번 더 확인(렌더러 대화상자와 별개)
    const ans = await dialog.showMessageBox(win, { type: 'question', buttons: [tr('hooks.apply'), tr('common.cancel')], defaultId: 1, cancelId: 1, noLink: true, message: tr('hooks.confirmTitle', { n: count }), detail: tr('hooks.mainConfirm') });
    if (ans.response !== 0) return { ok: false, reason: 'cancelled' };
    if (hashInstall() !== want) return { ok: false, reason: 'changed' };
    const r = await exec('/bin/bash', [installSh()], { timeout: 120000, maxBuffer: 1 << 20 });
    return { ok: !r.err, output: L.cleanBlock(r.stdout + (r.stderr ? '\n' + r.stderr : '')) };
  } finally { installBusy = false; }
}

// ---- 캘린더(opt-in, 메모리에만) ----
let cal = { pending: false, ok: false, events: [] };
let calRun = null;
function readCalendar() {
  if (!profile || !profile.calendar) { cal = { pending: false, ok: false, events: [] }; return Promise.resolve(); }
  if (calRun) return calRun;
  cal = { ...cal, pending: true };
  const args = [];
  for (const line of L.CAL_SCRIPT) args.push('-e', line);
  calRun = exec('/usr/bin/osascript', args, { timeout: 15000, maxBuffer: 1 << 20, cwd: os.homedir() }).then((r) => {
    if (!profile || !profile.calendar) cal = { pending: false, ok: false, events: [] }; // 읽는 동안 꺼졌으면 버림
    else cal = r.err ? { pending: false, ok: false, events: [] } : { pending: false, ok: true, events: L.parseCalendarOutput(r.stdout) };
  }).finally(() => { calRun = null; });
  return calRun;
}

// ---- 업그레이드(다른 모듈 updater.js 계약에 연결만) ----
const upd = { raw: null, view: { status: 'unconfigured', current: VERSION }, dmgPath: null, busy: false };
async function checkUpdates(fetchRepo) {
  if (!updater || typeof updater.checkForUpdates !== 'function') { upd.raw = null; upd.view = { status: 'unconfigured', current: VERSION }; return upd.view; }
  try {
    const r = await withTimeout(updater.checkForUpdates({ currentVersion: VERSION, repoRoot: ROOT, fetchRepo: fetchRepo === true }), 30000, { status: 'error', current: VERSION });
    upd.raw = r; upd.view = L.sanitizeUpdate(r, VERSION);
  } catch { upd.raw = null; upd.view = { status: 'error', current: VERSION }; }
  if (upd.view.status !== 'available') upd.dmgPath = null;
  return upd.view;
}
// 이전 업데이트의 마무리 결과(한 번만 보여 준다)
let finishNotice = null;
async function finishPendingInstall() {
  if (!updater || typeof updater.finishPendingInstall !== 'function') return;
  try {
    const r = await withTimeout(Promise.resolve(updater.finishPendingInstall()), 15000, null);
    if (r && typeof r === 'object' && ['installed', 'rolledBack', 'failed'].includes(r.status)) {
      finishNotice = { status: r.status, version: L.cleanVersion(r.version), message: typeof r.message === 'string' ? L.cleanBlock(r.message, 400).split('\n')[0].slice(0, 200) : '' };
    }
  } catch { /* 무시 */ }
}
const errText = (e) => L.cleanBlock(String(e && e.message ? e.message : ''), 300).split('\n')[0].slice(0, 200);

// ---- IPC (좁은 API만, 입력 검증) ----
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
function fromMain(e) {
  if (!win || win.isDestroyed() || e.sender !== win.webContents) return false;
  const fr = e.senderFrame;
  return !!fr && fr === win.webContents.mainFrame && fr.url === INDEX_URL;
}

// 모든 pty 채널은 작업 공간 id 를 받고, main 의 표에 없는 id 는 조용히 버린다
const wsFrom = (e, id) => (fromMain(e) ? wsOf(id) : null);
ipcMain.handle('pty:start', (e, id, cols, rows) => {
  const w = wsFrom(e, id);
  if (!w || !int(cols, 2, 1000) || !int(rows, 2, 1000)) return false;
  if (w.term) { // 렌더러가 다시 붙은 경우(화면 복구): 이어서 흘려보내고, 크기를 한 번 흔들어 앱이 다시 그리게 한다
    try { w.term.resize(cols > 2 ? cols - 1 : cols + 1, rows); setTimeout(() => { try { if (w.term) w.term.resize(cols, rows); } catch { /* 종료 */ } }, 60); } catch { /* 종료 직후 */ }
    return true;
  }
  if (w.exited) return true; // 끝난 세션은 자동으로 되살리지 않는다(다시 시작은 pty:restart)
  return spawnPty(w, cols, rows);
});
ipcMain.handle('pty:restart', (e, id, cols, rows) => {
  const w = wsFrom(e, id);
  if (!w || !int(cols, 2, 1000) || !int(rows, 2, 1000)) return false;
  killPty(w);
  return spawnPty(w, cols, rows);
});
ipcMain.on('pty:write', (e, id, data) => {
  const w = wsFrom(e, id);
  if (!w || typeof data !== 'string' || data.length > 1 << 20 || !w.term) return;
  w.term.write(data);
});
ipcMain.on('pty:resize', (e, id, cols, rows) => {
  const w = wsFrom(e, id);
  if (!w || !int(cols, 2, 1000) || !int(rows, 2, 1000) || !w.term) return;
  try { w.term.resize(cols, rows); } catch { /* 종료 직후 */ }
});
ipcMain.handle('ws:get', (e) => (fromMain(e) ? { list: wsView(), active: activeId } : null));
ipcMain.handle('ws:activate', (e, id) => { if (!wsFrom(e, id)) return false; activate(id); return true; });
ipcMain.handle('ws:new', (e) => (fromMain(e) ? newWorkspaceFlow() : { ok: false, reason: 'invalid' })); // 경로는 렌더러가 주지 않는다(main 의 폴더 선택창)
ipcMain.handle('ws:close', (e, id) => (wsFrom(e, id) ? closeWorkspace(id) : { ok: false, reason: 'invalid' }));
ipcMain.handle('panels:get', (e) => (fromMain(e) ? panels() : null));
// 렌더러가 본 항목(shown = 제목+"\n"+프롬프트)이 main 의 index 번 항목과 같을 때만 처리. 쓰는 문장은 항상 main 의 프롬프트.
// 대상은 활성 작업 공간뿐(id 가 활성이 아니면 거부).
ipcMain.handle('quest:fill', (e, id, index, shown) => {
  const w = wsFrom(e, id);
  if (!w || !int(index, 0, cache.todos.length - 1)) return { ok: false, reason: 'invalid' };
  if (w.id !== activeId) return { ok: false, reason: 'inactive' };
  const item = L.matchTodo(cache.todos, index, shown);
  if (!item) return { ok: false, reason: 'stale' };
  if (!item.prompt) return { ok: false, reason: 'no-prompt' }; // 사용자가 직접 할 일
  return writePrompt(w, item.prompt);
});
// 할 일 완료/안 함: 렌더러가 본 항목(shown)이 main 의 index 번 항목과 같을 때만. 기록하는 태그·제목은 항상 main 이 가진 항목의 값이다.
ipcMain.handle('todos:mark', (e, index, shown, kind) => {
  if (!fromMain(e) || !int(index, 0, Math.max(0, cache.todos.length - 1)) || (kind !== 'done' && kind !== 'skip') || typeof shown !== 'string') return { ok: false, reason: 'invalid' };
  const item = L.matchTodo(cache.todos, index, shown);
  if (!item) return { ok: false, reason: 'stale' };
  const entry = L.makeTodoDone(item, kind, nowSec());
  if (!entry) return { ok: false, reason: 'unsupported' }; // | · 개행 · 제어문자가 든 제목은 기록하지 않는다
  if (PERSIST) loadTodoDone(); // 파일을 직접 고친 경우를 반영
  if (!commitTodoDone(L.addTodoDone(todoDone, [entry], nowSec()))) return { ok: false, reason: 'save' };
  return { ok: true, id: rememberMarks([entry]) };
});
// 되돌리기: main 이 방금 쓴 그 줄만 파일에서 뺀다(id 는 main 이 준 것만)
ipcMain.handle('todos:undo', (e, id) => {
  if (!fromMain(e) || typeof id !== 'string' || !recentMarks.has(id)) return { ok: false, reason: 'invalid' };
  const entries = recentMarks.get(id);
  if (PERSIST) loadTodoDone();
  if (!commitTodoDone(L.removeTodoDone(todoDone, entries))) return { ok: false, reason: 'save' };
  recentMarks.delete(id);
  return { ok: true };
});
// 입력줄에 한 줄을 채운다(자동 Enter 없음). 할 일 클릭과 프로젝트 "이어서 하기"가 같은 경로·같은 안전장치를 쓴다.
function writePrompt(w, raw) {
  if (!w.term) return { ok: false, reason: 'no-term' };
  const text = L.cleanQuestText(raw);
  if (!text || !L.isSafeQuestStart(text)) return { ok: false, reason: 'unsafe-start' };
  if (!w.bracketed) return { ok: false, reason: 'not-ready' }; // 붙여넣기 모드가 꺼진 상태(선택 메뉴 등)에서는 쓰지 않는다. 셸 프롬프트도 켜져 있어 claude 입력줄인지까지는 가리지 못한다
  w.term.write('\x1b[200~' + text + '\x1b[201~'); // 붙여넣기로 감싸 Enter 없이 입력줄에만
  return { ok: true };
}
// 파일 끌어다 놓기: 렌더러(preload 의 webUtils)가 준 경로 문자열만 받는다. 활성 작업 공간에만, 파일 내용은 읽지 않는다.
// 모달·상세 화면은 렌더러가 먼저 막고, main 은 자기 네이티브 창이 열려 있을 때 거부한다.
ipcMain.handle('files:drop', (e, id, paths) => {
  const w = wsFrom(e, id);
  if (!w || !Array.isArray(paths) || paths.length < 1) return { ok: false, reason: 'invalid' };
  if (paths.length > L.DROP_MAX) return { ok: false, reason: 'too-many' };
  if (w.id !== activeId) return { ok: false, reason: 'inactive' };
  if (picking || closing || quitAsking || restarting) return { ok: false, reason: 'busy-ui' };
  if (!paths.every(L.validDropPath)) return { ok: false, reason: 'invalid' };
  for (const p of paths) { // lstat: 링크는 따라가지 않고 그대로 허용. 일반 파일·폴더·링크만
    try { const st = fs.lstatSync(p); if (!(st.isFile() || st.isDirectory() || st.isSymbolicLink())) return { ok: false, reason: 'missing' }; } catch { return { ok: false, reason: 'missing' }; }
  }
  if (!w.term) return { ok: false, reason: 'no-term' };
  if (!w.bracketed) return { ok: false, reason: 'not-ready' }; // 붙여넣기 모드가 아니면 쓰지 않는다(writePrompt 와 같다)
  const text = L.buildDropPaste(paths);
  if (!text) return { ok: false, reason: 'invalid' };
  w.term.write(text); // Enter 는 보내지 않는다
  return { ok: true };
});

// ---- 알림과 승인함: 승인 대기(스쿼드·스킬 제안) + 알림(dream·reflect 로그 이벤트). 제안 폴더·로그는 모두 믿지 않는다(lib.js 가 엄격히 훑는다) ----
const proposalBase = (kind) => (ROOT ? path.join(ROOT, 'data', kind === 'squad' ? 'squad-proposals' : 'skill-proposals') : null);
const skillTrashDir = () => path.join(ROOT, 'data', 'skill-proposals-trash'); // 앱 소유 휴지 폴더(영구 삭제 아님)
const inboxSeenFile = () => path.join(ROOT, 'data', 'inbox-seen.json');
let inboxSeen = ''; let inboxSeenLoaded = false;
function loadInboxSeen() {
  if (!ROOT) return;
  const r = L.readInboxSeenFile(inboxSeenFile(), Date.now()); // 하루 넘게 미래인 값은 손상으로 본다
  if (r.status === 'corrupt' && PERSIST) L.backupCorruptFile(inboxSeenFile()); // 망가진 파일은 .bak 으로 옮기고 새로 시작
  inboxSeen = r.data; inboxSeenLoaded = true;
}
// checks: slug -> { sig, at, c, p } — c: 검증 결과(undefined=실행 중, null=실행·형식 실패), p: 그 Promise.
// 제안 파일이 바뀌지 않았으면(sig 같음) 검증을 다시 돌리지 않고, 실행 중이면 같은 Promise 를 나눠 쓴다(목록·상세가 같은 검증을 공유).
const inbox = { approvals: [], checks: new Map() };
const fmtLogAt = L.fmtLogAt;
// 시험 전용(MARU_APP_UI=inbox): 가짜 승인·알림. 동작 버튼은 아무것도 하지 않는다.
const fakeInbox = () => {
  const ago = (min) => fmtLogAt(new Date(Date.now() - min * 60000));
  return {
    approvals: [
      { kind: 'squad', slug: 'research-desk', name: '조사 데스크', description: '여러 출처를 나눠 조사하고 한 장으로 합쳐 보고하는 팀', members: 3, state: 'ok', digest: 'a'.repeat(64), builtin: false },
      { kind: 'squad', slug: 'ops-runner', name: '운영 도우미', description: '반복 점검 스크립트를 돌리는 팀', members: 2, state: 'risk', digest: 'b'.repeat(64), builtin: true },
      { kind: 'skill', slug: 'weekly-review', name: 'weekly-review', description: '한 주의 일지를 모아 회고 문서 초안을 만든다', invalid: false },
    ],
    notifs: [{ at: ago(12), code: 'reflect.commit' }, { at: ago(95), code: 'reflect.quests', n: 3 }, { at: ago(60 * 9), code: 'dream.commit' }, { at: ago(60 * 9 + 2), code: 'dream.sweep', n: 2 }, { at: ago(60 * 30), code: 'dream.noChange' }],
    seen: ago(60 * 5),
  };
};
function inboxView() {
  const f = TEST_UI === 'inbox' ? fakeInbox() : null;
  const m = L.markUnseen(f ? f.notifs : cache.notifs, f ? f.seen : inboxSeen);
  return { approvals: f ? f.approvals : inbox.approvals, notifications: m.list, unseen: m.unseen };
}
// 알림을 본 것으로 표시: 기준은 main 이 가진 가장 최근 알림 시각(렌더러가 시각을 보내지 않는다)
ipcMain.handle('inbox:mark-seen', (e) => {
  if (!fromMain(e)) return { ok: false, reason: 'invalid' };
  const now = Date.now();
  const at = L.seenToStore(cache.notifs, now); // min(가장 최근 알림 시각, 지금): 미래 시각이 기준으로 박히지 않게 한다
  if (TEST_UI === 'inbox' || !at || at <= inboxSeen) return { ok: true };
  if (PERSIST && !L.saveInboxSeen(inboxSeenFile(), at)) return { ok: false, reason: 'save' };
  inboxSeen = at;
  return { ok: true };
});
// squads.py 호출: 고정 argv·셸 없음·python3 -I·시간/출력 상한·한 번에 하나씩(큐). 데이터 위치는 환경변수로 명시한다.
let squadsQueue = Promise.resolve();
function squadsCli(args) {
  const job = async () => {
    const script = ROOT ? path.join(ROOT, 'scripts', 'squads.py') : null;
    const py = script && isFileSafe(script) ? pythonBin() : null;
    if (!py) return null;
    const env = { ...childEnv(), MARU_DATA: path.join(ROOT, 'data'), MARU_SQUAD_PROPOSALS: proposalBase('squad'), MARU_SQUADS_BUILTIN: path.join(ROOT, 'squads') };
    return exec(py, ['-I', script, ...args], { timeout: 8000, maxBuffer: 128 * 1024, env });
  };
  const p = squadsQueue.then(job, job);
  squadsQueue = p.then(() => {}, () => {});
  return p;
}
async function checkSquad(slug) { // -> L.parseSquadCheck 결과 | null(실행·형식 실패)
  if (!L.validProposalSlug('squad', slug)) return null;
  const r = await squadsCli(['check', '--json', path.join(proposalBase('squad'), slug)]);
  return r && (r.code === 0 || r.code === 1) ? L.parseSquadCheck(r.stdout.trim(), slug) : null;
}
const checkState = (c) => (!c ? 'unknown' : !c.ok ? 'invalid' : c.risks.length ? 'risk' : 'ok');
const CHECK_RETRY_MS = 30000; // 실행·형식 실패(null)는 이 시간이 지나면 다시 시도한다
function checkCached(slug, sig) { // -> Promise<검증 결과 | null>
  const e = inbox.checks.get(slug);
  if (e && e.sig === sig && (e.c !== null || Date.now() - e.at < CHECK_RETRY_MS)) return e.p;
  const ent = { sig, at: Date.now(), c: undefined, p: null };
  ent.p = checkSquad(slug).then((c) => { ent.c = c; ent.at = Date.now(); return c; }, () => { ent.c = null; ent.at = Date.now(); return null; });
  inbox.checks.set(slug, ent);
  return ent.p;
}
const approvalOfSquad = (x) => {
  const e = inbox.checks.get(x.slug); const c = e && e.sig === x.sig ? e.c : undefined;
  return { kind: 'squad', slug: x.slug, name: x.name, description: x.description, members: x.members, state: c === undefined ? 'unknown' : checkState(c),
    digest: c && c.ok ? c.digest : '', builtin: !!(c && c.ok && c.existsBuiltin) }; // digest: 이 행이 그려진 검증 결과의 것(설치 때 main 이 다시 대조한다)
};
let inboxRefreshing = false; let inboxRefreshAgain = false;
async function refreshInbox(again) { // again: 동작이 끝난 뒤 호출 — 이미 도는 중이면 끝난 뒤 한 번 더 돈다(처리한 항목이 남아 있지 않게)
  if (!ROOT || TEST_UI === 'inbox') return;
  if (inboxRefreshing) { if (again) inboxRefreshAgain = true; return; }
  inboxRefreshing = true;
  try {
    do {
      inboxRefreshAgain = false;
      try { await refreshInboxOnce(); } catch { /* 다음 주기에 재시도 */ }
    } while (inboxRefreshAgain);
  } finally { inboxRefreshing = false; }
}
async function refreshInboxOnce() {
  const uid = process.getuid();
  const sq = L.listProposals('squad', proposalBase('squad'), uid);
  const sk = L.listProposals('skill', proposalBase('skill'), uid);
  const view = () => [...sq.map(approvalOfSquad), ...sk.map((x) => ({ kind: 'skill', slug: x.slug, name: x.name, description: x.description, invalid: x.invalid === true }))];
  inbox.approvals = view();
  for (const x of sq) {
    const e = inbox.checks.get(x.slug);
    if (e && e.sig === x.sig && (e.c !== null || Date.now() - e.at < CHECK_RETRY_MS)) continue;
    await checkCached(x.slug, x.sig);
    inbox.approvals = view();
  }
  for (const k of [...inbox.checks.keys()]) if (!sq.some((x) => x.slug === k)) inbox.checks.delete(k);
  inbox.approvals = view();
}
// 렌더러가 보낸 {kind, slug} 는 문자열 형식만 보고, main 이 지금 폴더를 다시 훑어 있는 것만 인정한다
const currentApproval = (kind, slug) => {
  if (!ROOT || !L.validProposalSlug(kind, slug)) return null;
  return L.listProposals(kind, proposalBase(kind), process.getuid()).find((x) => x.slug === slug) || null;
};
ipcMain.handle('inbox:detail', async (e, kind, slug) => {
  if (!fromMain(e)) return null;
  if (TEST_UI === 'inbox') {
    const a = fakeInbox().approvals.find((x) => x.kind === kind && x.slug === slug);
    if (!a) return null;
    return { kind, slug, name: a.name, description: a.description, files: [{ name: a.kind === 'squad' ? 'squad.md' : 'SKILL.md', size: 120 }], skipped: 0,
      sections: [{ name: a.kind === 'squad' ? 'squad.md' : 'SKILL.md', text: '---\nname: ' + a.name + '\ndescription: ' + a.description + '\n---\n\n(smoke)' }],
      check: a.kind === 'squad' ? { state: a.state, reason: '', warns: [], risks: a.state === 'risk' ? ['lead.md: 총괄 도구에 Bash 가 있음'] : [], existsPersonal: false, existsBuiltin: !!a.builtin, digest: a.digest, summary: { members: a.members, models: ['sonnet'], tools: ['Agent', 'Read'] } } : null };
  }
  const it = currentApproval(kind, slug);
  const d = it ? L.proposalDetail(kind, proposalBase(kind), slug, process.getuid()) : null;
  if (!d) return null;
  let check = null;
  if (kind === 'squad') {
    const c = await checkCached(slug, it.sig); // 목록과 같은 검증(진행 중이면 그것을 기다린다)을 쓴다. 설치 때는 main 이 따로 새로 검사한다
    check = { state: checkState(c), reason: c && !c.ok ? c.reason : '', warns: c && c.ok ? c.warns : [], risks: c && c.ok ? c.risks : [], existsPersonal: !!(c && c.ok && c.existsPersonal), existsBuiltin: !!(c && c.ok && c.existsBuiltin), digest: c && c.ok ? c.digest : '', summary: c && c.ok ? L.summarizeSquadCheck(c) : null };
  }
  return { kind, slug, name: it.name, description: it.description, ...d, check };
});
let inboxActing = false; // 확인 창이 떠 있거나 설치·거절을 하는 동안은 다른 동작을 받지 않는다
async function inboxAction(e, fn) {
  if (!fromMain(e) || TEST_UI === 'inbox') return { ok: false, reason: 'invalid' };
  if (inboxActing) return { ok: false, reason: 'busy' };
  inboxActing = true;
  try { return await fn(); } finally { inboxActing = false; refreshInbox(true); }
}
const confirmBox = async (message, detail, okLabel) => (await box({ type: 'warning', buttons: [okLabel, tr('common.cancel')], defaultId: 1, cancelId: 1, noLink: true, message, detail })).response === 0;
const personalSquadExists = (slug) => { try { const st = fs.lstatSync(path.join(ROOT, 'data', 'squads', slug)); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; } };
// shownDigest: 렌더러가 마지막으로 보여 준 검증 결과의 digest. 형식(64 hex)만 보고, main 이 새로 돌린 검사와 같을 때만 확인 창으로 간다(범위를 좁히기만 한다).
ipcMain.handle('inbox:install-squad', (e, slug, shownDigest) => inboxAction(e, async () => {
  if (typeof shownDigest !== 'string' || !/^[0-9a-f]{64}$/.test(shownDigest)) return { ok: false, reason: 'invalid' };
  if (!currentApproval('squad', slug)) return { ok: false, reason: 'invalid' };
  const c = await checkSquad(slug); // 캐시를 쓰지 않는 새 검사
  if (!c) return { ok: false, reason: 'check-failed' };
  if (!c.ok) return { ok: false, reason: 'rejected', detail: c.reason };
  if (c.digest !== shownDigest) { inbox.checks.delete(slug); return { ok: false, reason: 'changed' }; } // 사용자가 본 것과 다르다: 목록·상세를 다시 그리게 한다
  if (c.existsBuiltin) return { ok: false, reason: 'builtin' }; // 내장 스쿼드를 같은 이름의 개인 스쿼드가 덮어쓰게 되므로 앱에서는 설치하지 않는다(터미널에서만)
  if (c.risks.length) return { ok: false, reason: 'risky', risks: c.risks }; // 위험 신호가 있으면 앱은 설치하지 않는다(터미널에서 --ack-warnings 는 사용자가 직접)
  if (c.existsPersonal) return { ok: false, reason: 'exists' }; // 앱은 --replace 를 쓰지 않는다
  const sum = L.summarizeSquadCheck(c);
  const roster = sum.roster.map((x) => x.role + ' (' + x.model + '): ' + (x.tools.join(', ') || '-')).join('\n');
  const yes = await confirmBox(tr('dlg.sqInstall.title', { name: c.name }), tr('dlg.sqInstall.detail', { slug, n: sum.members, roster }), tr('inbox.act.install'));
  if (!yes) return { ok: false, reason: 'cancel' };
  if (!currentApproval('squad', slug)) return { ok: false, reason: 'invalid' };
  // --expect-digest: 확인 창에 보인 내용 그대로일 때만 설치된다(그사이 파일이 바뀌면 squads.py 가 거부). 위험 신호가 있으면 squads.py 도 거부한다.
  const r = await squadsCli(['install', path.join(proposalBase('squad'), slug), '--expect-digest', c.digest]);
  if (!r) return { ok: false, reason: 'check-failed' };
  if (r.code === 3) return { ok: false, reason: 'changed' };
  // 시간 초과·비정상 종료여도 설치가 이미 끝났을 수 있다: 개인 스쿼드 폴더가 생겼는지 다시 보고 그대로 알린다(없던 폴더였음을 위에서 확인했다)
  if (r.code !== 0 && !personalSquadExists(slug)) return { ok: false, reason: 'install-failed' };
  const rm = await squadsCli(['remove', '--proposal', slug]);
  refreshSquads();
  return { ok: true, name: c.name, removed: !!rm && rm.code === 0 };
}));
ipcMain.handle('inbox:reject', (e, kind, slug) => inboxAction(e, async () => {
  const it = currentApproval(kind, slug);
  if (!it) return { ok: false, reason: 'invalid' };
  const isSquad = kind === 'squad';
  const yes = await confirmBox(tr('dlg.reject.title', { name: it.name }), tr(isSquad ? 'dlg.reject.detail.squad' : 'dlg.reject.detail.skill'), tr('inbox.act.reject'));
  if (!yes) return { ok: false, reason: 'cancel' };
  if (!currentApproval(kind, slug)) return { ok: false, reason: 'invalid' };
  if (isSquad) { const r = await squadsCli(['remove', '--proposal', slug]); return r && r.code === 0 ? { ok: true } : { ok: false, reason: 'trash' }; }
  const r = L.trashProposalDir(proposalBase('skill'), skillTrashDir(), slug, process.getuid());
  return r.ok ? { ok: true } : { ok: false, reason: r.reason === 'missing' ? 'invalid' : 'trash' };
}));
// 스킬 "설치 요청": 앱은 아무것도 복사하지 않는다. 고정 문장(slug 뿐)을 활성 마루 작업 공간의 입력줄에 채운다(Enter 는 보내지 않는다. projects:continue 와 같다).
const isMaruWs = (w) => { try { return !!ROOT && fs.realpathSync(w.cwd) === fs.realpathSync(ROOT); } catch { return false; } };
ipcMain.handle('inbox:request-skill', (e, id, slug) => inboxAction(e, async () => {
  const w = wsFrom(e, id);
  const it = w ? currentApproval('skill', slug) : null;
  if (!w || !it || it.invalid) return { ok: false, reason: 'invalid' }; // SKILL.md 를 읽을 수 없는 제안은 버튼 상태와 무관하게 main 이 거부한다
  if (w.id !== activeId) return { ok: false, reason: 'inactive' };
  if (!isMaruWs(w)) return { ok: false, reason: 'not-maru' };
  if (!w.term) return { ok: false, reason: 'no-term' };
  // 붙여넣기 모드(bracketed)는 claude 입력줄뿐 아니라 셸 프롬프트도 켠다. state 파일(첫 질문 뒤에야 생김)로도 "claude 가 떴다"를 확정할 수 없어 구분하지 못한다 — 확인 창에서 사용자에게 알린다.
  if (!w.bracketed) return { ok: false, reason: 'not-ready' };
  const text = L.skillRequestText(tr, slug);
  if (!text) return { ok: false, reason: 'invalid' };
  if (!(await confirmBox(tr('dlg.skRequest.title', { slug }), tr('dlg.skRequest.detail', { text }), tr('inbox.act.request')))) return { ok: false, reason: 'cancel' };
  if (wsOf(id) !== w || w.id !== activeId) return { ok: false, reason: 'inactive' }; // 묻는 동안 바뀌었을 수 있다
  return writePrompt(w, text);
}));
// ---- 프로젝트 IPC: 키는 main 의 요약 목록과 대조하고, 문장·이름·상태는 main 이 가진 값으로 다시 만든다 ----
ipcMain.handle('projects:detail', (e, key) => {
  if (!fromMain(e)) return null;
  const s = findProject(key);
  if (!s) return null;
  return L.buildProjectDetail({ summary: s, registry: proj.raw.registry, entries: proj.raw.entries, state: projState, todos: cache.todos, memories: projectMetas(), list: proj.list, today: todayStr() });
});
function commitProjState(next) {
  if (!next || !L.projectStateFits(next)) return { ok: false, reason: 'size' }; // 읽기 상한을 넘는 상태는 쓰지 않는다(다음 읽기에서 손상으로 치워지므로)
  if (!ROOT || !L.saveProjectState(projStateFile(), next)) return { ok: false, reason: 'save' };
  projState = next; recomputeProjects();
  return { ok: true };
}
// "완료로 옮기기": 남은 일이 있으면 네이티브 창으로 먼저 알리고, 승인하면 그 항목들을 '안 함'으로 기록한 뒤 완료 처리한다.
// "다시 열기"는 그 기록을 되돌리지 않는다(되돌아오려면 회고가 다시 올려야 하고, 기록은 7일 뒤 풀린다).
let projDoneAsking = false;
const todoMarkId = (item) => item.tag + '\n' + (item.project || '') + '\n' + L.todoKey(item); // 같은 항목인지 가르는 키(태그·프로젝트·제목·프롬프트)
ipcMain.handle('projects:set-status', async (e, key, status) => {
  const s = fromMain(e) ? findProject(key) : null;
  if (!s || s.kind !== 'project' || (status !== 'open' && status !== 'done')) return { ok: false, reason: 'invalid' };
  loadProjState(); // 파일을 직접 고친 경우를 반영
  const pend = status === 'done' ? L.projectOpenTodos({ summary: s, registry: proj.raw.registry, state: projState, todos: cache.todos }) : [];
  if (!pend.length) return commitProjState(L.stateWithStatus(projState, s.key, status, todayStr()));
  if (projDoneAsking) return { ok: false, reason: 'busy' };
  projDoneAsking = true;
  try {
    const shownKeys = new Set(pend.map((p) => todoMarkId(p.item))); // 창을 띄운 시점에 보여 준 항목만 기록한다
    const ans = await box({ type: 'warning', buttons: [tr('dlg.projDone.ok'), tr('common.cancel')], defaultId: 1, cancelId: 1, noLink: true, message: tr('dlg.projDone.title', { n: pend.length }), detail: tr('dlg.projDone.detail') });
    if (ans.response !== 0) return { ok: false, reason: 'cancel' };
    const s2 = findProject(key); // 묻는 동안 목록이 바뀌었을 수 있다: 다시 대조하고 그 시점의 남은 일을 쓴다
    if (!s2 || s2.kind !== 'project') return { ok: false, reason: 'invalid' };
    loadProjState();
    const t = nowSec();
    const nextState = L.stateWithStatus(projState, s2.key, 'done', todayStr());
    if (!nextState || !L.projectStateFits(nextState)) return { ok: false, reason: 'size' }; // 저장할 수 없는 상태면 표시를 쓰기 전에 거부한다
    const entries = L.projectOpenTodos({ summary: s2, registry: proj.raw.registry, state: projState, todos: cache.todos }).filter((p) => shownKeys.has(todoMarkId(p.item))).map((p) => L.makeTodoDone(p.item, 'skip', t)).filter(Boolean);
    if (PERSIST) loadTodoDone();
    if (entries.length && !commitTodoDone(L.addTodoDone(todoDone, entries, t))) return { ok: false, reason: 'save' };
    const r = commitProjState(nextState);
    if (!r.ok && entries.length) { // 완료 처리가 실패하면 방금 쓴 줄을 거둔다. 거두지도 못하면 따로 알린다
      if (PERSIST) loadTodoDone();
      if (!commitTodoDone(L.removeTodoDone(todoDone, entries))) return { ok: false, reason: 'rollback' };
    }
    return r;
  } finally { projDoneAsking = false; }
});
ipcMain.handle('projects:rename', (e, key, title) => {
  const s = fromMain(e) ? findProject(key) : null;
  if (!s || s.kind !== 'project') return { ok: false, reason: 'invalid' };
  if (!L.cleanProjectTitle(title)) return { ok: false, reason: 'title' }; // 1~40자, 무해화 후에도 비면 거부
  loadProjState();
  return commitProjState(L.stateWithTitle(projState, s.key, title));
});
ipcMain.handle('projects:merge', (e, key, into) => {
  if (!fromMain(e) || !findProject(key) || !findProject(into) || !L.canMerge(proj.list, key, into)) return { ok: false, reason: 'invalid' };
  loadProjState();
  return commitProjState(L.stateWithMerge(projState, key, into));
});
// 순서·접힘: 렌더러가 보낸 태그·키는 main 이 가진 목록과 대조하고, 다른 카테고리로의 이동은 거부한다. 저장은 pruneProjectUi 를 거친다.
function commitProjUi(next) {
  const v = L.pruneProjectUi(next, proj.list);
  if (!L.projectUiFits(v)) return { ok: false, reason: 'size' };
  if (PERSIST && (!ROOT || !L.saveProjectUi(projUiFile(), v))) return { ok: false, reason: 'save' };
  projUi = v; recomputeProjects();
  return { ok: true };
}
ipcMain.handle('projects:set-collapsed', (e, tag, on) => {
  if (!fromMain(e) || typeof on !== 'boolean' || typeof tag !== 'string' || !proj.list.some((x) => x.tag === tag)) return { ok: false, reason: 'invalid' };
  if (PERSIST) loadProjUi(); // 파일을 직접 고친 경우를 반영
  const set = new Set(projUi.collapsed);
  if (on) set.add(tag); else set.delete(tag);
  return commitProjUi({ ...projUi, collapsed: [...set] });
});
// kind 'cat': id=태그를 beforeId(태그, null=맨 끝) 앞으로. kind 'proj': id=프로젝트 키를 같은 카테고리의 beforeId(키, null=프로젝트 줄 맨 끝) 앞으로.
ipcMain.handle('projects:reorder', (e, kind, id, beforeId) => {
  if (!fromMain(e) || typeof id !== 'string' || (beforeId !== null && typeof beforeId !== 'string')) return { ok: false, reason: 'invalid' };
  if (PERSIST) loadProjUi();
  let next = null;
  if (kind === 'cat') {
    const order = L.moveInOrder(proj.view.open.map((g) => g.tag), id, beforeId);
    if (order) next = { ...projUi, catOrder: order };
  } else if (kind === 'proj') {
    const g = proj.view.open.find((x) => x.items.some((it) => it.kind === 'project' && it.key === id));
    const order = g ? L.moveInOrder(g.items.filter((it) => it.kind === 'project').map((it) => it.key), id, beforeId) : null; // beforeId 가 다른 카테고리 키이면 null
    if (order) next = { ...projUi, projOrder: { ...projUi.projOrder, [g.tag]: order } };
  }
  return next ? commitProjUi(next) : { ok: false, reason: 'invalid' };
});
// 프로젝트 "이어서 하기": 지시문은 i18n 템플릿 + main 이 가진 제목뿐(모델이 쓴 일지 문장은 섞지 않는다). 대상은 활성 작업 공간뿐.
ipcMain.handle('projects:continue', (e, id, key, shown) => {
  const w = wsFrom(e, id);
  const s = w ? findProject(key) : null;
  if (!w || !s || s.kind !== 'project') return { ok: false, reason: 'invalid' };
  if (w.id !== activeId) return { ok: false, reason: 'inactive' };
  if (typeof shown !== 'string' || shown !== s.title) return { ok: false, reason: 'stale' };
  return writePrompt(w, tr('project.continue', { title: s.title }));
});
ipcMain.handle('profile:get', (e) => (fromMain(e) ? {
  profile, defaultLang: L.defaultLang(app.getLocale()), version: VERSION, uiOpen: TEST_UI,
} : null));
// patch: { name?: string, lang?: 'ko'|'en' } 만 허용. 이름은 main 이 다시 정리·검증한다. 첫 저장에는 name 이 필요하다.
ipcMain.handle('profile:set', (e, patch) => {
  if (!fromMain(e) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, reason: 'invalid' };
  if (Object.keys(patch).some((k) => k !== 'name' && k !== 'lang')) return { ok: false, reason: 'invalid' };
  let name = profile ? profile.name : '';
  let lang = profile ? profile.lang : L.defaultLang(app.getLocale());
  if ('name' in patch) name = typeof patch.name === 'string' ? L.cleanName(patch.name) : '';
  if ('lang' in patch) { if (!I18N.isLang(patch.lang)) return { ok: false, reason: 'invalid' }; lang = patch.lang; }
  if (!name) return { ok: false, reason: 'name' };
  if (!ROOT) return { ok: false, reason: 'save' };
  const next = { name, lang, calendar: profile ? profile.calendar : false, createdAt: profile ? profile.createdAt : new Date().toISOString() };
  if (!L.saveProfile(profilePath(), next)) return { ok: false, reason: 'save' };
  profile = next; buildMenu(); refreshTray(true);
  return { ok: true, profile };
});
ipcMain.handle('calendar:set', async (e, on) => {
  if (!fromMain(e) || typeof on !== 'boolean' || !profile || !ROOT) return { ok: false };
  const next = { ...profile, calendar: on };
  if (!L.saveProfile(profilePath(), next)) return { ok: false };
  profile = next;
  await readCalendar();
  return { ok: true };
});
ipcMain.handle('settings:get', async (e, recheckCalendar) => (fromMain(e) ? { rows: await settingsRows(recheckCalendar === true) } : null));
ipcMain.handle('settings:open-pane', (e, key) => fromMain(e) && openSettingsPane(key));
ipcMain.handle('settings:copy-login', (e) => { if (!fromMain(e)) return false; clipboard.writeText('claude auth login'); return true; });
ipcMain.handle('hooks:preview', (e) => (fromMain(e) ? previewInstall() : { ok: false, reason: 'invalid' }));
ipcMain.handle('hooks:install', (e) => (fromMain(e) ? runInstall() : { ok: false, reason: 'invalid' }));
ipcMain.handle('update:check', (e) => (fromMain(e) ? checkUpdates(true) : null)); // 사용자가 업그레이드를 눌렀을 때만 저장소 fetch
ipcMain.handle('update:notice', (e) => { if (!fromMain(e)) return null; const n = finishNotice; finishNotice = null; return n; });
ipcMain.handle('update:download', async (e) => {
  if (!fromMain(e) || upd.busy || upd.view.status !== 'available' || !upd.raw || !updater || typeof updater.downloadAndVerify !== 'function') return { ok: false };
  upd.busy = true; upd.dmgPath = null;
  let last = -1;
  try {
    const r = await updater.downloadAndVerify(upd.raw, (p) => {
      const pct = Math.max(0, Math.min(100, Math.round((Number(p) || 0) * 100)));
      if (pct !== last && win && !win.isDestroyed()) { last = pct; win.webContents.send('update:progress', pct); }
    });
    if (!r || typeof r.dmgPath !== 'string' || !path.isAbsolute(r.dmgPath)) throw new Error('invalid result');
    upd.dmgPath = r.dmgPath;
    return { ok: true };
  } catch (err) { return { ok: false, message: errText(err) }; } finally { upd.busy = false; }
});
ipcMain.handle('update:install', async (e) => {
  if (!fromMain(e) || upd.busy || !upd.dmgPath || !updater || typeof updater.installAndRelaunch !== 'function') return { ok: false };
  upd.busy = true;
  try { await updater.installAndRelaunch(upd.dmgPath, { beforeQuit: () => { quitting = true; } }); return { ok: true }; } catch (err) { return { ok: false, message: errText(err) }; } finally { upd.busy = false; }
});
ipcMain.handle('update:pull', async (e) => {
  if (!fromMain(e) || upd.busy || !ROOT || !upd.view.repoBehind || !updater || typeof updater.pullRepo !== 'function') return { ok: false };
  upd.busy = true;
  try {
    const r = await updater.pullRepo(ROOT);
    return { ok: !!(r && r.ok), message: L.cleanBlock(r && typeof r.message === 'string' ? r.message : '', 400).split('\n')[0].slice(0, 200) };
  } catch (err) { return { ok: false, message: errText(err) }; } finally { upd.busy = false; }
});
ipcMain.on('app:rendered', (e) => {
  if (!fromMain(e)) return;
  if (refreshed) rendered = true;
  if (SMOKE) checkSmoke();
});

// ---- 창 ----
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 560,
    backgroundColor: '#0B0907', title: tr('app.title'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 화면(렌더러) 복구: pty 는 main 에 그대로 있으므로 다시 불러오기만 하면 된다. 다시 붙을 때 작업 공간 목록을 렌더러가 새로 요청하고,
  // 붙여넣기 모드(bracketed)는 main 이 가진 값을 쓴다. 1분에 3번을 넘게 죽으면 더는 자동으로 다시 불러오지 않는다.
  win.webContents.on('render-process-gone', (_e, d) => {
    if (!d || d.reason === 'clean-exit' || quitting) return;
    const now = Date.now(); reloads = reloads.filter((t) => now - t < 60000);
    if (reloads.length >= 3) return;
    reloads.push(now);
    try { if (win && !win.isDestroyed()) win.webContents.reload(); } catch { /* 무시 */ }
  });
  win.webContents.on('unresponsive', async () => {
    if (hangAsking || quitting) return;
    hangAsking = true;
    try {
      const ans = await box({ type: 'warning', buttons: [tr('dlg.hang.reload'), tr('dlg.hang.wait')], defaultId: 0, cancelId: 1, noLink: true, message: tr('dlg.hang.title'), detail: tr('dlg.hang.detail') });
      if (ans.response === 0 && win && !win.isDestroyed()) win.webContents.forcefullyCrashRenderer();
    } finally { hangAsking = false; }
  });
  // 닫기(빨간 버튼·⌘W)는 숨기기만 한다. pty 는 계속 돈다. 실제 종료는 ⌘Q·트레이 "종료"(before-quit)에서.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  if (TEST_FX && !(found && found.source === 'env')) { console.error('MARU_APP_FX 에는 시험용 저장소(MARU_HOME)가 필요합니다'); app.exit(1); return; }
  profile = ROOT ? L.loadProfile(profilePath()) : null;
  buildMenu();
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (e) => e.preventDefault());
  cleanOldStateFiles();
  initWorkspaces();
  createWindow();
  createTray();
  refresh();
  setInterval(refresh, REFRESH_MS).unref();
  refreshSquads(); setInterval(refreshSquads, 60000).unref(); // 스쿼드 목록은 시작 때와 60초마다(1초 폴링에 넣지 않는다)
  // 훅이 쓰는 상태 파일은 이벤트가 없으므로 1초마다 읽어 트레이를 갱신한다
  setInterval(() => {
    if (TEST_FX) for (const w of wsOrder()) if (w.term) writeFxState(w);
    for (const w of wsOrder()) if (w.unavailable && dirOk(w.cwd)) { w.unavailable = false; wsChanged(false); } // 디스크가 다시 연결됨
    refreshTray();
  }, 1000).unref();
  if (!SMOKE) { readCalendar(); setInterval(readCalendar, 15 * 60 * 1000).unref(); } // 스모크에서는 캘린더를 읽지 않는다
  if (!SMOKE) { finishPendingInstall().then(() => checkUpdates(false)); setInterval(() => checkUpdates(false), 6 * 3600 * 1000).unref(); }
  if (SMOKE) setTimeout(() => { console.error('SMOKE FAIL: 15초 초과 (pty-output/rendered 미충족)'); app.exit(1); }, 15000);
});
// 시스템 종료·재시작·로그아웃: 확인 창으로 막지 않는다. 이 신호 뒤에 오는 before-quit 은 확인된 것으로 취급한다.
app.whenReady().then(() => { powerMonitor.on('shutdown', () => { quitting = true; cleanup(); }); });
app.on('activate', showWindow); // Dock 아이콘 클릭
app.on('before-quit', (e) => {
  if (quitting) return;
  if (!(!app.isPackaged && (SMOKE || TEST_FX)) && attention().length) { e.preventDefault(); confirmQuit(); return; }
  quitting = true; cleanup();
});
app.on('will-quit', cleanup);
app.on('window-all-closed', () => { if (quitting) { cleanup(); app.quit(); } }); // 창만 닫힌 것은 종료가 아니다
