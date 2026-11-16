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
  '\\u200B-\\u200F', '\\u2028-\\u202E', '\\u2060-\\u206F', '\\u2800', '\\u3164', '\\uFE00-\\uFE0F', '\\uFEFF', '\\uFFA0',
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
const PROJ_SLUG_RE = /^[0-9a-z가-힣-]{1,24}$/;
// 태그 칸 -> { tag, slug }. 슬러그 형식이 틀리면 줄을 버리지 않고 slug 만 null(셸 textclean.split_project 와 같은 규칙). 태그 검증은 호출 쪽.
function splitProjectField(field) {
  const i = typeof field === 'string' ? field.indexOf('/') : -1;
  if (i < 0) return { tag: field, slug: null };
  const slug = field.slice(i + 1);
  return { tag: field.slice(0, i), slug: PROJ_SLUG_RE.test(slug) ? slug : null };
}
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
    const [tagField, imp, rawTitle, rawPrompt] = f;
    const { tag, slug } = splitProjectField(tagField); // `태그` 또는 `태그/슬러그`(슬러그가 틀리면 슬러그만 뗀다)
    if (!TODO_TAG_RE.test(tag) || !TODO_IMP_RE.test(imp)) continue;
    const title = cleanQuestText(rawTitle);
    let prompt = cleanQuestText(rawPrompt);
    if (prompt && !isSafeQuestStart(prompt)) prompt = ''; // 붙여넣어도 거부될 프롬프트: 직접 할 일로 취급
    if (!title || [...title].length > TODO_TITLE_MAX || [...prompt].length > TODO_PROMPT_MAX) continue;
    const item = { tag, importance: Number(imp), title, prompt };
    if (slug) item.project = tag + '/' + slug; // 프로젝트를 가리킬 때만 붙는다
    out.push(item);
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
// 중요도(1~10)가 7 이상이면 별 하나를 붙인다(그 아래는 표시 없음)
function todoStarred(importance) { return Number(importance) >= 7; }

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


// ---- 프로젝트 추적(카테고리(태그) > 프로젝트 > 작업 기록) ----
// 원천: 일지 날짜 파일(@태그/슬러그), data/projects.txt(셸이 쓰는 레지스트리), data/project-state.json(앱이 쓰는 사용자 상태),
// todos(프로젝트를 가리키는 남은 일), 기억 frontmatter 의 tags. 파일은 모두 신뢰할 수 없는 표시 데이터로 엄격 파싱한다.
const PROJ_TITLE_MAX = 40;
// 셸 textclean.py 와 같은 값: 파일 자체는 1000줄·256KB(완료·합침이 쌓일 여유), 열린 프로젝트 200개는 apply_projects 가 센다
const PROJ_MAX = 1000;
const PROJ_REG_MAX_BYTES = 256 * 1024;
const PROJ_STATE_MAX_BYTES = 512 * 1024; // 정상 최대치(1000개 × 약 400바이트)보다 넉넉하게. 읽기·쓰기 같은 값
const PROJ_STATE_MAX_ENTRIES = 1000;
const PROJ_KEY_RE = /^([0-9A-Za-z가-힣-]{1,12})\/([0-9a-z가-힣-]{1,24})$/;
const PROJ_LOG_MAX = 200;
const PROJ_MEM_MAX = 12;
const CHECK_DAYS = 3; // 남은 일이 없고 마지막 기록이 이만큼 지났으면 '확인 필요'
const JOURNAL_FILE_MAX_BYTES = 256 * 1024; // session-context.sh 의 MAX_FILE 과 같다
const JOURNAL_TOTAL_MAX_BYTES = 4 * 1024 * 1024;
const JOURNAL_FILES_MAX = 400;
const MEM_HEAD_BYTES = 8192;
const MEM_FILES_MAX = 500;
const MEM_NAME_MAX = 64;
const MEM_DESC_MAX = 120;

function projectKey(tag, slug) { return slug ? tag + '/' + slug : tag; }
function isProjectKey(k) { return typeof k === 'string' && PROJ_KEY_RE.test(k); }
const cpLen = (s) => [...s].length;

// 일지 문장 하나를 무해화(셸 textclean.neutralize_body 와 같은 규칙): 백틱 제거, < > -> ‹ ›, [ ] -> ( ), 앞쪽 # @ 와 공백 제거
function neutralizeBody(s) {
  let t = cleanQuestText(s).replace(/`/g, '').replace(/</g, '‹').replace(/>/g, '›').replace(/\[/g, '(').replace(/\]/g, ')').trim();
  t = t.replace(/^[#@\s]+/, '');
  return t.trim();
}
const SECRET_RE = /sk-[A-Za-z0-9_-]{16,}|[0-9A-Fa-f]{32,}|[A-Za-z0-9+/_=-]{40,}/;
function looksSecret(s) { return typeof s === 'string' && SECRET_RE.test(s); }

// 프로젝트 이름(사용자 입력·레지스트리·상태 파일): 셸 textclean.clean_title 과 같은 규칙이고 멱등이다.
// 무해화(neutralizeBody) 뒤 공백 접기를 안정될 때까지 되풀이하고, 한글·영숫자·공백과 `. , - _ / ( ) : · + # &` 만 남은 1~40자일 때만 돌려준다. 아니면 ''.
const TITLE_OK_RE = /^[0-9A-Za-z가-힣 .,\-_/():\u00b7+#&]+$/;
function cleanProjectTitle(s) {
  if (typeof s !== 'string' || s.length > 400) return '';
  let t = s;
  for (let i = 0; i < 4; i++) {
    const n = neutralizeBody(t).replace(/\s+/g, ' ').trim();
    if (n === t) break;
    t = n;
  }
  const n = cpLen(t);
  return n >= 1 && n <= PROJ_TITLE_MAX && TITLE_OK_RE.test(t) && !looksSecret(t) ? t : '';
}

// data/projects.txt 본문 -> [{key, tag, slug, title}] (셸 textclean.read_projects 와 같은 규칙; 파일 순서, 키 중복은 첫 줄)
function parseProjectRegistry(text, truncated = false) {
  if (typeof text !== 'string') return [];
  const rows = text.split('\n');
  if (truncated) rows.pop();
  const out = []; const seen = new Set();
  for (const raw of rows) {
    if (out.length >= PROJ_MAX) break;
    const line = raw.replace(/\r$/, '');
    if (!line || hasBadChars(line)) continue;
    const f = line.split('|');
    if (f.length !== 3) continue;
    const [tag, slug, title] = f;
    if (!TODO_TAG_RE.test(tag) || !PROJ_SLUG_RE.test(slug) || cleanProjectTitle(title) !== title || looksSecret(title)) continue;
    const key = tag + '/' + slug;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ key, tag, slug, title });
  }
  return out;
}

// 일지 날짜 파일 본문 -> 항목 [{day, time, kind, importance, tag, slug, text, seq}]. session-context.sh 와 같은 엄격 형식만(그 밖의 줄은 버림).
const JOURNAL_HDR = /^## ([0-9]{2}:[0-9]{2})(?: ([0-9A-Za-z가-힣._-]{1,24}))? \(([0-9A-Za-z-]{8})\)$/;
const JOURNAL_ITEM = /^- \[(한 일|결정|남은 일)\] \((10|[1-9])\) (?:@([0-9A-Za-z가-힣-]{1,12}(?:\/[0-9a-z가-힣-]{1,24})?) )?(.+)$/;
const JOURNAL_KINDS = { '한 일': 'done', 결정: 'decision', '남은 일': 'todo' };
const JOURNAL_ITEM_MAX_CHARS = 200;
function parseJournalText(text, day) {
  if (typeof text !== 'string' || typeof day !== 'string') return [];
  const out = []; let time = null; let seq = 0;
  for (const raw of text.split('\n')) {
    const l = raw.replace(/\r$/, '').replace(BAD_CHARS_G, '');
    const h = JOURNAL_HDR.exec(l);
    if (h) { time = h[1]; continue; }
    if (l.startsWith('## ')) { time = null; continue; } // 형식이 틀린 헤더: 그 아래 줄은 어느 블록에도 붙이지 않는다
    const m = JOURNAL_ITEM.exec(l);
    if (!m || time === null) continue;
    const body = [...neutralizeBody(m[4])].slice(0, JOURNAL_ITEM_MAX_CHARS).join('');
    if (!body) continue;
    let tag = ''; let slug = null;
    if (m[3]) { const p = m[3].split('/'); tag = p[0]; slug = p[1] || null; }
    out.push({ day, time, kind: JOURNAL_KINDS[m[1]], importance: Number(m[2]), tag, slug, text: body, seq: seq++ });
  }
  return out;
}

const JOURNAL_NAME_RE = /^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:\.[0-9]{1,3})?\.md$/;
function validDay(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
}
// <기억 폴더>/journal/*.md 와 journal/archive/*.md 읽기(Node 전용). journal·archive 가 심볼릭 링크이거나 폴더가 아니면 읽지 않고,
// 파일은 일반 파일만(readRegular: O_NOFOLLOW), 파일당·전체·개수 상한을 넘으면 건너뛴다(최신 날짜 우선).
function readJournalEntries(memDir) {
  const fs = require('fs'); const path = require('path');
  const out = [];
  const isRealDir = (d) => { try { const st = fs.lstatSync(d); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; } };
  const jd = path.join(memDir, 'journal');
  if (!isRealDir(memDir) || !isRealDir(jd)) return out; // 기억 폴더·journal 이 링크이면 읽지 않는다(readMemoryMetas 와 같다)
  const files = [];
  for (const dir of [jd, path.join(jd, 'archive')]) {
    if (!isRealDir(dir)) continue;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { names = []; }
    for (const n of names) { const m = JOURNAL_NAME_RE.exec(n); if (m && validDay(m[1])) files.push({ day: m[1], file: path.join(dir, n), name: n }); }
  }
  files.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)));
  let total = 0;
  for (const f of files.slice(0, JOURNAL_FILES_MAX)) {
    const r = readRegular(f.file, JOURNAL_FILE_MAX_BYTES, false);
    if (!r || r.truncated) continue;
    total += Buffer.byteLength(r.text, 'utf8');
    if (total > JOURNAL_TOTAL_MAX_BYTES) break;
    out.push(...parseJournalText(r.text, f.day));
  }
  return out;
}

// ---- 사용자 상태(data/project-state.json): { "<태그/슬러그>": { status, doneAt?, title?, mergedInto? } } ----
function validateProjectState(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const keys = Object.keys(o);
  if (keys.length > PROJ_STATE_MAX_ENTRIES) return null;
  const out = {};
  for (const k of keys) {
    const e = o[k];
    if (!isProjectKey(k) || !e || typeof e !== 'object' || Array.isArray(e)) continue;
    if (e.status !== 'open' && e.status !== 'done') continue;
    const v = { status: e.status };
    if (e.status === 'done') v.doneAt = typeof e.doneAt === 'string' && validDay(e.doneAt) ? e.doneAt : null;
    if (typeof e.title === 'string' && e.title && cleanProjectTitle(e.title) === e.title) v.title = e.title;
    if (isProjectKey(e.mergedInto) && e.mergedInto !== k) v.mergedInto = e.mergedInto;
    out[k] = v;
  }
  return out;
}
// readRegular 결과 -> 상태 맵 | null(파일 없음·잘림·나쁜 JSON·형식 오류)
function parseProjectState(res) {
  if (!res || res.truncated || typeof res.text !== 'string') return null;
  try { return validateProjectState(JSON.parse(res.text)); } catch { return null; }
}
// 시작·갱신 때 읽기: { status: 'missing'|'corrupt'|'ok', data }
function readProjectStateFile(file) {
  const fs = require('fs');
  let present = true;
  try { fs.lstatSync(file); } catch { present = false; }
  if (!present) return { status: 'missing', data: {} };
  const data = parseProjectState(readRegular(file, PROJ_STATE_MAX_BYTES, false));
  return data ? { status: 'ok', data } : { status: 'corrupt', data: {} };
}
// 직렬화한 크기가 읽기 상한 안인가(넘는 상태를 쓰면 다음 읽기에서 '손상'으로 치워지므로 쓰기 전에 거부한다)
function projectStateFits(state) { return Buffer.byteLength(JSON.stringify(state, null, 2) + '\n', 'utf8') <= PROJ_STATE_MAX_BYTES; }
function saveProjectState(file, state) {
  const v = validateProjectState(state);
  if (!v || Object.keys(v).length !== Object.keys(state).length) return false; // 이상한 항목이 섞여 있으면 쓰지 않는다
  for (const k of Object.keys(v)) { // 필드까지 같아야 한다(알 수 없는 필드·고쳐진 값이 있으면 쓰지 않는다)
    const a = v[k]; const o = state[k];
    if (Object.keys(a).length !== Object.keys(o).length || Object.keys(a).some((f) => a[f] !== o[f])) return false;
  }
  if (!projectStateFits(v)) return false;
  return writeJsonAtomic(file, v, 'project-state');
}
// 합친 프로젝트를 따라가 대표 키를 찾는다(최대 8단계, 순환이면 처음 키)
function projectRoot(state, key) {
  let k = key;
  for (let i = 0; i < 8; i++) {
    const e = Object.prototype.hasOwnProperty.call(state, k) ? state[k] : null;
    if (!e || !e.mergedInto) return k;
    k = e.mergedInto;
  }
  return key;
}

// 레지스트리 + 일지 + 상태 + todos -> 프로젝트 요약 배열(합쳐진 것은 대표 프로젝트로 모음).
// 요약: { key, kind: 'project'|'unclassified', tag, title, status, doneAt, lastDay, records, openTodos, needsCheck }
// kind 'unclassified' 는 프로젝트 없는 줄·할 일의 카테고리별 "분류 안 됨" 묶음(key 는 태그만). today: 'YYYY-MM-DD'
function daysBetween(today, day) {
  const p = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  return Math.round((p(today) - p(day)) / 86400000);
}
function buildProjects({ registry, entries, state, todos, today }) {
  const reg = Array.isArray(registry) ? registry : [];
  const st = state && typeof state === 'object' ? state : {};
  const regMap = new Map(reg.map((r) => [r.key, r]));
  const ownerOf = (key) => { const r = projectRoot(st, key); return regMap.has(r) ? r : (regMap.has(key) ? key : null); };
  const acc = new Map(); // key -> {lastDay, records, openTodos}
  const get = (k) => { let a = acc.get(k); if (!a) { a = { lastDay: null, records: 0, openTodos: 0 }; acc.set(k, a); } return a; };
  for (const e of Array.isArray(entries) ? entries : []) {
    const owner = e.slug ? ownerOf(e.tag + '/' + e.slug) : null;
    if (!e.tag && !owner) continue; // 태그도 프로젝트도 없는 줄은 어느 카테고리에도 속하지 않는다
    const a = get(owner || e.tag);
    a.records++;
    if (!a.lastDay || e.day > a.lastDay) a.lastDay = e.day;
  }
  for (const t of Array.isArray(todos) ? todos : []) {
    const owner = t.project ? ownerOf(t.project) : null;
    if (!t.tag && !owner) continue;
    get(owner || t.tag).openTodos++;
  }
  const out = [];
  for (const r of reg) {
    const e = Object.prototype.hasOwnProperty.call(st, r.key) ? st[r.key] : null;
    if (e && e.mergedInto && regMap.has(projectRoot(st, r.key)) && projectRoot(st, r.key) !== r.key) continue; // 다른 프로젝트에 합쳐짐
    const a = acc.get(r.key) || { lastDay: null, records: 0, openTodos: 0 };
    const status = e && e.status === 'done' ? 'done' : 'open';
    const needsCheck = status === 'open' && a.openTodos === 0 && !!a.lastDay && daysBetween(today, a.lastDay) >= CHECK_DAYS;
    out.push({ key: r.key, kind: 'project', tag: r.tag, title: (e && e.title) || r.title, status, doneAt: status === 'done' ? (e && e.doneAt) || null : null, lastDay: a.lastDay, records: a.records, openTodos: a.openTodos, needsCheck });
  }
  for (const [k, a] of acc) {
    if (regMap.has(k) || !TODO_TAG_RE.test(k) || (!a.records && !a.openTodos)) continue; // 태그만 있는 키 = 분류 안 됨
    out.push({ key: k, kind: 'unclassified', tag: k, title: '', status: 'open', doneAt: null, lastDay: a.lastDay, records: a.records, openTodos: a.openTodos, needsCheck: false });
  }
  return out;
}

// 요약 배열 -> 화면용 묶음 { open: [{tag, items}], done: [{tag, items}], doneCount }. 카테고리는 최근 기록순, 묶음 안은 최근 기록순(분류 안 됨은 맨 뒤).
function groupProjects(list) {
  const mk = (items) => {
    const by = new Map();
    for (const it of items) { if (!by.has(it.tag)) by.set(it.tag, []); by.get(it.tag).push(it); }
    const last = (arr) => arr.reduce((m, x) => (x.lastDay && x.lastDay > m ? x.lastDay : m), '');
    const cmpItem = (a, b) => (a.kind !== b.kind ? (a.kind === 'project' ? -1 : 1)
      : (a.lastDay || '') < (b.lastDay || '') ? 1 : (a.lastDay || '') > (b.lastDay || '') ? -1 : (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    return [...by.entries()]
      .map(([tag, arr]) => ({ tag, items: arr.sort(cmpItem), last: last(arr) }))
      .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)))
      .map(({ tag, items: its }) => ({ tag, items: its }));
  };
  const l = Array.isArray(list) ? list : [];
  const done = l.filter((x) => x.status === 'done');
  return { open: mk(l.filter((x) => x.status !== 'done')), done: mk(done), doneCount: done.length };
}

// 합치기 가능 여부(렌더러가 보낸 키는 main 의 요약 목록과 대조한 뒤 이 함수로 한 번 더 본다)
function canMerge(list, key, into) {
  const a = (list || []).find((x) => x.key === key); const b = (list || []).find((x) => x.key === into);
  return !!a && !!b && a.kind === 'project' && b.kind === 'project' && key !== into && a.status === 'open' && b.status === 'open' && a.tag === b.tag;
}
// 상태 갱신(순수): 새 객체를 돌려준다. 항목이 400개를 넘게 되면 null.
function stateWithStatus(state, key, status, today) {
  const cur = state[key] || {};
  const e = { ...cur, status };
  if (status === 'done') e.doneAt = today; else delete e.doneAt;
  const next = { ...state, [key]: e };
  return Object.keys(next).length > PROJ_STATE_MAX_ENTRIES ? null : next;
}
function stateWithTitle(state, key, title) {
  const t = cleanProjectTitle(title);
  if (!t) return null;
  const next = { ...state, [key]: { status: 'open', ...(state[key] || {}), title: t } };
  return Object.keys(next).length > PROJ_STATE_MAX_ENTRIES ? null : next;
}
function stateWithMerge(state, key, into) {
  const next = {};
  for (const [k, e] of Object.entries(state)) next[k] = e && e.mergedInto === key ? { ...e, mergedInto: into } : e; // key 에 합쳐져 있던 것들도 into 로 옮긴다
  next[key] = { status: 'open', ...(state[key] || {}), mergedInto: into };
  delete next[key].doneAt;
  return Object.keys(next).length > PROJ_STATE_MAX_ENTRIES ? null : next;
}

// 시간 제한 캐시(순수): get() 은 ttlMs 안이면 저장한 값을, 아니면 load() 를 다시 불러 돌려준다. now: () => ms
function ttlCache(ttlMs, load, now = Date.now) {
  let value; let at = null;
  return {
    get() { const t = now(); if (at === null || !(t - at <= ttlMs)) { value = load(); at = t; } return value; },
    reset() { at = null; value = undefined; },
  };
}

// 기억 frontmatter(앞부분만) -> { name, description, tags } | null. 이름은 필수.
function parseMemoryMeta(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  let name = ''; let desc = ''; let tags = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^---\s*$/.test(l)) break;
    let m;
    if ((m = /^name:\s*(.+?)\s*$/.exec(l))) name = m[1];
    else if ((m = /^description:\s*(.+?)\s*$/.exec(l))) desc = m[1];
    else if ((m = /^\s+tags:\s*\[(.*)\]\s*$/.exec(l))) {
      tags = m[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter((x) => TODO_TAG_RE.test(x)).slice(0, 4);
    }
  }
  const clean = (s, max) => [...neutralizeBody(s)].slice(0, max).join('');
  name = clean(name, MEM_NAME_MAX);
  if (!name) return null;
  return { name, description: clean(desc, MEM_DESC_MAX), tags };
}
// 같은 태그(대표·보조 모두)를 가진 기억 최대 12개(이름순). 읽기 전용 표시용.
function relatedMemories(metas, tag, max = PROJ_MEM_MAX) {
  if (typeof tag !== 'string' || !tag) return [];
  const t = tag.toLowerCase();
  return (Array.isArray(metas) ? metas : []).filter((m) => m && m.tags.some((x) => x.toLowerCase() === t))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, max)
    .map((m) => ({ name: m.name, description: m.description }));
}
// <기억 폴더>/*.md(MEMORY.md 제외) 의 frontmatter 읽기(Node 전용). 일반 파일만, 앞 8KB 만, 최대 500개.
function readMemoryMetas(memDir) {
  const fs = require('fs'); const path = require('path');
  let names = [];
  try { const st = fs.lstatSync(memDir); if (!st.isDirectory() || st.isSymbolicLink()) return []; names = fs.readdirSync(memDir); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (out.length >= MEM_FILES_MAX) break;
    if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(n) || n === 'MEMORY.md') continue;
    const r = readRegular(path.join(memDir, n), MEM_HEAD_BYTES, false);
    const m = r ? parseMemoryMeta(r.text) : null;
    if (m) out.push(m);
  }
  return out;
}

// 상세(요청 시): 요약 + 남은 일 + 작업 기록(최신 날짜 먼저, 최대 200) + 관련 기억 + 합치기 후보. 모두 원시 값(문자열·숫자)만.
function buildProjectDetail({ summary, registry, entries, state, todos, memories, list, today }) {
  const st = state || {};
  const regKeys = new Set((registry || []).map((r) => r.key));
  const ownerOf = (key) => { const r = projectRoot(st, key); return regKeys.has(r) ? r : (regKeys.has(key) ? key : null); };
  const mine = (e) => (summary.kind === 'project'
    ? !!e.slug && ownerOf(e.tag + '/' + e.slug) === summary.key
    : e.tag === summary.tag && !(e.slug && ownerOf(e.tag + '/' + e.slug)));
  const log = (entries || []).filter(mine)
    .sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : a.time !== b.time ? (a.time < b.time ? 1 : -1) : a.seq - b.seq))
    .slice(0, PROJ_LOG_MAX).map((e) => ({ day: e.day, kind: e.kind, text: e.text }));
  const mineTodo = (t) => (summary.kind === 'project'
    ? !!t.project && ownerOf(t.project) === summary.key
    : t.tag === summary.tag && !(t.project && ownerOf(t.project)));
  const open = (todos || []).filter(mineTodo).map((t) => ({ title: t.title, importance: t.importance })).sort((a, b) => b.importance - a.importance);
  const mergeTargets = summary.kind === 'project' && summary.status === 'open'
    ? (list || []).filter((x) => canMerge(list, summary.key, x.key)).map((x) => ({ key: x.key, title: x.title })) : [];
  return {
    key: summary.key, kind: summary.kind, tag: summary.tag, title: summary.title, status: summary.status, doneAt: summary.doneAt,
    lastDay: summary.lastDay, records: summary.records, needsCheck: summary.needsCheck,
    todos: open, log, memories: relatedMemories(memories, summary.tag), mergeTargets,
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
  hasBadChars, isSafeQuestStart, parseAgentState, parseAgentRecord, effectiveAgent, isSessionId, resolveRoot, keyToSeq, levelInfo, parseSuggestions, cleanQuestText, parseTodos, todosFromSuggestions, resolveTodos, todoKey, todoStarred, matchTodo, fillNoticeKey, TODO_MAX, validSkillName, mergeSkillNames,
  parseBattery, parseDiskFree, parseLogEvents, mergeBriefing,
  readRegular, cleanName, defaultLang, validateProfile, parseProfile, loadProfile, saveProfile, NAME_MAX_CHARS,
  HOOK_EVENTS, HOOK_SCRIPTS, hookStatus, parseAuthStatus, cleanBlock, parseInstallSections, sanitizeUpdate, cleanVersion,
  SETTINGS_PANES, settingsPaneUrl, projectSlug, CAL_SCRIPT, parseCalendarOutput,
  confirmClose, confirmRestart, closeRequestAction, lookupWs, ringFrameInterval, readWorkspacesFile, backupCorruptFile,
  WS_MAX, WS_STATES, workspaceTitle, uniqueTitle, normalizeWorkspaces, parseWorkspaces, loadWorkspaces, saveWorkspaces, workspaceDirOk, newSessionId, shortenPath,
  LOGO, logoShapesSvg, RING, ringInit, stepRing, ringView,
  traySummary, trayTitle, trayTodoTitles, trayMenuModel, trayIconPath,
  splitProjectField, projectKey, isProjectKey, neutralizeBody, looksSecret, cleanProjectTitle, parseProjectRegistry, parseJournalText, readJournalEntries,
  validateProjectState, projectStateFits, parseProjectState, readProjectStateFile, saveProjectState, projectRoot, daysBetween, buildProjects, groupProjects, canMerge,
  stateWithStatus, stateWithTitle, stateWithMerge, parseMemoryMeta, relatedMemories, readMemoryMetas, buildProjectDetail,
  PROJ_TITLE_MAX, PROJ_LOG_MAX, PROJ_MEM_MAX, PROJ_REG_MAX_BYTES, PROJ_STATE_MAX_BYTES, PROJ_STATE_MAX_ENTRIES, CHECK_DAYS, validDay, ttlCache,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.MaruLib = api; // 렌더러(번들러 없음)에서는 전역으로 노출
