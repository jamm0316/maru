'use strict';
const { app, BrowserWindow, ipcMain, Menu, session, systemPreferences, shell, clipboard, dialog } = require('electron');
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
const TEST_UI = !app.isPackaged && ['menu', 'settings', 'update'].includes(process.env.MARU_APP_UI) ? process.env.MARU_APP_UI : null; // 시험 전용(패키징 빌드에서는 무시)
const PARTY = [
  { name: null, roleKey: 'lead', model: 'sonnet', lead: true }, // name null = 앱 이름(i18n app.title)
  { name: 'scout', roleKey: 'scout', model: 'haiku' },
  { name: 'worker', roleKey: 'worker', model: 'sonnet' },
  { name: 'expert', roleKey: 'expert', model: 'opus' },
];

let win = null;
let term = null;
let smokeOut = '';
let rendered = false;
let smokeDone = false;
let refreshed = false;
let lastOutputAt = 0;
let sessionId = null; // 이 pty 의 MARU_APP_SESSION
const STATE_DIR = () => path.join(ROOT, 'data', 'state', 'app');
const stateFile = () => (ROOT && sessionId ? path.join(STATE_DIR(), sessionId + '.json') : null);
function removeStateFile() { const f = stateFile(); if (f) try { fs.unlinkSync(f); } catch { /* 없음 */ } }
function readAgentState() {
  const f = stateFile();
  const r = f ? readRegular(f, 4096, false) : null;
  return r ? L.parseAgentRecord(r.text) : null;
}
// 하루 넘은 상태 파일·임시 파일 정리(일반 파일만)
function cleanOldStateFiles() {
  if (!ROOT) return;
  const dir = STATE_DIR();
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return;
    for (const name of fs.readdirSync(dir)) {
      if (!(name.startsWith('.') || name.endsWith('.json'))) continue;
      const f = path.join(dir, name);
      const st = fs.lstatSync(f);
      if (st.isFile() && Date.now() - st.mtimeMs > 24 * 3600 * 1000) fs.unlinkSync(f);
    }
  } catch { /* 디렉터리 없음 */ }
}
let bracketed = false; // 터미널 앱이 브래킷 붙여넣기(?2004)를 켰는가
let seqTail = '';
const INDEX_URL = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
let cache = {
  status: null, todos: [], skills: [], briefing: [], battery: null, disk: null,
};

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
      todos: L.resolveTodos(todoRes, sug), // todos.txt 우선, 없거나 유효 항목이 없으면 suggestions.txt
      skills: L.mergeSkillNames(
        skillDirs(path.join(os.homedir(), '.claude', 'skills')),
        skillDirs(path.join(ROOT, '.claude', 'skills')),
      ),
      briefing: L.mergeBriefing(logs),
      battery: batt ? L.parseBattery(batt) : null,
      disk: df ? L.parseDiskFree(df) : null,
    };
    refreshed = true;
  } finally { refreshing = false; }
}

function panels() {
  const st = cache.status || {};
  const lv = L.levelInfo(typeof st.memoryFiles === 'number' ? st.memoryFiles : 0);
  return {
    rootMissing: !ROOT,
    rootName: ROOT ? path.basename(ROOT) : '-',
    level: lv,
    lastReflect: st.lastReflect || null,
    lastDream: st.lastDream || null,
    pendingSkillProposals: typeof st.pendingSkillProposals === 'number' ? st.pendingSkillProposals : 0,
    todos: cache.todos,
    skills: cache.skills,
    briefing: cache.briefing,
    battery: cache.battery,
    disk: cache.disk,
    party: PARTY,
    calendar: profile && profile.calendar && cal.ok ? cal.events : [], // 메모리에만 둔다(디스크·로그 금지)
    updateAvailable: upd.view.status === 'available',
    workspaces: ROOT ? [{ name: path.basename(ROOT), active: true }] : [],
    agent: L.effectiveAgent(readAgentState(), Date.now(), lastOutputAt), // busy | idle | waiting | none (Claude Code 훅이 기록)
  };
}

// ---- pty ----
function trackBracketed(d) {
  const s = seqTail + d;
  const h = s.lastIndexOf('\x1b[?2004h');
  const l = s.lastIndexOf('\x1b[?2004l');
  if (h > l) bracketed = true; else if (l > h) bracketed = false;
  seqTail = s.slice(-7); // 시퀀스 길이(8)보다 짧게 남겨 중복 처리 방지
}

function startPty(cols, rows) {
  if (term) return true;
  const shell = process.env.SHELL || '/bin/zsh';
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_') || k.startsWith('MARU_APP')) delete env[k];
  const sid = crypto.randomUUID();
  sessionId = L.isSessionId(sid) ? sid : null; // 셸 env 에는 넣지 않고 claude 실행 명령에만 붙인다
  let self;
  try {
    self = pty.spawn(shell, ['-l'], { name: 'xterm-256color', cols, rows, cwd: ROOT || os.homedir(), env });
  } catch { return false; }
  removeStateFile();
  term = self; bracketed = false; seqTail = '';
  self.onData((d) => {
    if (term !== self) return;
    lastOutputAt = Date.now();
    trackBracketed(d);
    if (SMOKE) smokeOut += d;
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', d);
    if (SMOKE) checkSmoke();
  });
  self.onExit(({ exitCode }) => {
    if (term !== self) return;
    term = null; bracketed = false; removeStateFile();
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', exitCode);
  });
  // 스모크에서는 claude 대신 echo. 평소에는 claude 가 있을 때만 교체(없으면 셸 유지)
  if (SMOKE) self.write('echo maru-ok 한글 명조 정렬 테스트 가나다라마바사\r');
  else if (ROOT) self.write('command -v claude >/dev/null && ' + (sessionId ? 'MARU_APP_SESSION=' + sessionId + ' ' : '') + 'exec claude\r');
  return true;
}

function killPty() {
  const old = term; term = null; bracketed = false; removeStateFile();
  if (old) { try { old.kill(); } catch { /* 이미 종료 */ } }
}

function checkSmoke() {
  if (smokeDone || !rendered || !refreshed || !/^maru-ok 한글 .*\r?$/m.test(smokeOut.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))) return;
  smokeDone = true;
  const p = app.isPackaged ? null : panels();
  console.log('SMOKE OK pty-output=maru-ok panels-rendered=true root-source=' + (found ? found.source : 'none') + ' packaged=' + app.isPackaged);
  if (!ROOT) { console.error('SMOKE FAIL: 저장소를 찾지 못함'); app.exit(1); return; }
  if (!app.isPackaged) console.log(JSON.stringify(p, null, 2)); // 패널 내용은 개발 실행에서만 출력
  const shot = app.isPackaged ? null : process.env.MARU_APP_SHOT; // 선택(개발 전용): 스모크 때 화면 캡처 경로. 패키징 빌드에서는 무시
  if (shot && win) {
    setTimeout(() => win.webContents.capturePage().then((img) => { fs.writeFileSync(shot, img.toPNG()); app.exit(0); }, () => app.exit(0)), TEST_UI ? 4000 : 800);
    return;
  }
  app.exit(0);
}

// ---- 프로필·언어 ----
let profile = null; // 유효한 data/profile.json 이 있을 때만 객체
const profilePath = () => path.join(ROOT, 'data', 'profile.json');
const curLang = () => (profile ? profile.lang : L.defaultLang(app.getLocale()));
const tr = (k, p) => I18N.t(curLang(), k, p);
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: tr('menu.terminal'), submenu: [{
      label: tr('menu.restart'), accelerator: 'CmdOrCtrl+Shift+R',
      click: () => { if (win) win.webContents.send('pty:restart-request'); },
    }] },
    { label: tr('set.title'), submenu: [{
      label: tr('menu.openSettings'), accelerator: 'CmdOrCtrl+,',
      click: () => { if (win) win.webContents.send('ui:open-settings'); },
    }] },
    { role: 'windowMenu' },
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

ipcMain.handle('pty:start', (e, cols, rows) => {
  if (!fromMain(e) || !int(cols, 2, 1000) || !int(rows, 2, 1000)) return false;
  return startPty(cols, rows);
});
ipcMain.handle('pty:restart', (e, cols, rows) => {
  if (!fromMain(e) || !int(cols, 2, 1000) || !int(rows, 2, 1000)) return false;
  killPty();
  return startPty(cols, rows);
});
ipcMain.on('pty:write', (e, data) => {
  if (!fromMain(e) || typeof data !== 'string' || data.length > 1 << 20 || !term) return;
  term.write(data);
});
ipcMain.on('pty:resize', (e, cols, rows) => {
  if (!fromMain(e) || !int(cols, 2, 1000) || !int(rows, 2, 1000) || !term) return;
  try { term.resize(cols, rows); } catch { /* 종료 직후 */ }
});
ipcMain.handle('panels:get', (e) => (fromMain(e) ? panels() : null));
// 렌더러가 본 항목(shown = 제목+"\n"+프롬프트)이 main 의 index 번 항목과 같을 때만 처리. 쓰는 문장은 항상 main 의 프롬프트.
ipcMain.handle('quest:fill', (e, index, shown) => {
  if (!fromMain(e) || !int(index, 0, cache.todos.length - 1)) return { ok: false, reason: 'invalid' };
  const item = L.matchTodo(cache.todos, index, shown);
  if (!item) return { ok: false, reason: 'stale' };
  if (!item.prompt) return { ok: false, reason: 'no-prompt' }; // 사용자가 직접 할 일
  if (!term) return { ok: false, reason: 'no-term' };
  const text = L.cleanQuestText(item.prompt);
  if (!text || !L.isSafeQuestStart(text)) return { ok: false, reason: 'unsafe-start' };
  if (!bracketed) return { ok: false, reason: 'not-ready' }; // 선택 프롬프트 등에서는 쓰지 않는다
  term.write('\x1b[200~' + text + '\x1b[201~'); // 붙여넣기로 감싸 Enter 없이 입력줄에만
  return { ok: true };
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
  profile = next; buildMenu();
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
  try { await updater.installAndRelaunch(upd.dmgPath); return { ok: true }; } catch (err) { return { ok: false, message: errText(err) }; } finally { upd.busy = false; }
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
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  profile = ROOT ? L.loadProfile(profilePath()) : null;
  buildMenu();
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (e) => e.preventDefault());
  cleanOldStateFiles();
  createWindow();
  refresh();
  setInterval(refresh, REFRESH_MS).unref();
  if (!SMOKE) { readCalendar(); setInterval(readCalendar, 15 * 60 * 1000).unref(); } // 스모크에서는 캘린더를 읽지 않는다
  if (!SMOKE) { finishPendingInstall().then(() => checkUpdates(false)); setInterval(() => checkUpdates(false), 6 * 3600 * 1000).unref(); }
  if (SMOKE) setTimeout(() => { console.error('SMOKE FAIL: 15초 초과 (pty-output/rendered 미충족)'); app.exit(1); }, 15000).unref();
});
function cleanup() { killPty(); removeStateFile(); }
app.on('before-quit', cleanup);
app.on('will-quit', cleanup);
app.on('window-all-closed', () => { cleanup(); app.quit(); });
