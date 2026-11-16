'use strict';
// 순수 함수 모음(Electron·파일·프로세스 의존 없음). test.js 로 검사한다.

const MEMORIES_PER_LEVEL = 50;
const QUEST_MAX_CHARS = 120;
const SUGGESTIONS_MAX_BYTES = 64 * 1024;
const LOG_TAIL_BYTES = 64 * 1024;
const BRIEFING_MAX = 4;
const NAME_MAX = 64;

// 제어문자, bidi, zero-width, 보이지 않는 서식·채움 문자, Tags, 변형 선택자, 한글 채움, 미할당·사설·서로게이트(u 플래그)
const BAD_SRC = '[' + [
  '\\u0000-\\u001F', '\\u007F-\\u009F', '\\u00AD', '\\u034F', '\\u061C', '\\u115F', '\\u1160', '\\u180E',
  '\\u200B-\\u200F', '\\u2028-\\u202E', '\\u2060-\\u206F', '\\u3164', '\\uFE00-\\uFE0F', '\\uFEFF', '\\uFFA0',
  '\\uFFF9-\\uFFFB', '\\u{E0000}-\\u{E007F}', '\\u{E0100}-\\u{E01EF}', '\\p{Cf}', '\\p{Co}', '\\p{Cn}', '\\p{Cs}',
].join('') + ']';
const BAD_CHARS = new RegExp(BAD_SRC, 'u');
const BAD_CHARS_G = new RegExp(BAD_SRC, 'gu');

function hasBadChars(s) { return BAD_CHARS.test(s); }

function levelInfo(memoryFiles, per = MEMORIES_PER_LEVEL) {
  const n = Number.isFinite(memoryFiles) && memoryFiles > 0 ? Math.floor(memoryFiles) : 0;
  const rem = n % per;
  return { level: Math.floor(n / per) + 1, memories: n, ratio: rem / per, toNext: per - rem };
}

// suggestions.txt 본문 -> 퀘스트 문장 배열
function parseSuggestions(text, truncated = false) {
  if (typeof text !== 'string') return [];
  const out = [];
  const rows = text.split(/\r?\n/);
  if (truncated) rows.pop(); // 64KB 에서 잘렸으면 마지막(불완전) 줄 버림
  for (const raw of rows) {
    const line = raw.trim();
    if (!line) continue;
    if ([...line].length > QUEST_MAX_CHARS) continue;
    if (hasBadChars(line)) continue;
    out.push(line);
  }
  return out;
}

// todos.txt 본문 -> [{tag, importance, title, prompt}]  (스크립트가 모델 출력으로 쓰는 신뢰 못 할 파일: 엄격 파싱)
// 줄 형식: <tag>|<importance>|<title>|<prompt>  (| 정확히 3개)
const TODO_MAX = 7;
const TODO_LINE_MAX_CHARS = 400;
const TODO_TITLE_MAX = 60;
const TODO_PROMPT_MAX = 120;
const TODO_TAG_RE = /^[0-9A-Za-z가-힣-]{1,12}$/;
const TODO_IMP_RE = /^(10|[1-9])$/;
function parseTodos(text, truncated = false) {
  if (typeof text !== 'string') return [];
  const rows = text.split(/\r?\n/);
  if (truncated) rows.pop(); // 잘렸으면 마지막(불완전) 줄 버림
  const out = [];
  for (const raw of rows) {
    if (out.length >= TODO_MAX) break;
    if (!raw.trim() || [...raw].length > TODO_LINE_MAX_CHARS) continue;
    const f = raw.split('|');
    if (f.length !== 4) continue;
    const [tag, imp, rawTitle, rawPrompt] = f;
    if (!TODO_TAG_RE.test(tag) || !TODO_IMP_RE.test(imp)) continue;
    const title = cleanQuestText(rawTitle);
    let prompt = cleanQuestText(rawPrompt);
    if (prompt && !isSafeQuestStart(prompt)) prompt = ''; // 붙여넣어도 거부될 프롬프트: 직접 할 일로 취급
    if (!title || [...title].length > TODO_TITLE_MAX || [...prompt].length > TODO_PROMPT_MAX) continue;
    out.push({ tag, importance: Number(imp), title, prompt });
  }
  return out;
}

// suggestions.txt 문장 -> 할 일 항목(todos.txt 가 없거나 유효 항목이 없을 때의 대체)
function todosFromSuggestions(list) {
  return (Array.isArray(list) ? list : []).slice(0, TODO_MAX).map((s) => ({ tag: '추천', importance: 5, title: s, prompt: s }));
}

// todosRes/sugRes: {text, truncated}|null (readRegular 결과)
function resolveTodos(todosRes, sugRes) {
  const t = todosRes ? parseTodos(todosRes.text, todosRes.truncated) : [];
  if (t.length) return t;
  return sugRes ? todosFromSuggestions(parseSuggestions(sugRes.text, sugRes.truncated)) : [];
}

// 렌더러가 보여 준 항목의 비교 키: 제목과 프롬프트(정리된 문자열에는 \n 이 없으므로 모호하지 않다)
// 중요도(1~10) -> 채운 별 개수(1~3). 8 이상 3개, 5~7 2개, 그 밖은 1개
function todoStars(importance) {
  const n = Number(importance);
  return n >= 8 ? 3 : n >= 5 ? 2 : 1;
}

function todoKey(item) { return item ? item.title + '\n' + item.prompt : ''; }

// main 이 가진 목록의 index 항목이 렌더러가 본 shown(todoKey)과 같을 때만 그 항목을 돌려준다
function matchTodo(items, index, shown) {
  if (!Array.isArray(items) || !Number.isInteger(index) || index < 0 || index >= items.length) return null;
  return typeof shown === 'string' && todoKey(items[index]) === shown ? items[index] : null;
}

// 채우기 거부 사유 -> 문구 키(문구는 i18n.js 의 'fill.<사유>')
const FILL_REASONS = ['stale', 'no-prompt', 'unsafe-start', 'not-ready', 'no-term', 'inactive', 'invalid'];
function fillNoticeKey(reason) { return 'fill.' + (FILL_REASONS.includes(reason) ? reason : 'invalid'); }

// pty 에 써 넣을 문장 정리: 개행·\r·제어문자·보이지 않는 문자 제거
function cleanQuestText(s) {
  if (typeof s !== 'string') return '';
  return s.replace(BAD_CHARS_G, '').trim();
}

// 스킬 디렉터리 이름 필터(내용은 읽지 않는다)
// 숫자·!·/ 로 시작하면 선택 프롬프트/명령으로 오해될 수 있어 써 넣지 않는다
function isSafeQuestStart(s) { return typeof s === 'string' && s.length > 0 && !/^[0-9!\/]/.test(s); }

// 터미널 단축키: keydown 이벤트 -> pty 에 보낼 시퀀스(없으면 null). IME 조합 중에는 가로채지 않는다.
function keyToSeq(e) {
  if (!e || e.type !== 'keydown' || e.key !== 'Backspace') return null;
  if (e.isComposing || e.keyCode === 229) return null;
  if (e.ctrlKey || e.shiftKey) return null;
  if (e.metaKey && !e.altKey) return '\x15'; // Cmd+Backspace: 줄 앞부분 삭제(Ctrl+U)
  if (e.altKey && !e.metaKey) return '\x17'; // Option+Backspace: 앞 단어 삭제(Ctrl+W)
  return null;
}

// 마루 저장소 위치 찾기. 순서: MARU_HOME -> ~/.config/maru/root 첫 줄 -> (패키징 안 됨) appDir/.. -> ~/maru
// io: { readConfig(): string|null, isRepo(dir): boolean }. 후보는 절대경로이고 isRepo 통과해야 채택.
function resolveRoot({ env = {}, home, isPackaged, appDir, io }) {
  const path = require('path');
  const expand = (p) => {
    if (typeof p !== 'string') return null;
    p = p.trim();
    if (!p) return null;
    if (p === '~') p = home;
    else if (p.startsWith('~/')) p = path.join(home, p.slice(2));
    return path.isAbsolute(p) ? path.normalize(p) : null;
  };
  let cfg = null;
  try { const t = io.readConfig(); if (typeof t === 'string') cfg = t.split(/\r?\n/)[0]; } catch { /* 없음 */ }
  const cands = [
    ['env', expand(env.MARU_HOME)],
    ['config', expand(cfg)],
    ['app', isPackaged ? null : (appDir ? path.resolve(appDir, '..') : null)],
    ['home', home ? path.join(home, 'maru') : null],
  ];
  for (const [source, dir] of cands) {
    if (!dir) continue;
    let ok = false;
    try { ok = io.isRepo(dir) === true; } catch { ok = false; }
    if (ok) return { root: dir, source };
  }
  return null;
}

// 에이전트 상태 파일(JSON {"state","at"}) -> 'busy'|'idle'|'waiting'|null
const AGENT_STATES = ['busy', 'idle', 'waiting'];
function parseAgentState(text) {
  if (typeof text !== 'string' || text.length > 4096) return null;
  try {
    const o = JSON.parse(text);
    return o && typeof o === 'object' && AGENT_STATES.includes(o.state) ? o.state : null;
  } catch { return null; }
}

// 상태 파일 -> {state, atMs}|null
function parseAgentRecord(text) {
  const state = parseAgentState(text);
  if (!state) return null;
  let atMs = NaN;
  try { atMs = Date.parse(JSON.parse(text).at); } catch { /* 무시 */ }
  return { state, atMs };
}

// busy 인데 기록이 오래되고(staleMs) pty 출력도 그동안 없으면 idle 로 낮춘다(Esc 중단 등 Stop 훅이 없는 경우)
function effectiveAgent(rec, now, lastOutputAt, staleMs = 20000) {
  if (!rec) return 'none';
  if (rec.state !== 'busy') return rec.state;
  const quiet = now - lastOutputAt > staleMs;
  const old = !Number.isFinite(rec.atMs) || now - rec.atMs > staleMs;
  return old && quiet ? 'idle' : 'busy';
}

// MARU_APP_SESSION 형식: [A-Za-z0-9-]{8,64}
const isSessionId = (s) => typeof s === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(s);

function validSkillName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= NAME_MAX &&
    !name.startsWith('.') && !hasBadChars(name) && !/[\/\\]/.test(name);
}

function mergeSkillNames(...lists) {
  const set = new Set();
  for (const l of lists) for (const n of l || []) if (validSkillName(n)) set.add(n);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// pmset -g batt
function parseBattery(out) {
  if (typeof out !== 'string') return null;
  const src = /Now drawing from '([^']+)'/.exec(out);
  const m = /(\d{1,3})%;\s*([^;]+);/.exec(out);
  if (!m) return null;
  return {
    percent: Math.min(100, Number(m[1])),
    state: m[2].trim(),
    onAC: src ? /AC/i.test(src[1]) : null,
  };
}

// df -k /
function parseDiskFree(out) {
  if (typeof out !== 'string') return null;
  const lines = out.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const f = lines[lines.length - 1].trim().split(/\s+/);
  const kb = Number(f[3]);
  if (!Number.isFinite(kb) || kb < 0) return null;
  return { freeGB: Math.round(kb / 1024 / 1024) };
}

// dream.log / reflect.log 꼬리 -> 이벤트 [{at, code, n?}] (문구는 i18n.js 의 'ev.<code>')
// 줄 형식: "YYYY-MM-DD HH:MM:SS [dream|해시8] 메시지" 또는 "YYYY-MM-DD HH:MM:SS 추천 목록 갱신: ok N줄 ..."
const LOG_LINE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (.*)$/;

function parseLogEvents(text, kind, truncated = false) {
  if (typeof text !== 'string') return [];
  let lines = text.split(/\r?\n/);
  if (truncated) lines = lines.slice(1); // 잘린 첫 줄 버림
  const events = [];
  for (const line of lines) {
    const m = LOG_LINE.exec(line);
    if (!m) continue;
    const at = m[1];
    const body = m[2].replace(/^\[[^\]]*\]\s*/, '');
    let t = null; let n;
    if (kind === 'dream') {
      let x;
      if (/스냅샷 실패/.test(body)) t = 'dream.snapshotFail';
      else if (/기억 변경 없음/.test(body)) t = 'dream.noChange';
      else if (/커밋 완료/.test(body)) t = 'dream.commit';
      else if (/되돌림/.test(body)) t = 'dream.rollback';
      else if ((x = /sweep 끝:.*처리 (\d+)개/.exec(body)) && Number(x[1]) > 0) { t = 'dream.sweep'; n = Number(x[1]); }
    } else {
      let x;
      if (/^커밋 완료/.test(body)) t = 'reflect.commit';
      else if (/^변경 없음\(커밋/.test(body)) t = 'reflect.noChange';
      else if (/^되돌림/.test(body)) t = 'reflect.rollback';
      else if ((x = /^추천 목록 갱신: ok (\d+)줄/.exec(m[2])) && Number(x[1]) > 0) { t = 'reflect.quests'; n = Number(x[1]); }
    }
    if (t) events.push(n === undefined ? { at, code: t } : { at, code: t, n });
  }
  return events;
}

function mergeBriefing(eventLists, max = BRIEFING_MAX) {
  const all = [].concat(...eventLists);
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // 최신순(안정 아님 허용)
  return all.slice(0, max);
}

// ---- 안전한 파일 읽기/쓰기 (Node 전용: 렌더러에서는 호출하지 않는다) ----
// 일반 파일만(심볼릭 링크·FIFO 거부), 읽은 바이트(bytesRead)만 사용
function readRegular(file, maxBytes, fromEnd) {
  const fs = require('fs');
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

// ---- 프로필 (<저장소>/data/profile.json) ----
const NAME_MIN_CHARS = 1;
const NAME_MAX_CHARS = 24;
const PROFILE_MAX_BYTES = 4096;
const PROFILE_LANGS = ['ko', 'en'];

// 이름 정리: 퀘스트와 같은 문자 필터(제어문자·개행·보이지 않는 문자 제거) 뒤 1~24 코드포인트. 아니면 ''.
function cleanName(s) {
  const c = cleanQuestText(s);
  const n = [...c].length;
  return n >= NAME_MIN_CHARS && n <= NAME_MAX_CHARS ? c : '';
}

function defaultLang(locale) { return typeof locale === 'string' && /^ko\b/i.test(locale) ? 'ko' : 'en'; }

// 엄격 검증: 정리된 이름(이미 깨끗해야 함)·ko|en·boolean·ISO 날짜. 통과하면 알려진 필드만 담은 새 객체, 아니면 null.
function validateProfile(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (typeof o.name !== 'string' || !o.name || cleanName(o.name) !== o.name) return null;
  if (!PROFILE_LANGS.includes(o.lang)) return null;
  if (typeof o.calendar !== 'boolean') return null;
  if (typeof o.createdAt !== 'string' || o.createdAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(o.createdAt) || !Number.isFinite(Date.parse(o.createdAt))) return null;
  return { name: o.name, lang: o.lang, calendar: o.calendar, createdAt: o.createdAt };
}

// readRegular 결과({text, truncated}|null) -> 프로필|null (나쁜 파일은 없는 것으로 취급)
function parseProfile(res) {
  if (!res || res.truncated || typeof res.text !== 'string') return null;
  try { return validateProfile(JSON.parse(res.text)); } catch { return null; }
}
function loadProfile(file) { return parseProfile(readRegular(file, PROFILE_MAX_BYTES, false)); }

// 원자적 저장(임시 파일 0600 + rename). data 폴더가 심볼릭 링크면 거부. 성공 여부를 돌려준다.
function writeJsonAtomic(file, value, tmpPrefix) {
  const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
  const dir = path.dirname(file);
  const tmp = path.join(dir, '.' + tmpPrefix + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
  let fd = null;
  try {
    let st = null;
    try { st = fs.lstatSync(dir); } catch { /* 없음 */ }
    if (!st) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    else if (st.isSymbolicLink() || !st.isDirectory()) return false;
    fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    fs.renameSync(tmp, file);
    return true;
  } catch {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* 무시 */ }
    try { fs.unlinkSync(tmp); } catch { /* 없음 */ }
    return false;
  }
}
function saveProfile(file, profile) {
  const v = validateProfile(profile);
  return v ? writeJsonAtomic(file, v, 'profile') : false;
}

// ---- 작업 공간(탭) ----
const WS_MAX = 6;
const WS_TITLE_MAX = 40;
const WS_PATH_MAX = 1024;
const WS_FILE_MAX_BYTES = 32 * 1024;

// 폴더 이름 -> 제목(보이지 않는 문자 제거, 40자 상한). 비면 'workspace'.
function workspaceTitle(cwd, fallback) {
  const base = typeof cwd === 'string' ? cwd.replace(/\/+$/, '').split('/').pop() : '';
  const c = [...cleanQuestText(base || (cwd === '/' ? '/' : ''))].slice(0, WS_TITLE_MAX).join('').trim();
  return c || (typeof fallback === 'string' && fallback ? fallback : 'workspace');
}
// 이미 쓰는 제목(taken)과 겹치면 " 2", " 3" … 을 붙인다
function uniqueTitle(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const cand = [...base].slice(0, WS_TITLE_MAX - String(n).length - 1).join('') + ' ' + n;
    if (!used.has(cand)) return cand;
  }
}
// 저장된 목록 -> { list: [{cwd, title}], active }. 잘못된 항목·없는 폴더는 버리고 6개까지만 쓴다. exists(cwd): boolean
function normalizeWorkspaces(raw, { exists, max = WS_MAX, fallbackTitle } = {}) {
  const out = { list: [], active: 0 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.workspaces)) return out;
  const origIdx = [];
  raw.workspaces.forEach((e, i) => {
    if (out.list.length >= max || !e || typeof e !== 'object' || Array.isArray(e)) return;
    let cwd = e.cwd;
    if (typeof cwd !== 'string' || cwd.length > WS_PATH_MAX || !cwd.startsWith('/') || hasBadChars(cwd)) return;
    cwd = cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd;
    if (cwd.split('/').some((s) => s === '..' || s === '.')) return;
    let ok = false;
    try { ok = typeof exists === 'function' && exists(cwd) === true; } catch { ok = false; }
    const t = typeof e.title === 'string' ? [...cleanQuestText(e.title)].slice(0, WS_TITLE_MAX).join('').trim() : '';
    const entry = { cwd, title: uniqueTitle(t || workspaceTitle(cwd, fallbackTitle), out.list.map((x) => x.title)) };
    if (!ok) entry.unavailable = true; // 폴더가 잠시 없을 수 있다(연결 해제된 디스크): 버리지 않고 '사용 불가'로 남긴다
    out.list.push(entry);
    origIdx.push(i);
  });
  const a = origIdx.indexOf(raw.active);
  out.active = a >= 0 ? a : 0;
  return out;
}
// readRegular 결과 -> normalizeWorkspaces 결과|null (파일 없음·잘림·나쁜 JSON 은 null)
function parseWorkspaces(res, exists, extra) {
  if (!res || res.truncated || typeof res.text !== 'string') return null;
  let o; try { o = JSON.parse(res.text); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.workspaces)) return null;
  return normalizeWorkspaces(o, { exists, ...(extra || {}) });
}
function loadWorkspaces(file, exists, extra) { return parseWorkspaces(readRegular(file, WS_FILE_MAX_BYTES, false), exists, extra); }
// 시작 때 읽기: { status: 'missing' | 'corrupt' | 'ok', data }. 파일이 있는데 못 읽으면 corrupt(링크·잘림·나쁜 JSON·형식 오류 포함).
function readWorkspacesFile(file, exists, extra) {
  const fs = require('fs');
  let present = true;
  try { fs.lstatSync(file); } catch { present = false; }
  if (!present) return { status: 'missing', data: null };
  const data = loadWorkspaces(file, exists, extra);
  return data ? { status: 'ok', data } : { status: 'corrupt', data: null };
}
// 망가진 파일을 <file>.bak 으로 옮긴다(예전 .bak 은 덮어씀). 성공 여부.
function backupCorruptFile(file) {
  const fs = require('fs');
  try { fs.renameSync(file, file + '.bak'); return true; } catch { return false; }
}
// 저장: cwd·제목·활성 위치만(다른 필드는 쓰지 않는다)
function saveWorkspaces(file, list, active) {
  const n = normalizeWorkspaces({ workspaces: list, active }, { exists: () => true });
  return writeJsonAtomic(file, { version: 1, active: n.active, workspaces: n.list }, 'workspaces');
}
// 폴더 stat -> 사용 가능한가(디렉터리이고 소유자가 현재 사용자)
function workspaceDirOk(st, uid) { return !!st && typeof st.isDirectory === 'function' && st.isDirectory() && st.uid === uid; }
// MARU_APP_SESSION 새 id (rand: () => uuid 문자열). 형식이 틀리면 null.
function newSessionId(rand) { let s; try { s = rand(); } catch { return null; } return isSessionId(s) ? s : null; }
// 홈은 ~ 로, max 코드포인트를 넘으면 가운데를 …로 줄인다
function shortenPath(p, home, max = 30) {
  if (typeof p !== 'string' || !p) return '';
  let prefix = ''; let rest = p;
  if (typeof home === 'string' && home.length > 1 && (p === home || p.startsWith(home + '/'))) { prefix = '~'; rest = p.slice(home.length); }
  const full = prefix + rest || '/';
  if ([...full].length <= max) return full;
  const segs = rest.split('/').filter(Boolean);
  for (let k = segs.length - 1; k >= 1; k--) {
    const s = prefix + '/…/' + segs.slice(-k).join('/');
    if ([...s].length <= max) return s;
  }
  const last = segs[segs.length - 1] || '';
  return '…' + [...last].slice(-(max - 1)).join('');
}

// ---- 로고(앱 아이콘·헤더·트레이가 같은 도안을 쓴다) ----
// 135 단위 타일 기준. 도안을 바꿀 때는 LOGO 와 logoShapesSvg 만 고친다(renderer/index.html 헤더 SVG 는 test.js 가 같은지 검사한다).
const LOGO = {
  tile: 135, tileColor: '#17110B', color: '#FF8A2B',
  ring: { r: 40, w: 6 }, dash: { r: 24, w: 2, on: 4, off: 5 }, dot: { r: 10 },
  tray: { r: 52, w: 16, dot: 22 }, // 트레이는 18px 에서 읽히도록 바깥 고리 + 점만, 굵게
};
function logoShapesSvg(color, variant) {
  const c = LOGO.tile / 2;
  if (variant === 'tray') {
    return `<circle cx="${c}" cy="${c}" r="${LOGO.tray.r}" fill="none" stroke="${color}" stroke-width="${LOGO.tray.w}"/><circle cx="${c}" cy="${c}" r="${LOGO.tray.dot}" fill="${color}"/>`;
  }
  return `<circle cx="${c}" cy="${c}" r="${LOGO.ring.r}" fill="none" stroke="${color}" stroke-width="${LOGO.ring.w}"/>` +
    `<circle cx="${c}" cy="${c}" r="${LOGO.dash.r}" fill="none" stroke="${color}" stroke-width="${LOGO.dash.w}" stroke-dasharray="${LOGO.dash.on} ${LOGO.dash.off}"/>` +
    `<circle cx="${c}" cy="${c}" r="${LOGO.dot.r}" fill="${color}"/>`;
}

// ---- 상태 링 움직임(속도 기반) ----
// 상태: { a1, a2, v, busy, fl, t }. 속도 v 가 목표 vTarget 을 쫓는다: 올릴 때는 빠르게(400ms 에 90%), 내릴 때는 마찰처럼 천천히(시정수 650ms).
const RING = { vBusy: 540, vWaiting: 120, vDrift: 6, upMs: 400 / Math.LN10, downMs: 650, fadeMs: 650, dtMax: 50 };
function ringInit() { return { a1: 0, a2: 0, v: RING.vDrift, busy: 0, fl: 1, t: 0 }; }
function ringTarget(mode) {
  if (mode === 'busy') return RING.vBusy;
  if (mode === 'waiting') return RING.vWaiting;
  if (mode === 'idle' || mode === 'none') return RING.vDrift;
  return 0; // exited·알 수 없음
}
const chase = (cur, target, dt) => cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? RING.upMs : RING.downMs)));
// reduced: 움직임 없이 정지 상태(색·투명도로만 표시)
function stepRing(st, dtMs, mode, reduced) {
  if (reduced) return { a1: 0, a2: 0, v: 0, busy: 0, fl: 0, t: 0 };
  const s = st || ringInit();
  const dt = Math.max(0, Math.min(RING.dtMax, Number.isFinite(dtMs) ? dtMs : 0));
  const v = chase(s.v, ringTarget(mode), dt);
  const busy = chase(s.busy, mode === 'busy' ? 1 : 0, dt);
  const fl = chase(s.fl, mode === 'idle' || mode === 'none' ? 1 : 0, dt);
  const mod = (x) => ((x % 360) + 360) % 360;
  return { a1: mod(s.a1 + v * dt / 1000), a2: mod(s.a2 - 0.6 * v * dt / 1000), v, busy, fl, t: (s.t + dt) % 1e7 };
}
// 상태 -> 그릴 값(회전각, 바깥 호 길이, 점 배율, 떠오름 이동·배율)
function ringView(st) {
  const TAU = Math.PI * 2;
  return {
    rot1: st.a1, rot2: st.a2,
    arc: 120 + 50 * st.busy * Math.sin(TAU * st.t / 1200),
    dot: 1 + 0.12 * st.busy * Math.sin(TAU * st.t / 600),
    ty: 3 * st.fl * Math.sin(TAU * st.t / 4000),
    scale: 1 + 0.015 * st.fl * Math.sin(TAU * st.t / 3300 + 1),
  };
}

// ---- 작업 공간 동작 결정(순수) ----
// 세션이 아직 살아 있는(시작 전·종료됨·사용 불가가 아닌) 작업 공간을 닫으면 확인한다
const confirmClose = (state) => ['busy', 'waiting', 'idle', 'none'].includes(state);
// 다시 시작은 진행 중이거나 확인을 기다리는 작업일 때만 확인한다
const confirmRestart = (state) => state === 'busy' || state === 'waiting';
// ⌘W 를 렌더러가 받았을 때: 열린 창·메뉴가 있으면 그것을 닫고, 아니면 활성 작업 공간 닫기를 요청
function closeRequestAction({ overlayOpen, hasActive }) {
  if (overlayOpen) return 'overlay';
  return hasActive ? 'workspace' : 'none';
}
// IPC 의 작업 공간 id 확인: main 표(Map)에 있는 문자열 id 만 통과(없는·닫힌·이상한 id 는 null)
function lookupWs(table, id) { return table && typeof id === 'string' && typeof table.get === 'function' ? table.get(id) || null : null; }
// 링 애니메이션 프레임 간격: 0 = 매 프레임, 33 = 약 30fps(조용할 때), -1 = 멈춤(정지 상태가 다 가라앉음)
function ringFrameInterval(st, mode) {
  const still = ['exited', 'pending', 'unavailable'].includes(mode);
  if (still && st.v < 0.05 && st.busy < 0.001 && st.fl < 0.001) return -1;
  if (st.v < 30 && st.busy < 0.02 && mode !== 'busy' && mode !== 'waiting') return 33;
  return 0;
}

// ---- 트레이(메뉴 막대) ----
const WS_STATES = ['busy', 'waiting', 'idle', 'none', 'pending', 'exited', 'unavailable'];
const stateLabel = (t, s) => t('agent.' + (WS_STATES.includes(s) ? s : 'none'));
// states: 작업 공간별 상태 배열 -> "작업 중 2 · 확인 필요 1"
function traySummary(states, t) {
  const list = Array.isArray(states) ? states : [];
  if (!list.length) return t('tray.none');
  const parts = [];
  for (const s of WS_STATES) { const n = list.filter((x) => (WS_STATES.includes(x) ? x : 'none') === s).length; if (n) parts.push(stateLabel(t, s) + ' ' + n); }
  return parts.join(' · ');
}
const trayTitle = (states) => (Array.isArray(states) && states.includes('waiting') ? '!' : '');
// 메뉴에 올릴 할 일 제목: 정리 후 40자(넘으면 …), 최대 3개
function trayTodoTitles(todos) {
  const out = [];
  for (const it of Array.isArray(todos) ? todos : []) {
    if (out.length >= 3) break;
    const c = it && typeof it.title === 'string' ? cleanQuestText(it.title) : '';
    if (!c) continue;
    const cps = [...c];
    out.push(cps.length > 40 ? cps.slice(0, 39).join('') + '…' : c);
  }
  return out;
}
// 트레이 메뉴 모델(라벨만). workspaces: [{id,title,state}], todos: 할 일 항목, t: (key,params)=>문구
function trayMenuModel({ workspaces, activeId, todos, t }) {
  const ws = Array.isArray(workspaces) ? workspaces : [];
  const items = [{ type: 'header', label: traySummary(ws.map((w) => w.state), t), enabled: false }];
  for (const w of ws) items.push({ type: 'workspace', id: w.id, label: w.title + ' · ' + stateLabel(t, w.state), checked: w.id === activeId });
  items.push({ type: 'separator' });
  const titles = trayTodoTitles(todos);
  if (titles.length) { for (const x of titles) items.push({ type: 'todo', label: x, enabled: false }); items.push({ type: 'separator' }); }
  items.push({ type: 'action', id: 'show', label: t('tray.open') }, { type: 'action', id: 'new', label: t('tray.new') },
    { type: 'action', id: 'settings', label: t('tray.settings') }, { type: 'action', id: 'quit', label: t('tray.quit') });
  return items;
}
// 트레이 아이콘 경로: 개발에서는 app/build, 패키징에서는 Resources/tray (extraResources)
function trayIconPath({ isPackaged, resourcesPath, appDir }) {
  const path = require('path');
  return isPackaged ? path.join(resourcesPath, 'tray', 'trayTemplate.png') : path.join(appDir, 'build', 'trayTemplate.png');
}

// ---- 설정 화면 판정 ----
// 훅: 이벤트 -> 이 저장소 scripts 아래의 스크립트
const HOOK_SCRIPTS = { SessionEnd: 'reflect.sh', SessionStart: 'session-context.sh', Stop: 'journal-tick.sh', PreCompact: 'journal-tick.sh' };
const HOOK_EVENTS = Object.keys(HOOK_SCRIPTS);

// command 가 root/scripts/<name> 을 가리키는가(앞뒤 경계 확인: 다른 경로의 일부는 제외)
function commandPointsTo(cmd, roots, name) {
  if (typeof cmd !== 'string') return false;
  for (const r of roots) {
    const needle = r + '/scripts/' + name;
    let from = 0; let i;
    while ((i = cmd.indexOf(needle, from)) !== -1) {
      const before = i === 0 ? ' ' : cmd[i - 1];
      const after = i + needle.length >= cmd.length ? ' ' : cmd[i + needle.length];
      if (/[\s"'=;&|(]/.test(before) && /[\s"';&|)]/.test(after)) return true;
      from = i + 1;
    }
  }
  return false;
}

// settings: Claude 전역 설정 JSON(객체), roots: 저장소 경로 후보(원본·realpath). -> {SessionEnd: bool, ...}
function hookStatus(settings, roots) {
  const rs = (Array.isArray(roots) ? roots : [roots]).filter((r) => typeof r === 'string' && r.startsWith('/')).map((r) => r.replace(/\/+$/, ''));
  const out = {};
  const hooks = settings && typeof settings === 'object' && settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  for (const ev of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    out[ev] = groups.some((g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => h && typeof h === 'object' && commandPointsTo(h.command, rs, HOOK_SCRIPTS[ev])));
  }
  return out;
}

// `claude auth status` 출력 -> 허용 필드만(이메일·조직 정보는 읽어도 버린다). 해석 불가면 null.
function parseAuthStatus(text, now = Date.now()) {
  if (typeof text !== 'string' || text.length > 65536) return null;
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || typeof o.loggedIn !== 'boolean') return null;
  if (!o.loggedIn) return { loggedIn: false, plan: null, expiresAt: null, daysLeft: null, state: 'out' };
  const planRaw = typeof o.subscriptionType === 'string' ? o.subscriptionType : (typeof o.planTier === 'string' ? o.planTier : '');
  const plan = /^[A-Za-z0-9_ -]{1,24}$/.test(planRaw) ? planRaw : '?';
  let expiresAt = null; let daysLeft = null; let state = 'ok';
  const ms = typeof o.loginExpiresAt === 'string' ? Date.parse(o.loginExpiresAt) : NaN;
  if (Number.isFinite(ms)) {
    expiresAt = new Date(ms).toISOString().slice(0, 10);
    daysLeft = Math.floor((ms - now) / 86400000);
    state = ms <= now ? 'expired' : daysLeft < 3 ? 'soon' : 'ok';
  }
  return { loggedIn: true, plan, expiresAt, daysLeft, state };
}

// 여러 줄 출력 정리: ANSI 제거, 줄마다 보이지 않는 문자·제어문자 제거, 줄·전체 길이 상한. 줄바꿈은 유지.
function cleanBlock(s, maxChars = 6000, maxLine = 200) {
  if (typeof s !== 'string') return '';
  const text = s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, '');
  const out = [];
  let total = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = [...raw.replace(BAD_CHARS_G, '')].slice(0, maxLine).join('').trimEnd();
    total += line.length + 1;
    if (total > maxChars) { out.push('…'); break; }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// install.sh 출력의 "== 제목" 줄 -> 제목 배열(바뀔 항목 목록)
function parseInstallSections(out) {
  if (typeof out !== 'string') return [];
  const r = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^== (.+)$/.exec(line.replace(BAD_CHARS_G, ''));
    if (m && m[1] !== '끝') r.push(m[1].trim().slice(0, 100));
  }
  return r;
}

// 업데이트 모듈 결과 정리(렌더러에는 정리된 필드만 간다)
const UPDATE_STATUSES = ['unconfigured', 'none', 'available', 'error'];
function cleanVersion(v) { return typeof v === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/.test(v) ? v : null; }
function sanitizeUpdate(r, currentVersion) {
  const o = r && typeof r === 'object' ? r : {};
  const status = UPDATE_STATUSES.includes(o.status) ? o.status : 'error';
  const out = { status, current: cleanVersion(o.current) || currentVersion };
  const latest = cleanVersion(o.latest);
  if (latest) out.latest = latest;
  if (typeof o.notes === 'string') out.notes = [...cleanBlock(o.notes, 2000)].slice(0, 600).join('');
  if (o.repoBehind) out.repoBehind = true;
  if (typeof o.message === 'string') out.message = [...cleanBlock(o.message, 400)].slice(0, 200).join('');
  return out;
}

// 시스템 설정 딥링크 허용 목록(키만 받는다)
const SETTINGS_PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  calendars: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars',
};
function settingsPaneUrl(key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SETTINGS_PANES, key) ? SETTINGS_PANES[key] : null; }

// 기억 폴더 슬러그(Claude Code 규칙): 실제 경로의 영숫자 아닌 문자를 모두 '-'
function projectSlug(realRoot) { return typeof realRoot === 'string' ? realRoot.replace(/[^A-Za-z0-9]/g, '-') : ''; }

// ---- 캘린더 ----
// 고정 AppleScript(osascript -e 줄 배열). 출력: 이벤트마다 <날짜 YYYY-MM-DD>US<시각 HH:MM 또는 빈 값>US<종일 1|0>US<제목>RS
// (US=ASCII 31, RS=ASCII 30). 제목의 RS/US 는 스크립트(clean)가 제거하고, 파서도 필드 수가 틀린 레코드를 버린다. 날짜·시각 조각을 스크립트가 직접 만들어 로케일 형식과 무관하다.
const CAL_SCRIPT = [
  'on p2(n)', 'return text -2 thru -1 of ("0" & (n as text))', 'end p2',
  'on clean(s)', 'set AppleScript\'s text item delimiters to {(ASCII character 30), (ASCII character 31)}', 'set parts to text items of s',
  'set AppleScript\'s text item delimiters to ""', 'return parts as text', 'end clean',
  'on fmt(d)', 'return ((year of d) as text) & "-" & my p2(month of d as integer) & "-" & my p2(day of d)', 'end fmt',
  'set RS to (ASCII character 30)', 'set US to (ASCII character 31)', 'set out to ""',
  'set d0 to current date', 'set time of d0 to 0', 'set d1 to d0 + (2 * days)',
  'tell application "Calendar"',
  'repeat with c in calendars', 'try',
  'set evs to (every event of c whose start date < d1 and end date > d0)',
  'repeat with e in evs', 'try',
  'set sd to start date of e', 'set ad to allday event of e', 'set ttl to my clean((summary of e) as text)',
  'if sd < d0 then set sd to d0',
  'set tm to ""', 'set fl to "1"',
  'if ad is false then', 'set tm to (my p2(hours of sd)) & ":" & (my p2(minutes of sd))', 'set fl to "0"', 'end if',
  'set out to out & (my fmt(sd)) & US & tm & US & fl & US & ttl & RS',
  'end try', 'end repeat', 'end try', 'end repeat',
  'end tell', 'return out',
];
const CAL_MAX_EVENTS = 8;
const CAL_TITLE_MAX = 60;
const CAL_MAX_BYTES = 256 * 1024;
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// osascript 출력 -> [{day:'today'|'tomorrow', allDay, time, title}] (오늘·내일만, 정렬, 최대 8개). 형식이 아니면 해당 레코드 버림.
function parseCalendarOutput(text, now = new Date()) {
  if (typeof text !== 'string' || text.length > CAL_MAX_BYTES) return [];
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const seen = new Set();
  const list = [];
  for (const rec of text.split('\x1e')) {
    const f = rec.replace(/^[\r\n]+/, '').split('\x1f');
    if (f.length !== 4) continue;
    const [date, time, flag, rawTitle] = f;
    const day = date === today ? 'today' : date === tomorrow ? 'tomorrow' : null;
    if (!day || (flag !== '0' && flag !== '1')) continue;
    const allDay = flag === '1';
    if (allDay ? time !== '' : !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    const title = [...cleanQuestText(rawTitle)].slice(0, CAL_TITLE_MAX).join('').trim();
    if (!title) continue;
    const key = day + '|' + time + '|' + title;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ day, allDay, time, title });
  }
  list.sort((a, b) => (a.day === b.day ? 0 : a.day === 'today' ? -1 : 1) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return list.slice(0, CAL_MAX_EVENTS);
}

const api = {
  MEMORIES_PER_LEVEL, QUEST_MAX_CHARS, SUGGESTIONS_MAX_BYTES, LOG_TAIL_BYTES, BRIEFING_MAX,
  hasBadChars, isSafeQuestStart, parseAgentState, parseAgentRecord, effectiveAgent, isSessionId, resolveRoot, keyToSeq, levelInfo, parseSuggestions, cleanQuestText, parseTodos, todosFromSuggestions, resolveTodos, todoKey, todoStars, matchTodo, fillNoticeKey, TODO_MAX, validSkillName, mergeSkillNames,
  parseBattery, parseDiskFree, parseLogEvents, mergeBriefing,
  readRegular, cleanName, defaultLang, validateProfile, parseProfile, loadProfile, saveProfile, NAME_MAX_CHARS,
  HOOK_EVENTS, HOOK_SCRIPTS, hookStatus, parseAuthStatus, cleanBlock, parseInstallSections, sanitizeUpdate, cleanVersion,
  SETTINGS_PANES, settingsPaneUrl, projectSlug, CAL_SCRIPT, parseCalendarOutput,
  confirmClose, confirmRestart, closeRequestAction, lookupWs, ringFrameInterval, readWorkspacesFile, backupCorruptFile,
  WS_MAX, WS_STATES, workspaceTitle, uniqueTitle, normalizeWorkspaces, parseWorkspaces, loadWorkspaces, saveWorkspaces, workspaceDirOk, newSessionId, shortenPath,
  LOGO, logoShapesSvg, RING, ringInit, stepRing, ringView,
  traySummary, trayTitle, trayTodoTitles, trayMenuModel, trayIconPath,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.MaruLib = api; // 렌더러(번들러 없음)에서는 전역으로 노출
