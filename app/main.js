'use strict';
const { app, BrowserWindow, ipcMain, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const pty = require('node-pty');
const L = require('./lib');

const ROOT = path.resolve(__dirname, '..');
const SMOKE = process.env.MARU_APP_SMOKE === '1';
const REFRESH_MS = 30000;
const BUSY_WINDOW_MS = 1500;
const PARTY = [
  { name: '마루', role: '지휘', model: 'sonnet', lead: true },
  { name: 'scout', role: '정찰', model: 'haiku' },
  { name: 'worker', role: '작업', model: 'sonnet' },
  { name: 'expert', role: '자문', model: 'opus' },
];

let win = null;
let term = null;
let lastOutputAt = 0;
let smokeOut = '';
let rendered = false;
let smokeDone = false;
let refreshed = false;
let bracketed = false; // 터미널 앱이 브래킷 붙여넣기(?2004)를 켰는가
let seqTail = '';
const INDEX_URL = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
let cache = {
  status: null, quests: [], skills: [], briefing: [], battery: null, disk: null,
};

// ---- 데이터 수집(고정 경로만) ----
function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 10000, maxBuffer: 1 << 20, cwd: ROOT, ...opts }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

// 일반 파일만(심볼릭 링크·FIFO 거부), 읽은 바이트(bytesRead)만 사용
function readRegular(file, maxBytes, fromEnd) {
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, fromEnd ? st.size - len : 0);
    return { text: buf.toString('utf8', 0, n), truncated: st.size > maxBytes };
  } catch { return null; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* 무시 */ } }
}
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
  if (refreshing) return;
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
    const logs = ['dream', 'reflect'].map((k) => {
      const r = readTail(path.join(ROOT, 'data', 'logs', `${k}.log`), L.LOG_TAIL_BYTES);
      return r ? L.parseLogEvents(r.text, k, r.truncated) : [];
    });
    cache = {
      status,
      quests: sug ? L.parseSuggestions(sug.text, sug.truncated) : [],
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
    rootName: path.basename(ROOT),
    level: lv,
    lastReflect: st.lastReflect || null,
    lastDream: st.lastDream || null,
    pendingSkillProposals: typeof st.pendingSkillProposals === 'number' ? st.pendingSkillProposals : 0,
    quests: cache.quests,
    skills: cache.skills,
    briefing: cache.briefing,
    battery: cache.battery,
    disk: cache.disk,
    party: PARTY,
    workspaces: [{ name: path.basename(ROOT), active: true }],
    busy: Date.now() - lastOutputAt < BUSY_WINDOW_MS,
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
  let self;
  try {
    self = pty.spawn(shell, ['-l'], { name: 'xterm-256color', cols, rows, cwd: ROOT, env });
  } catch { return false; }
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
    term = null; bracketed = false;
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', exitCode);
  });
  // 스모크에서는 claude 대신 echo. 평소에는 claude 가 있을 때만 교체(없으면 셸 유지)
  self.write(SMOKE ? 'echo maru-ok\r' : 'command -v claude >/dev/null && exec claude\r');
  return true;
}

function killPty() {
  const old = term; term = null; bracketed = false;
  if (old) { try { old.kill(); } catch { /* 이미 종료 */ } }
}

function checkSmoke() {
  if (smokeDone || !rendered || !refreshed || !/^maru-ok\r?$/m.test(smokeOut.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))) return;
  smokeDone = true;
  const p = panels();
  console.log('SMOKE OK pty-output=maru-ok panels-rendered=true');
  console.log(JSON.stringify(p, null, 2));
  const shot = process.env.MARU_APP_SHOT; // 선택: 스모크 때 화면 캡처 경로
  if (shot && win) {
    setTimeout(() => win.webContents.capturePage().then((img) => { fs.writeFileSync(shot, img.toPNG()); app.exit(0); }, () => app.exit(0)), 800);
    return;
  }
  app.exit(0);
}

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
// 렌더러가 화면에서 본 문장(shown)이 main 의 현재 목록과 같을 때만 처리. 쓰는 문장은 항상 main 의 것.
ipcMain.handle('quest:fill', (e, index, shown) => {
  if (!fromMain(e) || !int(index, 0, cache.quests.length - 1)) return { ok: false, reason: 'invalid' };
  if (cache.quests[index] !== shown) return { ok: false, reason: 'stale' };
  if (!term) return { ok: false, reason: 'no-term' };
  const text = L.cleanQuestText(cache.quests[index]);
  if (!text || !L.isSafeQuestStart(text)) return { ok: false, reason: 'unsafe-start' };
  if (!bracketed) return { ok: false, reason: 'not-ready' }; // 선택 프롬프트 등에서는 쓰지 않는다
  term.write('\x1b[200~' + text + '\x1b[201~'); // 붙여넣기로 감싸 Enter 없이 입력줄에만
  return { ok: true };
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
    backgroundColor: '#0B0907', title: '마루',
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: '터미널', submenu: [{
      label: '터미널 다시 시작', accelerator: 'CmdOrCtrl+Shift+R',
      click: () => { if (win) win.webContents.send('pty:restart-request'); },
    }] },
    { role: 'windowMenu' },
  ]));
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (e) => e.preventDefault());
  createWindow();
  refresh();
  setInterval(refresh, REFRESH_MS).unref();
  if (SMOKE) setTimeout(() => { console.error('SMOKE FAIL: 15초 초과 (pty-output/rendered 미충족)'); app.exit(1); }, 15000).unref();
});
app.on('window-all-closed', () => {
  if (term) { try { term.kill(); } catch { /* 이미 종료 */ } }
  app.quit();
});
