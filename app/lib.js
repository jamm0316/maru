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
const TODO_MAX = 12; // 셸 apply_todos 의 병합 결과 상한(MAX_TOTAL)과 같다. 패널은 스크롤된다
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

// ---- 할 일 개별 완료/안 함 (앱 소유 파일 data/todo-done.txt) ----
// 한 줄 `<epoch초>|<done|skip>|<태그 또는 태그/슬러그>|<제목>`(정확히 4칸). 최대 200줄, 14일 지난 줄은 쓸 때 지운다. 파일은 32768바이트(UTF-8)를 넘지 않게 오래된 줄부터 덜어 낸다. 화면은 최근 7일 줄과 최상위 태그·제목 키가 모두 같은 할 일을 걸러 낸다.
const TODO_DONE_MAX = 200;
const TODO_DONE_KEEP_SEC = 14 * 86400;
const TODO_DONE_HIDE_SEC = 7 * 86400;
// 셸 scripts/textclean.py 의 TODO_DONE_MAX_BYTES 와 반드시 같아야 한다(넘으면 셸이 파일 전체를 무시한다). 시험이 두 값을 대조한다.
const TODO_DONE_MAX_BYTES = 32768;
const TODO_DONE_KINDS = ['done', 'skip'];
// 셸의 " ".join(title.split()).casefold() 의 근사: 공백 접기 + 소문자화(ß ς ſ 만 따로 처리). ASCII·한글은 같지만 모든 코드포인트에서 일치하지는 않는다
function titleKey(title) {
  if (typeof title !== 'string') return '';
  return title.split(/\s+/).filter(Boolean).join(' ').toLowerCase().replace(/\u00df|\u1e9e/g, 'ss').replace(/\u03c2/g, '\u03c3').replace(/\u017f/g, 's');
}
// 제목이 파일에 기록될 수 있는가: 정리 함수를 거친 값 그대로여야 하고(제어문자·bidi 없음), | 가 없고, 1~60자
function todoTitleRecordable(title) {
  return typeof title === 'string' && title !== '' && cleanQuestText(title) === title && !title.includes('|') && [...title].length <= TODO_TITLE_MAX;
}
function validTodoDoneTag(f) { return typeof f === 'string' && (TODO_TAG_RE.test(f) || PROJ_KEY_RE.test(f)); }
function validTodoDoneEntry(e) {
  return isPlainObject(e) && Number.isInteger(e.at) && e.at >= 1e8 && e.at <= 99999999999 && TODO_DONE_KINDS.includes(e.kind) && validTodoDoneTag(e.tag) && todoTitleRecordable(e.title);
}
// main 이 가진 할 일 항목 -> 기록 한 줄(없으면 null). 제목·태그는 항목의 값만 쓴다(렌더러가 보낸 문자열은 쓰지 않는다)
function makeTodoDone(item, kind, nowSec) {
  if (!item) return null;
  const e = { at: nowSec, kind, tag: item.project || item.tag, title: item.title };
  return validTodoDoneEntry(e) ? e : null;
}
const todoMarkable = (item) => !!item && todoTitleRecordable(item.title);
function formatTodoDone(entries) { return entries.map((e) => [e.at, e.kind, e.tag, e.title].join('|') + '\n').join(''); }
// 줄 수 200 상한 + 파일 바이트 상한: 앞(오래된) 줄부터 덜어 낸다
function fitTodoDone(entries) {
  let cur = entries.length > TODO_DONE_MAX ? entries.slice(entries.length - TODO_DONE_MAX) : entries;
  let total = 0; const sizes = cur.map((e) => { const b = Buffer.byteLength(formatTodoDone([e]), 'utf8'); total += b; return b; });
  let drop = 0;
  while (total > TODO_DONE_MAX_BYTES && drop < cur.length) total -= sizes[drop++];
  return drop ? cur.slice(drop) : cur;
}
// 본문 -> 유효한 줄 배열(파일 순서). 형식 틀린 줄은 버리고, 200줄을 넘으면 마지막 200줄만. truncated 면 마지막(불완전) 줄은 버린다
function parseTodoDone(text, truncated = false) {
  if (typeof text !== 'string') return [];
  const rows = text.split(/\r?\n/);
  if (truncated) rows.pop();
  const out = [];
  for (const raw of rows) {
    if (!raw || raw.length > 400) continue;
    const f = raw.split('|');
    if (f.length !== 4 || !/^[0-9]{9,11}$/.test(f[0])) continue;
    const e = { at: Number(f[0]), kind: f[1], tag: f[2], title: f[3] };
    if (validTodoDoneEntry(e)) out.push(e);
  }
  return out.length > TODO_DONE_MAX ? out.slice(out.length - TODO_DONE_MAX) : out;
}
// 14일(KEEP) 넘은 줄과 하루 넘게 미래인 줄을 지우고 최근 200줄만
function pruneTodoDone(entries, nowSec) {
  const kept = (Array.isArray(entries) ? entries : []).filter((e) => validTodoDoneEntry(e) && nowSec - e.at <= TODO_DONE_KEEP_SEC && e.at - nowSec <= 86400);
  return fitTodoDone(kept);
}
function addTodoDone(entries, added, nowSec) { return pruneTodoDone([...(Array.isArray(entries) ? entries : []), ...(Array.isArray(added) ? added : [])], nowSec); }
// 방금 쓴 그 줄만 제거(같은 줄이 여럿이면 가장 뒤의 것 하나씩). 하나도 못 찾으면 같은 배열을 돌려준다
function removeTodoDone(entries, targets) {
  let cur = Array.isArray(entries) ? entries : [];
  for (const t of Array.isArray(targets) ? targets : []) {
    for (let i = cur.length - 1; i >= 0; i--) {
      const e = cur[i];
      if (e.at === t.at && e.kind === t.kind && e.tag === t.tag && e.title === t.title) { cur = [...cur.slice(0, i), ...cur.slice(i + 1)]; break; }
    }
  }
  return cur;
}
// 표시 키: 최상위 태그('/' 앞) + 제목 키. 기록의 태그는 `태그/슬러그` 일 수 있고 할 일 쪽은 항상 item.tag 가 최상위 태그다(셸과 같은 규칙)
const todoMarkKey = (tag, title) => String(tag).split('/')[0] + '\n' + titleKey(title);
// 최근 7일 안의 기록과 최상위 태그·제목 키가 모두 같은 할 일은 뺀다(제목만 같고 태그가 다르면 남긴다)
function filterTodos(todos, entries, nowSec) {
  const hide = new Set();
  for (const e of Array.isArray(entries) ? entries : []) if (nowSec - e.at <= TODO_DONE_HIDE_SEC && e.at - nowSec <= 86400) hide.add(todoMarkKey(e.tag, e.title));
  return hide.size ? (Array.isArray(todos) ? todos : []).filter((t) => !hide.has(todoMarkKey(t.tag, t.title))) : (Array.isArray(todos) ? todos : []);
}
// 시작·갱신 때 읽기(Node 전용): { status: 'missing'|'corrupt'|'error'|'ok', data }.
// corrupt = 일반 파일이 아니거나(링크·FIFO·폴더) 상한을 넘음 -> 호출 쪽이 .bak 으로 치운다. error = 그 밖의 읽기 오류(EMFILE·EACCES 등) -> 호출 쪽은 메모리 값을 그대로 두고 파일은 건드리지 않는다.
function readTodoDoneFile(file) {
  const fs = require('fs');
  let lst;
  try { lst = fs.lstatSync(file); } catch (err) { return err && err.code === 'ENOENT' ? { status: 'missing', data: [] } : { status: 'error', data: [] }; }
  if (!lst.isFile() || lst.size > TODO_DONE_MAX_BYTES) return { status: 'corrupt', data: [] };
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > TODO_DONE_MAX_BYTES) return { status: 'corrupt', data: [] };
    const buf = Buffer.alloc(st.size);
    const n = fs.readSync(fd, buf, 0, st.size, 0);
    return { status: 'ok', data: parseTodoDone(buf.toString('utf8', 0, n)) };
  } catch (err) {
    return { status: err && (err.code === 'ELOOP') ? 'corrupt' : 'error', data: [] }; // O_NOFOLLOW 로 링크가 막히면 ELOOP
  } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* 무시 */ } }
}
function saveTodoDone(file, entries) {
  if (!Array.isArray(entries) || entries.length > TODO_DONE_MAX || !entries.every(validTodoDoneEntry)) return false;
  return writeTextAtomic(file, formatTodoDone(fitTodoDone(entries)), 'todo-done'); // 바이트 상한을 넘으면 오래된 줄부터 덜어 내고 쓴다
}

// ---- 할 일의 출처 세션 (셸 소유 data/todo-src.txt; 이 파일은 신뢰하지 않는다) ----
// 한 줄 `<epoch초>|<세션 uuid>|<cwd>|<태그[/슬러그]>|<제목 키>`(정확히 5칸). 제목 키는 titleKey(제목)과 같은 규칙, 태그는 최상위 태그로 비교한다(완료 표시와 같다).
// 상한은 셸 scripts/textclean.py 의 TODO_SRC_* 와 같아야 한다(시험이 대조한다).
const TODO_SRC_MAX_BYTES = 65536;
const TODO_SRC_MAX_LINES = 100;
const TODO_SRC_TTL_SEC = 30 * 86400;
const TODO_SRC_CWD_MAX = 400;
const TODO_SRC_KEY_MAX = 240;
const TODO_RESUME_STALE_SEC = 2 * 86400; // 마지막 활동이 이보다 오래된 세션은 기본으로 이어 열지 않는다(대화 전체를 다시 불러와 사용량이 든다)
const RESUME_RECENT_MS = 10 * 60 * 1000;
const RETRY_TTL_MS = 5 * 60 * 1000;
const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validSessionUuid = (s) => typeof s === 'string' && SESSION_UUID_RE.test(s);
// cwd: 절대 경로, 1~400자, 제어·서식 문자·`|` 없음, 정규화된 형태(빈 칸·. · .. 조각·끝 / 없음)
function validSrcCwd(c) {
  if (typeof c !== 'string' || !c.startsWith('/') || c.length < 2 || [...c].length > TODO_SRC_CWD_MAX || hasBadChars(c) || c.includes('|')) return false;
  return c.slice(1).split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}
// 본문 -> [{ at, sid, cwd, tag, project?, key }] (파일 순서). 틀린 줄(칸 수·epoch·uuid·cwd·태그·키·30일 초과·하루 넘는 미래)은 버리고, 같은 (최상위 태그, 키)는 가장 새 것 하나만(같으면 뒤의 것)
function parseTodoSrc(text, nowSec, truncated = false) {
  if (typeof text !== 'string' || !Number.isFinite(nowSec)) return [];
  const rows = text.split(/\r?\n/);
  if (truncated) rows.pop();
  const best = new Map();
  for (const raw of rows) {
    if (!raw || raw.length > 2000 || raw.includes('\uFFFD')) continue; // 깨진 바이트가 든 줄만 버린다
    const f = raw.split('|');
    if (f.length !== 5) continue;
    const [ep, sid, cwd, tagField, key] = f;
    if (!/^[0-9]{9,12}$/.test(ep) || !validSessionUuid(sid) || !validSrcCwd(cwd)) continue;
    const { tag, slug } = splitProjectField(tagField);
    if (!TODO_TAG_RE.test(tag) || (tagField.includes('/') && !slug)) continue;
    if (!key || [...key].length > TODO_SRC_KEY_MAX || hasBadChars(key)) continue;
    const at = Number(ep);
    if (at > nowSec + 86400 || at < nowSec - TODO_SRC_TTL_SEC) continue;
    const k = tag + '\n' + key;
    const cur = best.get(k);
    if (!cur || at >= cur.at) best.set(k, { at, sid, cwd, tag, project: slug ? tag + '/' + slug : undefined, key });
  }
  return [...best.values()];
}
// 시작·갱신 때 읽기(Node 전용): 일반 파일(링크 아님)·소유자가 현재 사용자·다른 사람이 쓸 수 없음·TODO_SRC_MAX_BYTES 이하일 때만. 아니면 []
function readTodoSrcFile(file, nowSec, uid) {
  const fs = require('fs');
  let fd = null;
  try {
    const lst = fs.lstatSync(file);
    if (!lst.isFile() || lst.size > TODO_SRC_MAX_BYTES || lst.uid !== uid || (lst.mode & 0o022) !== 0) return [];
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > TODO_SRC_MAX_BYTES || st.uid !== uid) return [];
    const buf = Buffer.alloc(st.size);
    const n = fs.readSync(fd, buf, 0, st.size, 0);
    return parseTodoSrc(buf.toString('utf8', 0, n), nowSec);
  } catch { return []; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* 무시 */ } }
}
// 할 일 항목 -> 출처 항목(없으면 null). 항목은 최상위 태그(item.tag)와 제목 키로 맺는다
function findTodoSrc(entries, item) {
  if (!item || !Array.isArray(entries)) return null;
  const tag = String(item.tag); const key = titleKey(item.title);
  return entries.find((e) => e.tag === tag && e.key === key) || null;
}
// 화면 힌트: 폴더 이름(정리·짧게)과 기록 시각만. 경로 전체는 렌더러로 보내지 않는다
function todoSrcHint(src) {
  if (!src) return null;
  const base = src.cwd.split('/').filter(Boolean).pop() || '/';
  const folder = [...cleanQuestText(base)].slice(0, 24).join('').trim();
  return folder ? { folder, at: src.at } : null;
}
// Claude 가 기록(transcript)을 두는 위치: <projects>/<slug(cwd)>/<세션 uuid>.jsonl
function transcriptFileFor(projectsDir, cwd, sid) {
  return String(projectsDir).replace(/\/+$/, '') + '/' + projectSlug(cwd) + '/' + sid + '.jsonl';
}
// 상태 파일의 transcript_path -> Claude 세션 uuid(없으면 null). <projects>/<slug>/<uuid>.jsonl 형태만 받는다(하위 에이전트 기록·바깥 경로·.. 조각·대문자 uuid 는 거부)
function transcriptSessionId(p, projectsDirs) {
  if (!validTranscriptPath(p) || p.includes('//') || p.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  const dirs = (Array.isArray(projectsDirs) ? projectsDirs : [projectsDirs]).filter((d) => typeof d === 'string' && d.startsWith('/') && d.length > 1).map((d) => d.replace(/\/+$/, ''));
  const parts = p.split('/'); // ['', ..., projects 폴더들..., slug, '<uuid>.jsonl']
  if (parts.length < 4) return null;
  const file = parts[parts.length - 1]; const slug = parts[parts.length - 2];
  if (!slug || slug === '.' || slug === '..') return null;
  const dir = parts.slice(0, -2).join('/');
  if (!dirs.includes(dir)) return null;
  const m = /^([0-9a-f-]{36})\.jsonl$/.exec(file);
  return m && validSessionUuid(m[1]) ? m[1] : null;
}
// 클릭 결정(순수): src = 출처 항목 또는 null / ctx = { projectsDir, nowMs, uid, force, workspaces: [{ id, sid, atMs, live }], fs: { lstat, stat, realpath } }
//  -> { action: 'switch', wsId } | { action: 'resume', sid, cwd, lastMs } | { action: 'new', reason, canForce? }
// reason: no-source | bad-source | no-folder | no-transcript | too-old. 파일 시스템은 ctx.fs 로만 만진다(읽기 전용)
function decideTodoOpen(src, ctx) {
  if (!src || typeof src !== 'object') return { action: 'new', reason: 'no-source' };
  if (!validSessionUuid(src.sid) || !validSrcCwd(src.cwd) || !ctx || typeof ctx.projectsDir !== 'string' || !ctx.fs) return { action: 'new', reason: 'bad-source' };
  // 그 세션이 이미 열려 있으면 그리로(여럿이면 가장 최근에 활동한 것)
  let hit = null;
  for (const w of Array.isArray(ctx.workspaces) ? ctx.workspaces : []) {
    if (!w || w.sid !== src.sid || w.live !== true || typeof w.id !== 'string') continue;
    if (!hit || (Number.isFinite(w.atMs) ? w.atMs : 0) >= (Number.isFinite(hit.atMs) ? hit.atMs : 0)) hit = w;
  }
  if (hit) return { action: 'switch', wsId: hit.id };
  let real;
  try {
    const l = ctx.fs.lstat(src.cwd); // 마지막 조각이 링크이면 거부
    if (!l || !l.isDirectory() || (typeof l.isSymbolicLink === 'function' && l.isSymbolicLink())) return { action: 'new', reason: 'no-folder' };
    real = ctx.fs.realpath(src.cwd); // Claude 는 실제 경로로 기록 폴더 이름을 만든다
    if (!workspaceDirOk(ctx.fs.stat(real), ctx.uid)) return { action: 'new', reason: 'no-folder' };
  } catch { return { action: 'new', reason: 'no-folder' }; }
  let lastMs;
  try {
    const pb = ctx.projectsDir.replace(/\/+$/, '');
    for (const dd of [pb, pb + '/' + projectSlug(real)]) { const d = ctx.fs.lstat(dd); if (!d || !d.isDirectory() || d.isSymbolicLink()) return { action: 'new', reason: 'no-transcript' }; } // 링크 폴더는 거부
    const t = ctx.fs.lstat(transcriptFileFor(ctx.projectsDir, real, src.sid));
    if (!t || !t.isFile() || (typeof t.isSymbolicLink === 'function' && t.isSymbolicLink()) || !Number.isFinite(t.mtimeMs)) return { action: 'new', reason: 'no-transcript' };
    if (t.uid !== ctx.uid) return { action: 'new', reason: 'no-transcript' }; // 다른 사용자 소유의 기록은 이어 열지 않는다
    lastMs = t.mtimeMs;
  } catch { return { action: 'new', reason: 'no-transcript' }; }
  if (ctx.force !== true && ctx.nowMs - lastMs > TODO_RESUME_STALE_SEC * 1000) return { action: 'new', reason: 'too-old', canForce: true };
  return { action: 'resume', sid: src.sid, cwd: src.cwd, lastMs, recent: ctx.nowMs - lastMs < RESUME_RECENT_MS }; // recent: 방금까지 쓰던 세션 — 다른 곳에서 열려 있을 수 있다(main 이 확인을 묻는다)
}
// 클릭 결과 사유 -> 문구 키(문구는 i18n.js 의 'todo.open.<사유>')
const OPEN_REASONS = ['no-source', 'bad-source', 'no-folder', 'no-transcript', 'too-old', 'agent-busy', 'timeout', 'busy-ui', 'max', 'stale', 'no-prompt', 'invalid', 'inactive', 'no-term', 'not-ready', 'unsafe-start', 'no-maru', 'shell', 'typed'];
function openNoticeKey(reason) { return 'todo.open.' + (OPEN_REASONS.includes(reason) ? reason : 'invalid'); }

// ---- 입력줄 채우기 안전장치(순수 함수; main 이 pty 상태를 모아 넘긴다) ----
// 포그라운드 프로세스 이름이 셸·login 이면 true. 명시한 이름만 거부한다(비었거나 모르는 이름은 false — 기존 채우기를 막지 않는다). `-zsh`·경로 형태도 같은 이름으로 본다
const SHELL_NAMES = new Set(['zsh', 'bash', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'login']);
function isShellProcessName(name) {
  if (typeof name !== 'string' || !name || name.length > 1024) return false;
  const base = name.trim().replace(/\/+$/, '').split('/').pop().replace(/^-+/, '').toLowerCase();
  return SHELL_NAMES.has(base);
}
// pty 로 가는 데이터가 사용자의 입력인가: 터미널이 스스로 보내는 응답(CSI·OSC·DCS: 포커스·커서 위치·장치 속성)을 빼고 남는 게 있으면 입력
function isUserInput(data) {
  if (typeof data !== 'string' || !data) return false;
  const rest = data.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1bP[^\x1b]*\x1b\\/g, '').replace(/\x1b\[[0-9;?<>=! ]*[@-~]/g, '');
  return rest.length > 0;
}
// 붙여넣기 모드 표시(?2004h/l)를 청크마다 따라간다. st = { tail, bracketed, awaitClaude, sawOff, claudeUp } -> 새 st(입력은 바꾸지 않는다)
// awaitClaude(우리가 연 작업 공간): 셸이 줄을 받아들이며 끄고(l) 그 뒤 켜는(h) 것을 claudeUp 으로 센다. 셸이 살아 있어도 같은 순서가 나오므로 claudeUp 만으로 "Claude 가 떴다"를 확정하지 않는다 — fillStep 이 포그라운드 프로세스도 본다
function bpStep(st, chunk) {
  const s = String((st && st.tail) || '') + String(chunk);
  const re = /\x1b\[\?2004([hl])/g; let m; let last = null; let sawOff = !!(st && st.sawOff); let claudeUp = !!(st && st.claudeUp); let sawOn = false; // sawOn: 이번 걸음에 ?2004h 가 있었다(셸이 2004l 을 안 내는 설정에서도 claudeUpAfter 가 쓴다)
  while ((m = re.exec(s)) !== null) {
    last = m[1]; if (m[1] === 'h') sawOn = true;
    if (st && st.awaitClaude) { if (m[1] === 'l') sawOff = true; else if (sawOff) claudeUp = true; }
  }
  return { ...st, tail: s.slice(-7), bracketed: last === 'h' ? true : last === 'l' ? false : !!(st && st.bracketed), sawOff, claudeUp, sawOn };
}
// 셸과 무관한 두 번째 claudeUp 판정(순수). zsh 의 `unset zle_bracketed_paste` 처럼 셸이 ?2004l 을 내지 않으면 bpStep 의 순서(l 다음 h)가 안 이뤄진다.
// 그래서 awaitClaude 인 작업 공간에서 붙여넣기 모드 켬(h)을 봤고 포그라운드가 셸이 아니면(이름을 알 때만) claude 가 뜬 것으로 본다. 래퍼는 bash 스크립트라 셸 이름이어서 이 단계에서 걸러진다.
function claudeUpAfter({ claudeUp, awaitClaude, sawOn, procName }) {
  if (claudeUp === true) return true;
  if (awaitClaude !== true || sawOn !== true) return false;
  return typeof procName === 'string' && procName.length > 0 && !isShellProcessName(procName);
}
// 기다리며 채우기의 한 걸음(순수). c = { elapsedMs, timeoutMs, exists, active, hasTerm, state, claudeOnly, claudeUp, bracketed, quietMs, procName, typed }
//  -> { do: 'abort', reason } | 'busy' | 'cancel'(기다리는 사이 사용자가 입력했다) | { do: 'stash', reason } | 'fill' | 'wait'
const READY_QUIET_MS = 400;
function fillStep(c) {
  if (!c || !c.exists) return { do: 'abort', reason: 'invalid' }; // 닫혔다
  if (c.typed) return { do: 'cancel' };
  if (c.state === 'exited') return { do: 'abort', reason: 'no-term' };
  if (c.state === 'unavailable') return { do: 'abort', reason: 'no-folder' };
  if (c.hasTerm) {
    if (c.state === 'busy' || c.state === 'waiting') return { do: 'busy' };
    const up = c.claudeOnly ? c.claudeUp === true : true;
    if (up && c.bracketed === true && c.quietMs >= READY_QUIET_MS && !isShellProcessName(c.procName)) {
      return c.active ? { do: 'fill' } : { do: 'stash', reason: 'inactive' }; // 기다리는 사이 다른 작업 공간으로 옮겼다: 몰래 채우지 않는다
    }
  }
  if (c.elapsedMs >= c.timeoutMs) return { do: 'stash', reason: 'timeout' };
  return { do: 'wait' };
}
// "채우기" 재시도 토큰: 만든 작업 공간이 아직 같은 pty(gen = 앱이 pty 마다 새로 만드는 id)이고 5분 안일 때만
function retryCheck(entry, cur, nowMs) {
  if (!entry || typeof entry.text !== 'string' || !entry.text || !Number.isFinite(entry.at)) return { ok: false, reason: 'stale' };
  if (!cur || cur.exists !== true || typeof entry.gen !== 'string' || !entry.gen || cur.gen !== entry.gen) return { ok: false, reason: 'stale' };
  if (!(nowMs - entry.at >= 0 && nowMs - entry.at <= RETRY_TTL_MS)) return { ok: false, reason: 'stale' };
  return { ok: true };
}
// 열려 있는 작업 공간이 어느 세션인가: 훅이 적은 transcript(상태 파일·마지막으로 본 값)가 우선. 우리가 --resume 으로 띄운 uuid 는
// 훅 상태가 아직 없고 사용자가 그 pty 에 입력을 넣기 전까지만 쓴다(그 뒤에는 /clear 등으로 다른 세션이 됐을 수 있다)
function sessionUuidOf({ hookSid, lastSid, resumeSid, hasState, typed, claudeSid } = {}) {
  if (validSessionUuid(hookSid)) return hookSid;
  if (validSessionUuid(lastSid)) return lastSid;
  if (validSessionUuid(resumeSid) && !hasState && !typed) return resumeSid;
  return validSessionUuid(claudeSid) ? claudeSid : null; // 앱이 --session-id 로 정해 준(또는 이어 연) 세션: 훅 정보가 없을 때의 마지막 근거(/clear 뒤에는 낡을 수 있다)
}
// 저장할 작업 공간. withSid(설정 켜짐)면 모두 저장하고 알려진 세션 uuid·prevSid 를 함께 적는다. 꺼져 있으면 uuid 는 적지 않고, 할 일 클릭의 이어 열기로 띄운 임시 작업 공간(transient)은 뺀다.
// 활성 위치는 저장되는 목록 안의 위치. 남는 게 없으면 null(파일을 건드리지 않는다)
function workspacesToSave(items, activeId, withSid = true) {
  const keep = (Array.isArray(items) ? items : []).filter((x) => x && typeof x.cwd === 'string' && (withSid || !x.transient));
  if (!keep.length) return null;
  const a = keep.findIndex((x) => x.id === activeId);
  // 하위 세션: parentId 가 저장되는 목록 안의 최상위 작업 공간을 가리킬 때만 id·parentId 를 적는다(아니면 최상위로 내린다)
  const byId = new Map(keep.filter((x) => validWsId(x.id)).map((x) => [x.id, x]));
  const parentOf = (x) => { const p = validWsId(x.parentId) && x.parentId !== x.id ? byId.get(x.parentId) : null; return p && !(validWsId(p.parentId) && byId.has(p.parentId)) ? p : null; };
  return { list: keep.map((x) => {
    const p = parentOf(x);
    return { cwd: x.cwd, title: x.title, ...(withSid && validSessionUuid(x.claudeSid) ? { claudeSid: x.claudeSid, claudeSidAt: x.claudeSidAt } : {}), ...(withSid && validSessionUuid(x.prevSid) ? { prevSid: x.prevSid } : {}),
      ...(isProjectKey(x.project) ? { project: x.project } : {}), ...(typeof x.squad === 'string' && SQUAD_SLUG_RE.test(x.squad) && (x.origin === 'child' || p) ? { squad: x.squad } : {}), ...(x.origin === 'child' || p ? { origin: 'child' } : {}), ...(x.by === 'user' && (x.origin === 'child' || p) ? { by: 'user' } : {}), ...(validWsId(x.id) ? { id: x.id } : {}), ...(p ? { parentId: p.id } : {}) };
  }), active: a >= 0 ? a : 0 };
}
const WS_ID_RE = /^[0-9a-f]{16}$/;
const STABLE_ID_RE = /^[A-Za-z0-9_-]{4,64}$/; // 스크립트와 맞춘 고정 작업 공간 id 형식(앱이 만드는 id 는 16 hex 로 이 안에 든다)
const validStableId = (s) => typeof s === 'string' && STABLE_ID_RE.test(s);
function validWsId(s) { return typeof s === 'string' && WS_ID_RE.test(s); }

// ---- 다시 켤 때 세션 이어 가기 ----
// 새로 여는 모든 작업 공간은 앱이 정한 uuid 로 `claude --session-id <uuid>` 를 실행한다(그 uuid 가 곧 claudeSid). 파일 시스템으로 짐작하지 않는다.
const RESTORE_ALIVE_SLACK_MS = 60 * 1000; // 기록이 "앱이 꺼진 시각" 보다 이만큼 넘게 새로우면 다른 곳에서 이어 쓴 것으로 본다
const OTHER_INSTANCE_MS = 45 * 1000;
const RESUME_FAIL_MS = 15 * 1000;
// 앱이 마지막으로 살아 있던 시각: 알려진 값(alive 파일·workspaces.json 의 aliveAt·그 파일의 수정 시각) 중 가장 새 것. 모르면 NaN
function pickAliveAt(...cands) {
  const v = cands.filter((x) => Number.isFinite(x) && x > 0);
  return v.length ? Math.max(...v) : NaN;
}
// 시작 방식: 지난번이 정상 종료(cleanExit)였으면 바로 다시 켰어도 normal. 아니면서 alive 시각이 45초 안이면 다른 앱 창이 살아 있다고 보고 아무것도 이어 열지 않는다
function startupMode({ cleanExit, aliveAtMs, nowMs }) {
  if (cleanExit === true) return 'normal';
  if (Number.isFinite(aliveAtMs) && Number.isFinite(nowMs) && Math.abs(nowMs - aliveAtMs) <= OTHER_INSTANCE_MS) return 'other-instance';
  return 'normal';
}
// 이어 열기가 실패했나(순수): --resume 으로 띄웠는데 0 이 아닌 코드로 끝났고, Claude 가 준비되기 전이거나 15초 안이면, 아직 한 번도 되돌리지 않았을 때만 새로 시작한다(되풀이 금지)
function resumeFailureDecision({ resumed, exitCode, ageMs, ready, fellBack }) {
  if (resumed !== true || fellBack === true) return 'none';
  if (!Number.isInteger(exitCode) || exitCode === 0) return 'none';
  return !ready || (Number.isFinite(ageMs) && ageMs < RESUME_FAIL_MS) ? 'fallback' : 'none';
}
// 안내가 지금 보여야 하나: 한 번도 안 보였으면(백그라운드 탭) 계속, 보인 뒤에는 8초
function noteVisible({ kind, shownAt, now }) {
  if (typeof kind !== 'string' || !kind) return false;
  return !Number.isFinite(shownAt) || now - shownAt < 8000;
}
// 새 세션에서 사용자가 첫 프롬프트를 보냈으면(글자를 넣고 Enter) 이전 세션 포인터(prevSid)를 버린다
function shouldDropPrev({ data, typedN, hasPrev }) {
  if (!hasPrev || typeof data !== 'string' || !data.includes('\r')) return false;
  return typedN >= 2 || /[^\r\n]/.test(data.replace(/\x1b\[[0-9;?<>=! ]*[@-~]/g, ''));
}
// 앱을 다시 켤 때 작업 공간마다 이어 열지 정한다(순수). entries: 저장된 목록 [{cwd, unavailable?, claudeSid?, claudeSidAt?, prevSid?}]
// ctx: { enabled, otherInstance, projectsDir, nowMs, uid, aliveAtMs, fs }
//  -> [{ action: 'resume', sid } | { action: 'fresh', prev: uuid|null, note?: 'moved'|'old'|'other', reason }] (entries 와 같은 길이·순서)
// 새로 시작하면서도 prev 에 옛 세션을 남기는 경우(too-old·moved·unavailable·other-instance): 사용자가 "원래 세션 열기" 로 되돌릴 수 있게. 기록이 없거나(no-transcript)
// 같은 sid 가 이미 쓰였거나(duplicate) 시계가 어긋났거나(future)·꺼짐(off)이면 포인터를 지운다. claudeSid 의 기록이 없으면(첫 프롬프트 전) prevSid 를 대신 판단한다
function decideRestore(entries, ctx) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : []).map((e) => {
    const cands = [];
    for (const c of [e && e.claudeSid, e && e.prevSid]) if (validSessionUuid(c) && !cands.includes(c)) cands.push(c);
    if (!cands.length) return { action: 'fresh', prev: null, reason: 'none' };
    if (!ctx || ctx.enabled !== true) return { action: 'fresh', prev: null, reason: 'off' };
    if (ctx.otherInstance === true) return { action: 'fresh', prev: cands[0], note: 'other', reason: 'other-instance' };
    if (e.unavailable) return { action: 'fresh', prev: cands[0], reason: 'unavailable' }; // 폴더가 잠시 없을 수 있다: 포인터는 남기고 지금은 새로 시작
    let last = { action: 'fresh', prev: null, reason: 'no-transcript' };
    for (const sid of cands) {
      if (seen.has(sid)) { last = { action: 'fresh', prev: null, reason: 'duplicate' }; continue; }
      if (sid === e.claudeSid && Number.isFinite(e.claudeSidAt) && e.claudeSidAt > ctx.nowMs + RESTORE_ALIVE_SLACK_MS) { last = { action: 'fresh', prev: null, reason: 'future' }; continue; } // 시계가 되돌아갔다
      const d = decideTodoOpen({ sid, cwd: e.cwd }, { projectsDir: ctx.projectsDir, nowMs: ctx.nowMs, uid: ctx.uid, force: false, workspaces: [], fs: ctx.fs });
      if (d.action === 'resume') {
        if (Number.isFinite(ctx.aliveAtMs) && d.lastMs > ctx.aliveAtMs + RESTORE_ALIVE_SLACK_MS) return { action: 'fresh', prev: sid, note: 'moved', reason: 'moved' };
        seen.add(sid);
        return { action: 'resume', sid };
      }
      if (d.reason === 'too-old') return { action: 'fresh', prev: sid, note: 'old', reason: 'too-old' };
      last = { action: 'fresh', prev: null, reason: d.reason }; // no-transcript·no-folder·bad-source: 다음 후보를 본다
    }
    return last;
  });
}

// 채우기 거부 사유 -> 문구 키(문구는 i18n.js 의 'fill.<사유>')
const FILL_REASONS = ['stale', 'no-prompt', 'unsafe-start', 'not-ready', 'no-term', 'inactive', 'invalid', 'shell'];
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
// Shift+Enter(다른 보조키 없음)인지. keydown 뿐 아니라 keypress·keyup 도 같은 판정으로 삼킨다
// Shift+Enter(다른 보조키 없음). 조합 여부는 보지 않는다: 조합 중이면 렌더러가 줄바꿈을 조합 확정 뒤로 미룬다.
// 한글 등 입력기 글자는 xterm 의 숨은 입력칸에 계속 쌓인다(지워도 남는다). 쌓인 채로 그 안의 커서가 중간에 놓이면
// xterm 이 다음 글자를 받을 때 입력칸 전체를 다시 보낸다(이미 보낸 글이 한 번 더 입력된다). 그래서 키를 누를 때마다 비운다.
// 조합 중이거나, xterm 이 입력칸 값을 읽으려고 걸어 둔 타이머가 아직 돌지 않았거나(settling), 미뤄 둔 줄바꿈이 있으면 비우지 않는다(글자가 사라진다).
function imeCanReset({ type, composing, isComposing, settling, pending } = {}) {
  return type === 'keydown' && composing !== true && isComposing !== true && settling !== true && pending !== true;
}
function isShiftEnter(e) {
  return !!e && e.key === 'Enter' && !!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}
function isNewlineKey(e) {
  return !!e && e.key === 'Enter' && !!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && e.keyCode !== 229;
}

// Cmd+←/→(다른 보조키 없음): 줄 맨 앞(Ctrl+A) / 맨 끝(Ctrl+E). 조합 중, 그리고 alternate screen(vim 등; altScreen=true)에서는 건드리지 않는다.
// 단, 화면이 Claude Code 자신(claudeUi=true: 마루가 claude 를 띄운 작업 공간이고 에이전트 상태가 알려져 있음)이면 alternate screen 이어도 보낸다.
// Claude Code 의 fullscreen 렌더러(settings 의 "tui": "fullscreen")는 시작부터 alternate screen 을 쓰기 때문이다.
function isLineNavKey(e, altScreen, claudeUi) {
  return (!altScreen || !!claudeUi) && !!e && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !!e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.isComposing && e.keyCode !== 229;
}

// Cmd+↑/↓(다른 보조키 없음): 입력란 전체의 맨 앞 / 맨 끝. 조합 중·alternate screen 규칙은 Cmd+←/→ 와 같다.
function isBufNavKey(e, altScreen, claudeUi) {
  return (!altScreen || !!claudeUi) && !!e && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !!e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.isComposing && e.keyCode !== 229;
}
// Claude Code 입력란의 위·아래 경계선(─ 가 이어진 줄. 옛 모양의 ╭╰ 도 받는다)
function isPromptBorder(s) { return typeof s === 'string' && /^[╭╰]?─{8,}/.test(s.trim()); }
// 화면 줄(lines)과 커서 줄(cursorY)로, 커서에서 입력란 첫 줄(up) 또는 마지막 줄까지 몇 줄인지 센다.
// Claude Code 에는 입력 전체의 맨 앞·끝으로 가는 키가 없고, 첫 줄에서 ↑ 를 더 누르면 이전 입력 이력으로 넘어간다. 그래서 줄 수를 정확히 세어 그만큼만 보낸다.
// 커서가 입력란 안(위·아래 모두 경계선이 보임)이 아니면 0: 그때는 줄 안에서만 움직인다.
function promptEdgeRows(lines, cursorY, up) {
  if (!Array.isArray(lines) || !Number.isInteger(cursorY) || cursorY < 0 || cursorY >= lines.length || isPromptBorder(lines[cursorY])) return 0;
  let a = -1; let b = -1;
  for (let i = cursorY - 1; i >= 0; i--) if (isPromptBorder(lines[i])) { a = i; break; }
  for (let i = cursorY + 1; i < lines.length; i++) if (isPromptBorder(lines[i])) { b = i; break; }
  if (a < 0 || b < 0) return 0;
  return up ? cursorY - a - 1 : b - cursorY - 1;
}
// 맨 앞: ↑ 를 rows 번 보낸 뒤 Ctrl+A. 맨 끝: ↓ 를 rows 번 보낸 뒤 Ctrl+E. appCursor: 터미널이 application cursor keys 모드인지
function bufNavSeq(up, rows, appCursor) {
  const n = Number.isInteger(rows) && rows > 0 ? Math.min(rows, 200) : 0;
  return ((appCursor ? '\x1bO' : '\x1b[') + (up ? 'A' : 'B')).repeat(n) + (up ? '\x01' : '\x05');
}
// Cmd+Shift+↑/↓(다른 보조키 없음): 왼쪽 패널에서 위·아래 대상(작업 공간, 이어서 프로젝트)으로 이동
function isStepKey(e) {
  return !!e && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !!e.metaKey && !!e.shiftKey && !e.ctrlKey && !e.altKey && !e.isComposing && e.keyCode !== 229;
}
// Cmd+Shift+←/→(다른 보조키 없음): 지금 보고 있는 대상이 속한 묶음을 접기(←) / 펼치기(→)
function isFoldKey(e) {
  return !!e && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !!e.metaKey && !!e.shiftKey && !e.ctrlKey && !e.altKey && !e.isComposing && e.keyCode !== 229;
}
// 접거나 펼칠 대상을 정한다. open=false 접기, true 펼치기. 이미 그 상태면 null(아무것도 하지 않는다).
// project(보고 있는 프로젝트 키)가 있으면 그 프로젝트의 카테고리, 없으면 활성 작업 공간의 묶음(자신이 부모면 자신, 하위 세션이면 그 부모).
// -> { kind: 'category', tag, closed } | { kind: 'workspace', id, closed } | null
function foldTarget({ ws, wsCollapsed, activeId, project, groups, catCollapsed } = {}, open) {
  const closed = !open;
  if (typeof project === 'string' && project) {
    const g = (Array.isArray(groups) ? groups : []).find((x) => x && typeof x.tag === 'string' && Array.isArray(x.items) && x.items.some((it) => it && it.key === project));
    if (!g) return null;
    const now = Array.isArray(catCollapsed) && catCollapsed.includes(g.tag);
    return now === closed ? null : { kind: 'category', tag: g.tag, closed };
  }
  const ordered = hierarchyOrder(ws);
  const i = ordered.findIndex((x) => x.id === activeId);
  if (i < 0) return null;
  let pid = null;
  if (ordered[i].depth === 1) pid = ordered[i].parentId;
  else if (ordered[i + 1] && ordered[i + 1].depth === 1) pid = ordered[i].id; // 하위 세션이 있는 부모
  if (typeof pid !== 'string') return null;
  const now = Array.isArray(wsCollapsed) && wsCollapsed.includes(pid);
  return now === closed ? null : { kind: 'workspace', id: pid, closed };
}
// targets: numberTargets() 결과(개수 제한 없이), cur: 지금 보고 있는 { kind, id }, d: -1(위) | 1(아래). 맨 처음·맨 끝에서는 null(돌아가지 않는다)
function stepTarget(targets, cur, d) {
  if (!Array.isArray(targets) || !cur || (d !== 1 && d !== -1)) return null;
  const i = targets.findIndex((t) => t && t.kind === cur.kind && t.id === cur.id);
  if (i < 0) return null;
  return targets[i + d] || null;
}

// 입력 중 화살표 바꾸기: 직접 친 "->" 는 →, "<-" 는 ←, "<->" 는 ↔ 로 바꾼다(앞 글자를 지우는 DEL 뒤에 기호를 보낸다).
// 바꾼 직후의 Backspace 는 기호를 지우고 원래 글자로 되돌린다(코드를 쓸 때의 탈출구). "-->" 처럼 - 가 이어진 뒤의 > 는 바꾸지 않는다.
// st: { prev: 직전에 친 글자들(최대 2), conv: 방금 바꾼 것 { orig, sym } | null }. d: 터미널이 보내려는 입력(한 글자가 아니면 그대로 두고 상태를 지운다)
// -> { out: pty 로 보낼 문자열, st: 다음 상태 }
const ARROW_DEL = '\x7f';
function arrowInput(st, d) {
  const prev = st && typeof st.prev === 'string' ? st.prev : '';
  const conv = st && st.conv && typeof st.conv.orig === 'string' ? st.conv : null;
  const none = { prev: '', conv: null };
  if (typeof d !== 'string' || d.length !== 1) return { out: d, st: none };
  if (d === ARROW_DEL) return conv ? { out: ARROW_DEL + conv.orig, st: none } : { out: d, st: none };
  if (d < ' ' ) return { out: d, st: none };
  if (d === '>' && conv && conv.sym === '←') return { out: ARROW_DEL + '↔', st: { prev: '', conv: { orig: '<->', sym: '↔' } } };
  if (d === '>' && prev.endsWith('-') && prev !== '--') return { out: ARROW_DEL + '→', st: { prev: '', conv: { orig: '->', sym: '→' } } };
  if (d === '-' && prev.endsWith('<')) return { out: ARROW_DEL + '←', st: { prev: '', conv: { orig: '<-', sym: '←' } } };
  return { out: d, st: { prev: (prev + d).slice(-2), conv: null } };
}

// 작업 공간이 Claude Code 화면인지: 마루가 claude 를 띄웠고(launched) 훅 상태가 busy/idle/waiting 으로 알려졌거나, 아직 상태가 없어도 claude 가 설치돼 있어 exec 됐을 때
function isClaudeUi({ launched, state, claudeFound } = {}) {
  return !!launched && (state === 'busy' || state === 'idle' || state === 'waiting' || (state === 'none' && !!claudeFound));
}

function keyToSeq(e, altScreen, claudeUi) {
  if (!e || e.type !== 'keydown') return null;
  if (e.isComposing || e.keyCode === 229) return null;
  if (isLineNavKey(e, altScreen, claudeUi)) return e.key === 'ArrowLeft' ? '\x01' : '\x05';
  // Shift+Enter: 줄바꿈(ESC+CR. Claude Code 가 Option+Enter 로 받는 입력과 같다). 전송하지 않는다
  if (e.key === 'Enter') return isNewlineKey(e) ? '\x1b\r' : null;
  if (e.key !== 'Backspace') return null;
  if (e.ctrlKey || e.shiftKey) return null;
  if (e.metaKey && !e.altKey) return '\x15'; // Cmd+Backspace: 줄 앞부분 삭제(Ctrl+U)
  if (e.altKey && !e.metaKey) return '\x17'; // Option+Backspace: 앞 단어 삭제(Ctrl+W)
  return null;
}

// ---- 파일 끌어다 놓기: 절대 경로 검증·인용·bracketed paste 조립 ----
const DROP_MAX = 10;
const DROP_PATH_MAX = 1024;
function validDropPath(p) {
  return typeof p === 'string' && p.length > 0 && p.startsWith('/') && [...p].length <= DROP_PATH_MAX && !hasBadChars(p.replace(/[\uFE0F\u200D]/g, '')); // 이모지 파일 이름을 위해 변형 선택자·ZWJ 만 허용
}
// macOS 터미널의 드롭처럼 백슬래시 탈출: ASCII 영숫자와 / . _ - + , : @ % = 및 비ASCII(한글 등)는 그대로,
// 그 밖의 ASCII(공백 ' " \ $ ( ) 백틱 등)는 앞에 \ 를 붙인다. 셸이 한 단어로 읽고, claude 가 이미지 경로로 인식한다
function shellQuote(p) { return String(p).replace(/[\x00-\x7F]/g, (c) => (/[A-Za-z0-9\/._+,:@%=-]/.test(c) ? c : '\\' + c)); }
// 경로 배열 -> 붙여넣을 문자열(각 경로 인용 + 공백 + 끝 공백 하나, Enter 없음). 하나라도 틀리거나 0·11개 이상이면 null
function buildDropPaste(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > DROP_MAX || !paths.every(validDropPath)) return null;
  return '\x1b[200~' + paths.map(shellQuote).join(' ') + ' \x1b[201~';
}
// 드롭 거부 사유 -> 문구 키('drop.<사유>')
const DROP_REASONS = ['invalid', 'inactive', 'busy-ui', 'not-ready', 'no-term', 'too-many', 'missing', 'shell'];
function dropNoticeKey(reason) { return 'drop.' + (DROP_REASONS.includes(reason) ? reason : 'invalid'); }

// ---- 서브에이전트·모델 표시 ----
const MODEL_ID_RE = /^[A-Za-z0-9._:\[\]-]{1,64}$/;
function validModelId(m) { return typeof m === 'string' && MODEL_ID_RE.test(m); }
function shortModelName(id) {
  if (typeof id !== 'string' || !id) return null;
  const low = id.toLowerCase();
  for (const w of ['opus', 'sonnet', 'haiku', 'fable', 'mythos']) if (low.includes(w)) return w;
  return [...id].slice(0, 24).join('');
}
// 기록(transcript) 경로: 절대 경로, .jsonl, 제어문자 없음, 1024자 이하
function validTranscriptPath(p) {
  return typeof p === 'string' && p.startsWith('/') && p.endsWith('.jsonl') && [...p].length <= 1024 && !/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(p);
}
// realFile 이 realBase(예: ~/.claude/projects 의 realpath) 아래에 있는지(문자열 비교; realpath 는 호출 쪽)
function pathInside(realFile, realBase) {
  return typeof realFile === 'string' && typeof realBase === 'string' && realBase.length > 1 && realFile.startsWith(realBase.endsWith('/') ? realBase : realBase + '/');
}
// transcript 꼬리 텍스트 -> 마지막 assistant 항목의 message.model(없으면 null). <synthetic> 제외
function parseTranscriptModel(text, truncated = false) {
  if (typeof text !== 'string') return null;
  const rows = text.split(/\r?\n/);
  if (truncated) rows.shift(); // 잘린 첫 줄 버림
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r || r.length > 1 << 20 || r.indexOf('"model"') < 0) continue;
    let o; try { o = JSON.parse(r); } catch { continue; }
    const m = o && typeof o === 'object' && o.message && typeof o.message === 'object' ? o.message : null;
    if (!m || (o.type !== 'assistant' && m.role !== 'assistant')) continue;
    if (validModelId(m.model) && m.model !== '<synthetic>') return m.model;
  }
  return null;
}
// .claude/agents/*.md frontmatter -> {name, model}|null. 이름·모델 형식이 틀리면 null
const AGENT_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
function parseAgentFile(text) {
  if (typeof text !== 'string') return null;
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return null;
  const f = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^(name|model):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (k) f[k[1]] = k[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  if (f.model === undefined || f.model === '') f.model = 'inherit'; // model 없음 = 마루와 같은 모델
  if (!AGENT_NAME_RE.test(f.name || '') || !validModelId(f.model)) return null;
  return { name: f.name, model: f.model };
}
const PARTY_MAX = 12;
const PARTY_ROLES = ['scout', 'worker', 'expert'];
const DEFAULT_AGENTS = [{ name: 'scout', model: 'haiku' }, { name: 'worker', model: 'sonnet' }, { name: 'expert', model: 'opus' }];
// 읽은 에이전트 목록 -> 파티(마루 제외). 비면 기본 3개. 이름이 겹치면 앞의 것만. 역할 이름은 아는 이름만
function buildAgentParty(agents) {
  const seen = new Set(); const out = [];
  for (const a of Array.isArray(agents) ? agents : []) {
    if (!a || !AGENT_NAME_RE.test(a.name || '') || !validModelId(a.model) || seen.has(a.name)) continue;
    seen.add(a.name); out.push({ name: a.name, roleKey: PARTY_ROLES.includes(a.name) ? a.name : null, model: a.model === 'inherit' ? 'inherit' : shortModelName(a.model) }); // 'inherit' 는 main 이 마루 줄의 모델로 바꾼다
    if (out.length >= PARTY_MAX) break;
  }
  const rank = (x) => { const i = PARTY_ROLES.indexOf(x.name); return i < 0 ? PARTY_ROLES.length : i; };
  out.sort((x, y) => rank(x) - rank(y)); // 아는 역할(scout, worker, expert)을 앞에, 나머지는 읽은 순서(안정 정렬)
  return out.length ? out : DEFAULT_AGENTS.map((a) => ({ name: a.name, roleKey: a.name, model: a.model }));
}
// 서브에이전트 종류 목록(파일마다 하나) -> [{type, count}] (처음 나온 순서)
const SUB_TYPE_RE = /^[A-Za-z0-9_:.-]{1,64}$/;
function summarizeSubs(types) {
  const m = new Map();
  for (const t of Array.isArray(types) ? types : []) if (typeof t === 'string' && SUB_TYPE_RE.test(t)) m.set(t, (m.get(t) || 0) + 1);
  return [...m].map(([type, count]) => ({ type, count }));
}
function validSubFileName(n) { return typeof n === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(n); }
function parseSubType(text) {
  if (typeof text !== 'string' || text.length > 256) return null;
  const t = text.split(/\r?\n/)[0];
  return SUB_TYPE_RE.test(t) ? t : null;
}

// ---- 스쿼드(scripts/squads.py meta 의 한 줄 JSON) ----
// {"squads":[{slug,name,description,source:'builtin'|'personal',lead:{agent,model},members:[{role,agent,model}]}],"skipped":[...]} -> 엄격 검증한 배열.
// 모르는 필드는 버리고, 틀린 스쿼드·팀원은 버린다(팀원이 6명을 넘는 스쿼드는 통째로 버린다). 스쿼드 12개까지.
const SQUAD_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,19}$/;
const SQUADS_MAX = 12;
const SQUAD_MEMBERS_MAX = 6;
const SQUAD_NAME_MAX = 24;
const SQUAD_DESC_MAX = 200;
const SQUAD_META_MAX_BYTES = 256 * 1024;
const SQUAD_SCAN_MAX = 64; // 앞에서부터 이만큼만 훑는다
const SQUAD_MODELS = ['haiku', 'sonnet', 'opus', 'inherit'];
const SQUAD_RESERVED_ROLES = ['lead', 'session', 'squad']; // squads.py RESERVED_ROLES 와 같다
const squadRoleReserved = (r) => SQUAD_RESERVED_ROLES.includes(r) || r.endsWith('-lead') || r.endsWith('-session'); // squads.py role_reserved
const isPlainObject = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
function squadText(s, max, min) { // 보이지 않는 문자·제어문자가 있거나 앞뒤 공백이 있으면 거부
  if (typeof s !== 'string' || hasBadChars(s) || s !== s.trim()) return null;
  const n = [...s].length;
  return n >= min && n <= max ? s : null;
}
function validSquad(o) {
  if (!isPlainObject(o) || typeof o.slug !== 'string' || !SQUAD_SLUG_RE.test(o.slug)) return null;
  const name = squadText(o.name, SQUAD_NAME_MAX, 1);
  const description = squadText(o.description, SQUAD_DESC_MAX, 0);
  if (name === null || description === null || (o.source !== 'builtin' && o.source !== 'personal')) return null;
  const lead = o.lead;
  if (!isPlainObject(lead) || lead.agent !== 'sq-' + o.slug + '-lead' || !SQUAD_MODELS.includes(lead.model)) return null;
  if (!Array.isArray(o.members) || o.members.length > SQUAD_MEMBERS_MAX) return null;
  const members = []; const roles = new Set();
  for (const m of o.members) {
    if (!isPlainObject(m) || typeof m.role !== 'string' || !SQUAD_SLUG_RE.test(m.role) || squadRoleReserved(m.role) || roles.has(m.role)) continue;
    if (m.agent !== 'sq-' + o.slug + '-' + m.role || !SQUAD_MODELS.includes(m.model)) continue;
    roles.add(m.role); members.push({ role: m.role, agent: m.agent, model: m.model });
  }
  return { slug: o.slug, name, description, personal: o.source === 'personal', lead: { agent: lead.agent, model: lead.model }, members };
}
function parseSquadMeta(text) {
  if (typeof text !== 'string' || text.length > SQUAD_META_MAX_BYTES) return [];
  let o; try { o = JSON.parse(text); } catch { return []; }
  if (!isPlainObject(o) || !Array.isArray(o.squads)) return [];
  const out = []; const seen = new Set();
  for (const e of o.squads.slice(0, SQUAD_SCAN_MAX)) {
    if (out.length >= SQUADS_MAX) break;
    const v = validSquad(e);
    if (!v || seen.has(v.slug)) continue;
    seen.add(v.slug); out.push(v);
  }
  return out;
}
// 검증된 스쿼드 -> 화면용 묶음. 모델 'inherit' 는 마루 줄의 모델(leadModel)로 바꾼다. 줄: { agent, lead, role(총괄이면 null), model }
function squadView(squads, leadModel) {
  const mdl = (m) => (m === 'inherit' ? leadModel || '—' : m);
  return (Array.isArray(squads) ? squads : []).map((q) => ({
    slug: q.slug, name: q.name, personal: q.personal,
    rows: [{ agent: q.lead.agent, lead: true, role: null, model: mdl(q.lead.model) }, ...q.members.map((m) => ({ agent: m.agent, lead: false, role: m.role, model: mdl(m.model) }))],
  }));
}
// 작업 공간에 저장된 팀(slug)이 지금 설치된(검증을 통과한) 스쿼드 목록에 있을 때만 { slug, name }. 없으면 null: 래퍼가 무시할 팀을 칩으로 내세우지 않는다(순수)
function teamChip(slug, squads) {
  if (typeof slug !== 'string' || !SQUAD_SLUG_RE.test(slug)) return null;
  const q = (Array.isArray(squads) ? squads : []).find((x) => x && x.slug === slug && typeof x.name === 'string' && x.name);
  return q ? { slug, name: q.name } : null;
}
// 하위 세션 진입용 에이전트(sq-<slug>-session)는 서브에이전트로 도는 멤버가 아니다: 임시 줄로 보이지 않게 건너뛴다
const SESSION_AGENT_RE = /^sq-[a-z0-9][a-z0-9-]*-session$/;
// 서브에이전트 종류 -> 개수(Map), 알려진 줄에 붙고 남은 것(임시 줄 후보)
function matchSubs(subs, knownNames) {
  const counts = new Map(); const extra = [];
  const known = new Set(knownNames);
  for (const s of Array.isArray(subs) ? subs : []) {
    if (!s || typeof s.type !== 'string' || !SUB_TYPE_RE.test(s.type) || !Number.isInteger(s.count) || s.count < 1 || s.count > 32) continue;
    if (SESSION_AGENT_RE.test(s.type)) continue;
    counts.set(s.type, s.count);
    if (!known.has(s.type)) extra.push({ type: s.type, count: s.count });
  }
  return { counts, extra };
}
// 스쿼드 묶음을 펼칠지: 사용자가 직접 정했으면 그대로, 아니면 그 스쿼드의 에이전트가 돌 때만
function squadOpen(userChoice, active) { return typeof userChoice === 'boolean' ? userChoice : !!active; }
// 작업 공간에서 claude 를 띄우는 한 줄(셸에 쓴다). wrapper = 저장소의 maru-claude.sh 절대 경로(없거나 이상하면 null -> 그냥 claude)
// resumeId(선택): 있으면 소문자 uuid 형식이어야 하고(아니면 null — 호출 쪽은 실행하지 않는다) `--resume <uuid>` 를 붙인다. 래퍼는 받은 인자를 그대로 claude 에 넘긴다.
// claudeBin(선택): resolveClaude() 가 찾은 절대 경로. 유효하면(래퍼와 같은 검증, 폴더가 "/" 이거나 ":" 를 품으면 제외) 사용자 셸의 PATH 에 claude 가 없어도 뜨게
// PATH 맨 뒤에 그 폴더를 덧붙인다(앞이 아니라 뒤: 사용자 도구를 가리지 않는다). `[ -x bin ] || command -v claude` 라서 저장된 경로가 낡았어도 PATH 의 claude 가 있으면 그대로 간다.
// 실행 대상은 래퍼(있으면) 아니면 이름 claude — 사용자 셸이 고른 claude 가 먼저고 덧붙인 폴더는 대비책이다. 래퍼가 이름으로 부르는 claude 도 같은 PATH 로 찾는다. { } 묶음은 쓰지 않는다(fish 호환).
// 맨 앞 \x15(Ctrl-U)는 셸에 이미 쳐 둔 글자가 이 줄과 섞이지 않게 줄을 지운다(예전 형태에도 붙였다: 이 변경이 예전 형태의 유일한 차이).
function claudeLaunchCommand(sid, wrapper, resumeId, freshId, claudeBin) {
  const pathOk = (p) => typeof p === 'string' && p.startsWith('/') && p.length <= 1024 && !hasBadChars(p) && !/[\r\n]/.test(p);
  const ok = pathOk(wrapper);
  const has = (v) => v !== undefined && v !== null;
  if ((has(resumeId) && !validSessionUuid(resumeId)) || (has(freshId) && !validSessionUuid(freshId)) || (has(resumeId) && has(freshId))) return null; // 둘 다 주면 거부(--resume 과 --session-id 는 함께 쓰지 않는다)
  const arg = resumeId ? ' --resume ' + resumeId : freshId ? ' --session-id ' + freshId : ''; // freshId: 새 세션에 앱이 정한 uuid(그 작업 공간의 claudeSid)
  const env = sid ? 'MARU_APP_SESSION=' + sid + ' ' : '';
  if (pathOk(claudeBin)) {
    const dir = require('path').dirname(claudeBin);
    if (dir !== '/' && !dir.includes(':') && pathOk(dir)) return '\x15[ -x ' + shellQuote(claudeBin) + ' ] || command -v claude >/dev/null || exit 127; ' + env + 'PATH="$PATH":' + shellQuote(dir) + ' exec ' + (ok ? shellQuote(wrapper) : 'claude') + arg + ' ; exit 127\r';
  }
  return '\x15command -v claude >/dev/null && ' + env + 'exec ' + (ok ? shellQuote(wrapper) : 'claude') + arg + ' ; exit 127\r'; // exec 가 안 되면(claude 없음·실패) 셸이 남지 않게 끝낸다(남은 셸에 문장을 채우는 사고 방지). 종료 코드 127 은 렌더러가 "claude 를 찾지 못함" 으로 알린다
}

// 마루 저장소 위치 찾기. 순서: MARU_HOME -> ~/.config/maru/root 첫 줄 -> (패키징 안 됨) appDir/.. -> ~/maru -> ~/.maru(managed)
// io: { readConfig(): string|null, isRepo(dir): boolean }. 후보는 절대경로이고 isRepo 통과해야 채택.
function resolveRoot({ env = {}, home, isPackaged, appDir, io, managedHome }) {
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
    ['managed', managedHome ? path.normalize(managedHome) : (home ? path.join(home, '.maru') : null)], // 앱이 payload 를 풀어 둔 홈(마커 .maru-managed)
  ];
  for (const [source, dir] of cands) {
    if (!dir) continue;
    let ok = false;
    try { ok = io.isRepo(dir) === true && (source !== 'managed' || !io.isManaged || io.isManaged(dir) === true); } catch { ok = false; }
    if (ok) return { root: dir, source };
  }
  return null;
}

// 에이전트 상태 파일(JSON {"state","at"}) -> 'busy'|'idle'|'waiting'|null
const AGENT_STATES = ['busy', 'idle', 'waiting'];
const AGENT_STATE_MAX = 8192; // 훅이 cwd(최대 1024자, 한글이면 바이트가 많다)까지 적어도 들어가는 크기. main 의 읽기 상한과 같다
function parseAgentState(text) {
  if (typeof text !== 'string' || text.length > AGENT_STATE_MAX) return null;
  try {
    const o = JSON.parse(text);
    return o && typeof o === 'object' && AGENT_STATES.includes(o.state) ? o.state : null;
  } catch { return null; }
}

// 상태 기록의 cwd: 절대 경로, 1024자 이하, 제어·서식 문자 없음
function validRecCwd(c) { return typeof c === 'string' && c.length >= 1 && c.length <= 1024 && c.startsWith('/') && !hasBadChars(c); }
// 상태 파일 -> {state, atMs}|null
function parseAgentRecord(text) {
  const state = parseAgentState(text);
  if (!state) return null;
  let atMs = NaN; let o = null;
  try { o = JSON.parse(text); atMs = Date.parse(o.at); } catch { /* 무시 */ }
  const rec = { state, atMs };
  if (o && validTranscriptPath(o.transcript_path)) rec.transcript = o.transcript_path; // 앱 밖에서 쓴 값일 수 있어 다시 검증
  if (o && validModelId(o.model)) rec.model = o.model;
  if (o && validRecCwd(o.cwd)) rec.cwd = o.cwd; // 선택: 훅이 알려 주는 현재 위치(절대 경로). 틀린 값은 버린다
  if (o && Number.isInteger(o.bg) && o.bg >= 1 && o.bg <= 99) rec.bg = o.bg; // 선택: 메인 턴은 끝났고(idle) 백그라운드 서브에이전트가 도는 수. 틀린 값은 버리고 기록은 받는다
  if (o && o.rc === true) rec.rc = true; // 선택: 원격 제어가 연결된 세션의 훅이 적는다. 불리언 true 만 받는다(문자열·숫자는 연결 아님). 없으면 연결 아님
  return rec;
}

// ---- 원격 제어(Remote Control) 토글: 순수 함수 ----
// pty 출력에서 ANSI 를 벗기고, 마커 "/remote-control is active" 가 청크 경계에 걸쳐도 찾도록 짧은 꼬리(256자)만 들고 있다. 임의 바이트에도 안전하다
const RC_TAIL_MAX = 256; const RC_SCAN_MAX = 1 << 20; const RC_MARKER = '/remote-control is active';
function rcScan(tail, data) {
  const t = typeof tail === 'string' ? tail.slice(-RC_TAIL_MAX) : '';
  if (typeof data !== 'string' || !data) return { tail: t, active: false };
  const d = data.length > RC_SCAN_MAX ? data.slice(-RC_SCAN_MAX) : data; // 너무 큰 청크는 끝부분만 본다(메모리·시간 상한)
  let s = t + d;
  s = s.replace(/\x1b\[\d{0,3}C/g, ' ') // 커서 오른쪽 이동은 공백으로 그려지는 일이 있어 공백으로 본다
    .replace(/\x1b\][^\x07\x1b]{0,512}(?:\x07|\x1b\\)/g, '').replace(/\x1bP[^\x1b]{0,512}\x1b\\/g, '')
    .replace(/\x1b\[[0-9;?<>=! ]{0,64}[@-~]/g, '').replace(/\x1b[@-Z\\-_]/g, '');
  // 끝에 잘린 이스케이프는 다음 청크와 이어 벗기도록 꼬리에 남기고, 이번 검색에서는 뺀다
  const cut = /\x1b(?:\[[0-9;?<>=! ]{0,64}|\][^\x07\x1b]{0,512}\x1b?|P[^\x1b]{0,512}\x1b?)?$/.exec(s);
  const held = cut ? cut[0] : ''; if (cut) s = s.slice(0, cut.index);
  s = s.replace(/\s+/g, ' ');
  const i = s.indexOf(RC_MARKER);
  if (i >= 0) return { tail: (s.slice(i + RC_MARKER.length) + held).slice(-RC_TAIL_MAX), active: true }; // 찾은 부분은 버려 같은 줄을 다시 세지 않는다
  return { tail: (s + held).slice(-RC_TAIL_MAX), active: false };
}
// 입력줄에 보내지 않은 글이 있을 수 있는가(추측이다: 마지막 Enter·Ctrl+C·Ctrl+U 뒤에 사용자가 뭔가 눌렀으면 true). 터미널의 자동 응답(포커스·커서 위치·장치 속성·OSC·DCS)은 세지 않는다.
// 방향키(이력 불러오기)·Esc·Tab·Backspace·Shift+Enter(ESC+CR)·붙여넣기도 입력이다. 비우는 것은 Enter(\r)·Ctrl+C·Ctrl+U 뿐이고 덩어리 안에서는 마지막 것이 정한다. 모르겠으면 dirty 를 유지한다
function draftStep(dirty, data) {
  let d = !!dirty;
  if (typeof data !== 'string' || !data) return d;
  const re = /\x1b\[200~[\s\S]*?(?:\x1b\[201~|$)|\x1b\][^\x07\x1b]{0,512}(?:\x07|\x1b\\)|\x1bP[^\x1b]{0,512}\x1b\\|\x1b\[([0-9;?<>=!-\/ ]*)([@-~])|\x1b[\r\n]|[\s\S]/g;
  let m;
  while ((m = re.exec(data)) !== null) {
    const c = m[0];
    if (c.startsWith('\x1b[200~')) d = true; // 붙여넣기: 안의 Enter 는 전송이 아니다
    else if (c.startsWith('\x1b]') || c.startsWith('\x1bP')) continue; // OSC·DCS 응답
    else if (m[2] !== undefined) { // CSI: 응답(?·>·<·= 로 시작, 또는 포커스 I/O·커서 위치 R·장치 속성 c·y·n·t)은 건너뛰고 나머지(방향키·Home/End·Delete·Shift+Tab 등)는 입력
      if (!/^[?<>=]/.test(m[1]) && !(m[1] === '' && (m[2] === 'I' || m[2] === 'O')) && !'Rcynt'.includes(m[2])) d = true;
    } else if (c === '\r' || c === '\x03' || c === '\x15') d = false;
    else d = true; // 글자·Esc·Tab·Backspace·\n·ESC+CR(Shift+Enter) 등 나머지 입력
  }
  return d;
}
// 터미널의 "/remote-control is active" 는 글자일 뿐이라 모델·문서·사용자가 찍어도 나타난다. 사용자가 켜 달라고 한 직후(5분 안)이고 그 뒤에 훅 기록이 아직 없을 때만 증거로 받는다
const RC_MARKER_MS = 5 * 60 * 1000;
function rcMarkerOk({ asked, askedAt, hookAt, now } = {}) {
  if (asked !== 'on' || !Number.isFinite(askedAt) || !Number.isFinite(now)) return false;
  if (!(now - askedAt >= 0 && now - askedAt < RC_MARKER_MS)) return false;
  return !(Number.isFinite(hookAt) && hookAt > askedAt); // 요청보다 새 훅 기록이 있으면 그것이 정한다
}
// 원격 제어 표시 상태. 증거 = 훅 기록의 rc(hookRc, hookAt)와 터미널 마커(seenAt, 켜짐). 시각은 now 로 눌러 미래 시각이 요청을 이기지 못하게 한다.
// 요청(asked, askedAt)보다 새 증거가 요청과 같은 방향이면 증거가 이긴다. 60초 안에서는 증거가 없거나 반대면(연결이 끝나기 전에 쓴 기록일 수 있다) 진행 중으로 본다. 60초 뒤: 새 증거가 있으면 증거, 없고 요청이 바탕과 다르면 unknown
const RC_PENDING_MS = 60000;
function rcView(c) {
  const { hookRc, hookAt, seenAt, asked, askedAt, now } = c || {};
  const fin = Number.isFinite; const cl = (t) => (fin(now) && t > now ? now : t);
  let evAt = -Infinity; let on = false;
  if (typeof hookRc === 'boolean' && fin(hookAt)) { evAt = cl(hookAt); on = hookRc; }
  if (fin(seenAt) && seenAt > 0 && cl(seenAt) >= evAt) { evAt = cl(seenAt); on = true; } // 같은 시각이면 터미널 마커(켜짐)를 따른다
  const base = on ? 'on' : 'off';
  if (!((asked === 'on' || asked === 'off') && fin(askedAt))) return base;
  const newer = evAt > askedAt; const agrees = (asked === 'on') === on;
  if (!fin(now) || now - askedAt < RC_PENDING_MS) return newer && agrees ? base : (asked === 'on' ? 'turning-on' : 'turning-off');
  if (newer) return base;
  return agrees ? base : 'unknown';
}
// 토글 문장을 보내도 되는가: { ok } | { ok:false, reason }.
// view: rcView 결과(진행 중이면 pending, unknown 이면 보내지 않는다). state: busy 는 거부(권한·질문 창이 훅보다 먼저 떠 있을 수 있다), waiting 도 거부.
// idle 은 출력이 READY_QUIET_MS 이상 조용해야 하고, none(훅 기록 전)은 ready(입력줄이 떴다는 fillStep 판정)일 때만
function rcCanSend(c) {
  const { hasTerm, shellFront, bracketed, state, dirty, cc, view, quietMs, ready } = c || {};
  if (!hasTerm || cc !== true) return { ok: false, reason: 'no-session' };
  if (shellFront) return { ok: false, reason: 'shell' };
  if (view === 'turning-on' || view === 'turning-off') return { ok: false, reason: 'pending' };
  if (view === 'unknown') return { ok: false, reason: 'unknown' };
  if (bracketed !== true) return { ok: false, reason: 'not-ready' };
  if (state === 'waiting') return { ok: false, reason: 'waiting' };
  if (state === 'busy') return { ok: false, reason: 'busy' };
  if (state === 'idle') { if (!(Number.isFinite(quietMs) && quietMs >= READY_QUIET_MS)) return { ok: false, reason: 'not-ready' }; }
  else if (state === 'none') { if (ready !== true) return { ok: false, reason: 'not-ready' }; }
  else return { ok: false, reason: 'not-ready' };
  if (dirty) return { ok: false, reason: 'draft' };
  return { ok: true };
}

// idle 이면서 백그라운드 서브에이전트가 도는 수(없으면 0). 기록의 at 이 ttlMs 보다 오래됐으면(SubagentStop 이 안 온 낡은 값) 0
function bgCount(rec, state, now, ttlMs) {
  if (!rec || state !== 'idle' || !Number.isInteger(rec.bg) || rec.bg < 1 || rec.bg > 99) return 0;
  return Number.isFinite(rec.atMs) && Number.isFinite(now) && now - rec.atMs <= ttlMs && rec.atMs - now <= 86400000 ? rec.bg : 0;
}
// 서브에이전트 목록을 보여 줄까: 일하는 중(busy·waiting)이거나, idle 인데 백그라운드 작업이 남아 있을 때
function showSubs(rec, state, now, ttlMs) { return state === 'busy' || state === 'waiting' || bgCount(rec, state, now, ttlMs) > 0; }
// 상태 문구: [i18n 키, 매개변수]. idle + 백그라운드 작업이 있으면 "입력 대기 · 백그라운드 작업 N"
function agentStatusText(k, bg) { return k === 'idle' && Number.isInteger(bg) && bg > 0 ? { key: 'agent.idle.bg', params: { n: bg } } : { key: 'agent.' + k, params: {} }; }

// 앱을 띄운 프로세스가 Claude Code 세션 안이었을 때 물려받는 호스트 환경을 자식(작업 공간 pty·도구)에게 넘기지 않는다. 입력은 바꾸지 않고 복사본을 돌려준다.
// 늘 뺀다: CLAUDECODE, CLAUDE_CODE_*, CLAUDE_AGENT_SDK_*, CLAUDE_EFFORT, CLAUDE_PID, CLAUDE_PREVIEW_*.
// 입력에 CLAUDECODE 또는 CLAUDE_CODE_CHILD_SESSION 이 있었을 때(= 정말 호스트 세션에서 물려받았다)만 추가로: MCP_*, ANTHROPIC_BASE_URL·ANTHROPIC_API_KEY·ANTHROPIC_AUTH_TOKEN·ANTHROPIC_CUSTOM_HEADERS.
// 늘 남긴다: CLAUDE_CONFIG_DIR, MARU_*. (사용자가 셸 프로필에 둔 CLAUDE_CODE_* 설정은 pty 가 로그인 셸이라 프로필을 다시 읽어 돌아온다 — 여기서는 "물려받은 것"만 정리한다.)
const HOST_ENV_ALWAYS = (k) => k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k.startsWith('CLAUDE_AGENT_SDK_') || k === 'CLAUDE_EFFORT' || k === 'CLAUDE_PID' || k.startsWith('CLAUDE_PREVIEW_');
const HOST_ENV_INHERITED = (k) => k.startsWith('MCP_') || k === 'ANTHROPIC_BASE_URL' || k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN' || k === 'ANTHROPIC_CUSTOM_HEADERS';
function sanitizeHostEnv(env) {
  const src = env && typeof env === 'object' ? env : {};
  const inherited = Object.prototype.hasOwnProperty.call(src, 'CLAUDECODE') || Object.prototype.hasOwnProperty.call(src, 'CLAUDE_CODE_CHILD_SESSION');
  const out = {};
  for (const k of Object.keys(src)) {
    if (k === 'CLAUDE_CONFIG_DIR' || k.startsWith('MARU_')) { out[k] = src[k]; continue; }
    if (HOST_ENV_ALWAYS(k) || (inherited && HOST_ENV_INHERITED(k))) continue;
    out[k] = src[k];
  }
  return out;
}

// 상태 파일의 at 은 초 단위로 잘려 있다(date -u +%S). 파일 mtime 이 at 과 2초 안이면 그 값(ms)으로 다듬어 Esc 시각과 비교한다
function refineAgentAt(rec, mtimeMs) {
  if (!rec || !Number.isFinite(rec.atMs) || !Number.isFinite(mtimeMs)) return rec;
  const d = mtimeMs - rec.atMs;
  return d >= 0 && d < 2000 ? { ...rec, atMs: mtimeMs } : rec;
}

// Esc 로 중단했는데 Stop 훅이 없을 때: busy/waiting 기록보다 Esc 가 나중이고(그 뒤 새 기록 없음), Esc 뒤 delayMs(1.5초)가 지났으면 true.
// 그 사이에 이미 끝나가던 도구가 PostToolUse(busy)를 쓰면 기록이 Esc 보다 새로워 false 가 된다. 다음 프롬프트(UserPromptSubmit)의 busy 도 마찬가지.
const ESC_IDLE_MS = 1500;
function escInterrupted(rec, escAt, now, delayMs = ESC_IDLE_MS) {
  if (!rec || (rec.state !== 'busy' && rec.state !== 'waiting')) return false;
  if (!Number.isFinite(escAt) || escAt <= 0 || !Number.isFinite(rec.atMs) || !Number.isFinite(now)) return false;
  return escAt > rec.atMs && now - escAt >= delayMs;
}

// busy 인데 기록이 오래되고(staleMs) pty 출력도 그동안 없으면 idle 로 낮춘다(Esc 중단 등 Stop 훅이 없는 경우)
// escAt: 이 작업 공간 터미널에서 busy/waiting 중에 사용자가 Esc 를 누른 시각(ms, 앱 메모리에만 둔다). 0 이면 없음
function effectiveAgent(rec, now, lastOutputAt, staleMs = 20000, escAt = 0) {
  if (!rec) return 'none';
  if (escInterrupted(rec, escAt, now)) return 'idle';
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

// 플랜 사용량(data/usage.json, scripts/usage-status.sh 가 statusLine 입력에서 뽑아 쓴다). 숫자만 받는다.
// 입력 {"v":1,"at":<epoch 초>,"five_hour":{"pct":0~100,"resets_at":<epoch 초>},"seven_day":{...}} -> 같은 모양으로 정리해 돌려준다(창은 있는 것만). 쓸 수 없으면 null.
const USAGE_MAX_BYTES = 4096;
const USAGE_KEYS = ['five_hour', 'seven_day'];
function parseUsage(text) {
  if (typeof text !== 'string' || text.length > USAGE_MAX_BYTES) return null;
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!num(o.at) || o.at <= 0 || o.at > 4102444800) return null;
  const out = { v: 1, at: Math.floor(o.at) };
  for (const k of USAGE_KEYS) {
    const w = o[k];
    if (!w || typeof w !== 'object' || Array.isArray(w)) continue;
    if (!num(w.pct) || !num(w.resets_at) || w.resets_at <= 0 || w.resets_at > 4102444800) continue;
    out[k] = { pct: Math.min(100, Math.max(0, w.pct)), resets_at: Math.floor(w.resets_at) };
  }
  return out[USAGE_KEYS[0]] || out[USAGE_KEYS[1]] ? out : null;
}
// parseUsage 결과 -> { windows: [{ key, pct(정수), resetMs(남은 ms), expired, level }], ageMs } (창이 하나도 없으면 null)
// 초기화 시각이 지난 창은 0% 로 보인다(이미 초기화된 것을 아니까). level: 'ok' < 80, 'warn' 80~94, 'crit' >= 95
function usageLevel(pct) { return pct >= 95 ? 'crit' : pct >= 80 ? 'warn' : 'ok'; }
function usageView(usage, nowMs = Date.now()) {
  if (!usage || typeof usage !== 'object') return null;
  const windows = [];
  for (const key of USAGE_KEYS) {
    const w = usage[key];
    if (!w || typeof w.pct !== 'number' || typeof w.resets_at !== 'number') continue;
    const left = w.resets_at * 1000 - nowMs;
    const expired = left <= 0;
    const pct = expired ? 0 : Math.round(Math.min(100, Math.max(0, w.pct)));
    windows.push({ key, pct, resetMs: expired ? 0 : left, expired, level: usageLevel(pct) });
  }
  if (!windows.length || typeof usage.at !== 'number') return null;
  return { windows, ageMs: Math.max(0, nowMs - usage.at * 1000) };
}
// 초기화까지 남은 시간 -> { key, params }: 1시간 미만 분, 하루 미만 시간, 그 이상 일. 이미 지났으면 'usage.reset.done'
function fmtUsageReset(w) {
  if (!w || w.expired) return { key: 'usage.reset.done', params: {} };
  const ms = Math.max(0, w.resetMs);
  if (ms < 3600000) return { key: 'usage.reset.min', params: { n: Math.min(59, Math.max(1, Math.ceil(ms / 60000))) } };
  if (ms < 86400000) return { key: 'usage.reset.hour', params: { n: Math.floor(ms / 3600000) } };
  return { key: 'usage.reset.day', params: { n: Math.min(99, Math.floor(ms / 86400000)) } };
}
// 마지막 갱신 후 지난 시간 -> { key, params }
function fmtUsageAge(ageMs) {
  const s = Math.floor(Math.max(0, ageMs) / 1000);
  if (s < 60) return { key: 'usage.age.now', params: {} };
  if (s < 3600) return { key: 'usage.age.min', params: { n: Math.floor(s / 60) } };
  if (s < 86400) return { key: 'usage.age.hour', params: { n: Math.floor(s / 3600) } };
  return { key: 'usage.age.day', params: { n: Math.min(99, Math.floor(s / 86400)) } };
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
    return { text: buf.toString('utf8', 0, n), truncated: st.size > maxBytes, mtimeMs: st.mtimeMs };
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
  const out = { name: o.name, lang: o.lang, calendar: o.calendar, createdAt: o.createdAt };
  if (typeof o.resumeSessions === 'boolean') out.resumeSessions = o.resumeSessions; // 선택 항목(없으면 켜짐). 예전 앱은 모르는 필드를 무시한다
  return out;
}
const resumeSessionsOn = (profile) => !(profile && profile.resumeSessions === false);

// readRegular 결과({text, truncated}|null) -> 프로필|null (나쁜 파일은 없는 것으로 취급)
function parseProfile(res) {
  if (!res || res.truncated || typeof res.text !== 'string') return null;
  try { return validateProfile(JSON.parse(res.text)); } catch { return null; }
}
function loadProfile(file) { return parseProfile(readRegular(file, PROFILE_MAX_BYTES, false)); }

// 원자적 저장(임시 파일 0600 + rename). data 폴더가 심볼릭 링크면 거부. 성공 여부를 돌려준다.
function writeJsonAtomic(file, value, tmpPrefix) { return writeTextAtomic(file, JSON.stringify(value, null, 2) + '\n', tmpPrefix); }
function writeTextAtomic(file, text, tmpPrefix) {
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
    fs.writeSync(fd, text);
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
// 관리형 홈(roots: ROOT 와 그 realpath)의 작업 공간 기본 제목은 폴더 이름(".maru")이 아니라 제품 이름. 비었거나 자동으로 붙은 ".maru" 일 때만 바꾸고 사용자가 정한 제목은 그대로 둔다
function managedWsTitle(title, cwd, roots, product) {
  const isRoot = typeof cwd === 'string' && Array.isArray(roots) && roots.some((r) => typeof r === 'string' && r && r.replace(/\/+$/, '') === cwd.replace(/\/+$/, ''));
  return isRoot && typeof product === 'string' && product && (!title || title === '.maru') ? product : title;
}
// 사용자가 직접 정한 제목: 무해화 -> 40자(코드포인트) 상한 -> 앞뒤 공백 제거. 비면 ''(거부). 문자열이 아니면 ''
function cleanWsTitle(s) {
  if (typeof s !== 'string') return '';
  return [...cleanQuestText(s.length > 4000 ? s.slice(0, 4000) : s)].slice(0, WS_TITLE_MAX).join('').trim();
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
// 저장된 parentId 검증: 같은 파일 안 항목을 가리키고, 자기 자신이 아니며, 부모 자신이 부모를 주장하지 않을 때만(깊이 1; 끊어진 참조·순환·손자는 최상위로). id 는 관계에 쓰이는 항목에만 남긴다
function linkWorkspaceParents(list, rawIds, rawParents) {
  const byId = new Map();
  rawIds.forEach((id, i) => { if (id && !byId.has(id)) byId.set(id, i); });
  const links = [];
  rawParents.forEach((pid, i) => {
    const j = pid ? byId.get(pid) : undefined;
    if (j !== undefined && j !== i && !rawParents[j] && rawIds[i] && byId.get(rawIds[i]) === i) links.push([i, j]);
  });
  rawIds.forEach((id, i) => { if (id && byId.get(id) === i) list[i].id = id; }); // 모든 작업 공간의 고정 id(겹치면 먼저 나온 것만). 없는 옛 항목은 불러올 때 main 이 새로 정한다
  for (const [i, j] of links) { list[i].parentId = rawIds[j]; list[i].origin = 'child'; }
}

// 저장된 목록 -> { list: [{cwd, title}], active }. 잘못된 항목·없는 폴더는 버리고 6개까지만 쓴다. exists(cwd): boolean
function normalizeWorkspaces(raw, { exists, max = WS_MAX, fallbackTitle } = {}) {
  const out = { list: [], active: 0 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.workspaces)) return out;
  const origIdx = []; const rawIds = []; const rawParents = [];
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
    if (validSessionUuid(e.claudeSid)) { // 마지막으로 알려진 Claude 세션(선택). 틀린 값은 버리고 작업 공간은 남긴다
      entry.claudeSid = e.claudeSid;
      if (Number.isInteger(e.claudeSidAt) && e.claudeSidAt >= 1e11 && e.claudeSidAt <= 99999999999999) entry.claudeSidAt = e.claudeSidAt;
    }
    if (validSessionUuid(e.prevSid) && e.prevSid !== entry.claudeSid) entry.prevSid = e.prevSid; // 새로 시작하면서 남겨 둔 옛 세션("원래 세션 열기" 용, 하나뿐)
    if (e.origin === 'child') entry.origin = 'child'; // 하위 세션이었던 적이 있다(부모가 닫혀도 마루 세션이 될 수 없다)
    if (isProjectKey(e.project)) entry.project = e.project; // 하위 세션의 프로젝트 이름표(부모가 닫혀도 남는다)
    if (e.origin === 'child' && typeof e.squad === 'string' && SQUAD_SLUG_RE.test(e.squad)) entry.squad = e.squad; // 하위 세션이 맡은 팀(다시 열 때 같은 팀으로; 없어진 팀이면 래퍼가 무시하고 팀 없이 연다)
    if (e.origin === 'child' && e.by === 'user') entry.by = 'user'; // 사용자가 직접 연 하위 세션(마루가 요청한 것과 구분). 그 밖의 값은 버린다
    rawIds.push(validWsId(e.id) ? e.id : null); rawParents.push(validWsId(e.parentId) ? e.parentId : null);
    out.list.push(entry);
    origIdx.push(i);
  });
  linkWorkspaceParents(out.list, rawIds, rawParents);
  const a = origIdx.indexOf(raw.active);
  out.active = a >= 0 ? a : 0;
  if (Number.isInteger(raw.aliveAt) && raw.aliveAt >= 1e11 && raw.aliveAt <= 99999999999999) out.aliveAt = raw.aliveAt; // (예전 파일) 앱이 마지막으로 살아 있던 시각(ms)
  if (raw.cleanExit === true) out.cleanExit = true; // 정상 종료 표지(다음 시작 때 지워진다)
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
// 파일에 쓸 JSON 본문(순수). 내용이 같으면 쓰지 않으려고 호출 쪽이 이전 본문과 비교한다. aliveAt 은 더 이상 여기에 쓰지 않는다(별도 alive 파일)
function workspacesJson(list, active, { cleanExit } = {}) {
  const n = normalizeWorkspaces({ workspaces: list, active }, { exists: () => true });
  return JSON.stringify({ version: 1, active: n.active, ...(cleanExit === true ? { cleanExit: true } : {}), workspaces: n.list }, null, 2) + '\n';
}
function saveWorkspaces(file, list, active, opts) { return writeTextAtomic(file, workspacesJson(list, active, opts || {}), 'workspaces'); }
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
function isRealDir(d) { const fs = require('fs'); try { const st = fs.lstatSync(d); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; } }
function readJournalEntries(memDir) {
  const fs = require('fs'); const path = require('path');
  const out = [];
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

// ---- 하루 회고(<기억 폴더>/diary/YYYY-MM-DD.md): "# 제목" 한 줄 + 빈 줄로 나뉜 본문. 셸이 쓰고 앱은 읽기만 한다 ----
const DIARY_FILE_MAX_BYTES = 8 * 1024;
const DIARY_FILES_MAX = 400;
const DIARY_TITLE_MAX = 60;
const DIARY_BODY_MAX = 1500;
const DIARY_NAME_RE = /^([0-9]{4}-[0-9]{2}-[0-9]{2})\.md$/;
// 본문 -> { title, body } | null. 첫 비어 있지 않은 줄이 "# " 로 시작해야 한다. 줄마다 neutralizeBody(제어문자 제거 포함)를 거치고, 문단 구분(빈 줄)은 남긴다.
function parseDiaryText(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  let i = 0;
  while (i < lines.length && !lines[i].replace(BAD_CHARS_G, '').trim()) i++;
  if (i >= lines.length) return null;
  const head = lines[i].replace(/^\uFEFF/, '');
  if (!head.startsWith('# ')) return null;
  const title = [...neutralizeBody(head.slice(2))].slice(0, DIARY_TITLE_MAX).join('').trim();
  if (!title) return null;
  const body = lines.slice(i + 1).map((l) => neutralizeBody(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, body: [...body].slice(0, DIARY_BODY_MAX).join('').trim() };
}
// <기억 폴더>/diary/*.md 읽기(Node 전용) -> Map(day -> {title, body}). diary 가 링크·폴더 아님이면 비어 있다. 일반 파일만, 8KB 넘으면 건너뛰고, 최신 400개까지.
function readDiaries(memDir) {
  const fs = require('fs'); const path = require('path');
  const out = new Map();
  const dd = path.join(memDir, 'diary');
  if (!isRealDir(memDir) || !isRealDir(dd)) return out;
  let names = [];
  try { names = fs.readdirSync(dd); } catch { names = []; }
  const files = [];
  for (const n of names) { const m = DIARY_NAME_RE.exec(n); if (m && validDay(m[1])) files.push({ day: m[1], file: path.join(dd, n) }); }
  files.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  for (const f of files.slice(0, DIARY_FILES_MAX)) {
    const r = readRegular(f.file, DIARY_FILE_MAX_BYTES, false);
    if (!r || r.truncated) continue;
    const d = parseDiaryText(r.text);
    if (d) out.set(f.day, d);
  }
  return out;
}

// ---- 달력(왼쪽 달 카드·가운데 하루 보기)용 순수 함수 ----
const YM_RE = /^([0-9]{4})-([0-9]{2})$/;
// 'YYYY-MM' -> { year, month } | null (2000~2100년, 1~12월)
function parseYm(s) {
  const m = typeof s === 'string' ? YM_RE.exec(s) : null;
  if (!m) return null;
  const year = +m[1]; const month = +m[2];
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? { year, month } : null;
}
// 'YYYY-MM' 에서 delta 달 뒤 -> 'YYYY-MM' (범위 밖이면 null)
function shiftYm(ym, delta) {
  const p = parseYm(ym);
  if (!p || !Number.isInteger(delta)) return null;
  const k = p.year * 12 + (p.month - 1) + delta;
  const out = String(Math.floor(k / 12)).padStart(4, '0') + '-' + String((k % 12) + 1).padStart(2, '0');
  return parseYm(out) ? out : null;
}
// 'YYYY-MM-DD' 에서 delta 일 뒤 -> 'YYYY-MM-DD' (잘못된 날짜·범위 밖이면 null)
function shiftDay(day, delta) {
  if (!validDay(day) || !Number.isInteger(delta)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + delta));
  const out = String(d.getUTCFullYear()).padStart(4, '0') + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  return parseYm(out.slice(0, 7)) ? out : null;
}
// 달 격자: { days: 그 달의 날수, first: 1일의 요일(0=일요일) }
function monthLayout(year, month) {
  return { days: new Date(Date.UTC(year, month, 0)).getUTCDate(), first: new Date(Date.UTC(year, month - 1, 1)).getUTCDay() };
}
// 달 요약: { 'YYYY-MM-DD': { records, diary, events } } — 기록·회고·일정이 하나라도 있는 날만. entries: 일지 항목, diaries: Map, events: { 'YYYY-MM-DD': [...] } | null
function buildMonthSummary({ entries, diaries, events, ym }) {
  const out = {};
  const get = (d) => (hasOwn(out, d) ? out[d] : (out[d] = { records: 0, diary: false, events: 0 }));
  const inMonth = (d) => typeof d === 'string' && d.startsWith(ym + '-') && validDay(d);
  for (const e of Array.isArray(entries) ? entries : []) if (e && inMonth(e.day)) get(e.day).records++;
  if (diaries && typeof diaries.keys === 'function') for (const d of diaries.keys()) if (inMonth(d)) get(d).diary = true;
  if (events && typeof events === 'object') for (const d of Object.keys(events)) if (inMonth(d) && Array.isArray(events[d]) && events[d].length) get(d).events = events[d].length;
  return out;
}
// 하루의 일지 항목을 프로젝트(등록된 것) 또는 태그별로 묶는다 -> [{ title, key, items: [{time, kind, text}] }]. 묶음은 첫 기록 시각순, 태그 없음('' 제목)은 맨 뒤, 묶음 안은 시각·기록 순.
function buildDayGroups({ entries, day, registry, state }) {
  const st = state && typeof state === 'object' ? state : {};
  const regMap = new Map((Array.isArray(registry) ? registry : []).map((r) => [r.key, r]));
  const groups = new Map();
  const mine = (Array.isArray(entries) ? entries : []).filter((e) => e && e.day === day);
  mine.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.seq - b.seq));
  for (const e of mine) {
    const root = e.slug ? projectRoot(st, e.tag + '/' + e.slug) : null;
    const owner = root && regMap.has(root) ? root : (e.slug && regMap.has(e.tag + '/' + e.slug) ? e.tag + '/' + e.slug : null);
    const gk = owner ? 'p:' + owner : e.tag ? 't:' + e.tag : 'n:';
    if (!groups.has(gk)) {
      const e2 = owner && hasOwn(st, owner) ? st[owner] : null;
      groups.set(gk, { title: owner ? (e2 && e2.title) || regMap.get(owner).title : e.tag, key: owner, none: !owner && !e.tag, items: [] });
    }
    groups.get(gk).items.push({ time: e.time, kind: e.kind, text: e.text });
  }
  return [...groups.values()].sort((a, b) => (a.none === b.none ? 0 : a.none ? 1 : -1)).map(({ title, key, items }) => ({ title, key, items }));
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

// 요약 배열 -> 화면용 묶음 { open: [{tag, items}], done: [{tag, items}], doneCount, unsorted: [요약...] }. 카테고리는 최근 기록순, 묶음 안은 최근 기록순.
// 분류 안 됨(kind 'unclassified') 줄은 카테고리 묶음에 넣지 않고 unsorted 로 따로 모은다(최근 기록 날짜 내림차순, 같으면 태그순).
function groupProjects(list, ui) {
  const mk = (items) => {
    const by = new Map();
    for (const it of items) { if (!by.has(it.tag)) by.set(it.tag, []); by.get(it.tag).push(it); }
    const last = (arr) => arr.reduce((m, x) => (x.lastDay && x.lastDay > m ? x.lastDay : m), '');
    const cmpItem = (a, b) => ((a.lastDay || '') < (b.lastDay || '') ? 1 : (a.lastDay || '') > (b.lastDay || '') ? -1 : (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    return [...by.entries()]
      .map(([tag, arr]) => ({ tag, items: arr.sort(cmpItem), last: last(arr) }))
      .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)))
      .map(({ tag, items: its }) => ({ tag, items: its }));
  };
  const l = Array.isArray(list) ? list : [];
  const done = l.filter((x) => x.status === 'done');
  const isUnc = (x) => x.kind === 'unclassified';
  const open = mk(l.filter((x) => x.status !== 'done' && !isUnc(x)));
  const unsorted = l.filter((x) => x.status !== 'done' && isUnc(x))
    .sort((a, b) => ((a.lastDay || '') < (b.lastDay || '') ? 1 : (a.lastDay || '') > (b.lastDay || '') ? -1 : (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)));
  return { open: ui ? applyProjectUi(open, ui) : open, done: mk(done), doneCount: done.length, unsorted }; // 사용자 순서는 진행 중 목록에만
}

// ---- 화면 상태(data/project-ui.json): { catOrder: [태그...], projOrder: { "<태그>": ["<태그/슬러그>", ...] }, collapsed: [태그...] } ----
// 앱이 쓰는 표시 전용 상태(순서·접힘). 모르는 필드는 버리고, 형식이 틀린 원소는 걸러 내며, 배열·객체 길이 상한을 넘으면 파일 전체를 손상으로 본다.
const PROJ_UI_MAX_BYTES = 128 * 1024;
const PROJ_UI_MAX_TAGS = 200; // catOrder·collapsed·projOrder 키 수 상한
const PROJ_UI_MAX_PER_TAG = 200; // 한 카테고리의 프로젝트 순서 길이 상한
const PROJ_UI_MAX_KEYS = 1000; // projOrder 전체 키 수 상한
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function defaultProjectUi() { return { catOrder: [], projOrder: {}, collapsed: [] }; }
function cleanTagList(a) { // 태그 배열 -> 형식 맞고 겹치지 않는 태그만(길이 상한 초과는 null)
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > PROJ_UI_MAX_TAGS) return null;
  const seen = new Set(); const out = [];
  for (const t of a) if (typeof t === 'string' && TODO_TAG_RE.test(t) && !seen.has(t)) { seen.add(t); out.push(t); }
  return out;
}
// 접어 둔 하위 세션 묶음: 부모 작업 공간의 고정 id(16 hex, 겹치지 않게, 최대 20개). 비어 있으면 필드를 쓰지 않는다
const WS_COLLAPSED_MAX = 20;
function cleanWsCollapsed(a) {
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > 200) return null;
  const seen = new Set(); const out = [];
  for (const t of a) if (validWsId(t) && !seen.has(t)) { seen.add(t); out.push(t); }
  return out.slice(-WS_COLLAPSED_MAX);
}
function validateProjectUi(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const catOrder = cleanTagList(o.catOrder); const collapsed = cleanTagList(o.collapsed);
  if (!catOrder || !collapsed) return null;
  const projOrder = {};
  const po = o.projOrder;
  if (po !== undefined) {
    if (!po || typeof po !== 'object' || Array.isArray(po)) return null;
    const tags = Object.keys(po);
    if (tags.length > PROJ_UI_MAX_TAGS) return null;
    let total = 0;
    for (const tag of tags) {
      const arr = po[tag];
      if (!Array.isArray(arr) || arr.length > PROJ_UI_MAX_PER_TAG) return null;
      total += arr.length;
      if (total > PROJ_UI_MAX_KEYS) return null;
      if (!TODO_TAG_RE.test(tag)) continue; // __proto__ 같은 키는 버린다
      const seen = new Set(); const keys = [];
      for (const k of arr) if (isProjectKey(k) && k.startsWith(tag + '/') && !seen.has(k)) { seen.add(k); keys.push(k); }
      projOrder[tag] = keys;
    }
  }
  const ws = cleanWsCollapsed(o.wsCollapsed);
  if (!ws) return null;
  return { catOrder, projOrder, collapsed, ...(ws.length ? { wsCollapsed: ws } : {}) };
}
function parseProjectUi(res) {
  if (!res || res.truncated || typeof res.text !== 'string') return null;
  try { return validateProjectUi(JSON.parse(res.text)); } catch { return null; }
}
// { status: 'missing'|'corrupt'|'ok', data } (없거나 손상이면 data 는 기본값)
function readProjectUiFile(file) {
  const fs = require('fs');
  let present = true;
  try { fs.lstatSync(file); } catch { present = false; }
  if (!present) return { status: 'missing', data: defaultProjectUi() };
  const data = parseProjectUi(readRegular(file, PROJ_UI_MAX_BYTES, false));
  return data ? { status: 'ok', data } : { status: 'corrupt', data: defaultProjectUi() };
}
function projectUiFits(ui) { return Buffer.byteLength(JSON.stringify(ui, null, 2) + '\n', 'utf8') <= PROJ_UI_MAX_BYTES; }
// 요약 목록(buildProjects 결과)에 없는 태그·키를 걸러 낸다. 빈 순서 목록은 지운다.
function pruneProjectUi(ui, list) {
  const v = validateProjectUi(ui) || defaultProjectUi();
  const l = Array.isArray(list) ? list : [];
  if (!l.some((x) => x && x.kind === 'project')) return v; // 레지스트리가 비었거나 못 읽은 순간이면 저장해 둔 순서·접힘을 지우지 않는다(검증만 한다)
  const tags = new Set(l.filter((x) => x.kind === 'project').map((x) => x.tag)); const keys = new Set(l.filter((x) => x.kind === 'project').map((x) => x.key));
  const projOrder = {};
  for (const tag of Object.keys(v.projOrder)) {
    const ks = v.projOrder[tag].filter((k) => keys.has(k));
    if (tags.has(tag) && ks.length) projOrder[tag] = ks;
  }
  return { catOrder: v.catOrder.filter((t) => tags.has(t)), projOrder, collapsed: v.collapsed.filter((t) => tags.has(t)), ...(v.wsCollapsed ? { wsCollapsed: v.wsCollapsed } : {}) };
}
// 검증을 통과한 값과 완전히 같을 때만 쓴다(고쳐진 값이 있으면 거부). data 폴더가 링크면 writeJsonAtomic 이 거부한다.
function saveProjectUi(file, ui) {
  const v = validateProjectUi(ui);
  if (!v || Object.keys(ui).length !== (v.wsCollapsed ? 4 : 3) || JSON.stringify(v) !== JSON.stringify({ catOrder: ui.catOrder, projOrder: ui.projOrder, collapsed: ui.collapsed, ...(v.wsCollapsed ? { wsCollapsed: ui.wsCollapsed } : {}) })) return false;
  if (!projectUiFits(v)) return false;
  return writeJsonAtomic(file, v, 'project-ui');
}
// 순서 적용: order 에 있는 알려진 id(중복 무시)를 그 순서대로 앞에, 나머지는 원래 순서로 뒤에
function applyOrder(items, order, keyOf) {
  const by = new Map(items.map((it) => [keyOf(it), it]));
  const out = []; const used = new Set();
  for (const k of Array.isArray(order) ? order : []) if (typeof k === 'string' && by.has(k) && !used.has(k)) { used.add(k); out.push(by.get(k)); }
  for (const it of items) if (!used.has(keyOf(it))) out.push(it);
  return out;
}
// 묶음(카테고리 배열)에 사용자 순서를 적용: 카테고리 순서, 카테고리 안 프로젝트 순서.
function applyProjectUi(groups, ui) {
  const u = ui && typeof ui === 'object' ? ui : defaultProjectUi();
  const po = u.projOrder && typeof u.projOrder === 'object' ? u.projOrder : {};
  return applyOrder(groups, u.catOrder, (g) => g.tag).map((g) => ({ tag: g.tag, items: applyOrder(g.items, hasOwn(po, g.tag) ? po[g.tag] : [], (it) => it.key) }));
}
// ids 에서 id 를 beforeId 앞(null 이면 맨 끝)으로 옮긴 새 배열. id 가 없거나 beforeId 가 없거나(null 아님) 자기 자신이면 null.
function moveInOrder(ids, id, beforeId) {
  if (!Array.isArray(ids) || !ids.includes(id)) return null;
  if (beforeId !== null && (beforeId === id || !ids.includes(beforeId))) return null;
  const rest = ids.filter((x) => x !== id);
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
  rest.splice(at, 0, id);
  return rest;
}

// ---- ⌘숫자: 왼쪽 패널에 보이는 순서(작업 공간 먼저, 이어서 보이는 프로젝트 줄) ----
const GOTO_MAX = 9;
// 접히지 않은 카테고리 안 줄의 키(화면 순서). openGroups: groupProjects().open, collapsed: 접힌 태그 배열
function visibleProjectKeys(openGroups, collapsed) {
  const closed = new Set(Array.isArray(collapsed) ? collapsed : []);
  const out = [];
  for (const g of Array.isArray(openGroups) ? openGroups : []) {
    if (!g || closed.has(g.tag)) continue;
    for (const it of Array.isArray(g.items) ? g.items : []) if (it && typeof it.key === 'string') out.push(it.key);
  }
  return out;
}
// -> 번호(0 부터; ⌘1 = 0)별 { kind: 'workspace'|'project', id }, 최대 9개. main(메뉴)과 렌더러(힌트)가 같은 함수를 쓴다.
function numberTargets(wsIds, projectKeys, max = GOTO_MAX) {
  const out = [];
  for (const id of Array.isArray(wsIds) ? wsIds : []) { if (out.length >= max) break; if (typeof id === 'string') out.push({ kind: 'workspace', id }); }
  for (const id of Array.isArray(projectKeys) ? projectKeys : []) { if (out.length >= max) break; if (typeof id === 'string') out.push({ kind: 'project', id }); }
  return out;
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

// 기억 파일 한 줄의 길이 상한. 모든 정규식·문자열 처리 전에 먼저 자른다(공백만 수만 개인 줄에서 정규식이 느려지는 것을 막는다).
const MEM_LINE_MAX = 4096;
const memCapLine = (l) => (l.length > MEM_LINE_MAX ? l.slice(0, MEM_LINE_MAX) : l);
// 파일 이름 규칙(새 읽기와 옛 읽기가 같이 쓴다): 소문자·숫자로 시작, 소문자·숫자·_·-, 최대 80자 + .md
const MEM_FILE_RE = /^[a-z0-9][a-z0-9_-]{0,79}\.md$/;
// YAML 블록 스칼라 표시(> | >- |+ >2 ...): 값이 아니라 표지이므로 빈 값으로 본다
const isBlockScalar = (v) => /^[>|][-+0-9]{0,2}$/.test(v);
// 'key: 값' 한 줄에서 값(앞뒤 공백 제거, 블록 스칼라 표지는 빈 값). key 가 다르면 null. 정규식 없이 선형으로 읽는다.
function memKeyValue(l, key, allowIndent) {
  const s = allowIndent ? l.trimStart() : l;
  if (!s.startsWith(key + ':')) return null;
  const v = s.slice(key.length + 1).trim();
  return isBlockScalar(v) ? '' : v;
}
// 한 줄 목록 '[a, b]' 의 안쪽. 대괄호로 감싼 값이 아니면 null
function memInlineList(v) { return v.length >= 2 && v[0] === '[' && v[v.length - 1] === ']' ? v.slice(1, -1) : null; }

// 기억 frontmatter(앞부분만) -> { name, description, tags } | null. 이름은 필수.
function parseMemoryMeta(text) {
  if (typeof text !== 'string') return null;
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n?|\n/);
  if (lines[0] !== '---') return null;
  let name = ''; let desc = ''; let tags = [];
  const titles = { ko: '', en: '' }; const descs = { ko: '', en: '' }; // 화면용 표시 문구(첫 비어 있지 않은 값)
  for (let i = 1; i < lines.length; i++) {
    const l = memCapLine(lines[i]);
    if (l.trimEnd() === '---') break;
    let v;
    if ((v = memKeyValue(l, 'name', false)) !== null) { if (v) name = v; }
    else if ((v = memKeyValue(l, 'description', false)) !== null) { if (v) desc = v; }
    else if ((v = memKeyValue(l, 'title_ko', true)) !== null) { if (!titles.ko) titles.ko = v; }
    else if ((v = memKeyValue(l, 'title_en', true)) !== null) { if (!titles.en) titles.en = v; }
    else if ((v = memKeyValue(l, 'description_ko', true)) !== null) { if (!descs.ko) descs.ko = v; }
    else if ((v = memKeyValue(l, 'description_en', true)) !== null) { if (!descs.en) descs.en = v; }
    else if (/^[ \t]/.test(l) && (v = memKeyValue(l, 'tags', true)) !== null) {
      const inner = memInlineList(v);
      if (inner !== null) tags = inner.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter((x) => TODO_TAG_RE.test(x)).slice(0, 4);
    }
  }
  const clean = (s, max) => [...neutralizeBody(s)].slice(0, max).join('');
  name = clean(name, MEM_NAME_MAX);
  if (!name) return null;
  const cl = (x, max) => clean(memvUnquote(x), max);
  return { name, description: clean(desc, MEM_DESC_MAX), tags, titles: { ko: cl(titles.ko, MEMV_TITLE_MAX), en: cl(titles.en, MEMV_TITLE_MAX) }, descs: { ko: cl(descs.ko, MEM_DESC_MAX), en: cl(descs.en, MEM_DESC_MAX) } };
}
// 같은 태그(대표·보조 모두)를 가진 기억 최대 12개(이름순). 읽기 전용 표시용.
function relatedMemories(metas, tag, max = PROJ_MEM_MAX) {
  if (typeof tag !== 'string' || !tag) return [];
  const t = tag.toLowerCase();
  return (Array.isArray(metas) ? metas : []).filter((m) => m && m.tags.some((x) => x.toLowerCase() === t))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, max)
    .map((m) => ({ name: m.name, description: m.description, titles: m.titles || { ko: '', en: '' }, descs: m.descs || { ko: '', en: '' } })); // 화면이 언어에 맞춰 고른다(memoryDisplay)
}
// 기억 폴더를 읽어도 되는가(동기): 폴더도, 그 바로 위 프로젝트 폴더도 심볼릭 링크가 아니어야 한다.
function memDirSafeSync(memDir) {
  const fs = require('fs'); const path = require('path');
  try {
    const st = fs.lstatSync(memDir); if (!st.isDirectory() || st.isSymbolicLink()) return false;
    return !fs.lstatSync(path.dirname(memDir)).isSymbolicLink();
  } catch { return false; }
}
// <기억 폴더>/*.md(MEMORY.md 제외) 의 frontmatter 읽기(Node 전용). 일반 파일만(하드링크 제외), 앞 8KB 만, 최대 500개.
function readMemoryMetas(memDir) {
  const fs = require('fs'); const path = require('path');
  if (!memDirSafeSync(memDir)) return [];
  let names = [];
  try { names = fs.readdirSync(memDir); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (out.length >= MEM_FILES_MAX) break;
    if (!MEM_FILE_RE.test(n) || n === 'MEMORY.md') continue;
    const p = path.join(memDir, n);
    try { if (fs.lstatSync(p).nlink !== 1) continue; } catch { continue; }
    const r = readRegular(p, MEM_HEAD_BYTES, false);
    const m = r ? parseMemoryMeta(r.text) : null;
    if (m) out.push(m);
  }
  return out;
}

// ---- 기억 보기(읽기 전용): 기억 파일 전체 읽기·링크 해석·그래프·배치·검색 ----
// 기억 파일의 이름·본문은 LLM 이 쓴 신뢰할 수 없는 글이다. 여기서 제어·bidi 문자를 걷고 길이를 자르며, 화면은 textContent 로만 그린다.
const MEMV_FILES_MAX = 500; // 읽을 파일 수 상한
const MEMV_FILE_MAX_BYTES = 64 * 1024; // 파일 하나 상한(넘으면 건너뜀)
const MEMV_TOTAL_MAX_BYTES = 2 * 1024 * 1024; // 읽은 바이트 합 상한
const MEMV_NAME_MAX = 80;
const MEMV_DESC_MAX = 240;
const MEMV_TITLE_MAX = 60; // 화면용 제목(권장 40자, 넘게 와도 이만큼까지만 쓴다)
const MEMV_BODY_MAX = 6000; // 화면·검색에 쓰는 본문 글자 수(코드포인트)
const MEMV_BODY_LINES_MAX = 300;
const MEMV_LINKS_MAX = 40; // 파일 하나가 가리킬 수 있는 [[링크]] 수
const MEMV_TAGS_MAX = 6;
const MEMV_TYPES = ['user', 'feedback', 'project', 'reference'];
const MEMV_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/; // MEM_FILE_RE(.md 앞부분)와 같은 규칙
const MEMV_DIR_SCAN_MAX = 5000; // 폴더에서 훑는 항목 수 상한(넘으면 더 읽지 않고 건너뜀으로 센다)
const MEMV_CACHE_TTL_MS = 20000; // main 의 목록 캐시 유효 시간
const MEMV_TAG_RE = /^[0-9A-Za-z가-힣_-]{1,24}$/;
const MEMV_TAG_EDGE_MEMBERS_MAX = 8; // 이보다 많은 기억이 가진 태그는 '같은 태그' 선을 긋지 않는다(헤어볼 방지)
const MEMV_EDGES_MAX = 1200; // 그래프 전체 선 상한(링크 선 먼저)
const MEMV_TAG_EDGES_MAX = 500;
const MEMV_QUERY_MAX = 100;

const memvCut = (s, max) => [...s].slice(0, max).join('');
// 한 줄 글: 탭은 공백으로, 나머지 제어·bidi·보이지 않는 문자는 지우고 공백을 접는다
function memvLine(s, max) {
  if (typeof s !== 'string') return '';
  return memvCut(s.replace(/\t/g, ' ').replace(BAD_CHARS_G, '').replace(/\s+/g, ' ').trim(), max);
}
// 본문: 줄바꿈은 살리고 줄마다 같은 규칙으로 걷는다
function memvBody(s) {
  if (typeof s !== 'string') return '';
  const lines = s.replace(/\r\n?/g, '\n').split('\n').slice(0, MEMV_BODY_LINES_MAX).map((l) => memCapLine(l).replace(/\t/g, '  ').replace(BAD_CHARS_G, '').trimEnd());
  return memvCut(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), MEMV_BODY_MAX);
}
function memvUnquote(v) {
  let s = v.trim();
  const m = /^(["'])([\s\S]*)\1$/.exec(s);
  if (m) s = m[1] === '"' ? m[2].replace(/\\(["\\])/g, '$1') : m[2].replace(/''/g, "'");
  return s;
}
// 기억 파일 한 개의 원문 -> { slug, name, description, type, tags, body, links, modified } | null
// frontmatter 가 없거나 닫히지 않으면 기억이 아닌 것으로 본다. 이름이 없으면 slug 를 쓴다. links 는 본문 [[slug]] 의 원문(중복 제거·상한, 해석은 buildMemoryModel).
function parseMemoryFile(text, slug, modifiedMs) {
  if (typeof text !== 'string' || typeof slug !== 'string' || !MEMV_SLUG_RE.test(slug)) return null;
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n?|\n/).map(memCapLine); // 줄 단위로 먼저 자른다(CRLF·단독 CR 모두 줄바꿈)
  if (lines[0] !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trimEnd() === '---') { end = i; break; }
  if (end < 0) return null;
  let name = ''; let desc = ''; let type = ''; let tags = []; let inTags = false;
  const titles = { ko: '', en: '' }; const descs = { ko: '', en: '' }; // metadata 아래의 화면용 표시 문구(없어도 된다)
  for (let i = 1; i < end; i++) {
    const l = lines[i]; let v;
    if (inTags) {
      const ts = l.trimStart();
      if (ts[0] === '-' && (ts[1] === ' ' || ts[1] === '\t') && ts.slice(2).trim()) { tags.push(memvUnquote(ts.slice(2).trim())); continue; }
      inTags = false;
    }
    if ((v = memKeyValue(l, 'name', false)) !== null) { if (v) name = memvUnquote(v); }
    else if ((v = memKeyValue(l, 'description', false)) !== null) desc = memvUnquote(v);
    else if ((v = memKeyValue(l, 'title_ko', true)) !== null) { if (!titles.ko) titles.ko = memvLine(memvUnquote(v), MEMV_TITLE_MAX); } // 같은 키가 또 나오면 비어 있지 않은 첫 값(scripts/maru_ui.py 와 같다)
    else if ((v = memKeyValue(l, 'title_en', true)) !== null) { if (!titles.en) titles.en = memvLine(memvUnquote(v), MEMV_TITLE_MAX); }
    else if ((v = memKeyValue(l, 'description_ko', true)) !== null) { if (!descs.ko) descs.ko = memvLine(memvUnquote(v), MEMV_DESC_MAX); }
    else if ((v = memKeyValue(l, 'description_en', true)) !== null) { if (!descs.en) descs.en = memvLine(memvUnquote(v), MEMV_DESC_MAX); }
    else if ((v = memKeyValue(l, 'type', true)) !== null) { const w = memvUnquote(v).toLowerCase(); if (MEMV_TYPES.includes(w)) type = w; }
    else if ((v = memKeyValue(l, 'tags', true)) !== null) {
      const inner = memInlineList(v);
      if (inner !== null) tags = tags.concat(inner.split(',').map((x) => memvUnquote(x)));
      else if (v === '' && !isBlockScalar(l.trimStart().slice(5).trim())) inTags = true;
    }
  }
  const seen = new Set(); const cleanTags = [];
  for (const t of tags) {
    const c = memvLine(t, 40);
    if (MEMV_TAG_RE.test(c) && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); cleanTags.push(c); }
    if (cleanTags.length >= MEMV_TAGS_MAX) break;
  }
  const raw = lines.slice(end + 1, end + 1 + MEMV_BODY_LINES_MAX * 4).join('\n');
  const links = [];
  for (const m of raw.matchAll(/\[\[([^\[\]\n|#]{1,80}?)\s*(?:[|#][^\[\]\n]*)?\]\]/g)) {
    const t = m[1].trim().toLowerCase();
    if (t && !links.includes(t)) links.push(t);
    if (links.length >= MEMV_LINKS_MAX) break;
  }
  const mod = Number.isFinite(modifiedMs) && modifiedMs > 0 ? Math.floor(modifiedMs) : 0;
  return { slug, name: memvLine(name, MEMV_NAME_MAX) || slug, description: memvLine(desc, MEMV_DESC_MAX), titles, descs, type: type || 'reference', tags: cleanTags, body: memvBody(raw), links, modified: mod };
}
// 파싱된 파일들 -> 화면용 목록. 링크는 main 이 가진 목록(slug, 없으면 이름)으로만 해석한다: 없는 대상·자기 자신·중복은 버린다.
// id 는 main 이 매긴 것('m0', 'm1', ...)이고 화면은 이것으로만 기억을 가리킨다.
function buildMemoryModel(files) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.slug === 'string').slice(0, MEMV_FILES_MAX);
  const bySlug = new Map(); const byName = new Map();
  list.forEach((f, i) => { if (!bySlug.has(f.slug)) bySlug.set(f.slug, i); const k = String(f.name).toLowerCase(); if (!byName.has(k)) byName.set(k, i); });
  const outs = list.map((f, i) => {
    const o = [];
    for (const t of Array.isArray(f.links) ? f.links : []) {
      const j = bySlug.has(t) ? bySlug.get(t) : byName.get(t);
      if (j !== undefined && j !== i && !o.includes(j)) o.push(j);
    }
    return o;
  });
  const ins = list.map(() => []);
  outs.forEach((o, i) => o.forEach((j) => ins[j].push(i)));
  return list.map((f, i) => ({
    id: 'm' + i, slug: f.slug, name: f.name, description: f.description, titles: { ko: (f.titles && f.titles.ko) || '', en: (f.titles && f.titles.en) || '' }, descs: { ko: (f.descs && f.descs.ko) || '', en: (f.descs && f.descs.en) || '' }, type: f.type, tags: f.tags.slice(), body: f.body, modified: f.modified,
    out: outs[i].map((j) => 'm' + j), in: ins[i].map((j) => 'm' + j),
  }));
}
const memvYield = () => new Promise((r) => setImmediate(r)); // 파일 사이에 main 의 다른 일(입력·IPC)이 끼어들 틈을 준다
// 읽기 전용 파일 읽기(비동기). 일반 파일만(심볼릭 링크·FIFO 거부), 하드링크(nlink !== 1)는 거부. 한도보다 크면 truncated.
async function memvReadFile(file, maxBytes) {
  const fsp = require('fs').promises; const C = require('fs').constants;
  let fh = null;
  try {
    fh = await fsp.open(file, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
    const st = await fh.stat();
    if (!st.isFile() || st.nlink !== 1) return null;
    if (st.size > maxBytes) return { text: '', size: st.size, mtimeMs: st.mtimeMs, truncated: true };
    const buf = Buffer.alloc(st.size);
    const { bytesRead } = await fh.read(buf, 0, st.size, 0);
    return { text: buf.toString('utf8', 0, bytesRead), size: st.size, mtimeMs: st.mtimeMs, truncated: false };
  } catch { return null; } finally { if (fh) try { await fh.close(); } catch { /* 무시 */ } }
}
// <기억 폴더>/*.md(MEMORY.md 제외) 전체 -> Promise<{ items, skipped }> (거부하지 않는다).
// 폴더나 그 위 프로젝트 폴더가 링크이면 비운다. 개수·크기·합계 상한을 넘는 파일, 링크·하드링크·특수 파일은 건너뜀으로 센다.
// 폴더는 MEMV_DIR_SCAN_MAX 개까지만 훑고(넘으면 건너뜀 1 추가), .md 인데 이름 규칙에 안 맞는 것도 건너뜀으로 센다.
// limits 는 시험용(files, fileBytes, totalBytes, scanMax).
async function readMemoryFiles(memDir, limits) {
  const fs = require('fs'); const fsp = fs.promises; const path = require('path');
  const lim = { files: MEMV_FILES_MAX, fileBytes: MEMV_FILE_MAX_BYTES, totalBytes: MEMV_TOTAL_MAX_BYTES, scanMax: MEMV_DIR_SCAN_MAX, ...(limits || {}) };
  const empty = { items: [], skipped: 0 };
  const names = []; let skipped = 0;
  try {
    const st = await fsp.lstat(memDir); if (!st.isDirectory() || st.isSymbolicLink()) return empty;
    if ((await fsp.lstat(path.dirname(memDir))).isSymbolicLink()) return empty;
    const dir = await fsp.opendir(memDir);
    let scanned = 0;
    try {
      for await (const ent of dir) {
        if (++scanned > lim.scanMax) { skipped++; break; }
        const n = ent.name;
        if (n === 'MEMORY.md') continue;
        if (MEM_FILE_RE.test(n)) names.push(n); else if (n.endsWith('.md')) skipped++;
      }
    } finally { try { await dir.close(); } catch { /* 이미 닫힘 */ } }
  } catch { return empty; }
  const files = []; let total = 0;
  for (const n of names.sort()) {
    if (files.length >= lim.files) { skipped++; continue; }
    await memvYield();
    const p = path.join(memDir, n);
    let st; try { st = await fsp.lstat(p); } catch { continue; }
    if (!st.isFile() || st.nlink !== 1 || st.size > lim.fileBytes || total + st.size > lim.totalBytes) { skipped++; continue; } // 링크·하드링크·특수 파일·큰 파일
    const r = await memvReadFile(p, lim.fileBytes);
    if (!r || r.truncated) { skipped++; continue; }
    const f = parseMemoryFile(r.text, n.slice(0, -3), r.mtimeMs);
    if (!f) { skipped++; continue; }
    total += r.size; files.push(f);
  }
  return { items: buildMemoryModel(files), skipped };
}
// 그래프 선: 링크 선(양방향이어도 하나) -> '같은 태그' 선(멤버 2~8개인 태그만, 사슬로 잇는다). 같은 쌍은 한 번만, 전체 상한을 넘기지 않는다.
// items: buildMemoryModel 결과. 반환 [{ a, b, kind: 'link'|'tag', tag? }] (a, b 는 items 의 위치, a < b)
function buildMemoryGraph(items, opts) {
  const o = { tagMembersMax: MEMV_TAG_EDGE_MEMBERS_MAX, tagEdgesMax: MEMV_TAG_EDGES_MAX, edgesMax: MEMV_EDGES_MAX, ...(opts || {}) };
  const list = Array.isArray(items) ? items : [];
  const idx = new Map(list.map((m, i) => [m.id, i]));
  const seen = new Set(); const edges = [];
  const add = (i, j, kind, tag) => {
    if (i === j || edges.length >= o.edgesMax) return false;
    const a = Math.min(i, j); const b = Math.max(i, j); const k = a * 100000 + b;
    if (seen.has(k)) return false;
    seen.add(k); edges.push(tag ? { a, b, kind, tag } : { a, b, kind }); return true;
  };
  list.forEach((m, i) => { for (const t of m.out || []) if (idx.has(t)) add(i, idx.get(t), 'link'); });
  const byTag = new Map();
  list.forEach((m, i) => { for (const t of m.tags || []) { const k = t.toLowerCase(); if (!byTag.has(k)) byTag.set(k, []); byTag.get(k).push(i); } });
  let tagEdges = 0;
  for (const [tag, members] of [...byTag.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (members.length < 2 || members.length > o.tagMembersMax) continue;
    for (let q = 1; q < members.length && tagEdges < o.tagEdgesMax; q++) if (add(members[q - 1], members[q], 'tag', tag)) tagEdges++;
  }
  return edges;
}
// 결정적 힘 기반 배치(Fruchterman-Reingold): 같은 입력이면 같은 좌표. 시드·반복 횟수 고정, 애니메이션 없음.
// 두 단계로 나눈다: simulateGraph(힘 계산, 한 번) -> 원시 좌표, fitGraph(칸 크기에 맞추기, 칸 크기가 바뀔 때마다 다시). 크기가 바뀌어도 다시 시뮬레이션하지 않는다.
// 시뮬레이션은 width x height 의 가로세로 비율을 쓴다: 처음에 타원으로 흩뿌리고, 중심으로 당기는 힘도 짧은 축 쪽이 더 세다.
function simulateGraph(n, edges, opts) {
  const o = { width: 1000, height: 700, iterations: 220, seed: 12345, ...(opts || {}) };
  const W = o.width; const H = o.height; const cx = W / 2; const cy = H / 2;
  if (!(n > 0)) return [];
  if (n === 1) return [{ x: cx, y: cy }];
  let s = o.seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const x = new Float64Array(n); const y = new Float64Array(n);
  const rx = W * 0.35; const ry = H * 0.35; // 타원으로 시작: 가로로 긴 칸이면 가로로 넓게
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n + (rnd() - 0.5) * 0.6; const r = 0.3 + 0.7 * rnd(); x[i] = cx + rx * r * Math.cos(a); y[i] = cy + ry * r * Math.sin(a); }
  const k = Math.sqrt((W * H) / n) * 0.7;
  const m = Math.min(W, H); const gx = 0.09 * (m / W); const gy = 0.09 * (m / H); // 비율을 맞춘 중력: 긴 축은 약하게 당긴다
  const ax = Math.sqrt(W / m); const ay = Math.sqrt(H / m); // 밀어내는 힘도 긴 축 쪽으로 더 세게: 가로로 긴 칸에서는 가로로 넓게 퍼진다
  const es = (Array.isArray(edges) ? edges : []).filter((e) => e && e.a >= 0 && e.b >= 0 && e.a < n && e.b < n && e.a !== e.b);
  const dx = new Float64Array(n); const dy = new Float64Array(n);
  for (let it = 0; it < o.iterations; it++) {
    const temp = (Math.max(W, H) / 8) * (1 - it / o.iterations) + 0.5;
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j]; let ey = y[i] - y[j]; let d2 = ex * ex + ey * ey;
        if (d2 < 0.01) { ex = ((i * 7 + j * 3) % 11) - 5.5; ey = ((i * 5 + j * 13) % 9) - 4.5; d2 = ex * ex + ey * ey + 0.01; } // 겹친 두 점은 정해진 방향으로 밀어낸다
        const d = Math.sqrt(d2); const f = (k * k) / d / d;
        dx[i] += ex * f * ax; dy[i] += ey * f * ay; dx[j] -= ex * f * ax; dy[j] -= ey * f * ay;
      }
    }
    for (const e of es) {
      const ex = x[e.a] - x[e.b]; const ey = y[e.a] - y[e.b]; const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      const w = e.kind === 'tag' ? 0.35 : 1; const f = (d / k) * w;
      dx[e.a] -= ex * f; dy[e.a] -= ey * f; dx[e.b] += ex * f; dy[e.b] += ey * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i] -= (x[i] - cx) * gx; dy[i] -= (y[i] - cy) * gy; // 중심으로 약하게 당겨 떨어진 점이 멀리 날아가지 않게 한다
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1; const step = Math.min(len, temp);
      x[i] += (dx[i] / len) * step; y[i] += (dy[i] / len) * step;
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) out.push(Number.isFinite(x[i]) && Number.isFinite(y[i]) ? { x: x[i], y: y[i] } : { x: cx, y: cy });
  return out;
}
const GRAPH_MAX_DISTORT = 2.5; // 가로·세로를 따로 늘릴 때 두 배율의 비가 이 값을 넘지 않게 한다
const GRAPH_FEW_SPAN = 0.5; // 노드 2~3개는 칸(안쪽 여백 제외)의 이 비율보다 넓게 퍼지지 않는다(양 끝 가장자리로 날아가지 않게)
// 원시 좌표 -> width x height 칸의 pad 안쪽에 맞춘 좌표. 가로·세로 배율을 따로 쓰되 비를 GRAPH_MAX_DISTORT 로 제한한다. 원시 좌표는 바꾸지 않는다.
function fitGraph(raw, opts) {
  const o = { width: 1000, height: 700, pad: 40, ...(opts || {}) };
  const W = o.width; const H = o.height; const cx = W / 2;
  const padT = Number.isFinite(o.padTop) ? o.padTop : o.pad; const padB = Number.isFinite(o.padBottom) ? o.padBottom : o.pad; // 위·아래는 따로 둘 수 있다(안내 글·범례 자리)
  const cy = padT + (H - padT - padB) / 2;
  const list = Array.isArray(raw) ? raw : []; const n = list.length;
  if (!n) return [];
  if (n === 1) return [{ x: cx, y: cy }];
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const p of list) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const aw = Math.max(W - 2 * o.pad, 1); const ah = Math.max(H - padT - padB, 1);
  const rw = Math.max(maxX - minX, 1e-6); const rh = Math.max(maxY - minY, 1e-6);
  let sx = Math.min(aw / rw, 1e4); let sy = Math.min(ah / rh, 1e4);
  if (n <= 3) { sx = Math.min(sx, (aw * GRAPH_FEW_SPAN) / rw); sy = Math.min(sy, (ah * GRAPH_FEW_SPAN) / rh); }
  if (sx > sy * GRAPH_MAX_DISTORT) sx = sy * GRAPH_MAX_DISTORT; else if (sy > sx * GRAPH_MAX_DISTORT) sy = sx * GRAPH_MAX_DISTORT;
  const mx = (minX + maxX) / 2; const my = (minY + maxY) / 2;
  return list.map((p) => ({ x: Math.min(W - o.pad, Math.max(o.pad, cx + (p.x - mx) * sx)), y: Math.min(H - padB, Math.max(padT, cy + (p.y - my) * sy)) }));
}
// n: 노드 수, edges: buildMemoryGraph 결과 -> [{x, y}] (모두 유한수, pad 안쪽 width x height 안)
function layoutGraph(n, edges, opts) { return fitGraph(simulateGraph(n, edges, opts), opts); }
// ---- 그래프 움직임(순수 계산: DOM 없음). memview.js 가 매 프레임 부른다 ----
const GRAPH_DRIFT_AMP = 6; // 떠다니는 폭(viewBox 단위)
const GRAPH_DT_MAX_MS = 32; // 한 프레임 계산에 쓰는 시간 상한: 탭이 멈췄다 돌아와도 터지지 않게
const GRAPH_LABEL_PX_LO = 6.5; const GRAPH_LABEL_PX_HI = 8.5; // 화면에서 글자 크기가 이 범위일 때 이름이 서서히 나타난다
// 노드별 떠다니는 오프셋: (번호, 시각)만으로 정해진다. 주기 7~13초의 사인 둘씩 섞어 부드럽고, 크기는 항상 amp 이하.
function graphDrift(i, tMs, amp) {
  const a = amp === undefined ? GRAPH_DRIFT_AMP : amp;
  const t = Number(tMs);
  if (!(a > 0) || !Number.isFinite(t)) return { x: 0, y: 0 };
  const rnd = (n) => { let h = (Math.imul((i | 0) + 1, 0x9E3779B1) ^ Math.imul(n + 1, 0x85EBCA6B)) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D) >>> 0; h = Math.imul(h ^ (h >>> 12), 0x297A2D39) >>> 0; return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
  const w = (n) => Math.sin(2 * Math.PI * (t / (7000 + 6000 * rnd(n)) + rnd(n + 10)));
  return { x: a * (0.6 * w(0) + 0.4 * w(1)), y: a * (0.6 * w(2) + 0.4 * w(3)) };
}
// 한 프레임 계산. nodes: [{x,y,vx,vy,pin}] 를 그 자리에서 고친다(pin 이면 그 자리 그대로). anchors: [{x,y}] 자리 목표, edges: buildMemoryGraph 결과.
// 힘: 자리 목표(+떠다니는 오프셋)로 당기는 용수철, 속도 감쇠, 길게 늘어난 연결 선(자리 사이 거리 + 여유 초과분)만 당기는 용수철(태그 선은 약하게).
// 선택 옵션: boxes [{hw, hh, cy?}](노드별 이름 상자의 반너비·반높이, cy 는 상자 중심이 노드 중심보다 아래로 얼마나 있는지)가 있으면 상자가 겹치는 쌍을
// 겹침이 적은 축으로 겹친 만큼(sep 배) 서로 밀어낸다(고정된 노드는 안 움직이고 상대가 두 배로 받는다). 없으면 쌍 계산을 아예 건너뛴다.
// bounds {x0, x1, y0, y1}: 노드 상자의 가로가 [x0, x1] 안에, 중심의 세로가 [y0, y1] 안에 머물게 한다(p.free 인 노드·고정 노드는 제외, 끌어 놓은 자리는 어디든 된다).
// 반환 { move }: 이번 프레임에 가장 많이 움직인 거리(0 에 가까우면 가라앉은 것)
function graphStep(nodes, anchors, edges, opts) {
  const o = { dtMs: 16, tMs: 0, amp: GRAPH_DRIFT_AMP, spring: 6, damp: 5, link: 4, tagLink: 1.5, sep: 60, repel: 0, repelRange: 400, maxAccel: 1500, maxSpeed: 2000, ...(opts || {}) };
  const dt = Math.min(Math.max(Number(o.dtMs) || 0, 0), GRAPH_DT_MAX_MS) / 1000;
  const n = Math.min(nodes.length, anchors.length);
  const fx = new Float64Array(n); const fy = new Float64Array(n);
  const slack = 2 * Math.max(0, o.amp || 0);
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!e || !(e.a >= 0 && e.b >= 0 && e.a < n && e.b < n) || e.a === e.b) continue;
    const pa = nodes[e.a]; const pb = nodes[e.b]; const d0 = Math.hypot(anchors[e.a].x - anchors[e.b].x, anchors[e.a].y - anchors[e.b].y);
    const ex = pb.x - pa.x; const ey = pb.y - pa.y; const d = Math.hypot(ex, ey);
    if (!(d > d0 + slack) || d < 1e-6) continue;
    const s = (d - d0 - slack) * (e.kind === 'tag' ? o.tagLink : o.link) / d;
    fx[e.a] += ex * s; fy[e.a] += ey * s; fx[e.b] -= ex * s; fy[e.b] -= ey * s;
  }
  const bx = Array.isArray(o.boxes) && o.boxes.length >= n ? o.boxes : null; const bd = o.bounds || null;
  if (bx) {
    let mhw = 0; let mhh = 0; let mcy = 0; for (let i = 0; i < n; i++) { mhw = Math.max(mhw, bx[i].hw); mhh = Math.max(mhh, bx[i].hh); mcy = Math.max(mcy, Math.abs(bx[i].cy || 0)); }
    const rangeX = Math.max(o.repel > 0 ? o.repelRange : 0, 2 * mhw); const rangeY = Math.max(o.repel > 0 ? o.repelRange : 0, 2 * (mhh + mcy)); // 이보다 멀리 떨어진 쌍은 겹칠 수도 밀 수도 없으니 바로 건너뛴다
    for (let i = 0; i < n; i++) {
      const pi = nodes[i]; const bi = bx[i];
      for (let j = i + 1; j < n; j++) {
        const pj = nodes[j]; const bj = bx[j];
        if (pi.pin && pj.pin) continue;
        const dx = pj.x - pi.x; if (dx > rangeX || dx < -rangeX) continue;
        const dy = (pj.y + (bj.cy || 0)) - (pi.y + (bi.cy || 0)); if (dy > rangeY || dy < -rangeY) continue;
        const wi = pi.pin ? 0 : pj.pin ? 2 : 1; const wj = pj.pin ? 0 : pi.pin ? 2 : 1;
        if (o.repel > 0) { // 멀리서도 약하게 밀어 고르게 퍼뜨린다(처음 퍼뜨릴 때만 쓴다)
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < o.repelRange) { const q = o.repel / Math.max(d, 15); const ux = d > 1e-6 ? dx / d : 1; const uy = d > 1e-6 ? dy / d : 0; fx[i] -= ux * q * wi; fy[i] -= uy * q * wi; fx[j] += ux * q * wj; fy[j] += uy * q * wj; }
        }
        const ox = bi.hw + bj.hw - Math.abs(dx); if (!(ox > 0)) continue;
        const oy = bi.hh + bj.hh - Math.abs(dy); if (!(oy > 0)) continue;
        const horiz = ox < oy; const sg = (horiz ? dx : dy) >= 0 ? 1 : -1; // 겹친 두 중심은 번호 순서로 정해진 쪽으로 민다
        const f = o.sep * (horiz ? ox : oy) * sg;
        if (horiz) { fx[i] -= f * wi; fx[j] += f * wj; } else { fy[i] -= f * wi; fy[j] += f * wj; }
      }
    }
  }
  const lim = (i, p) => { // 노드 i 의 가로·세로 허용 범위(칸이 상자보다 좁으면 가운데)
    if (!bd || p.free) return null;
    const hw = bx ? bx[i].hw : 0; let lx = bd.x0 + hw; let hx = bd.x1 - hw; if (lx > hx) lx = hx = (bd.x0 + bd.x1) / 2;
    let ly = bd.y0; let hy = bd.y1; if (ly > hy) ly = hy = (ly + hy) / 2;
    return { lx, hx, ly, hy };
  };
  let move = 0;
  for (let i = 0; i < n; i++) {
    const p = nodes[i];
    if (p.pin) { p.vx = 0; p.vy = 0; continue; }
    const dr = graphDrift(i, o.tMs, o.amp); const an = anchors[i]; const lm = lim(i, p);
    let tx = an.x + dr.x; let ty = an.y + dr.y;
    if (lm) { tx = Math.min(lm.hx, Math.max(lm.lx, tx)); ty = Math.min(lm.hy, Math.max(lm.ly, ty)); } // 목표도 안쪽으로: 벽과 용수철이 맞서지 않게
    let ax = o.spring * (tx - p.x) - o.damp * p.vx + fx[i]; let ay = o.spring * (ty - p.y) - o.damp * p.vy + fy[i];
    const am = Math.sqrt(ax * ax + ay * ay); if (am > o.maxAccel) { ax *= o.maxAccel / am; ay *= o.maxAccel / am; } // 가속도 상한: 같은 자리에 겹친 노드가 많아도 날뛰지 않는다
    p.vx += ax * dt; p.vy += ay * dt;
    const sp = Math.hypot(p.vx, p.vy); if (sp > o.maxSpeed) { p.vx *= o.maxSpeed / sp; p.vy *= o.maxSpeed / sp; }
    let nx = p.x + p.vx * dt; let ny = p.y + p.vy * dt;
    if (!(Number.isFinite(nx) && Number.isFinite(ny))) { p.x = an.x; p.y = an.y; p.vx = 0; p.vy = 0; continue; }
    if (lm) { const cx2 = Math.min(lm.hx, Math.max(lm.lx, nx)); const cy2 = Math.min(lm.hy, Math.max(lm.ly, ny)); if (cx2 !== nx) p.vx = 0; if (cy2 !== ny) p.vy = 0; nx = cx2; ny = cy2; }
    move = Math.max(move, Math.hypot(nx - p.x, ny - p.y)); p.x = nx; p.y = ny;
  }
  return { move };
}
// 처음 자리 퍼뜨리기: 이름 상자가 겹치지 않고 칸 안을 고르게 쓰도록, 자리 목표를 약하게 두고 미리 돌려 가라앉은 자리를 돌려준다(새 자리 목표로 쓴다).
// anchors 는 맞춘 자리, 연결 선은 맞춘 거리를 기준으로 약하게 붙들고, pinned(Set)는 제자리에 둔다. 같은 입력이면 같은 결과.
function graphSettle(anchors, edges, boxes, bounds, opts) {
  const n0 = anchors.length; // 노드가 많으면 반복을 줄이고(240 -> 60) 밀어내는 범위도 좁힌다: 크기를 바꾸는 중에도 멈추지 않게
  const o = { iterations: Math.round(240 - Math.min(1, Math.max(0, (n0 - 60) / 440)) * 180), repelRange: n0 <= 100 ? 400 : 260, spring: 0.8, damp: 6, link: 1, tagLink: 0.4, sep: 60, repel: 3000, pinned: null, ...(opts || {}) };
  const nodes = anchors.map((a, i) => ({ x: a.x, y: a.y, vx: 0, vy: 0, pin: !!(o.pinned && o.pinned.has(i)) }));
  for (let it = 0; it < o.iterations; it++) graphStep(nodes, anchors, edges, { dtMs: GRAPH_DT_MAX_MS, tMs: 0, amp: 0, boxes, bounds, spring: o.spring, damp: o.damp, link: o.link, tagLink: o.tagLink, sep: o.sep, repel: o.repel, repelRange: o.repelRange });
  return nodes.map((p) => ({ x: p.x, y: p.y }));
}
// 이름을 보이는 노드 수: 40개 이하는 모두, 그보다 많으면 확대 배율 k 에 따라 40*k^2 개(전부가 될 때까지). 순서는 graphLabelOrder.
const GRAPH_LABEL_ALL_MAX = 40;
function graphLabelCount(n, k) {
  if (!(n > 0)) return 0; if (n <= GRAPH_LABEL_ALL_MAX) return n;
  const v = Number(k); return Math.min(n, Math.max(1, Math.ceil(GRAPH_LABEL_ALL_MAX * (v > 0 ? v * v : 0))));
}
// 연결이 많은 순(같으면 번호 순)으로 노드 번호를 늘어놓는다
function graphLabelOrder(deg) { return deg.map((d, i) => i).sort((a, b) => (deg[b] - deg[a]) || (a - b)); }
// 이름 글자의 투명도(0~1): 화면에서 글자 크기(px)가 lo 이하면 0, hi 이상이면 1, 사이는 부드럽게
function graphLabelOpacity(px, lo, hi) {
  const a = lo === undefined ? GRAPH_LABEL_PX_LO : lo; const b = hi === undefined ? GRAPH_LABEL_PX_HI : hi;
  const v = Number(px); if (!(v > a)) return 0; if (v >= b) return 1;
  const t = (v - a) / (b - a); return t * t * (3 - 2 * t);
}
// 보는 위치(확대·이동)를 목표로 지수 평활로 다가간다. 선형이라 확대 중에도 커서 아래 점이 그대로 있다. -> { k, tx, ty, done }
function graphEaseView(cur, tgt, dtMs, tauMs) {
  const tau = tauMs > 0 ? tauMs : 70; const dt = Math.min(Math.max(Number(dtMs) || 0, 0), GRAPH_DT_MAX_MS * 4);
  const a = 1 - Math.exp(-dt / tau);
  const k = cur.k + (tgt.k - cur.k) * a; const tx = cur.tx + (tgt.tx - cur.tx) * a; const ty = cur.ty + (tgt.ty - cur.ty) * a;
  if (Math.abs(tgt.k - k) < 0.0005 && Math.abs(tgt.tx - tx) < 0.05 && Math.abs(tgt.ty - ty) < 0.05) return { k: tgt.k, tx: tgt.tx, ty: tgt.ty, done: true };
  return { k, tx, ty, done: false };
}
// 검색: 이름·설명·태그·본문에서 대소문자 무시 부분 일치. 빈 검색어는 전부. -> 일치한 항목의 id 배열(원래 순서)
// texts: memorySearchText 를 미리 계산해 둔 배열(items 와 같은 순서). 주면 글자를 다시 이어 붙이지 않는다.
// 화면에 보일 제목·설명(언어 lang = 'ko'|'en'): 제목은 title_<언어> > 다른 언어 > 이름(slug), 설명은 description_<언어> > 최상위 설명 > 다른 언어
function memoryDisplay(item, lang) {
  const m = item || {}; const l = lang === 'en' ? 'en' : 'ko'; const o = l === 'en' ? 'ko' : 'en';
  const t = m.titles || {}; const d = m.descs || {};
  return { title: t[l] || t[o] || m.name || m.slug || '', description: d[l] || m.description || d[o] || '' };
}
// 검색 글자: 이름·slug·제목(두 언어)·설명(두 언어)·태그·본문
const memorySearchText = (m) => (m.name + '\n' + (m.slug || '') + '\n' + (m.titles ? m.titles.ko + ' ' + m.titles.en : '') + '\n' + m.description + '\n' + (m.descs ? m.descs.ko + ' ' + m.descs.en : '') + '\n' + (m.tags || []).join(' ') + '\n' + m.body).toLowerCase();
function filterMemories(items, query, tag, texts) {
  const q = typeof query === 'string' ? memvCut(query.trim().toLowerCase(), MEMV_QUERY_MAX) : '';
  const tg = typeof tag === 'string' && tag ? tag.toLowerCase() : '';
  const out = [];
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (tg && !(m.tags || []).some((x) => x.toLowerCase() === tg)) continue;
    if (q && !(Array.isArray(texts) && typeof texts[i] === 'string' ? texts[i] : memorySearchText(m)).includes(q)) continue;
    out.push(m.id);
  }
  return out;
}

// 그 프로젝트(또는 분류 안 됨 묶음)에 속한 남은 일 -> [{ item, idx }] (idx = todos 배열 안의 위치)
function projectOpenTodos({ summary, registry, state, todos }) {
  const st = state || {};
  const regKeys = new Set((registry || []).map((r) => r.key));
  const ownerOf = (key) => { const r = projectRoot(st, key); return regKeys.has(r) ? r : (regKeys.has(key) ? key : null); };
  const mineTodo = (t) => (summary.kind === 'project'
    ? !!t.project && ownerOf(t.project) === summary.key
    : t.tag === summary.tag && !(t.project && ownerOf(t.project)));
  const out = [];
  (Array.isArray(todos) ? todos : []).forEach((t, idx) => { if (mineTodo(t)) out.push({ item: t, idx }); });
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
  const open = projectOpenTodos({ summary, registry, state, todos }).map(({ item: t, idx }) => ({ title: t.title, importance: t.importance, idx, shown: todoKey(t), markable: todoMarkable(t) })).sort((a, b) => b.importance - a.importance || a.idx - b.idx);
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
const WS_STATES = ['busy', 'waiting', 'idle', 'none', 'pending', 'exited', 'unavailable', 'unknown', 'turnEnded'];
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
    if (m) r.push(m[1].trim().slice(0, 100));
  }
  r.pop(); // 마지막 머리글은 끝 표시(언어와 무관하게 항상 마지막)
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
const CAL_PRE = [
  'on p2(n)', 'return text -2 thru -1 of ("0" & (n as text))', 'end p2',
  'on clean(s)', 'set AppleScript\'s text item delimiters to {(ASCII character 30), (ASCII character 31)}', 'set parts to text items of s',
  'set AppleScript\'s text item delimiters to ""', 'return parts as text', 'end clean',
  'on fmt(d)', 'return ((year of d) as text) & "-" & my p2(month of d as integer) & "-" & my p2(day of d)', 'end fmt',
  'set RS to (ASCII character 30)', 'set US to (ASCII character 31)', 'set out to ""',
];
const CAL_TAIL = [
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
const CAL_SCRIPT = [...CAL_PRE, 'set d0 to current date', 'set time of d0 to 0', 'set d1 to d0 + (2 * days)', ...CAL_TAIL];
// 한 달 읽기용 고정 스크립트: 연·월(검증된 정수)만 바뀌는 부분이고 숫자 리터럴로만 들어간다. 로케일과 무관하게 1일로 먼저 맞춘 뒤 연·월을 바꾼다.
// 날짜 설정 줄만 따로 돌려준다(시험에서 Calendar 부분 없이 실행할 수 있게). d1 은 `copy` 로 d0 의 사본을 만든다: `set d1 to d0` 는 같은 날짜 객체를 가리켜 d1 을 바꾸면 d0 도 바뀐다.
// 날짜 변수 v 를 y-m-d 0시로 만드는 줄들. 정오에서 출발해 날짜를 옮긴 뒤 0시로 맞춘다(실행 시각과 무관하게 같은 결과).
// 자정에 서머타임이 시작돼 0시가 없는 날은 전날 23시로 가므로, 그때만 1시간을 더해 그 날의 첫 시각으로 맞춘다.
function calDateLines(v, y, m, d) {
  return ['set time of ' + v + ' to 43200', 'set day of ' + v + ' to 1', 'set year of ' + v + ' to ' + y, 'set month of ' + v + ' to ' + m, 'set day of ' + v + ' to ' + d,
    'set time of ' + v + ' to 0', 'if (hours of ' + v + ') is not 0 then set ' + v + ' to ' + v + ' + (1 * hours)'];
}
function calMonthDateSetup(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  const ny = month === 12 ? year + 1 : year; const nm = month === 12 ? 1 : month + 1;
  return ['set d0 to current date', ...calDateLines('d0', year, month, 1), 'copy d0 to d1', ...calDateLines('d1', ny, nm, 1)];
}
function calMonthScript(year, month) {
  const setup = calMonthDateSetup(year, month);
  if (!setup) return null;
  return [...CAL_PRE, ...setup, ...CAL_TAIL];
}
const CAL_MAX_EVENTS = 8;
const CAL_TITLE_MAX = 60;
const CAL_MAX_BYTES = 256 * 1024;
const CAL_MONTH_MAX_BYTES = 512 * 1024;
const CAL_DAY_MAX_EVENTS = 12; // 하루 최대
const CAL_MONTH_MAX_EVENTS = 400; // 한 달 최대
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

// 한 달 읽기 출력 -> { 'YYYY-MM-DD': [{allDay, time, title}] } (그 달 안의 날만; 하루 12개·한 달 400개 상한, 날짜별 종일 먼저·시각순). 형식이 틀린 레코드는 버린다.
function parseCalendarMonth(text, year, month) {
  const out = {};
  const ym = Number.isInteger(year) && Number.isInteger(month) ? String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') : null;
  if (!ym || !parseYm(ym) || typeof text !== 'string' || text.length > CAL_MONTH_MAX_BYTES) return out;
  const seen = new Set();
  for (const rec of text.split('\x1e')) {
    const f = rec.replace(/^[\r\n]+/, '').split('\x1f');
    if (f.length !== 4) continue;
    const [date, time, flag, rawTitle] = f;
    if (!date.startsWith(ym + '-') || !validDay(date) || (flag !== '0' && flag !== '1')) continue;
    const allDay = flag === '1';
    if (allDay ? time !== '' : !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    const title = [...cleanQuestText(rawTitle)].slice(0, CAL_TITLE_MAX).join('').trim();
    if (!title) continue;
    const key = date + '|' + time + '|' + title;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!hasOwn(out, date)) out[date] = [];
    out[date].push({ allDay, time, title });
  }
  let total = 0;
  for (const d of Object.keys(out).sort()) {
    out[d].sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || (a.time < b.time ? -1 : a.time > b.time ? 1 : (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)));
    out[d] = out[d].slice(0, CAL_DAY_MAX_EVENTS);
    if (total + out[d].length > CAL_MONTH_MAX_EVENTS) { out[d] = out[d].slice(0, CAL_MONTH_MAX_EVENTS - total); }
    total += out[d].length;
    if (!out[d].length) delete out[d];
  }
  return out;
}

// ---- 하루 상세 읽기(하루 보기를 열었을 때만, 켜져 있을 때만) ----
// 출력: 이벤트마다 <시작 날짜>US<시작 시각|빈 값>US<종일 1|0>US<제목>US<끝 날짜>US<끝 시각|빈 값>US<캘린더 이름>US<장소>US<메모>RS. 시작 날짜·시각은 실제 값 그대로다(앞선 날에 시작한 일정을 이 날 0시로 당기지 않는다:
// 파서가 그 날에 시작하지 않은 것을 버려 달 목록과 같은 일정만 남는다). 모든 글 필드는 먼저 길이를 자르고(제목 200·장소 400·캘린더 이름 200·메모 2000자) clean 이 RS/US 를 제거한다.
// 장소·메모는 missing value 일 수 있어 try 로 읽고 비면 "". 종일 일정의 끝은 배타적(다음 날 0시)이라 1초를 뺀다. 날짜 설정 줄은 숫자 리터럴(검증된 정수)만 들어간다.
const CAL_DAY_TAIL = [
  'tell application "Calendar"',
  'repeat with c in calendars', 'try',
  'set cn to ""', 'try', 'set cn to (name of c) as text', 'if (count of cn) > 200 then set cn to text 1 thru 200 of cn', 'set cn to my clean(cn)', 'end try',
  'set evs to (every event of c whose start date < d1 and end date > d0)',
  'repeat with e in evs', 'try',
  'set sd to start date of e', 'set ed to end date of e', 'set ad to allday event of e', 'set ttl to (summary of e) as text', 'if (count of ttl) > 200 then set ttl to text 1 thru 200 of ttl', 'set ttl to my clean(ttl)',
  'if ad is true then set ed to ed - 1',
  'set lc to ""', 'try', 'set rl to location of e', 'if rl is not missing value then', 'set rl to rl as text', 'if (count of rl) > 400 then set rl to text 1 thru 400 of rl', 'set lc to my clean(rl)', 'end if', 'end try',
  'set nt to ""', 'try', 'set rn to description of e', 'if rn is not missing value then', 'set rn to rn as text', 'if (count of rn) > 2000 then set rn to text 1 thru 2000 of rn', 'set nt to my clean(rn)', 'end if', 'end try',
  'set tm to ""', 'set etm to ""', 'set fl to "1"',
  'if ad is false then', 'set tm to (my p2(hours of sd)) & ":" & (my p2(minutes of sd))', 'set etm to (my p2(hours of ed)) & ":" & (my p2(minutes of ed))', 'set fl to "0"', 'end if',
  'set out to out & (my fmt(sd)) & US & tm & US & fl & US & ttl & US & (my fmt(ed)) & US & etm & US & cn & US & lc & US & nt & RS',
  'end try', 'end repeat', 'end try', 'end repeat',
  'end tell', 'return out',
];
// 하루: d0 = 그 날 0시, d1 = 다음 날 0시. 다음 날짜(연·월·일)는 JS 에서 계산해 d1 에 그대로 넣는다(36시간을 더하는 방식은 자정에 서머타임이 바뀌는 시간대에서 하루가 어긋난다).
// d1 은 먼저 정오로 옮긴 뒤 날짜를 바꾼다(0시인 채로 0시가 없는 날로 옮기면 전날로 밀려 하루가 어긋난다). 그런 시간대(예: America/Santiago·Havana)는 0시가 없어 `set time to 0` 이 전날 23시로 가므로, 일이 기대와 다르면 1시간을 더한다. 날짜 설정 줄만 따로 돌려준다(시험에서 Calendar 없이 실행).
// 월을 바꾸기 전에 1일로 먼저 맞추고 마지막에 일을 정한다.
function calDayDateSetup(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  if (!validDay(String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'))) return null;
  const nx = new Date(Date.UTC(year, month - 1, day + 1));
  return ['set d0 to current date', ...calDateLines('d0', year, month, day), 'copy d0 to d1', ...calDateLines('d1', nx.getUTCFullYear(), nx.getUTCMonth() + 1, nx.getUTCDate())];
}
function calDayScript(year, month, day) {
  const setup = calDayDateSetup(year, month, day);
  if (!setup) return null;
  return [...CAL_PRE, ...setup, ...CAL_DAY_TAIL];
}
const CAL_DAY_DETAIL_MAX_EVENTS = 30; const CAL_DAY_MERGE_MAX = 4;
const CAL_DAY_DETAIL_MAX_BYTES = 512 * 1024;
// ---- 하루 읽기 큐 결정(main 이 쓰는 순수 함수) ----
const CAL_DAY_FRESH_MS = 6000; // 큐에서 차례가 왔을 때 이 시간 안에 요청된 날만 읽는다(열린 날은 5초마다 다시 묻는다)
const CAL_DAY_KEEP_FAILS = 2; const CAL_DAY_KEEP_MS = 15 * 60 * 1000; // 다시 읽기가 실패해도 이전 상세는 연속 2번·15분까지만 남긴다
// 차례가 온 작업을 건너뛸지: 마지막 요청이 너무 오래됐으면(사용자가 이미 떠난 날) true
const calDayJobStale = (reqAt, now) => !Number.isFinite(reqAt) || now - reqAt > CAL_DAY_FRESH_MS;
// 캐시가 가득 찼을 때 버릴 항목: 쉬는 것 중 가장 오래 쓰지 않은 것, 없으면 아직 시작하지 않은 대기 작업 중 가장 오래 요청된 것, 둘 다 없으면 null(읽는 중인 것은 절대 버리지 않는다)
// entries: [[key, { busy, started, used }]]
function calDayVictim(entries) {
  let idle = null, queued = null;
  for (const [k, v] of entries) {
    if (!v.busy) { if (!idle || v.used < idle[1]) idle = [k, v.used]; }
    else if (!v.started) { if (!queued || v.used < queued[1]) queued = [k, v.used]; }
  }
  return idle ? idle[0] : queued ? queued[0] : null;
}
// 다시 읽기가 실패한 뒤의 상태: 이전에 읽은 상세(ok)는 연속 실패가 2번 이하이고 마지막 성공이 15분 안일 때만 유지한다. c: { state, fails(이번 실패 포함), okAt }
function calDayAfterFail(c, now) {
  return c.state === 'ok' && c.fails <= CAL_DAY_KEEP_FAILS && now - c.okAt <= CAL_DAY_KEEP_MS ? 'ok' : 'fail';
}
const CAL_NAME_MAX = 80; const CAL_LOC_MAX = 200; const CAL_NOTES_MAX = 600; const CAL_NOTES_LINES = 20;
const calOneLine = (s, max) => [...(typeof s === 'string' ? s.replace(/[\r\n]+/g, ' ').replace(BAD_CHARS_G, '') : '').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
function calNotes(s) {
  if (typeof s !== 'string') return '';
  const lines = s.replace(/\r\n?/g, '\n').replace(/[^\S\n]+$/gm, '').split('\n').map((x) => x.replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, '').replace(BAD_CHARS_G, ''));
  let cut = lines.length > CAL_NOTES_LINES;
  let t = lines.slice(0, CAL_NOTES_LINES).join('\n').trim();
  const cp = [...t];
  if (cp.length > CAL_NOTES_MAX) { t = cp.slice(0, CAL_NOTES_MAX).join('').trimEnd(); cut = true; }
  return t && cut ? t + '…' : t;
}
// 하루 상세 출력 -> [{allDay, time, title, endDay, endTime, cal, loc, notes, more?}] (그 날에 시작하는 것만; 종일 먼저·시각순; 최대 30개). endDay 는 끝이 더 뒤 날일 때만 'YYYY-MM-DD', 아니면 ''.
// 같은 시각·같은 제목은 한 행으로 합쳐 달 목록과 같은 수를 유지하고, 다른 캘린더의 상세(끝·캘린더·장소·메모)는 more 에 모은다(첫 블록 포함 최대 4개, 완전히 같은 블록은 버림).
// 입력이 문자열이 아니거나 상한을 넘거나 날짜 인자가 잘못이면 null(읽기 실패)이고, 정상인데 일정이 없으면 []다.
function parseCalendarDay(text, year, month, day) {
  const ds = Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) ? String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') : null;
  if (!ds || year < 2000 || year > 2100 || !validDay(ds) || typeof text !== 'string' || text.length > CAL_DAY_DETAIL_MAX_BYTES) return null;
  const timeOk = (x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
  const seen = new Map(); const out = [];
  for (const rec of text.split('\x1e')) {
    const f = rec.replace(/^[\r\n]+/, '').split('\x1f');
    if (f.length !== 9) continue;
    const [date, time, flag, rawTitle, endDate, endTime, rawCal, rawLoc, rawNotes] = f;
    if (date !== ds || !validDay(endDate) || (flag !== '0' && flag !== '1')) continue;
    const allDay = flag === '1';
    if (allDay ? time !== '' || endTime !== '' : !timeOk(time) || !timeOk(endTime)) continue;
    const title = [...cleanQuestText(rawTitle)].slice(0, CAL_TITLE_MAX).join('').trim();
    if (!title) continue;
    const key = time + '|' + title;
    const blk = { endDay: endDate > ds ? endDate : '', endTime, cal: calOneLine(rawCal, CAL_NAME_MAX), loc: calOneLine(rawLoc, CAL_LOC_MAX), notes: calNotes(rawNotes) };
    const prev = seen.get(key);
    if (prev) { // 같은 일정이 다른 캘린더에도 있으면 한 행으로 두고 상세만 모은다
      const all = [prev, ...(prev.more || [])];
      if (all.length < CAL_DAY_MERGE_MAX && !all.some((b) => b.endDay === blk.endDay && b.endTime === blk.endTime && b.cal === blk.cal && b.loc === blk.loc && b.notes === blk.notes)) (prev.more || (prev.more = [])).push(blk);
      continue;
    }
    const ev = { allDay, time, title, ...blk }; seen.set(key, ev); out.push(ev);
  }
  out.sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || (a.time < b.time ? -1 : a.time > b.time ? 1 : (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)));
  return out.slice(0, CAL_DAY_DETAIL_MAX_EVENTS);
}

// ---- 캘린더 도우미(maru-cal, EventKit) 순수 함수 ----
// 도우미가 있으면 osascript 대신 쓴다. 인자는 검증된 정수에서만 만든다(셸 없이 execFile 의 인자 배열로 전달).
const CAL_HELPER_FIRST_MS = 70000; // 권한 창이 뜰 수 있는 첫 호출(도우미 안의 대기 상한 60초보다 길다)
const CAL_HELPER_MS = 10000; // 권한이 확인된 뒤
const CAL_OSA_MS = 90000; // 도우미가 없을 때 osascript 폴백(느린 것이 알려져 있다)
// kind: 'today' | 'month' | 'day' -> 인자 배열, 잘못이면 null
function calHelperArgs(kind, year, month, day) {
  const int = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
  if (kind === 'today') return ['today'];
  if (kind === 'month') return int(year, 2000, 2100) && int(month, 1, 12) ? ['month', String(year), String(month)] : null;
  if (kind === 'day') {
    if (!int(year, 2000, 2100) || !int(month, 1, 12) || !int(day, 1, 31)) return null;
    return validDay(String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')) ? ['day', String(year), String(month), String(day)] : null;
  }
  return null;
}
// 도우미 종료 코드 -> 'ok' | 'perm'(권한 없음) | 'fail'. null(시간 초과로 죽음 등)도 fail.
function calHelperExit(code) { return code === 0 ? 'ok' : code === 3 ? 'perm' : 'fail'; }
// `maru-cal status` 한 단어 -> 'ok' | 'denied' | 'ask'(첫 읽기 때 시스템이 묻는다) | 'unknown'
function calStatusWord(out) {
  const w = typeof out === 'string' ? out.trim() : '';
  return w === 'authorized' ? 'ok' : w === 'denied' || w === 'restricted' ? 'denied' : w === 'notDetermined' ? 'ask' : 'unknown';
}
// 읽기 방식 선택: 패키징된 앱이거나 소스 실행 + 개발용 옵트인(devOptIn)일 때만, 도우미가 일반 파일(심볼릭 링크 아님)·실행 가능·소유자 확인(owned)이고 (패키징 시) 앱 Resources 안에 있으면 'helper', 아니면 'osascript'.
// i = { helper: 경로, isFile, executable, owned, packaged, devOptIn, realHelper, realResources }
function calChooseReader(i) {
  if (!i || typeof i.helper !== 'string' || !i.helper || i.isFile !== true || i.executable !== true || i.owned !== true) return 'osascript';
  if (!i.packaged && i.devOptIn !== true) return 'osascript';
  if (i.packaged && !pathInside(i.realHelper, i.realResources)) return 'osascript';
  return 'helper';
}

// ---- 알림과 승인함(inbox) ----
// 제안 폴더·파일(이름과 내용)과 로그는 모두 믿지 않는다: main 이 직접 훑고(엄격한 slug·lstat·일반 파일만·크기/개수 상한), 화면에는 정리한 문자열만 보낸다.
const INBOX_NOTIF_MAX = 8;
const PROPOSAL_KINDS = ['squad', 'skill'];
const PROPOSAL_SLUG_RE = { squad: /^[a-z0-9][a-z0-9-]{0,19}$/, skill: /^[a-z0-9][a-z0-9-]{0,40}$/ }; // squads.py SLUG_RE / reflect.sh 스킬 이름 규칙과 같다
const PROPOSAL_SCAN_MAX = 40;        // 제안 폴더(종류별)에서 훑는 항목 수
const PROPOSAL_LIST_MAX = 12;        // 종류별로 화면에 올리는 제안 수
const PROPOSAL_FILE_MAX = 16384;     // 파일 하나(스쿼드 파일 상한과 같다)
const PROPOSAL_SKILL_FILE_MAX = 65536; // SKILL.md 는 더 크게 허용(reflect.sh 는 100KB 까지 받는다. 화면에는 앞부분만)
const PROPOSAL_TOTAL_MAX = 131072;   // 한 제안에서 읽는 합계
const PROPOSAL_FILES_MAX = 16;       // 한 제안에서 보는 파일 수
const PROPOSAL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/;
const INBOX_SEEN_MAX_BYTES = 512;
const LOG_AT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function validProposalSlug(kind, slug) {
  return typeof slug === 'string' && PROPOSAL_KINDS.includes(kind) && PROPOSAL_SLUG_RE[kind].test(slug);
}
// 한 줄 표시용: 공백 정리 + 제어·bidi·보이지 않는 문자 제거 + 코드포인트 상한
function cleanDisplay(s, max) {
  if (typeof s !== 'string') return '';
  return [...s.replace(/\s+/g, ' ').replace(BAD_CHARS_G, '').trim()].slice(0, max).join('');
}
// 여러 줄 본문 표시용: 줄바꿈은 살리고 나머지 제어·서식 문자는 제거, 코드포인트 상한. 잘렸는지는 호출 쪽이 크기로 안다.
function cleanProposalText(s, max) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n').map((l) => l.replace(BAD_CHARS_G, '')).join('\n');
  return [...t].slice(0, max).join('').replace(/\n{3,}/g, '\n\n').trimEnd();
}
// SKILL.md·squad.md 머리말(--- 사이)의 name·description 한 줄 값만. 그 밖의 형식(접은 문단 등)은 ''.
function proposalMeta(text) {
  const out = { name: '', description: '' };
  if (typeof text !== 'string') return out;
  const head = text.slice(0, 4096).replace(/\r\n?/g, '\n');
  if (!head.startsWith('---\n')) return out;
  const end = head.indexOf('\n---', 4);
  if (end < 0) return out;
  for (const line of head.slice(4, end).split('\n')) {
    const m = /^(name|description):\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    if (/^[>|][+-]?$/.test(v)) v = '';
    out[m[1]] = cleanDisplay(v, m[1] === 'name' ? 40 : 200);
  }
  return out;
}
const dirOwnedOk = (st, uid) => !!st && st.isDirectory() && !st.isSymbolicLink() && (typeof uid !== 'number' || st.uid === uid) && (st.mode & 0o022) === 0;

// 폴더 하나의 일반 파일만 훑는다(링크·폴더·특수 파일은 건너뛰고 skipped 로 센다). read(이름) 이 true 인 파일만 내용을 읽는다.
// -> { files: [{ name, size, text?, oversize? }], skipped, overflow, sig }
function scanProposalDir(dir, { uid, read, perFile = PROPOSAL_FILE_MAX, total = PROPOSAL_TOTAL_MAX, max = PROPOSAL_FILES_MAX } = {}) {
  const fs = require('fs'); const path = require('path');
  const out = { files: [], skipped: 0, overflow: false, sig: '' };
  let names;
  try { names = fs.readdirSync(dir).sort(); } catch { return out; }
  let used = 0; const sig = [];
  for (const name of names) {
    if (out.files.length >= max) { out.overflow = true; break; }
    if (!PROPOSAL_NAME_RE.test(name)) { out.skipped++; continue; }
    let st; try { st = fs.lstatSync(path.join(dir, name)); } catch { out.skipped++; continue; }
    if (!st.isFile() || (typeof uid === 'number' && st.uid !== uid)) { out.skipped++; continue; }
    sig.push(name + ':' + st.size + ':' + Math.floor(st.mtimeMs));
    const f = { name, size: st.size };
    if (read && read(name)) {
      // oversize: 'file'(파일 하나가 너무 큼) | 'total'(합계 상한에 닿아 읽지 않음)
      if (st.size > perFile) f.oversize = 'file';
      else if (used + st.size > total) f.oversize = 'total';
      else {
        const r = readRegular(path.join(dir, name), perFile, false);
        if (r) { used += st.size; f.text = cleanProposalText(r.text, perFile); } else f.oversize = 'file';
      }
    }
    out.files.push(f);
  }
  out.sig = sig.join('|');
  return out;
}

// 제안 폴더(base) -> 목록. 폴더 이름은 slug 규칙을 통과한 것만, 링크·일반 폴더가 아닌 것·소유자가 다른 것은 건너뛴다.
// kind 'squad': { kind, slug, name, description, members, sig } / 'skill': { kind, slug, name, description, sig, invalid? }
function listProposals(kind, base, uid) {
  const fs = require('fs'); const path = require('path');
  if (!PROPOSAL_KINDS.includes(kind)) return [];
  let st; try { st = fs.lstatSync(base); } catch { return []; }
  if (!dirOwnedOk(st, uid)) return [];
  let names; try { names = fs.readdirSync(base).sort(); } catch { return []; }
  const out = [];
  for (const slug of names.slice(0, PROPOSAL_SCAN_MAX)) {
    if (out.length >= PROPOSAL_LIST_MAX) break;
    if (!validProposalSlug(kind, slug)) continue;
    const dir = path.join(base, slug);
    let ds; try { ds = fs.lstatSync(dir); } catch { continue; }
    if (!dirOwnedOk(ds, uid)) continue;
    const main = kind === 'squad' ? 'squad.md' : 'SKILL.md';
    const sc = scanProposalDir(dir, { uid, read: (n) => n === main, perFile: kind === 'squad' ? PROPOSAL_FILE_MAX : PROPOSAL_SKILL_FILE_MAX });
    const f = sc.files.find((x) => x.name === main);
    const meta = f && typeof f.text === 'string' ? proposalMeta(f.text) : { name: '', description: '' };
    if (kind === 'squad') {
      const members = sc.files.filter((x) => x.name.endsWith('.md') && x.name !== 'squad.md' && x.name !== 'lead.md').length;
      out.push({ kind, slug, name: meta.name || slug, description: meta.description, members, sig: sc.sig });
    } else {
      out.push({ kind, slug, name: meta.name || slug, description: meta.description, sig: sc.sig, ...(f && f.text !== undefined ? {} : { invalid: true }) });
    }
  }
  return out;
}

// 상세 보기(읽기 전용): 스쿼드는 squad.md·lead.md·팀원 파일(+같은 이름의 .note.txt), 스킬은 SKILL.md 와 파일 목록.
// -> { sections: [{ name, text, truncated, limit? }], files: [{ name, size }], skipped }  (이름·본문 모두 정리한 문자열)
function proposalDetail(kind, base, slug, uid) {
  const fs = require('fs'); const path = require('path');
  if (!validProposalSlug(kind, slug)) return null;
  const dir = path.join(base, slug);
  let ds; try { ds = fs.lstatSync(dir); } catch { return null; }
  if (!dirOwnedOk(ds, uid)) return null;
  const isSquad = kind === 'squad';
  const sc = scanProposalDir(dir, { uid, read: (n) => (isSquad ? n.endsWith('.md') : n === 'SKILL.md'), perFile: isSquad ? PROPOSAL_FILE_MAX : PROPOSAL_SKILL_FILE_MAX });
  const rank = (n) => (n === 'squad.md' ? 0 : n === 'lead.md' ? 1 : 2);
  const withText = sc.files.filter((f) => f.text !== undefined || f.oversize).sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : 1));
  const sections = withText.map((f) => f.oversize
    ? { name: cleanDisplay(f.name, 41), text: '', truncated: true, limit: f.oversize } // limit: 'file' | 'total'
    : { name: cleanDisplay(f.name, 41), text: f.text, truncated: false });
  if (isSquad) { // 회고가 남긴 메모(<slug>.note.txt): 같은 폴더 밖, 작은 일반 파일만
    const note = readRegular(path.join(base, slug + '.note.txt'), 2048, false);
    let nst = null; try { nst = fs.lstatSync(path.join(base, slug + '.note.txt')); } catch { /* 없음 */ }
    if (note && nst && nst.isFile() && (typeof uid !== 'number' || nst.uid === uid)) sections.push({ name: 'note.txt', text: cleanProposalText(note.text, 2048), truncated: note.truncated, ...(note.truncated ? { limit: 'file' } : {}) });
  }
  return { sections, files: sc.files.map((f) => ({ name: cleanDisplay(f.name, 41), size: f.size })), skipped: sc.skipped + (sc.overflow ? 1 : 0) };
}

// 거절(스킬): 폴더를 앱 소유 휴지 폴더로 옮긴다(rename: 한 번에 옮겨지고 링크는 따라가지 않는다). slug 는 여기서 다시 검증한다.
function trashProposalDir(base, trashBase, slug, uid, now = new Date()) {
  const fs = require('fs'); const path = require('path');
  if (!validProposalSlug('skill', slug)) return { ok: false, reason: 'invalid' };
  const dir = path.join(base, slug);
  let ds; try { ds = fs.lstatSync(dir); } catch { return { ok: false, reason: 'missing' }; }
  if (!dirOwnedOk(ds, uid)) return { ok: false, reason: 'invalid' };
  try {
    let ts = null; try { ts = fs.lstatSync(trashBase); } catch { /* 없음 */ }
    if (!ts) fs.mkdirSync(trashBase, { mode: 0o700 });
    else if (!ts.isDirectory() || ts.isSymbolicLink()) return { ok: false, reason: 'trash' };
    const stamp = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
    const exists = (q) => { try { fs.lstatSync(q); return true; } catch { return false; } };
    let dest = path.join(trashBase, slug + '-' + stamp);
    for (let i = 2; exists(dest); i++) dest = path.join(trashBase, slug + '-' + stamp + '-' + i);
    fs.renameSync(dir, dest);
    return { ok: true };
  } catch { return { ok: false, reason: 'trash' }; }
}

// 스킬 설치 요청 문장: 고정 템플릿(t 는 i18n 의 inbox.skillRequest) + 검증을 통과한 slug 뿐이다(제안 내용은 섞지 않는다). slug 가 틀리면 ''.
function skillRequestText(t, slug) {
  return validProposalSlug('skill', slug) ? String(t('inbox.skillRequest', { slug })) : '';
}

// squads.py check --json 한 줄 -> 엄격 검증한 요약(문자열은 다시 정리). 형식이 어긋나면 null. expectSlug 와 다르면 null.
const SQUAD_CHECK_MAX_BYTES = 32768;
const SQUAD_TOOLS_OK = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Agent', 'Skill', 'TodoWrite', 'NotebookEdit'];
function parseSquadCheck(text, expectSlug) {
  if (typeof text !== 'string' || text.length > SQUAD_CHECK_MAX_BYTES || !validProposalSlug('squad', expectSlug)) return null;
  let o; try { o = JSON.parse(text); } catch { return null; }
  if (!isPlainObject(o) || o.slug !== expectSlug) return null;
  if (o.ok === false) return typeof o.reason === 'string' ? { ok: false, slug: expectSlug, reason: cleanDisplay(o.reason, 200) } : null;
  if (o.ok !== true || typeof o.digest !== 'string' || !/^[0-9a-f]{64}$/.test(o.digest)) return null;
  const tools = (a) => (Array.isArray(a) && a.length <= 16 && a.every((x) => SQUAD_TOOLS_OK.includes(x)) ? [...new Set(a)] : null);
  const skills = (a) => (a === undefined ? [] : (Array.isArray(a) && a.length <= 3 && a.every((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(x)) ? [...new Set(a)] : null)); // 팀원 미리 실을 스킬(없으면 [])
  const strs = (a) => (Array.isArray(a) && a.length <= 30 && a.every((x) => typeof x === 'string') ? a.map((x) => cleanDisplay(x, 200)).filter(Boolean) : null);
  if (!isPlainObject(o.lead) || !SQUAD_MODELS.includes(o.lead.model) || !tools(o.lead.tools)) return null;
  if (!Array.isArray(o.members) || o.members.length < 1 || o.members.length > SQUAD_MEMBERS_MAX) return null;
  const members = [];
  for (const m of o.members) {
    if (!isPlainObject(m) || typeof m.role !== 'string' || !SQUAD_SLUG_RE.test(m.role) || !SQUAD_MODELS.includes(m.model) || !tools(m.tools) || !skills(m.skills)) return null;
    members.push({ role: m.role, model: m.model, tools: tools(m.tools), skills: skills(m.skills) });
  }
  const warns = strs(o.warns); const risks = strs(o.risks);
  const name = squadText(typeof o.name === 'string' ? o.name : null, SQUAD_NAME_MAX, 1); const description = squadText(typeof o.description === 'string' ? o.description : null, SQUAD_DESC_MAX, 0);
  if (!warns || !risks || name === null || description === null || typeof o.existsPersonal !== 'boolean' || typeof o.existsBuiltin !== 'boolean') return null;
  return { ok: true, slug: expectSlug, name, description, lead: { model: o.lead.model, tools: tools(o.lead.tools) }, members, warns, risks, existsPersonal: o.existsPersonal, existsBuiltin: o.existsBuiltin, digest: o.digest };
}
// 확인 창에 보일 요약: 팀원 수(총괄 제외), 모델·도구의 중복 없는 목록, 총괄·팀원별 roster
function summarizeSquadCheck(c) {
  const all = [c.lead, ...c.members];
  const roster = [{ role: 'lead', model: c.lead.model, tools: c.lead.tools }, ...c.members.map((m) => ({ role: m.role, model: m.model, tools: m.tools, skills: m.skills }))]; // 확인 창에 총괄·팀원별 도구를 그대로 보인다
  return { members: c.members.length, models: [...new Set(all.map((x) => x.model))], tools: [...new Set([].concat(...all.map((x) => x.tools)))], roster };
}

// 로그 시각 'YYYY-MM-DD HH:MM:SS'(로컬) -> 밀리초. 실제 달력에 없는 날짜(13월 등)나 형식 오류는 null.
const SEEN_FUTURE_MS = 86400000; // 지금보다 하루 넘게 앞선 시각은 믿지 않는다
function logAtMs(at) {
  if (typeof at !== 'string' || !LOG_AT_RE.test(at)) return null;
  const [y, mo, d, h, mi, se] = [+at.slice(0, 4), +at.slice(5, 7), +at.slice(8, 10), +at.slice(11, 13), +at.slice(14, 16), +at.slice(17, 19)];
  const dt = new Date(y, mo - 1, d, h, mi, se);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d || dt.getHours() !== h || dt.getMinutes() !== mi || dt.getSeconds() !== se) return null;
  const t = dt.getTime();
  return Number.isFinite(t) ? t : null;
}
// 실제 날짜이고 지금 + 1일 이내인 시각만 true
const plausibleLogAt = (at, now = Date.now()) => { const t = logAtMs(at); return t !== null && t <= now + SEEN_FUTURE_MS; };
const pad2 = (n) => String(n).padStart(2, '0');
const fmtLogAt = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());

// 본 알림 기준 시각(data/inbox-seen.json: { version: 1, seen: 'YYYY-MM-DD HH:MM:SS' | '' })
function validateInboxSeen(o, now = Date.now()) {
  if (!isPlainObject(o) || o.version !== 1 || typeof o.seen !== 'string' || (o.seen !== '' && !plausibleLogAt(o.seen, now))) return null; // 하루 넘게 미래인 값은 손상으로 본다
  if (Object.keys(o).length !== 2) return null;
  return o.seen;
}
function parseInboxSeen(res, now = Date.now()) {
  if (!res || res.truncated || typeof res.text !== 'string') return null;
  try { return validateInboxSeen(JSON.parse(res.text), now); } catch { return null; }
}
// { status: 'missing'|'corrupt'|'ok', data: 본 시각('' 이면 아무것도 안 본 것) }
function readInboxSeenFile(file, now = Date.now()) {
  const fs = require('fs');
  let present = true;
  try { fs.lstatSync(file); } catch { present = false; }
  if (!present) return { status: 'missing', data: '' };
  const d = parseInboxSeen(readRegular(file, INBOX_SEEN_MAX_BYTES, false), now);
  return d === null ? { status: 'corrupt', data: '' } : { status: 'ok', data: d };
}
function saveInboxSeen(file, seen, now = Date.now()) {
  if (validateInboxSeen({ version: 1, seen }, now) === null) return false;
  return writeJsonAtomic(file, { version: 1, seen }, 'inbox-seen');
}
// 알림 목록에 새로움 표시를 붙이고 센다. seen 보다 늦은 시각만 새것(형식이 틀린 시각은 새것이 아니다).
function markUnseen(events, seen, now = Date.now()) {
  const s = plausibleLogAt(seen, now) ? seen : '';
  const list = (Array.isArray(events) ? events : []).map((e) => ({ ...e, fresh: plausibleLogAt(e.at, now) && e.at > s }));
  return { list, unseen: list.filter((e) => e.fresh).length };
}
// 로그 시각('YYYY-MM-DD HH:MM:SS', 로컬) -> 지금까지 지난 시간 { unit: 'now'|'min'|'hour'|'day', n }. 형식이 틀리면 null. 미래 시각은 'now'.
function relativeAgo(at, now = Date.now()) {
  if (typeof at !== 'string' || !LOG_AT_RE.test(at)) return null;
  const t = logAtMs(at);
  if (t === null) return null;
  const s = Math.floor((now - t) / 1000);
  if (s < 60) return { unit: 'now', n: 0 };
  if (s < 3600) return { unit: 'min', n: Math.floor(s / 60) };
  if (s < 86400) return { unit: 'hour', n: Math.floor(s / 3600) };
  return { unit: 'day', n: Math.min(99, Math.floor(s / 86400)) };
}
// 가장 최근 알림 시각(실제 날짜가 아니거나 하루 넘게 미래인 시각은 무시)
const newestAt = (events, now = Date.now()) => (Array.isArray(events) ? events.reduce((m, e) => (plausibleLogAt(e && e.at, now) && e.at > m ? e.at : m), '') : '');
// "본 것으로" 저장할 기준: min(가장 최근 알림 시각, 지금). 미래 시각이 기준으로 박혀 이후 알림을 가리지 못하게 한다.
function seenToStore(events, now = Date.now()) {
  const at = newestAt(events, now); const cur = fmtLogAt(new Date(now));
  return at && at < cur ? at : (at ? cur : '');
}

// ================= 관리형 홈(~/.maru): 앱에 실려 온 payload 를 풀어 두는 곳 =================
// 앱이 쓰는 곳은 마커(.maru-managed)가 있는 홈뿐이다. data/ 와 .claude/settings.local.json 은 절대 건드리지 않는다.
const MANAGED_MARKER = '.maru-managed';
const SYNC_MARKER = '.maru-syncing'; // 동기화가 진행 중이라는 표시(실패하면 남아 다음 시작 때 다시 시도)
const MANAGED_MARKER_MAX = 512 * 1024;
const PAYLOAD_FILES_MAX = 3000;
const PAYLOAD_FILE_MAX_BYTES = 8 * 1024 * 1024;
const PAYLOAD_TOTAL_MAX_BYTES = 64 * 1024 * 1024;
const FIRST_MEETING_TEXT = '/first-meeting'; // 고정 문장(번역하지 않는다)
const SEG_RE = /^[A-Za-z0-9._-]{1,100}$/;
const fsOf = (io) => (io && io.fs) || require('fs');
const idOf = (st) => st.dev + ':' + st.ino;

// 매니페스트·payload 경로 검증: 모든 성분이 ASCII [A-Za-z0-9._-], '.'·'..'·빈 성분·절대경로 금지.
// 보호 경로(data/, .git, .claude/settings.local.json, 마커)는 대소문자를 가리지 않고 거부한다. 통과하면 같은 문자열, 아니면 null.
function safeManifestPath(p) {
  if (typeof p !== 'string' || !p || p.length > 300) return null;
  const parts = p.split('/');
  if (parts.length > 12) return null;
  for (const s of parts) if (!SEG_RE.test(s) || s === '.' || s === '..') return null;
  const low = p.toLowerCase(); const top = parts[0].toLowerCase();
  if (top === 'data' || top === '.git' || low === '.claude/settings.local.json') return null;
  if (parts.length === 1 && low.startsWith('.maru-')) return null;
  return p;
}

// 마커 텍스트 -> { version, lang, manifest[] } | null (manifest 는 안전한 경로만 남긴다)
function parseMarker(text) {
  if (typeof text !== 'string' || text.length > MANAGED_MARKER_MAX) return null;
  let o; try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.version !== 'string' || o.version.length > 40) return null;
  const manifest = [];
  if (Array.isArray(o.manifest)) for (const p of o.manifest.slice(0, PAYLOAD_FILES_MAX + 100)) { const s = safeManifestPath(p); if (s) manifest.push(s); }
  return { version: o.version, lang: o.lang === 'en' ? 'en' : 'ko', manifest };
}

function readMarker(home, io) {
  const fs = fsOf(io); const path = require('path');
  const f = path.join(home, MANAGED_MARKER);
  try {
    const st = fs.lstatSync(f);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MANAGED_MARKER_MAX) return null;
    return parseMarker(fs.readFileSync(f, 'utf8'));
  } catch { return null; }
}
function readSyncing(home, io) {
  try { const st = fsOf(io).lstatSync(require('path').join(home, SYNC_MARKER)); return st.isFile() && !st.isSymbolicLink(); } catch { return false; }
}

// 버전 비교(숫자 성분만, 나머지는 0). a>b 이면 1
function cmpVersion(a, b) {
  const p = (v) => String(v).split(/[.+-]/).slice(0, 4).map((x) => (/^\d{1,9}$/.test(x) ? parseInt(x, 10) : 0));
  const x = p(a); const y = p(b);
  for (let i = 0; i < 4; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function readPayloadVersion(payloadDir, io) {
  const b = readPayloadFile(require('path').join(payloadDir, 'VERSION'), io);
  const v = b ? b.toString('utf8').trim().slice(0, 40) : '';
  return /^[0-9A-Za-z._+-]{1,40}$/.test(v) ? v : null;
}

// payload 폴더 훑기: 일반 파일·폴더만. 심볼릭 링크·특수 파일이 하나라도 있으면 거부. -> { ok, files:[{rel, abs, exec}] } | { ok:false, reason }
function scanPayload(payloadDir, io) {
  const fs = fsOf(io); const path = require('path');
  const files = []; let total = 0;
  const skipTop = new Set(['CLAUDE.md', 'CLAUDE.en.md']);
  let st;
  try { st = fs.lstatSync(payloadDir); } catch { return { ok: false, reason: 'payload-missing' }; }
  if (!st.isDirectory() || st.isSymbolicLink()) return { ok: false, reason: 'payload-missing' };
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const r = rel ? rel + '/' + name : name;
      const abs = path.join(dir, name);
      const s = fs.lstatSync(abs);
      if (s.isSymbolicLink()) return 'payload-symlink';
      if (!rel && skipTop.has(name)) continue;
      if (!rel && (name.toLowerCase() === 'data' || name.toLowerCase() === '.git')) continue; // 개인 데이터·저장소 정보는 싣지 않는다
      if (!safeManifestPath(r)) return 'payload-name';
      if (s.isDirectory()) { const e = walk(abs, r); if (e) return e; }
      else if (s.isFile()) {
        if (s.size > PAYLOAD_FILE_MAX_BYTES) return 'payload-big';
        total += s.size;
        if (files.length >= PAYLOAD_FILES_MAX || total > PAYLOAD_TOTAL_MAX_BYTES) return 'payload-big';
        files.push({ rel: r, abs, exec: (s.mode & 0o111) !== 0 });
      } else return 'payload-special';
    }
    return null;
  };
  try { const e = walk(payloadDir, ''); if (e) return { ok: false, reason: e }; } catch { return { ok: false, reason: 'payload-read' }; }
  return { ok: true, files };
}

// 홈 검사. -> { ok, marker, created, empty } | { ok:false, reason }
function prepareHome(home, io, uid) {
  const fs = fsOf(io);
  let st = null;
  try { st = fs.lstatSync(home); } catch { /* 없음 */ }
  if (!st) return { ok: true, marker: null, created: true, empty: false };
  if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, reason: 'home-symlink' };
  if (st.uid !== uid) return { ok: false, reason: 'home-owner' };
  if ((st.mode & 0o022) !== 0) return { ok: false, reason: 'home-mode' };
  const marker = readMarker(home, io);
  let empty = false;
  if (!marker) {
    let n = 0; try { n = fs.readdirSync(home).length; } catch { return { ok: false, reason: 'home-read' }; }
    if (n > 0) return { ok: false, reason: 'not-managed' };
    empty = true;
  }
  return { ok: true, marker, created: false, empty };
}
// 홈 상태 이름: absent | empty | managed | symlink | owner | mode | foreign | unreadable
function homeStatus(home, io) {
  const uid = io && typeof io.uid === 'number' ? io.uid : process.getuid();
  const h = prepareHome(home, io, uid);
  if (!h.ok) return { 'home-symlink': 'symlink', 'home-owner': 'owner', 'home-mode': 'mode', 'not-managed': 'foreign' }[h.reason] || 'unreadable';
  return h.created ? 'absent' : h.marker ? 'managed' : 'empty';
}

// 상위 폴더 확인/생성: 모든 중간 성분을 lstat 해 심볼릭 링크·폴더 아님·남의 소유면 거부, 그룹/다른 사용자 쓰기 권한은 고친다.
// create=false 면 없는 폴더는 그대로 둔다(사전 점검용). -> null | 이유
function walkChain(base, rel, io, uid, create) {
  const fs = fsOf(io); const path = require('path');
  const parts = rel.split('/'); parts.pop();
  let cur = base;
  for (const p of parts) {
    cur = path.join(cur, p);
    let st = null; try { st = fs.lstatSync(cur); } catch { /* 없음 */ }
    if (!st) { if (!create) return null; fs.mkdirSync(cur, { mode: 0o755 }); continue; }
    if (st.isSymbolicLink() || !st.isDirectory()) return 'dest-symlink';
    if (st.uid !== uid) return 'dest-owner';
    if (create && (st.mode & 0o022) !== 0) { try { fs.chmodSync(cur, st.mode & 0o755); } catch { return 'dest-mode'; } }
  }
  return null;
}

// 같은 폴더에 임시 파일 -> fsync -> rename 으로 쓴다
function writeFileAtomicMode(dest, data, mode, io) {
  const fs = fsOf(io); const path = require('path'); const crypto = require('crypto');
  const tmp = path.join(path.dirname(dest), '.' + path.basename(dest) + '.' + crypto.randomBytes(5).toString('hex') + '.tmp');
  let fd = null;
  try {
    fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeSync(fd, data);
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = null;
    fs.renameSync(tmp, dest);
    return true;
  } catch {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* 무시 */ }
    try { fs.unlinkSync(tmp); } catch { /* 없음 */ }
    return false;
  }
}

function readPayloadFile(abs, io) {
  const fs = fsOf(io);
  let fd = null;
  try {
    fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > PAYLOAD_FILE_MAX_BYTES) return null;
    const buf = Buffer.alloc(st.size); const n = fs.readSync(fd, buf, 0, st.size, 0);
    return buf.subarray(0, n);
  } catch { return null; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* 무시 */ } }
}

// CLAUDE.md 원본 고르기: en 이면 CLAUDE.en.md(없으면 CLAUDE.md 로 대체), 아니면 CLAUDE.md
function pickClaudeMd(payloadDir, lang, io) {
  const path = require('path');
  if (lang === 'en') { const b = readPayloadFile(path.join(payloadDir, 'CLAUDE.en.md'), io); if (b) return { buf: b, fallback: false }; }
  const b = readPayloadFile(path.join(payloadDir, 'CLAUDE.md'), io);
  return b ? { buf: b, fallback: lang === 'en' } : null;
}

function writeMarker(home, marker, io) {
  const body = JSON.stringify({ version: marker.version, lang: marker.lang, manifest: marker.manifest, syncedAt: new Date().toISOString() }, null, 2) + '\n';
  return writeFileAtomicMode(require('path').join(home, MANAGED_MARKER), body, 0o600, io);
}

// 보호 대상(data/ 폴더, settings.local.json)의 dev:ino. 이름의 대소문자·유니코드 별칭과 상관없이 같은 파일이면 걸린다.
function protectedIds(home, io) {
  const fs = fsOf(io); const path = require('path'); const ids = new Set();
  for (const p of [path.join(home, 'data'), path.join(home, '.claude', 'settings.local.json')]) { try { ids.add(idOf(fs.lstatSync(p))); } catch { /* 없음 */ } }
  return ids;
}
// 이전 매니페스트에만 있던 파일 제거: 모든 중간 성분이 진짜 폴더, 대상은 링크 수 1 의 일반 파일, 보호 대상이 아닐 때만.
function removeStale(home, manifest, newSet, io) {
  const fs = fsOf(io); const path = require('path');
  const prot = protectedIds(home, io); let removed = 0;
  for (const rel of manifest) {
    if (newSet.has(rel) || !safeManifestPath(rel)) continue;
    const parts = rel.split('/'); let cur = home; const dirs = []; let ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = path.join(cur, parts[i]);
      let st; try { st = fs.lstatSync(cur); } catch { ok = false; break; }
      if (st.isSymbolicLink() || !st.isDirectory() || prot.has(idOf(st))) { ok = false; break; }
      dirs.push(cur);
    }
    if (!ok) continue;
    const p = path.join(home, rel);
    let st; try { st = fs.lstatSync(p); } catch { continue; }
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || prot.has(idOf(st))) continue;
    try { fs.unlinkSync(p); removed++; } catch { continue; }
    for (let i = dirs.length - 1; i >= 0; i--) { try { fs.rmdirSync(dirs[i]); } catch { break; } }
  }
  return removed;
}

// 홈 옆의 오래된 임시 폴더(<홈>.tmp-<16진>)를 지운다: 앱이 쓴 진행 중 표시가 있고, 내 소유의 진짜 폴더이며, maxAgeMs 보다 오래된 것만.
function cleanStaleTmp(home, io, maxAgeMs) {
  const fs = fsOf(io); const path = require('path');
  const uid = io && typeof io.uid === 'number' ? io.uid : process.getuid();
  const age = typeof maxAgeMs === 'number' ? maxAgeMs : 10 * 60 * 1000;
  const parent = path.dirname(home); const prefix = path.basename(home) + '.tmp-'; let n = 0;
  let names = []; try { names = fs.readdirSync(parent); } catch { return 0; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !/^[0-9a-f]{10}$/.test(name.slice(prefix.length))) continue;
    const d = path.join(parent, name);
    try {
      const st = fs.lstatSync(d);
      if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid) continue;
      const m = fs.lstatSync(path.join(d, SYNC_MARKER));
      if (!m.isFile() || m.isSymbolicLink() || (age > 0 && Date.now() - m.mtimeMs < age)) continue;
      fs.rmSync(d, { recursive: true, force: true }); n++;
    } catch { /* 표시가 없으면 건드리지 않는다 */ }
  }
  return n;
}

// payload -> 관리형 홈 동기화. io = { fs, uid }(주입 가능).
// 새 홈(없거나 빈 폴더)은 옆의 임시 폴더에 다 만든 뒤 rename 한다(중간에 실패해도 홈은 생기지 않는다).
// 기존 관리형 홈은 진행 중 표시(.maru-syncing)를 먼저 쓰고 마커를 마지막에 쓴 뒤 표시를 지운다(실패하면 표시가 남아 다시 시도된다).
// -> { ok, version, lang, written, removed, claudeFallback } | { ok:false, reason }
function syncPayload({ payloadDir, home, lang, io } = {}) {
  const fs = fsOf(io); const path = require('path'); const crypto = require('crypto');
  const uid = io && typeof io.uid === 'number' ? io.uid : process.getuid();
  if (typeof payloadDir !== 'string' || typeof home !== 'string' || !path.isAbsolute(payloadDir) || !path.isAbsolute(home)) return { ok: false, reason: 'args' };
  const lg = lang === 'en' ? 'en' : 'ko';
  const sc = scanPayload(payloadDir, io);
  if (!sc.ok) return sc;
  const version = readPayloadVersion(payloadDir, io);
  if (!version) return { ok: false, reason: 'payload-version' };
  const md = pickClaudeMd(payloadDir, lg, io);
  if (!md) return { ok: false, reason: 'payload-claude-md' };
  const h = prepareHome(home, io, uid);
  if (!h.ok) return h;
  const fresh = h.created || h.empty;
  const items = sc.files.filter((f) => f.rel !== 'CLAUDE.md');
  const newSet = new Set(items.map((f) => f.rel)); newSet.add('CLAUDE.md');
  let root = home;
  if (fresh) {
    cleanStaleTmp(home, io);
    root = home + '.tmp-' + crypto.randomBytes(5).toString('hex');
    try { fs.mkdirSync(path.dirname(home), { recursive: true, mode: 0o700 }); fs.mkdirSync(root, { mode: 0o700 }); fs.chmodSync(root, 0o700); } catch { return { ok: false, reason: 'home-create' }; }
  } else {
    // 사전 점검: 중간 성분이 링크·남의 것이면, 목적지가 폴더·링크이면 아무것도 쓰기 전에 거부한다
    for (const rel of newSet) {
      const e = walkChain(home, rel, io, uid, false); if (e) return { ok: false, reason: e };
      let st = null; try { st = fs.lstatSync(path.join(home, rel)); } catch { /* 없음 */ }
      if (st && st.isDirectory()) return { ok: false, reason: 'dest-dir' };
      if (st && st.isSymbolicLink()) return { ok: false, reason: 'dest-symlink' };
    }
    try { fs.chmodSync(home, 0o700); } catch { return { ok: false, reason: 'home-mode' }; }
  }
  const run = () => {
    if (!writeFileAtomicMode(path.join(root, SYNC_MARKER), JSON.stringify({ to: version, at: new Date().toISOString() }) + '\n', 0o600, io)) return { ok: false, reason: 'write' };
    let written = 0;
    for (const f of items) {
      const e = walkChain(root, f.rel, io, uid, true); if (e) return { ok: false, reason: e };
      let st = null; try { st = fs.lstatSync(path.join(root, f.rel)); } catch { /* 없음 */ }
      if (st && st.isSymbolicLink()) return { ok: false, reason: 'dest-symlink' };
      const buf = readPayloadFile(f.abs, io);
      if (!buf) return { ok: false, reason: 'payload-read' };
      if (!writeFileAtomicMode(path.join(root, f.rel), buf, f.exec ? 0o755 : 0o644, io)) return { ok: false, reason: 'write' };
      written++;
    }
    if (!writeFileAtomicMode(path.join(root, 'CLAUDE.md'), md.buf, 0o644, io)) return { ok: false, reason: 'write' };
    written++;
    const removed = fresh || !h.marker ? 0 : removeStale(root, h.marker.manifest, newSet, io);
    if (!writeMarker(root, { version, lang: lg, manifest: [...newSet].sort() }, io)) return { ok: false, reason: 'marker' };
    try { fs.unlinkSync(path.join(root, SYNC_MARKER)); } catch { return { ok: false, reason: 'marker' }; }
    return { ok: true, version, lang: lg, written, removed, claudeFallback: md.fallback };
  };
  let res;
  try { res = run(); } catch { res = { ok: false, reason: 'write' }; }
  if (fresh) {
    if (res.ok) {
      try { if (h.empty) fs.rmdirSync(home); fs.renameSync(root, home); } catch { res = { ok: false, reason: 'home-create' }; }
    }
    if (!res.ok) { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 다음 시작 때 정리 */ } }
  }
  return res;
}

// 언어가 바뀌었을 때 CLAUDE.md 만 다시 쓴다(마커가 있는 홈만). 마커의 lang 도 갱신.
function syncClaudeMd({ payloadDir, home, lang, io } = {}) {
  const path = require('path'); const fs = fsOf(io);
  const uid = io && typeof io.uid === 'number' ? io.uid : process.getuid();
  if (typeof payloadDir !== 'string' || typeof home !== 'string' || !path.isAbsolute(payloadDir) || !path.isAbsolute(home)) return { ok: false, reason: 'args' };
  const lg = lang === 'en' ? 'en' : 'ko';
  const h = prepareHome(home, io, uid);
  if (!h.ok) return h;
  if (!h.marker) return { ok: false, reason: 'not-managed' };
  try { const d = fs.lstatSync(path.join(payloadDir, 'CLAUDE.md')); if (d.isSymbolicLink()) return { ok: false, reason: 'payload-symlink' }; } catch { return { ok: false, reason: 'payload-claude-md' }; }
  const md = pickClaudeMd(payloadDir, lg, io);
  if (!md) return { ok: false, reason: 'payload-claude-md' };
  try { const st = fs.lstatSync(path.join(home, 'CLAUDE.md')); if (st.isDirectory()) return { ok: false, reason: 'dest-dir' }; } catch { /* 없음 */ }
  if (!writeFileAtomicMode(path.join(home, 'CLAUDE.md'), md.buf, 0o644, io)) return { ok: false, reason: 'write' };
  const man = new Set(h.marker.manifest); man.add('CLAUDE.md');
  if (!writeMarker(home, { version: h.marker.version, lang: lg, manifest: [...man].sort() }, io)) return { ok: false, reason: 'marker' };
  return { ok: true, lang: lg, claudeFallback: md.fallback };
}

// 시작 때 할 일: 'newer'(홈이 앱보다 새것: 건드리지 않음) | 'sync' | 'lang' | 'none'
function managedAction(marker, payloadVersion, profileLang, syncing) {
  if (!marker || !payloadVersion) return 'none';
  if (cmpVersion(marker.version, payloadVersion) > 0) return 'newer';
  if (syncing || marker.version !== payloadVersion) return 'sync';
  if ((profileLang === 'ko' || profileLang === 'en') && marker.lang !== profileLang) return 'lang';
  return 'none';
}

// 동기화 기록(데이터 폴더 안 로그 한 줄). data/ 와 logs/ 가 진짜 폴더이고 파일이 링크가 아닐 때만, 64KB 상한.
function appendSyncLog(root, line, io) {
  const fs = fsOf(io); const path = require('path');
  try {
    const data = path.join(root, 'data'); const logs = path.join(data, 'logs'); const f = path.join(logs, 'app-sync.log');
    for (const d of [data, logs]) {
      let st = null; try { st = fs.lstatSync(d); } catch { /* 없음 */ }
      if (!st) fs.mkdirSync(d, { mode: 0o700 }); else if (st.isSymbolicLink() || !st.isDirectory()) return false;
    }
    try { const st = fs.lstatSync(f); if (!st.isFile() || st.isSymbolicLink() || st.size > 64 * 1024) return false; } catch { /* 없음 */ }
    const fd = fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeSync(fd, new Date().toISOString() + ' ' + String(line).replace(/[^\x20-\x7e]/g, '?').slice(0, 200) + '\n'); } finally { fs.closeSync(fd); }
    return true;
  } catch { return false; }
}

// 첫 만남 입력줄에 붙이는 고정 문장. 상수와 정확히 같을 때만 붙여넣기 문자열을 돌려준다(그 밖은 null). 일반 퀘스트용 isSafeQuestStart 는 '/' 로 시작하는 문장을 거부하므로 따로 둔다.
// Claude Code 첫 실행 화면(테마·로그인)이 떠 있는 동안에는 입력줄이 없다. 붙여넣기 모드(bracketed)가 그 화면에서 꺼져 있는지 알 수 없어서 그것만 믿지 않고,
// 첫 화면 동안에는 참일 수 없는 신호를 함께 본다: onboarded(설정 파일의 hasCompletedOnboarding 가 true 이거나 이 작업 공간의 훅 상태 파일이 있음)와 loggedIn(claude auth status).
// ~/.claude.json 내용 -> true | false | null(읽지 못함·형식 이상: 막지 않는다)
function parseOnboarded(text) {
  if (typeof text !== 'string') return null;
  let o; try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  return o.hasCompletedOnboarding === true;
}
// c = { hasTerm, procName, bracketed, awaitClaude, claudeUp, quietMs, onboarded: true|false|null, hookState: boolean, loggedIn: true|false|null }
// -> { ok: true } | { ok: false, reason: 'no-term' | 'shell' | 'setup' | 'not-ready' }.
// 'setup'(첫 설정 미완료): 훅 상태가 없고, onboarded === false(설정 파일을 읽었고 키가 true 가 아님)이거나 onboarded === null(모름)인데 loggedIn === false.
// onboarded === true 면 loggedIn 은 보지 않는다(셸 프로필의 환경변수로 로그인한 사람을 앱 환경의 auth status 로 막지 않는다). claudeUp 은 우리가 연 작업 공간(awaitClaude)일 때만 요구한다(fillStep 과 같다)
function firstMeetingGate(c) {
  if (!c || !c.hasTerm) return { ok: false, reason: 'no-term' };
  if (isShellProcessName(c.procName)) return { ok: false, reason: 'shell' };
  if (c.hookState !== true && c.onboarded !== true && (c.onboarded === false || c.loggedIn === false)) return { ok: false, reason: 'setup' };
  // why: not-ready 의 세부(먼저 걸린 것): 입력 모드(bracketed) → claude 시작(claude-up) → 출력 중(quiet). reason 은 그대로
  if (c.bracketed !== true) return { ok: false, reason: 'not-ready', why: 'bracketed' };
  if (c.awaitClaude === true && c.claudeUp !== true) return { ok: false, reason: 'not-ready', why: 'claude-up' };
  if (!(c.quietMs >= READY_QUIET_MS)) return { ok: false, reason: 'not-ready', why: 'quiet' };
  return { ok: true };
}
function firstMeetingPaste(text) { return text === FIRST_MEETING_TEXT ? '\x1b[200~' + FIRST_MEETING_TEXT + '\x1b[201~' : null; }

// 기억 폴더 읽기 가능 여부: 'missing'(아직 없음=새 사용자) | 'ok' | 'unreadable'(링크·권한 등)
function probeMemoryDir(dir, io) {
  const fs = fsOf(io); const path = require('path');
  if (typeof dir !== 'string' || !dir) return 'unreadable';
  let st;
  try { st = fs.lstatSync(dir); } catch (e) { return e && e.code === 'ENOENT' ? 'missing' : 'unreadable'; }
  if (st.isSymbolicLink() || !st.isDirectory()) return 'unreadable';
  try { if (fs.lstatSync(path.dirname(dir)).isSymbolicLink()) return 'unreadable'; fs.readdirSync(dir); } catch { return 'unreadable'; }
  return 'ok';
}

// ---- 첫 설정 상태 (<홈>/data/setup.json). 프로필(profile.json)과 따로 둔다 ----
const SETUP_MAX_BYTES = 4096;
const SETUP_CONNECT = ['done', 'later'];
function defaultSetupState() { return { v: 1, homeAt: null, connect: null, doneAt: null, metAt: null, dismissedAt: null }; }
const isoOrNull = (s) => (typeof s === 'string' && s.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s)) ? s : null);
function validateSetupState(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (o.v !== 1) return null;
  const connect = SETUP_CONNECT.includes(o.connect) ? o.connect : null;
  for (const k of ['homeAt', 'doneAt', 'metAt', 'dismissedAt']) if (o[k] !== null && o[k] !== undefined && isoOrNull(o[k]) === null) return null;
  return { v: 1, homeAt: isoOrNull(o.homeAt), connect, doneAt: isoOrNull(o.doneAt), metAt: isoOrNull(o.metAt), dismissedAt: isoOrNull(o.dismissedAt) }; // 알 수 없는 필드는 버린다
}
function parseSetupState(res) {
  if (!res || res.truncated || typeof res.text !== 'string') return null;
  try { return validateSetupState(JSON.parse(res.text)); } catch { return null; }
}
function loadSetupState(file) { return parseSetupState(readRegular(file, SETUP_MAX_BYTES, false)); } // 없거나 망가졌으면 null
function saveSetupState(file, st) { const v = validateSetupState(st); return v ? writeJsonAtomic(file, v, 'setup') : false; }

// 관리형 홈이 있고 프로필이 유효한데 setup.json 이 없거나 망가졌을 때: 홈은 이미 만든 것으로 본다
function deriveSetupState({ marker, profile }) { return marker && profile ? validateSetupState({ ...defaultSetupState(), homeAt: profile.createdAt }) : null; }
// 기존 프로필이 유효하면 createdAt·calendar 를 지키고 이름·언어만 바꾼다(덮어써 잃지 않게)
function mergeProfile(existing, name, lang, nowIso) {
  const e = validateProfile(existing);
  return e ? { ...e, name, lang } : { name, lang, calendar: false, createdAt: nowIso };
}
// 첫 설정 화면이 필요한가. found = resolveRoot 결과, state = 상태|null. -> { needed, stage: 'welcome'|'connect'|'done' }
function setupStage({ found, state }) {
  if (!found) return { needed: true, stage: 'welcome' };
  if (found.source !== 'managed') return { needed: false, stage: 'done' };
  const st = state || defaultSetupState();
  if (st.doneAt) return { needed: false, stage: 'done' };
  if (!st.homeAt) return { needed: true, stage: 'welcome' };
  return { needed: true, stage: 'connect' };
}
// 설정이 아직 끝나지 않은(연결을 미룬) 홈인지: 상태 영역의 "설정 마무리" 항목용
function setupUnfinished({ found, state }) {
  if (!found || found.source !== 'managed') return false;
  const st = state || defaultSetupState();
  return st.connect !== 'done';
}

// ---- 사전 요구사항 ----
const PREREQ_IDS = ['macos', 'claude', 'auth', 'git', 'python3', 'jq', 'perl'];
const PREREQ_HOW = { macos: 'prereq.how.macos', claude: 'prereq.how.claude', auth: 'prereq.how.auth', git: 'prereq.how.clt', python3: 'prereq.how.clt', jq: 'prereq.how.jq', perl: 'prereq.how.perl' };
// install.sh·점검이 쓰는 PATH(순수): 기본 폴더·현재 PATH 뒤에 claude 가 있는 폴더(절대 경로·실재·"/" 아님·":" 없음)를 덧붙인다(중복 제거).
// 앞이 아니라 뒤인 이유: 버전 관리자 shim 폴더가 git·python3 를 가리지 않게. 뒤에 있어도 claude 의 #!/usr/bin/env node 는 옆의 node 를 찾는다.
// claudeBin: resolveClaude() 결과(없으면 null). isDir(path) -> boolean
function childPath({ extra, current, claudeBin, isDir }) {
  const path = require('path'); const out = [];
  if (typeof claudeBin === 'string' && path.isAbsolute(claudeBin)) {
    const d = path.dirname(claudeBin); let ok = false; try { ok = d !== '/' && !d.includes(':') && isDir(d) === true; } catch { ok = false; }
    if (ok) out.push(d);
  }
  return [...new Set([...(Array.isArray(extra) ? extra : []), ...String(current || '').split(':').filter(Boolean), ...out])].join(':');
}
// PATH 문자열에서 실행 파일 찾기(io.isExec(path) -> boolean)
function findInPath(name, pathStr, isExec) {
  const path = require('path');
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,40}$/.test(name)) return null;
  for (const d of String(pathStr || '').split(':')) {
    if (!d || !path.isAbsolute(d)) continue;
    const p = path.join(d, name);
    let ok = false; try { ok = isExec(p) === true; } catch { ok = false; }
    if (ok) return p;
  }
  return null;
}
// raw: { macos: boolean, claude: 'ok'|'missing'|'broken', auth: parseAuthStatus 결과|null, git/python3/jq/perl: 'ok'|'missing'|'broken' }
// -> [{ id, status: 'ok'|'missing'|'need'|'unknown', required, how }]. auth 는 필수가 아니다(필요 표시와 로그인 단추는 있지만 막지 않는다: API 키·Bedrock 처럼 셸 환경변수로 인증하는 사용자도 지나가야 한다).
function modelPrereqs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const tool = (v) => (v === 'ok' ? 'ok' : v === 'broken' ? 'need' : 'missing');
  const out = [];
  out.push({ id: 'macos', status: r.macos === true ? 'ok' : 'missing', required: true, detail: typeof r.macosVersion === 'string' && /^[0-9.]{1,20}$/.test(r.macosVersion) ? r.macosVersion : null });
  out.push({ id: 'claude', status: tool(r.claude), required: true });
  let auth = 'unknown';
  if (r.claude === 'ok') { const a = r.auth; auth = !a ? 'unknown' : (a.loggedIn && a.state !== 'expired') ? 'ok' : 'need'; }
  else auth = 'need';
  out.push({ id: 'auth', status: auth, required: false });
  for (const id of ['git', 'python3', 'jq', 'perl']) out.push({ id, status: tool(r[id]), required: true });
  const howKey = (x) => (x.id === 'claude' && x.status === 'need' ? 'prereq.how.claudeBroken' : x.id === 'auth' && r.claude !== 'ok' ? 'prereq.how.authFirst' : PREREQ_HOW[x.id]); // 고장 난 claude 는 재설치 안내, claude 가 없으면 로그인보다 설치가 먼저
  return out.map((x) => ({ ...x, how: x.status === 'ok' ? null : howKey(x) }));
}
function prereqsReady(list) { return Array.isArray(list) && PREREQ_IDS.every((id) => { const x = list.find((y) => y && y.id === id); return !!x && (x.status === 'ok' || !x.required); }); }

// ---- claude 위치 찾기(순수) ----
// home: 홈 폴더, lines: 셸 탐색(`command -v claude`)이 낸 후보 줄들, nvmDirs: ~/.nvm/versions/node 아래 폴더 이름들
// -> 시도할 절대 경로 배열(셸이 알려 준 것 먼저, 고정 위치, nvm 최신 버전 순; 중복·상대 경로·제어 문자 제외)
const NVM_MAX = 50;
function nvmVersionDirs(names) {
  const key = (v) => v.replace(/^v/, '').split('.').map(Number);
  return (Array.isArray(names) ? names : []).filter((x) => typeof x === 'string' && /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(x))
    .sort((a, b) => { const ka = key(a); const kb = key(b); for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i]; return 0; }).slice(0, NVM_MAX);
}
function claudeCandidates({ home, lines, nvmDirs }) {
  const path = require('path');
  const ok = (p) => typeof p === 'string' && p.startsWith('/') && !/[\x00-\x1f\x7f]/.test(p);
  const out = [];
  for (const l of Array.isArray(lines) ? lines : []) { const p = typeof l === 'string' ? l.trim() : l; if (ok(p)) out.push(p); }
  if (ok(home) && path.isAbsolute(home)) {
    const h = (...a) => path.join(home, ...a);
    out.push(h('.local', 'bin', 'claude'), h('.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', h('.npm-global', 'bin', 'claude'), h('.bun', 'bin', 'claude'), h('.volta', 'bin', 'claude'));
    for (const v of nvmVersionDirs(nvmDirs)) out.push(h('.nvm', 'versions', 'node', v, 'bin', 'claude'));
  } else out.push('/opt/homebrew/bin/claude', '/usr/local/bin/claude');
  return [...new Set(out)];
}

// 셸 탐색 출력에서 claude 경로만 뽑는다: 센티널 줄(__MARU_CLAUDE__<경로>)만 보고 rc·로그아웃 문구 같은 잡음은 무시한다. 절대 경로(제어 문자 없음)가 아니면 null
const CLAUDE_PROBE_CMD = "printf '\\n__MARU_CLAUDE__%s\\n' \"$(command -v claude)\"";
function parseClaudeProbe(out) {
  let found = null;
  for (const l of String(out || '').split('\n')) {
    const x = l.replace(/\r$/, '');
    if (!x.startsWith('__MARU_CLAUDE__')) continue;
    const p = x.slice('__MARU_CLAUDE__'.length);
    found = p.startsWith('/') && !/[\x00-\x1f\x7f]/.test(p) ? p : null;
  }
  return found;
}

// ---- 첫 설정: 터미널에서 돌릴 명령(순수) ----
// 설치 명령은 여기 한 곳에서만 고친다(확인 창의 상세와 스크립트가 같은 문자열을 쓴다).
const SETUP_INSTALL_CMD = 'curl -fsSL https://claude.ai/install.sh | bash';
const SETUP_KINDS = ['install-claude', 'login'];
// kind -> 명령 문자열. login 은 claudeBin(절대 경로·제어 문자 없음)을 shellQuote 로 인용한 것만 끼운다. 그 밖은 null
function setupCommand(kind, claudeBin) {
  if (kind === 'install-claude') return SETUP_INSTALL_CMD;
  if (kind === 'login') return typeof claudeBin === 'string' && claudeBin.startsWith('/') && !/[\x00-\x1f\x7f]/.test(claudeBin) ? shellQuote(claudeBin) + ' auth login' : null;
  return null;
}
// .command 스크립트 본문. strings: { run, done, fail }(현재 언어 문구; fail 의 {code} 자리에 종료 코드가 들어간다).
// 문구는 작은따옴표로 인용해 글자 그대로 출력한다(printf '%s'). 명령이 실패하면(pipefail 포함) done 대신 fail 을 출력한다. 잘못된 입력이면 null
function buildSetupScript({ kind, claudeBin, strings }) {
  const cmd = setupCommand(kind, claudeBin);
  const sq = (x) => "'" + String(x).replace(/'/g, "'\\''") + "'";
  if (!cmd || !strings || typeof strings.run !== 'string' || typeof strings.done !== 'string' || typeof strings.fail !== 'string') return null;
  const fail = strings.fail.split('{code}').map(sq).join('"$rc"');
  return '#!/bin/bash\nset -o pipefail\nprintf \'%s\\n\' ' + sq(strings.run) + '\n' + cmd + '\nrc=$?\nif [ "$rc" -eq 0 ]; then\n  printf \'\\n%s\\n\' ' + sq(strings.done) + '\nelse\n  printf \'\\n%s\\n\' ' + fail + '\nfi\nexit $rc\n';
}

// ---- 첫 만남 배너 ----
// 기억 파일이 0개이고 metAt·dismissedAt 이 없고 프로필이 있을 때만 보인다. memories = readMemoryFiles 결과({items, skipped})|null
function firstMeetingBanner({ memories, probe, state, profile }) {
  if (!profile) return false;
  if (probe !== 'missing' && probe !== 'ok') return false; // 읽지 못한 것과 비어 있는 것을 구분한다
  if (probe === 'ok' && (!memories || !Array.isArray(memories.items) || memories.items.length > 0 || (memories.skipped | 0) > 0)) return false;
  const st = state || defaultSetupState();
  return !st.metAt && !st.dismissedAt;
}

// ======== 하위 세션: 마루가 다른 폴더의 세션을 열어 일을 맡긴다 ========
// 요청 파일(<ROOT>/data/state/app/requests/<epoch-ms>-<8hex>.json)은 신뢰하지 않는 입력이다. 인증(mac)·판정·동의·예산·프롬프트 전달·보고 표시를 순수 함수(+주입한 fs)로 둔다.
const CHILD_MAX = 4; // 앱 전체에서 동시에 열려 있는 하위 세션(부모가 둘이어도 합쳐서)
const CHILD_RATE_MAX = 3; const CHILD_RATE_MS = 60 * 1000; // 1분에 받아들이는 요청(동의 창 남발 방지)
const CHILD_DAY_MAX = 20; const CHILD_DAY_MS = 24 * 3600 * 1000; // 24시간에 실제로 여는 하위 세션(재시작 뒤에도 유지)
const REQ_MAX_BYTES = 16384; const REQ_STALE_MS = 60 * 1000; const REQ_FILES_PER_SCAN = 20; const REQ_FUTURE_MS = 2000;
const REQ_TITLE_MAX = 40; const REQ_PROMPT_MAX = 4000; const REQ_CWD_MAX = 1024;
const REQ_NAME_RE = /^(\d{13})-([0-9a-f]{8})\.json$/;
const REQ_KEYS = ['v', 'from', 'cwd', 'title', 'project', 'squad', 'prompt', 'at', 'mac'];
const REQ_KEY_RE = /^[0-9a-f]{64}$/;

// 프롬프트 정리: 줄바꿈(\n)·탭은 남기고(\r 은 \n 으로) 제어·서식·보이지 않는 문자는 지운다. ESC 도 지워지므로 붙여넣기 끝 표지를 만들 수 없다
function cleanPromptText(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\r\n?/g, '\n').replace(BAD_CHARS_G, (c) => (c === '\n' || c === '\t' ? c : '')).replace(/[ \t]+$/gm, '').replace(/\n{4,}/g, '\n\n\n').trim(); // 줄 끝 공백을 지운 뒤 빈 줄이 3줄 넘게 이어지면 2줄로(보이는 것과 전달하는 것이 같도록 한 번만 정규화한다)
}
function validAbsDir(c) { // 정규화된 절대 경로(.·..·빈 조각 없음)
  if (typeof c !== 'string' || c.length < 1 || c.length > REQ_CWD_MAX || !c.startsWith('/') || hasBadChars(c)) return false;
  return c === '/' || c.slice(1).split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}
// 주의: 이 키는 같은 사용자(uid) 안에서는 비밀이 아니다(같은 사용자의 프로세스가 ps eww 로 환경을 읽을 수 있다). mac 은 실수·다른 작업 공간의 요청을 거르는 용도이고, 진짜 관문은 매번 뜨는 동의 창이다
// ---- 인증: 마루 pty 마다 시작할 때 정한 무작위 키(MARU_REQ_KEY, 64 hex = 32바이트). 요청의 mac = HMAC-SHA256(키 바이트, 아래 7줄을 "\n" 으로 이은 UTF-8) ----
// 줄: v, from, cwd, title, project(없으면 빈 문자열), at, 프롬프트 UTF-8 의 SHA-256(소문자 hex). 값은 파일에 적힌 그대로(정리 전)
// v=2(스쿼드를 지정한 요청)는 끝에 squad 줄이 하나 더 붙는다(8줄). v=1 은 예전과 바이트까지 같다. v 는 서명 안에 있어 2 -> 1 로 내려 squad 를 서명 밖으로 빼도 맞지 않는다
function childMacMessage(f) {
  const sha = require('crypto').createHash('sha256').update(String(f.prompt), 'utf8').digest('hex');
  const lines = [String(f.v), f.from, f.cwd, f.title, f.project === null || f.project === undefined ? '' : f.project, String(f.at), sha];
  if (f.v === 2) lines.push(typeof f.squad === 'string' ? f.squad : '');
  return lines.join('\n');
}
function childMac(keyHex, f) {
  return require('crypto').createHmac('sha256', Buffer.from(keyHex, 'hex')).update(childMacMessage(f), 'utf8').digest('hex');
}
function childMacOk(keyHex, f) { // 상수 시간 비교. 키·mac 형식이 틀리면 false
  if (typeof keyHex !== 'string' || !REQ_KEY_RE.test(keyHex) || !f || typeof f.mac !== 'string' || !REQ_KEY_RE.test(f.mac)) return false;
  const a = Buffer.from(childMac(keyHex, f), 'hex'); const b = Buffer.from(f.mac, 'hex');
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}
// 마루 세션이 될 수 있는 작업 공간인가(= 키를 받는다): 최상위, 폴더가 저장소 루트, 하위 세션이었던 적이 없다(origin 이 'child' 면 부모가 닫혀도 영구히 안 됨)
function maruEligible({ isRoot, parentId, origin }) { return isRoot === true && !parentId && origin !== 'child'; }
// 작업 공간 사실 목록에서 요청자를 찾는다. list = [{ id, sessionId, hasTerm, proc, isRoot, parentId, origin, key }]. 앱 세션 id(from)가 같고 pty 가 있는 것만
// -> { id, running, maru, child, key } | null. running: 셸이 아닌 프로세스(Claude)가 전경에 있고 claude 실행 파일이 있다
function requesterOf(list, from, claudeFound) {
  if (typeof from !== 'string' || !Array.isArray(list)) return null;
  const w = list.find((x) => x && x.sessionId === from && x.hasTerm === true);
  if (!w) return null;
  const proc = typeof w.proc === 'string' ? w.proc : '';
  return { id: w.id, running: !!proc && !isShellProcessName(proc) && claudeFound === true, maru: maruEligible(w), child: !!w.parentId || w.origin === 'child', key: typeof w.key === 'string' ? w.key : null };
}
// 요청 본문 -> { ok: true, req, raw } | { ok: false, reason }. 계약에 없는 키·타입은 거부(프로토타입 키 포함). raw: mac 계산에 쓰는 파일 그대로의 값
function parseChildRequest(text) {
  const bad = (reason) => ({ ok: false, reason });
  if (typeof text !== 'string' || text.length > REQ_MAX_BYTES) return bad('size');
  let o; try { o = JSON.parse(text); } catch { return bad('json'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return bad('shape');
  const keys = Object.keys(o);
  if (keys.some((k) => !REQ_KEYS.includes(k)) || !['v', 'from', 'cwd', 'title', 'prompt', 'at', 'mac'].every((k) => hasOwn(o, k))) return bad('shape');
  if (o.v !== 1 && o.v !== 2) return bad('version');
  if (!isSessionId(o.from)) return bad('shape');
  if (typeof o.mac !== 'string' || !REQ_KEY_RE.test(o.mac)) return bad('auth');
  if (!validAbsDir(o.cwd)) return bad('cwd');
  const title = cleanQuestText(o.title);
  if (typeof o.title !== 'string' || !title || cpLen(title) > REQ_TITLE_MAX) return bad('title');
  const prompt = cleanPromptText(o.prompt);
  if (typeof o.prompt !== 'string' || !prompt || cpLen(prompt) > REQ_PROMPT_MAX) return bad('prompt');
  if (Buffer.byteLength(childPromptText('ko', prompt), 'utf8') > PROMPT_FILE_MAX || Buffer.byteLength(childPromptText('en', prompt), 'utf8') > PROMPT_FILE_MAX) return bad('prompt-size'); // 전달 파일(머리말 포함)이 16KB 를 넘으면 조용히 줄이지 않고 거부
  const project = hasOwn(o, 'project') ? o.project : null;
  if (project !== null && !isProjectKey(project)) return bad('project');
  // squad: v=2 에만, 있어야 한다(엄격한 slug). v=1 에 있으면 거부(서명 밖의 값이 되므로)
  if (hasOwn(o, 'squad') !== (o.v === 2)) return bad('shape');
  if (o.v === 2 && !(typeof o.squad === 'string' && SQUAD_SLUG_RE.test(o.squad))) return bad('shape');
  const squad = o.v === 2 ? o.squad : null;
  if (!Number.isSafeInteger(o.at) || o.at < 1e12 || o.at > 1e14) return bad('shape');
  return { ok: true, req: { from: o.from, cwd: o.cwd, title, project, squad, prompt, at: o.at }, raw: { v: o.v, from: o.from, cwd: o.cwd, title: o.title, project, squad, at: o.at, prompt: o.prompt, mac: o.mac } };
}
// 예산(앱 전체, 재시작 뒤에도): 24시간에 20개. launches = 실제로 연 시각(ms) 배열
function budgetOk(launches, nowMs) { // 미래 시각(시계를 되돌린 경우)은 '지금'으로 센다: 되돌려도 예산이 풀리지 않는다
  const recent = (Array.isArray(launches) ? launches : []).filter((t) => Number.isFinite(t) && nowMs - Math.min(t, nowMs) < CHILD_DAY_MS);
  return recent.length < CHILD_DAY_MAX;
}
function recordLaunch(launches, nowMs) { // 새 배열(하루 지난 것은 버리고 20개만)
  return [...(Array.isArray(launches) ? launches : []).filter((t) => Number.isFinite(t) && nowMs - t < CHILD_DAY_MS), nowMs].slice(-CHILD_DAY_MAX);
}
function validateBudget(o) { // -> 시각 배열 | null(손상)
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.version !== 1 || !Array.isArray(o.launches) || o.launches.length > 200) return null;
  return o.launches.filter((t) => Number.isSafeInteger(t) && t > 1e12 && t < 1e14).slice(-CHILD_DAY_MAX);
}
function readBudgetFile(file) { // -> { status, list }
  const fs = require('fs');
  let present = true; try { fs.lstatSync(file); } catch { present = false; }
  if (!present) return { status: 'missing', list: [] };
  const r = readRegular(file, 8192, false);
  let list = null; try { list = r && !r.truncated ? validateBudget(JSON.parse(r.text)) : null; } catch { list = null; }
  return list ? { status: 'ok', list } : { status: 'corrupt', list: [] };
}
function saveBudgetFile(file, launches) { return writeJsonAtomic(file, { version: 1, launches: (Array.isArray(launches) ? launches : []).filter((t) => Number.isSafeInteger(t)).slice(-CHILD_DAY_MAX) }, 'child-budget'); }
// ---- 재전송 방지: 같은 mac 은 120초 안에 두 번 받지 않는다(파일 이름만 바꿔 복사해도). seen = [[mac, 시각]] ----
// 키는 같은 사용자의 다른 프로세스가 읽을 수 있어(ps eww) 비밀이 아니다. mac 은 실수·다른 작업 공간의 요청을 거르는 용도이고, 진짜 관문은 매번 뜨는 동의 창이다
const REPLAY_MS = 120 * 1000; const REPLAY_MAX = 200;
function macSeen(seen, mac, nowMs) { return (Array.isArray(seen) ? seen : []).some((x) => x && x[0] === mac && nowMs - x[1] < REPLAY_MS && x[1] - nowMs < REPLAY_MS); }
function rememberMac(seen, mac, nowMs) { // 새 배열(120초 지난 것은 버리고 200개까지)
  return [...(Array.isArray(seen) ? seen : []).filter((x) => x && Math.abs(nowMs - x[1]) < REPLAY_MS), [mac, nowMs]].slice(-REPLAY_MAX);
}
// ---- 거절 소음 제한: 작업 공간마다 알림은 10초에 한 번, 기록은 1분에 20줄(넘는 것은 센 뒤 한 줄로 요약) ----
const NOTICE_GAP_MS = 10 * 1000; const LOG_PER_MIN = 20;
function noticeOk(lastAt, nowMs) { return !(Number.isFinite(lastAt) && nowMs - lastAt >= 0 && nowMs - lastAt < NOTICE_GAP_MS); }
// st = { start, count, dropped } -> { st, action: 'log'|'skip', summary: 앞 창에서 못 적은 수(0 이면 없음) }
function logGate(st, nowMs) {
  const cur = st && Number.isFinite(st.start) ? st : { start: nowMs, count: 0, dropped: 0 };
  if (nowMs - cur.start >= 60000 || nowMs < cur.start) return { st: { start: nowMs, count: 1, dropped: 0 }, action: 'log', summary: cur.dropped };
  if (cur.count >= LOG_PER_MIN) return { st: { ...cur, dropped: cur.dropped + 1 }, action: 'skip', summary: 0 };
  return { st: { ...cur, count: cur.count + 1 }, action: 'log', summary: 0 };
}
// 요청 하나를 받아들일지(순수). c = { name, size, mtimeMs, text, nowMs, requester(from) -> requesterOf 결과|null, wsCount, childCount() -> 앱 전체 하위 세션 수,
//   accepted: [받아들인 시각 — 단조 시계 ms], monoMs: 지금의 단조 시계 ms, launches: [연 시각 ms(벽시계)], seen: 이미 본 mac 목록, realDir(cwd) -> 실제 경로|null, projectKnown(key) -> boolean }
// -> { ok: true, req, real, parentId, mac } | { ok: false, reason, parentId? }. parentId 는 mac 인증을 통과한 뒤의 거절에만 붙는다(알림은 그 작업 공간에만).
// 이유: name size stale json shape version auth replay cwd title prompt prompt-size project from child not-maru not-claude project-unknown children-max ws-max rate budget
function decideChildRequest(c) {
  const bad = (reason) => ({ ok: false, reason });
  if (!c || typeof c.name !== 'string' || !REQ_NAME_RE.test(c.name)) return bad('name');
  if (!Number.isFinite(c.size) || c.size < 1 || c.size > REQ_MAX_BYTES) return bad('size');
  if (!Number.isFinite(c.nowMs)) return bad('stale');
  if (!Number.isFinite(c.mtimeMs) || c.nowMs - c.mtimeMs > REQ_STALE_MS || c.mtimeMs - c.nowMs > REQ_FUTURE_MS) return bad('stale');
  const p = parseChildRequest(c.text);
  if (!p.ok) return bad(p.reason);
  const req = p.req;
  if (c.nowMs - req.at > REQ_STALE_MS || req.at - c.nowMs > REQ_FUTURE_MS) return bad('stale'); // 오래됐거나 미래의 요청
  const who = typeof c.requester === 'function' ? c.requester(req.from) : null;
  if (!who || typeof who.id !== 'string') return bad('from');
  if (who.running !== true) return bad('not-claude'); // 셸만 떠 있다
  if (who.child === true) return bad('child'); // 하위 세션(이었던 것 포함)은 하위 세션을 열 수 없다(깊이 1)
  if (who.maru !== true) return bad('not-maru');
  if (!childMacOk(who.key, p.raw)) return bad('auth'); // 그 세션의 키로 만든 mac 이어야 한다(같은 사용자 안에서는 비밀이 아님: 위 주석)
  const bad2 = (reason) => ({ ok: false, reason, parentId: who.id }); // 인증된 요청의 거절
  if (macSeen(c.seen, p.raw.mac, c.nowMs)) return bad2('replay');
  const real = typeof c.realDir === 'function' ? c.realDir(req.cwd) : null;
  if (typeof real !== 'string' || !validAbsDir(real)) return bad2('cwd');
  if (req.project !== null && !(typeof c.projectKnown === 'function' && c.projectKnown(req.project) === true)) return bad2('project-unknown');
  const kids = typeof c.childCount === 'function' ? c.childCount() : CHILD_MAX;
  if (!Number.isInteger(kids) || kids >= CHILD_MAX) return bad2('children-max');
  if (!Number.isInteger(c.wsCount) || c.wsCount >= WS_MAX) return bad2('ws-max');
  const mono = Number.isFinite(c.monoMs) ? c.monoMs : c.nowMs; // 분당 한도는 단조 시계로(벽시계를 되돌려도 풀리지 않는다)
  const recent = (Array.isArray(c.accepted) ? c.accepted : []).filter((t) => Number.isFinite(t) && mono - t >= 0 && mono - t < CHILD_RATE_MS);
  if (recent.length >= CHILD_RATE_MAX) return bad2('rate');
  if (!budgetOk(c.launches, c.nowMs)) return bad2('budget');
  return { ok: true, req, real, parentId: who.id, mac: p.raw.mac };
}
// 동의를 기다리는 사이(또는 직후) 상황이 바뀌었을 수 있다: 앱이 끝나 가거나 창이 없으면 안 열고, 부모가 살아 있고 자리가 있고 폴더가 그대로(실제 경로가 승인한 것과 같음)여야 한다
function childLaunchCheck({ quitting, windowOk, parentAlive, children, wsCount, realNow, approvedReal }) {
  if (quitting === true || windowOk !== true) return 'busy';
  if (parentAlive !== true) return 'from';
  if (!Number.isInteger(children) || children >= CHILD_MAX || !Number.isInteger(wsCount) || wsCount >= WS_MAX) return children >= CHILD_MAX ? 'children-max' : 'ws-max';
  if (typeof realNow !== 'string' || realNow !== approvedReal) return 'cwd'; // 동의 뒤에 링크가 바뀌었다
  return null;
}
// 부모(마루 작업 공간)가 계속 쓸 수 있나: 작업 공간이 있고 자격이 있으면 된다(pty 가 그 사이 다시 시작됐어도 같은 작업 공간이다)
function parentUsable({ exists, eligible }) { return exists === true && eligible === true; }
// 창이 보여야만 요청을 받는다(숨은 채로 하위 세션을 열지 않는다; 요청은 60초 안에 보이면 처리, 아니면 만료)
function childWindowReady({ destroyed, visible, minimized }) { return destroyed !== true && visible === true && minimized !== true; }
// 하위 세션을 열면 부모를 펼친다: 접어 둔 부모 id 목록에서 뺀 새 배열
function expandParent(collapsedIds, parentId) { return (Array.isArray(collapsedIds) ? collapsedIds : []).filter((x) => x !== parentId); }
// 동의 창(main 이 상태를 가진다): 대기 중인 하나의 요청에 한 번만 쓰는 토큰. 응답 = 'open'|'cancel'. 토큰이 다르거나 이미 쓰였거나 만료면 invalid
function consentAnswer(pending, token, answer, nowMs) {
  if (!pending || typeof pending.token !== 'string' || typeof token !== 'string' || token.length !== pending.token.length) return { result: 'invalid' };
  if (!require('crypto').timingSafeEqual(Buffer.from(token), Buffer.from(pending.token))) return { result: 'invalid' };
  if (pending.used === true || (Number.isFinite(pending.expiresAt) && nowMs > pending.expiresAt)) return { result: 'invalid' };
  if (answer !== 'open' && answer !== 'cancel') return { result: 'invalid' };
  return { result: answer };
}
const CHILD_REASONS = ['name', 'size', 'stale', 'json', 'shape', 'version', 'auth', 'replay', 'cwd', 'title', 'prompt', 'prompt-size', 'project', 'from', 'child', 'not-maru', 'not-claude', 'project-unknown', 'children-max', 'ws-max', 'rate', 'budget', 'dir', 'file', 'trust-cancel', 'busy', 'start'];
function childReasonCode(reason) { return CHILD_REASONS.includes(reason) ? reason : 'shape'; }
function childReasonKey(reason) { return 'child.reject.' + childReasonCode(reason); }

// ---- 요청 폴더 읽기: 한 번만 처리(이름을 바꿔 먼저 가져오고, 읽은 뒤 지운다). fsx = fs 와 같은 동기 API ----
// 폴더가 진짜 폴더이고 내 소유이며 group/other 쓰기 권한이 없을 때만 쓴다(아니면 채널 전체를 무시)
function reqDirOk(dir, fsx, uid) {
  try { const st = fsx.lstatSync(dir); return st.isDirectory() && !st.isSymbolicLink() && st.uid === uid && (st.mode & 0o022) === 0; } catch { return false; }
}
function rmEntry(fsx, f) { // 링크·일반 파일은 지우고 폴더·특수 파일은 통째로(이름 규칙에 맞는 항목에만 쓴다)
  try { const st = fsx.lstatSync(f); if (st.isDirectory() && !st.isSymbolicLink()) fsx.rmSync(f, { recursive: true, force: true }); else fsx.unlinkSync(f); return true; } catch { return false; }
}
// -> { dirOk, items: [{ name, text|null, size, mtimeMs, reason? }] }. 이름 규칙에 맞는 항목만 본다. 미래 mtime(> now+2초)·일반 파일이 아닌 것은 지우고 건너뛴다.
// 쓰는 중(settleMs 안)인 것은 다음으로 미룬다. 20개 상한은 거른 뒤에 적용. handled: 이미 가져간 이름(메모리, 최대 500)
function takeChildRequests({ dir, fsx, uid, rand, handled, nowMs, settleMs = 150, limit = REQ_FILES_PER_SCAN }) {
  const path = require('path');
  if (!reqDirOk(dir, fsx, uid)) return { dirOk: false, items: [] };
  let names = [];
  try { names = fsx.readdirSync(dir); } catch { return { dirOk: true, items: [] }; }
  const ready = [];
  for (const name of names.filter((n) => REQ_NAME_RE.test(n)).sort()) {
    if (handled && handled.has(name)) continue;
    const f = path.join(dir, name);
    let st; try { st = fsx.lstatSync(f); } catch { continue; }
    if (!st.isFile()) { rmEntry(fsx, f); continue; } // 폴더·링크·특수 파일: 읽지 않고 치운다
    if (Number.isFinite(nowMs)) {
      if (st.mtimeMs - nowMs > REQ_FUTURE_MS) { rmEntry(fsx, f); continue; } // 미래 시각: 무시하고 지운다
      if (settleMs > 0 && nowMs - st.mtimeMs < settleMs) continue; // 쓰는 중일 수 있다: 다음 훑기에
    }
    ready.push(name);
  }
  const items = [];
  for (const name of ready.slice(0, limit)) {
    if (handled) { if (handled.size >= 500) handled.delete(handled.values().next().value); handled.add(name); }
    const mine = path.join(dir, '.taken-' + rand() + '.tmp');
    try { fsx.renameSync(path.join(dir, name), mine); } catch { continue; } // 이미 누가 가져갔다
    const item = { name, text: null, size: 0, mtimeMs: 0, reason: 'file' };
    try {
      const st = fsx.lstatSync(mine);
      item.size = st.size; item.mtimeMs = st.mtimeMs;
      if (st.isFile() && st.uid === uid && st.size <= REQ_MAX_BYTES) {
        const r = readRegular(mine, REQ_MAX_BYTES, false);
        if (r && !r.truncated) { item.text = r.text; delete item.reason; }
      } else if (st.size > REQ_MAX_BYTES) item.reason = 'size';
    } catch { /* 위 기본값 */ }
    rmEntry(fsx, mine); // 가져간 임시 파일은 쓰고 나면 반드시 지운다
    items.push(item);
  }
  return { dirOk: true, items };
}
// 앱을 켤 때: 남아 있는 요청·가져간 임시 파일을 처리하지 않고 지운다(일반 파일·링크, 이름 규칙에 맞는 폴더 등 특수 항목). 지운 수
function purgeChildRequests({ dir, fsx, uid }) {
  const path = require('path');
  if (!reqDirOk(dir, fsx, uid)) return 0;
  let n = 0;
  try {
    for (const name of fsx.readdirSync(dir)) {
      const f = path.join(dir, name);
      try {
        const st = fsx.lstatSync(f);
        if (st.isFile() || st.isSymbolicLink()) { fsx.unlinkSync(f); n++; }
        else if (REQ_NAME_RE.test(name) || /^\.taken-/.test(name)) { if (rmEntry(fsx, f)) n++; }
      } catch { /* 건너뜀 */ }
    }
  } catch { /* 없음 */ }
  return n;
}

// 동의 창에 보일 값(전체 경로·제목·프로젝트·전체 맡길 내용). 모두 요청에서 온 값이라 renderer 가 textContent 로만 쓴다
// squads: parseSquadMeta 가 검증한 목록(main 이 그 순간 직접 읽은 것). squad: 요청이 말한 slug|null. 목록에 있으면 미리 고르고(suggested), 없으면 "팀 없이" 로 두고 squadMissing 을 켠다
function consentView({ token, folder, project, title, prompt, paste, squads, squad }) {
  const brief = cleanPromptText(prompt); // 전달하는 것과 같은 문자열(이미 정규화돼 있다). 자르지 않는다
  const teams = squadChoices(squads);
  const asked = typeof squad === 'string' && SQUAD_SLUG_RE.test(squad) ? squad : null;
  const known = asked !== null && teams.some((q) => q.slug === asked);
  return { token, folder, project: project || null, title, brief, chars: cpLen(brief), lines: brief ? brief.split('\n').length : 0, paste: paste === true,
    squads: teams, squad: known ? asked : null, squadMissing: asked !== null && !known, squadAsked: asked };
}
// 동의 창에 보일 팀 목록(slug·이름·개인 여부만)
function squadChoices(squads) {
  return (Array.isArray(squads) ? squads : []).filter((q) => q && typeof q.slug === 'string' && SQUAD_SLUG_RE.test(q.slug) && typeof q.name === 'string' && q.name).slice(0, SQUADS_MAX).map((q) => ({ slug: q.slug, name: q.name, personal: q.personal === true }));
}
// 승인과 함께 온 팀 선택(렌더러가 준 값)을 main 이 그 순간 읽은 목록으로 다시 검증한다(순수). choice: null|undefined(= 팀 없이) 또는 slug.
// -> { ok: true, squad: slug|null } | { ok: false }. 형식이 틀리거나 목록에 없으면 거부(요청·렌더러의 말을 믿지 않는다)
function consentChoice(squads, choice) {
  if (choice === null || choice === undefined) return { ok: true, squad: null };
  if (typeof choice !== 'string' || !SQUAD_SLUG_RE.test(choice)) return { ok: false };
  return squadChoices(squads).some((q) => q.slug === choice) ? { ok: true, squad: choice } : { ok: false };
}
// "스쿼드 만들기" 요청 문구 정리(순수): 문자열만. 제어·서식 문자와 개행은 공백으로, 공백은 하나로, 앞뒤 정리, 1~300 코드포인트. 비면·비밀처럼 보이면(looksSecret) ''
const SQUAD_ASK_MAX = 300;
function cleanSquadAsk(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(BAD_CHARS_G, ' ').replace(/\s+/g, ' ').trim();
  const n = [...t].length;
  return n >= 1 && n <= SQUAD_ASK_MAX && !looksSecret(t) ? t : '';
}

// ======== 사용자가 직접 여는 하위 세션(마루 작업 공간 아래) ========
// 폴더는 렌더러가 주지 않는다: main 이 연 폴더 선택창의 결과를 "초안"(한 번만 쓰는 토큰)에 담아 두고, 렌더러는 표시용 문자열과 토큰만 받는다.
const SUB_TITLE_MAX = REQ_TITLE_MAX; const SUB_BRIEF_MAX = REQ_PROMPT_MAX; // 마루가 맡기는 것과 같은 한도
const SUB_DRAFT_MS = 10 * 60 * 1000; const SUB_DRAFT_MAX = 8;
const SUB_TOKEN_RE = /^[0-9a-f]{32}$/;
const SUB_OPEN_KEYS = ['parent', 'token', 'title', 'brief', 'squad', 'notify'];
// 열기 요청(렌더러가 준 값, 신뢰하지 않는다) -> { ok: true, parent, token, title, brief, squad, notify } | { ok: false, reason: 'invalid'|'title'|'brief' }
// title 은 정리한 값(비면 '' — 호출 쪽이 폴더 이름으로 채운다), brief 는 마루의 브리핑과 같은 정리(비어도 된다)
function parseSubOpen(o) {
  const bad = (reason) => ({ ok: false, reason });
  if (!o || typeof o !== 'object' || Array.isArray(o)) return bad('invalid');
  const keys = Object.keys(o);
  if (keys.length !== SUB_OPEN_KEYS.length || keys.some((k) => !SUB_OPEN_KEYS.includes(k))) return bad('invalid');
  if (!validWsId(o.parent) || typeof o.token !== 'string' || !SUB_TOKEN_RE.test(o.token)) return bad('invalid');
  if (typeof o.title !== 'string' || typeof o.brief !== 'string' || typeof o.notify !== 'boolean') return bad('invalid');
  if (!(o.squad === null || (typeof o.squad === 'string' && SQUAD_SLUG_RE.test(o.squad)))) return bad('invalid');
  if (o.title.length > SUB_TITLE_MAX * 4) return bad('title');
  const title = cleanQuestText(o.title);
  if (cpLen(title) > SUB_TITLE_MAX) return bad('title');
  if (o.brief.length > SUB_BRIEF_MAX * 4) return bad('brief');
  const brief = cleanPromptText(o.brief);
  if (cpLen(brief) > SUB_BRIEF_MAX) return bad('brief');
  if (brief && (Buffer.byteLength(childPromptText('ko', brief, 'user'), 'utf8') > PROMPT_FILE_MAX || Buffer.byteLength(childPromptText('en', brief, 'user'), 'utf8') > PROMPT_FILE_MAX)) return bad('brief'); // 전달 파일(머리말 포함)이 16KB 를 넘으면 조용히 줄이지 않고 거부
  return { ok: true, parent: o.parent, token: o.token, title, brief, squad: o.squad, notify: o.notify };
}
// 초안 보관소(Map: token -> { parentId, real, display, expiresAt }). 부모마다 하나만 두고(새로 고르면 이전 것은 버린다), 만료된 것은 치운다
function subDraftAdd(store, { token, parentId, real, display, nowMs }) {
  if (!(store instanceof Map) || typeof token !== 'string' || !SUB_TOKEN_RE.test(token) || !validWsId(parentId) || !validAbsDir(real) || typeof display !== 'string' || !Number.isFinite(nowMs)) return false;
  for (const [k, d] of store) if (nowMs > d.expiresAt || d.parentId === parentId) store.delete(k);
  while (store.size >= SUB_DRAFT_MAX) store.delete(store.keys().next().value);
  store.set(token, { parentId, real, display, expiresAt: nowMs + SUB_DRAFT_MS });
  return true;
}
// -> { ok: true, draft } | { ok: false, reason: 'invalid'|'expired' }. 토큰이 없거나(이미 썼거나) 다른 부모의 것이면 invalid
function subDraftCheck(store, token, parentId, nowMs) {
  if (!(store instanceof Map) || typeof token !== 'string' || !SUB_TOKEN_RE.test(token)) return { ok: false, reason: 'invalid' };
  const d = store.get(token);
  if (!d || d.parentId !== parentId) return { ok: false, reason: 'invalid' };
  if (!Number.isFinite(nowMs) || nowMs > d.expiresAt) { store.delete(token); return { ok: false, reason: 'expired' }; }
  return { ok: true, draft: d };
}
function subDraftUse(store, token) { return store instanceof Map && store.delete(token); } // 열었으면 한 번 쓴 것으로 지운다(다시 쓰면 invalid)
// 마루가 요청한 경로(decideChildRequest)와 같은 한도, 같은 순서: 하위 세션 수 -> 작업 공간 수 -> 분당 -> 하루. 막히면 이유 코드(child.reject.*), 아니면 null
function subLimitCheck({ childCount, wsCount, accepted, monoMs, launches, nowMs }) {
  if (!Number.isInteger(childCount) || childCount >= CHILD_MAX) return 'children-max';
  if (!Number.isInteger(wsCount) || wsCount >= WS_MAX) return 'ws-max';
  const recent = (Array.isArray(accepted) ? accepted : []).filter((t) => Number.isFinite(t) && monoMs - t >= 0 && monoMs - t < CHILD_RATE_MS);
  if (recent.length >= CHILD_RATE_MAX) return 'rate';
  if (!budgetOk(launches, nowMs)) return 'budget';
  return null;
}
// "마루에게 알리기" 한 줄: 고정 문장(i18n sub.noticeLine)에 정리한 제목·폴더(표시용, 홈은 ~)만 끼운다. 개행·제어 문자 없음, 비면 ''
function cleanNoticePart(s, max) {
  const t = typeof s === 'string' ? s.replace(BAD_CHARS_G, ' ').replace(/\s+/g, ' ').trim() : '';
  return [...t].slice(0, max).join('').trim();
}
function subNoticeLine(tr, title, folder) {
  const t = cleanNoticePart(title, SUB_TITLE_MAX); const f = cleanNoticePart(folder, 80);
  if (!t || !f || typeof tr !== 'function') return '';
  return cleanQuestText(String(tr('sub.noticeLine', { title: t, folder: f })));
}

// ---- 프롬프트 전달: 셸에 글을 쓰지 않고 파일로 건넨다(래퍼가 읽고 지운다) ----
const CHILD_HEADER = {
  ko: '[마루가 맡긴 일] 이 세션은 총괄 에이전트 마루가 이 프로젝트의 일을 맡기려고 열었습니다. 아래가 맡긴 내용입니다. 설계 문서가 있으면 먼저 읽고, 끝나면 무엇을 했고 무엇이 남았는지 짧게 보고하세요.',
  en: '[Task from Maru] This session was opened by Maru, the coordinating agent, to hand off work on this project. Below is what was handed over. If there is a design document, read it first, and when you finish, briefly report what you did and what remains.',
};
const CHILD_HEADER_USER = { // 사용자가 직접 연 하위 세션의 머리말(마루가 연 것이 아니므로 그렇게 말하지 않는다)
  ko: '[사용자가 맡긴 일] 이 세션은 사용자가 마루에서 직접 연 하위 세션입니다. 아래가 맡긴 내용입니다. 설계 문서가 있으면 먼저 읽고, 끝나면 무엇을 했고 무엇이 남았는지 짧게 보고하세요.',
  en: '[Task from the user] This session was opened by the user directly from Maru as a child session. Below is what was handed over. If there is a design document, read it first, and when you finish, briefly report what you did and what remains.',
};
const PROMPT_FILE_MAX = 16384; const PROMPT_STALE_MS = 5 * 60 * 1000;
const PROMPT_FILE_RE = /^[0-9a-f]{16}\.txt$/;
function childPromptText(lang, prompt, by) { // 고정 머리말(코드가 만든다) + 빈 줄 + 정리된 프롬프트. by === 'user' 면 사용자가 직접 연 세션용 머리말
  const p = cleanPromptText(prompt);
  const H = by === 'user' ? CHILD_HEADER_USER : CHILD_HEADER;
  return p ? (H[lang] || H.ko) + '\n\n' + p : '';
}
// 전달 파일은 정확히 한 번만 쓴다. 시작하려는 순간의 상황으로 무엇을 할지 정한다(순수): file = 아직 안 쓴 전달 파일 경로|null, wrapperOk = 래퍼를 지금 쓸 수 있나
// -> { env: 파일 경로|null(환경변수로 건넬 것), deleteFile: 지울 파일|null, paste: 입력줄에 채우기로 내려가나 }
function promptHandoff({ file, wrapperOk }) {
  if (typeof file !== 'string' || !file) return { env: null, deleteFile: null, paste: false };
  if (wrapperOk !== true) return { env: null, deleteFile: file, paste: true }; // 승인 뒤 래퍼를 못 쓰게 됐다: 파일은 지우고 같은 내용을 입력줄에(Enter 는 사용자가)
  return { env: file, deleteFile: null, paste: false };
}
// 하위 세션을 만든 직후 맡길 내용을 어떻게 할지(순수). hasFile = 전달 파일을 썼나, text = 맡길 내용(머리말 포함, 비면 '')
// -> { pasteNow: 지금 입력줄에 채우나(파일 없이 내용만 있을 때), keepBrief: 시작 순간 래퍼를 못 쓰게 될 때를 위해 내용을 들고 있나(파일이 있을 때) }
function childBriefPlan({ hasFile, text }) {
  const has = typeof text === 'string' && text !== '';
  return { pasteNow: !hasFile && has, keepBrief: !!hasFile && has };
}
// 시작 순간에 입력줄에 채울 내용(순수). 파일을 래퍼로 건네지 못하게 됐고(ho.paste) 들고 있던 내용이 있을 때만 그 내용, 아니면 null
function briefAtSpawn(ho, brief) {
  return ho && ho.paste === true && typeof brief === 'string' && brief !== '' ? brief : null;
}
// 마루 자신의 폴더인가(순수): 둘 다 이미 실제 경로로 바꾼 절대 경로여야 같다고 본다
function isMaruRootDir(real, rootReal) {
  return typeof real === 'string' && real !== '' && typeof rootReal === 'string' && rootReal !== '' && real === rootReal;
}
function promptDirOk(dir, fsx, uid, create) {
  try {
    let st = null; try { st = fsx.lstatSync(dir); } catch { /* 없음 */ }
    if (!st) { if (!create) return false; fsx.mkdirSync(dir, { recursive: true, mode: 0o700 }); st = fsx.lstatSync(dir); }
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || (st.mode & 0o022) !== 0) return false;
    if ((st.mode & 0o777) !== 0o700) fsx.chmodSync(dir, 0o700);
    return true;
  } catch { return false; }
}
// -> 파일 경로 | null. 폴더 700, 파일 600, 임시 파일에 쓴 뒤 이름을 바꾼다(반쯤 쓴 파일이 보이지 않는다). 16KB 넘으면 쓰지 않는다
function writeChildPromptFile({ dir, text, rand, fsx, uid }) {
  const path = require('path');
  if (typeof text !== 'string' || !text || Buffer.byteLength(text, 'utf8') > PROMPT_FILE_MAX) return null;
  if (!promptDirOk(dir, fsx, uid, true)) return null;
  const name = rand();
  if (typeof name !== 'string' || !/^[0-9a-f]{16}$/.test(name)) return null;
  const fin = path.join(dir, name + '.txt'); const tmp = path.join(dir, '.' + name + '.tmp');
  let fd = null;
  try {
    fd = fsx.openSync(tmp, fsx.constants.O_WRONLY | fsx.constants.O_CREAT | fsx.constants.O_EXCL | fsx.constants.O_NOFOLLOW, 0o600);
    fsx.writeSync(fd, text); fsx.fsyncSync(fd); fsx.closeSync(fd); fd = null;
    fsx.renameSync(tmp, fin);
    return fin;
  } catch {
    if (fd !== null) try { fsx.closeSync(fd); } catch { /* 무시 */ }
    try { fsx.unlinkSync(tmp); } catch { /* 없음 */ }
    return null;
  }
}
// 5분 넘은 전달 파일·임시 파일 삭제(일반 파일만). 지운 수
function cleanStalePromptFiles({ dir, nowMs, fsx, uid, ttlMs = PROMPT_STALE_MS }) {
  const path = require('path');
  if (!promptDirOk(dir, fsx, uid, false)) return 0;
  let n = 0;
  try {
    for (const name of fsx.readdirSync(dir)) {
      if (!(PROMPT_FILE_RE.test(name) || /^\.[0-9a-f]{16}\.tmp$/.test(name))) continue;
      try { const f = path.join(dir, name); const st = fsx.lstatSync(f); if (st.isFile() && nowMs - st.mtimeMs > ttlMs) { fsx.unlinkSync(f); n++; } } catch { /* 건너뜀 */ }
    }
  } catch { /* 없음 */ }
  return n;
}
// 하위 세션 pty 환경변수(sanitizeHostEnv 를 거친 환경에 얹는다): 고정 작업 공간 id(모든 작업 공간)·부모의 고정 id·프로젝트·프롬프트 파일. 부모의 앱 세션 id·인증 키는 넣지 않는다
function childEnvVars({ ws, parentWs, project, promptFile, squad }) {
  const out = {};
  if (validStableId(ws)) out.MARU_WS = ws; // 모든 작업 공간: 재시작·재실행에도 변하지 않는 id(보고 폴더의 키)
  if (validStableId(parentWs)) out.MARU_PARENT_WS = parentWs; // 하위 세션: 부모의 고정 id(저장된 parentId 에서; 부모 pty 가 아직 안 떠 있어도 된다)
  if (isProjectKey(project)) out.MARU_PROJECT = project; // 설계 문서 폴더(--add-dir)는 넘기지 않는다: 하위 세션이 고치려면 Claude Code 의 보통 권한 확인을 거친다
  if (typeof promptFile === 'string' && validAbsDir(promptFile) && promptFile.length <= 1024) out.MARU_CHILD_PROMPT_FILE = promptFile;
  if (typeof squad === 'string' && SQUAD_SLUG_RE.test(squad)) out.MARU_CHILD_SQUAD = squad; // 하위 세션에만 main 이 넘긴다. 래퍼가 JSON 에 총괄이 있을 때만 --agent 를 붙인다
  return out;
}
// 작업 공간 pty 의 환경(순수): 호스트 환경을 정리하고, 앱이 정한 값만 얹는다. 물려받은 MARU_APP*·MARU_WS·MARU_PARENT_*·MARU_PROJECT·MARU_CHILD_*·MARU_REQ_KEY 는 모두 지운다.
// reqKey 는 마루가 될 수 있는 작업 공간(maruEligible)에만 넘긴다. 다른 작업 공간(하위 세션 포함)에는 어떤 경우에도 키가 없다
function ptyEnv({ host, ws, parentWs, project, promptFile, reqKey, squad }) {
  const env = { ...sanitizeHostEnv(host), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_') || k.startsWith('MARU_APP') || k === 'MARU_WS' || k.startsWith('MARU_PARENT_') || k === 'MARU_PROJECT' || k.startsWith('MARU_CHILD_') || k.startsWith('MARU_REQ')) delete env[k];
  Object.assign(env, childEnvVars({ ws, parentWs, project, promptFile, squad }));
  if (typeof reqKey === 'string' && REQ_KEY_RE.test(reqKey)) env.MARU_REQ_KEY = reqKey;
  return env;
}

// ---- 목록 순서·접기 ----
// items [{ id, parentId? }] -> 화면 순서의 [{ id, depth }]: 최상위는 원래 순서, 각 부모 바로 뒤에 자식(만든 순서). 부모가 없거나 부모가 자식이면 최상위로 본다(깊이는 1 까지)
function hierarchyOrder(items) {
  const list = Array.isArray(items) ? items.filter((x) => x && typeof x.id === 'string') : [];
  const byId = new Map(list.map((x) => [x.id, x]));
  const parentOf = (x) => { const p = typeof x.parentId === 'string' && x.parentId !== x.id ? byId.get(x.parentId) : null; return p && !(typeof p.parentId === 'string' && byId.has(p.parentId) && p.parentId !== p.id) ? p : null; };
  const kids = new Map();
  for (const x of list) { const p = parentOf(x); if (p) { if (!kids.has(p.id)) kids.set(p.id, []); kids.get(p.id).push(x); } }
  const out = [];
  for (const x of list) {
    if (parentOf(x)) continue;
    out.push({ ...x, depth: 0 });
    for (const k of kids.get(x.id) || []) out.push({ ...k, depth: 1 });
  }
  return out;
}
// 작업 공간 순서 바꾸기. items [{ id, parentId? }] 저장 순서 -> id 를 beforeId(같은 형제 묶음의 id, null 이면 묶음의 맨 끝) 앞으로 옮긴 전체 id 배열. 안 되면 null(모르는 id·자기 앞·다른 묶음·제자리).
// 형제 묶음은 hierarchyOrder 와 같은 규칙(최상위 전체가 한 묶음, 한 부모의 자식이 한 묶음). 그 묶음이 차지한 자리만 바뀌고 나머지는 제자리다.
function reorderWs(items, id, beforeId) {
  const list = Array.isArray(items) ? items.filter((x) => x && typeof x.id === 'string') : [];
  if (typeof id !== 'string' || (beforeId !== null && typeof beforeId !== 'string') || id === beforeId) return null;
  const parents = new Map(hierarchyOrder(list).map((x) => [x.id, x.depth === 1 ? list.find((y) => y.id === x.id).parentId : null]));
  if (!parents.has(id) || (beforeId !== null && !parents.has(beforeId)) || (beforeId !== null && parents.get(beforeId) !== parents.get(id))) return null;
  const grp = parents.get(id);
  const slots = []; const members = [];
  list.forEach((x, i) => { if (parents.get(x.id) === grp) { slots.push(i); members.push(x.id); } });
  const next = moveInOrder(members, id, beforeId);
  if (!next || next.every((x, i) => x === members[i])) return null;
  const out = list.map((x) => x.id); slots.forEach((at, i) => { out[at] = next[i]; });
  return out;
}
// 화면에 보이는 작업 공간 id(⌘숫자 대상). 접힌 부모(고정 id)의 자식은 숨긴다(활성인 자식은 보인다). ordered = hierarchyOrder 결과
function visibleWsIds(ordered, collapsedIds, activeId) {
  const closed = new Set(Array.isArray(collapsedIds) ? collapsedIds : []);
  let cur = null; const out = [];
  for (const x of Array.isArray(ordered) ? ordered : []) {
    if (x.depth === 0) { cur = x.id; out.push(x.id); continue; }
    if (closed.has(cur) && x.id !== activeId) continue;
    out.push(x.id);
  }
  return out;
}

// ---- 상태 표시 ----
// 저장소(훅이 도는 곳) 밖 폴더의 작업 공간은 상태 훅이 없다: 바쁨도 입력 대기도 아닌 '알 수 없음'. 단, 읽지 않은 보고가 있고 그 뒤로 pty 출력이 거의 없으면(turnEnded) 턴이 끝났음이 증명된다
const REPORT_PROOF_SLACK_MS = 5000;
function stateDisplay({ state, hasTerm, outsideRoot, reportedAt, lastOutputAt }) {
  if (state !== 'none' || hasTerm !== true || outsideRoot !== true) return state;
  if (Number.isFinite(reportedAt) && reportedAt > 0 && !(Number.isFinite(lastOutputAt) && lastOutputAt > reportedAt + REPORT_PROOF_SLACK_MS)) return 'turnEnded';
  return 'unknown';
}
// 안 읽은 답변 표시: 표시 상태가 busy→idle/waiting/turnEnded(또는 unknown→turnEnded)로 바뀌었을 때, 사용자가 보고 있지 않으면 켠다. 보고 있으면(활성 작업 공간 + 창 포커스) 끈다. 시작·복원(prev 없음)·none/pending→idle·exited 는 켜지 않는다
function unreadNext({ prev, next, unread, looking }) {
  if (looking === true) return false;
  if (next === 'busy') return false; // 다시 작업 중이면 아직 끝난 답변이 아니다(조용한 구간을 대기로 잘못 본 표시를 거둔다). 진짜로 끝나면 다시 표시된다
  if (unread === true) return true;
  if (prev === 'busy') return next === 'idle' || next === 'waiting' || next === 'turnEnded';
  return prev === 'unknown' && next === 'turnEnded';
}
// 훅 기록의 cwd 가 작업 공간을 연 폴더와 다르면 그 폴더 이름(마지막 조각), 아니면 null. 다른 출처로 짐작하지 않는다
function currentLocation({ recCwd, cwd, cwdReal }) {
  if (!validRecCwd(recCwd)) return null;
  const norm = (p) => (typeof p === 'string' && p.length > 1 ? p.replace(/\/+$/, '') : p);
  const c = norm(recCwd);
  if (c === norm(cwd) || c === norm(cwdReal)) return null;
  const base = c.split('/').filter(Boolean).pop();
  return base ? [...base].slice(0, 40).join('') : null;
}
// 하위 세션 줄 아래에 보일 실행 중 서브에이전트 이름(상태가 알려졌을 때만; summarizeSubs 결과 [{type,count}] 에서 최대 3개)
function childSubNames(subs) {
  return (Array.isArray(subs) ? subs : []).filter((s) => s && typeof s.type === 'string' && SUB_TYPE_RE.test(s.type)).slice(0, 3).map((s) => s.type);
}

// ---- 보고(스크립트가 쓰는 <ROOT>/data/state/app/reports/<마루 작업 공간 고정 id>/<epoch-ms>-<자식 고정 id>.json): 표시만 한다 ----
const REPORT_MAX_BYTES = 8192; const REPORT_TEXT_MAX = 2000; const REPORT_FILES_MAX = 50; const REPORT_SCAN_MAX = 200; const REPORT_FUTURE_MS = 60 * 1000; const REPORT_FLASH_GAP_MS = 60 * 1000;
const REPORT_NAME_RE = /^(\d{13})-([A-Za-z0-9_-]{4,64})\.json$/;
const REPORT_KEYS = ['v', 'from', 'project', 'cwd_name', 'at', 'bg', 'text'];
// text 가 비어 있어도 유효하다(= "턴이 끝났다" 표지). nowMs 가 있으면 at 이 now+60초보다 미래인 보고는 버린다
function parseReport(text, nowMs) { // -> { from, project, cwdName, at, bg, text } | null
  if (typeof text !== 'string' || text.length > REPORT_MAX_BYTES) return null;
  let o; try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some((k) => !REPORT_KEYS.includes(k))) return null;
  if (o.v !== 1 || !validStableId(o.from) || typeof o.text !== 'string' || !Number.isSafeInteger(o.at) || o.at < 1e12 || o.at > 1e14) return null;
  if (Number.isFinite(nowMs) && o.at > nowMs + REPORT_FUTURE_MS) return null;
  const body = [...cleanPromptText(o.text)].slice(0, REPORT_TEXT_MAX).join('');
  const project = hasOwn(o, 'project') && isProjectKey(o.project) ? o.project : null;
  const cwdName = hasOwn(o, 'cwd_name') && typeof o.cwd_name === 'string' && o.cwd_name && cpLen(o.cwd_name) <= 80 && !hasBadChars(o.cwd_name) ? o.cwd_name : null;
  const bg = hasOwn(o, 'bg') ? (o.bg === true ? 1 : Number.isInteger(o.bg) && o.bg >= 0 && o.bg <= 99 ? o.bg : 0) : 0;
  return { from: o.from, project, cwdName, at: o.at, bg, text: body };
}
// 보고 폴더 읽기(읽기 전용, 비동기): 진짜 폴더·내 소유·group/other 쓰기 없음, 파일은 일반 파일·내 소유·8KB 이하·이름 규칙. 이름 200개까지만 훑고 최신순 50개. fsp = fs.promises 와 같은 API
async function readReportsDir({ dir, fsp, uid, nowMs }) {
  const path = require('path'); const fsc = require('fs').constants;
  try { const st = await fsp.lstat(dir); if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || (st.mode & 0o022) !== 0) return []; } catch { return []; }
  let names = []; try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names.filter((n) => REPORT_NAME_RE.test(n)).sort().reverse().slice(0, REPORT_SCAN_MAX)) {
    if (out.length >= REPORT_FILES_MAX) break;
    let fh = null;
    try {
      const f = path.join(dir, name); const ls = await fsp.lstat(f);
      if (!ls.isFile() || ls.uid !== uid || ls.size > REPORT_MAX_BYTES) continue;
      fh = await fsp.open(f, fsc.O_RDONLY | fsc.O_NOFOLLOW | fsc.O_NONBLOCK);
      const st = await fh.stat();
      if (!st.isFile() || st.size > REPORT_MAX_BYTES) continue;
      const buf = Buffer.alloc(st.size); const { bytesRead } = await fh.read(buf, 0, st.size, 0);
      const rep = parseReport(buf.toString('utf8', 0, bytesRead), nowMs);
      if (rep) out.push(rep);
    } catch { /* 건너뜀 */ } finally { if (fh) try { await fh.close(); } catch { /* 무시 */ } }
  }
  return out.sort((a, b) => b.at - a.at);
}
// reports: parseReport 결과 배열, kids: [{ id(고정 작업 공간 id; 보고의 from 과 같다), title, project }]
// -> { count(알려진 하위 세션의 보고만), items: [{ at, title|null, project, text, bg, known }], lastAt: { <하위 세션 id>: 시각 } }. 모르는 보낸이는 목록에는 보이지만 세지 않는다
function summarizeReports(reports, kids) {
  const byId = new Map((Array.isArray(kids) ? kids : []).filter((k) => k && validStableId(k.id)).map((k) => [k.id, k]));
  const items = []; const lastAt = {}; let known = 0;
  for (const r of Array.isArray(reports) ? reports : []) {
    const k = byId.get(r.from) || null;
    items.push({ at: r.at, title: k ? k.title : null, project: k ? k.project || null : null, text: r.text, bg: r.bg, known: !!k });
    if (k) { known++; if (!(lastAt[k.id] >= r.at)) lastAt[k.id] = r.at; }
  }
  return { count: Math.min(known, 99), items: items.slice(0, REPORT_FILES_MAX), lastAt };
}
// 0 -> 1 이상으로 바뀌었고 마루 작업 공간이 활성이 아닐 때만, 같은 작업 공간에서 60초에 한 번까지
function reportFlash({ prev, next, active, lastFlashAt, nowMs }) {
  if (!(Number.isInteger(prev) && Number.isInteger(next) && prev === 0 && next > 0 && active !== true)) return false;
  return !(Number.isFinite(lastFlashAt) && Number.isFinite(nowMs) && nowMs - lastFlashAt < REPORT_FLASH_GAP_MS);
}
// 한 줄 기록(개인 정보 없이: 이유 코드와 파일 이름뿐)
function childLogLine(kind, reason, name) { return String(kind).replace(/[^a-z-]/g, '').slice(0, 12) + ' ' + String(reason).replace(/[^a-z-]/g, '').slice(0, 20) + ' ' + (typeof name === 'string' && REQ_NAME_RE.test(name) ? name : '-'); }

// ---- 좌우 패널 너비(끌어서 조절) ----
// 기본값은 style.css 의 .left / .right-col flex-basis 와 같아야 한다. 가운데 열은 최소 PANEL_CENTER_MIN 이 남아야 한다.
const PANEL_DEFAULT = { left: 220, right: 340 };
const PANEL_RANGE = { left: [180, 480], right: [260, 560] };
const PANEL_CENTER_MIN = 420;
const PANEL_PAD = 16; // .cols 의 좌우 안쪽 여백과 열 사이 간격(각 16px): 가운데 = 창 - 여백 2개 - 간격 2개 - 왼쪽 - 오른쪽
const PANEL_NARROW_MAX = 1100; // 이하에서는 CSS 가 왼쪽을 PANEL_LEFT_NARROW 로 고정한다
const PANEL_LEFT_NARROW = 150;
const PANEL_STORE_KEY = 'maru.cols.v1';
const panelNum = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);
const panelVw = (vw) => (typeof vw === 'number' && Number.isFinite(vw) && vw > 0 ? vw : null);
// side 쪽 패널이 가질 수 있는 [min, max]. other 는 반대쪽의 지금 너비(숫자가 아니면 기본값). 창 너비가 없으면 고정 범위만. 최소값이 항상 이긴다.
function panelRange(side, other, viewportWidth) {
  const s = side === 'left' ? 'left' : 'right'; const o = s === 'left' ? 'right' : 'left';
  const [min, max] = PANEL_RANGE[s];
  const vw = panelVw(viewportWidth);
  if (vw === null) return { min, max };
  let otherEff = panelNum(other, PANEL_DEFAULT[o]);
  if (vw <= PANEL_NARROW_MAX) { if (s === 'left') return { min, max }; otherEff = PANEL_LEFT_NARROW; } // 좁은 배치의 왼쪽은 CSS 가 150px 로 고정(여기서는 저장값만 범위 안으로)
  const room = vw - 4 * PANEL_PAD - PANEL_CENTER_MIN - otherEff;
  return { min, max: Math.max(min, Math.min(max, room)) };
}
// 저장·입력값 -> 화면에 적용할 너비. 잘못된 값(NaN·문자열 등)은 기본값. 저장값 자체는 바꾸지 않는다(호출한 쪽이 보관).
function clampPanelWidths(w, viewportWidth) {
  const src = w && typeof w === 'object' ? w : {};
  const cl = (v, r) => Math.max(r.min, Math.min(r.max, v));
  const l0 = cl(panelNum(src.left, PANEL_DEFAULT.left), { min: PANEL_RANGE.left[0], max: PANEL_RANGE.left[1] }); const r0 = cl(panelNum(src.right, PANEL_DEFAULT.right), { min: PANEL_RANGE.right[0], max: PANEL_RANGE.right[1] });
  const right = cl(r0, panelRange('right', l0, viewportWidth));
  const left = cl(l0, panelRange('left', right, viewportWidth));
  return { left, right };
}
// 저장된 JSON 문자열 -> {left,right} 또는 null(없음·깨짐·두 값 모두 숫자 아님)
function parsePanelWidths(text) {
  let o = null; try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (!(typeof o.left === 'number' && Number.isFinite(o.left)) && !(typeof o.right === 'number' && Number.isFinite(o.right))) return null;
  return { left: panelNum(o.left, PANEL_DEFAULT.left), right: panelNum(o.right, PANEL_DEFAULT.right) };
}
// 개발용 환경변수 MARU_APP_COLS="왼쪽,오른쪽"(정수 둘) -> {left,right} 또는 null
function parseColsEnv(s) {
  const m = /^\s*(\d{1,4})\s*,\s*(\d{1,4})\s*$/.exec(typeof s === 'string' ? s : '');
  return m ? { left: Number(m[1]), right: Number(m[2]) } : null;
}
// 키보드 조절: 손잡이가 움직이는 방향 기준(왼쪽 손잡이 → 는 왼쪽을 넓히고, 오른쪽 손잡이 ← 는 오른쪽을 넓힌다). 반환: 'default' | 'min' | 'max' | 변화량(px) | null
function panelKeyDelta(side, key, shift) {
  if (key === 'Enter') return 'default';
  if (key === 'Home') return 'min';
  if (key === 'End') return 'max';
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const step = shift ? 64 : 16; const toRight = key === 'ArrowRight';
  return side === 'left' ? (toRight ? step : -step) : (toRight ? -step : step);
}

// ---- 읽기 화면 배치·표 정렬·작업 공간별 상태 ----
const READ_TERM_DEFAULT = 420; // 읽기 화면을 켰을 때 터미널 기본 폭
const READ_TERM_MIN = 320;
const READ_MAIN_MIN = 360; // 읽기 영역이 항상 남겨야 할 폭
const READ_STORE_KEY = 'maru.read.v1';
const READ_STORE_MAX = 100; // 저장하는 작업 공간 수 상한
// 좁은 창(읽기 영역만 보이고 터미널은 띠로 접힌다). 창 너비를 모르면 좁지 않다고 본다
function readIsNarrow(viewportWidth) { const v = panelVw(viewportWidth); return v !== null && v <= PANEL_NARROW_MAX; }
// 터미널이 가질 수 있는 가장 큰 폭: 창 - 여백 2개 - 간격 2개(왼쪽|읽기|터미널) - 왼쪽 열 - 읽기 영역 최소 폭. 최소값이 항상 이긴다
function readTermMax(viewportWidth, leftWidth) {
  const v = panelVw(viewportWidth); if (v === null) return READ_TERM_MIN;
  const left = readIsNarrow(v) ? PANEL_LEFT_NARROW : panelNum(leftWidth, PANEL_DEFAULT.left);
  return Math.max(READ_TERM_MIN, v - 4 * PANEL_PAD - left - READ_MAIN_MIN);
}
// 원하는 폭(숫자가 아니면 기본값) -> 화면에 적용할 폭
function readTermWidth(want, viewportWidth, leftWidth) {
  return Math.max(READ_TERM_MIN, Math.min(readTermMax(viewportWidth, leftWidth), panelNum(want, READ_TERM_DEFAULT)));
}
// 표 칸 글이 숫자 모양인가: 부호, 쉼표 묶음 또는 연속 숫자, 소수점, 끝의 % 만. 단위 글자가 붙으면 아니다
// 앞자리 0 이 둘 이상인 값('00012')은 코드·식별자일 수 있어 숫자로 보지 않는다. '0'·'-0'·'0.5' 는 숫자다
function readIsNumText(s) { if (typeof s !== 'string') return false; const t = s.trim(); return /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/.test(t) && !/^[+-]?0{2,}/.test(t); }
// 열 정렬 목록. align 이 있으면 그대로, 없으면 본문 칸이 모두 숫자 모양(빈 칸은 건너뜀, 숫자 칸이 하나 이상)일 때 'right', 아니면 null
function readTableAligns(table) {
  const t = table && typeof table === 'object' ? table : {};
  const head = Array.isArray(t.head) ? t.head : []; const rows = Array.isArray(t.rows) ? t.rows : []; const al = Array.isArray(t.align) ? t.align : [];
  const txt = (cell) => (Array.isArray(cell) ? cell.map((p) => (p && typeof p.v === 'string' ? p.v : '')).join('') : '');
  const out = [];
  for (let k = 0; k < head.length; k++) {
    if (al[k] === 'left' || al[k] === 'right' || al[k] === 'center') { out.push(al[k]); continue; }
    let nums = 0; let other = 0;
    for (const r of rows) { const s = txt(Array.isArray(r) ? r[k] : null).trim(); if (s === '') continue; if (readIsNumText(s)) nums++; else other++; }
    out.push(nums > 0 && other === 0 ? 'right' : null);
  }
  return out;
}
// 저장 글 -> { <작업 공간 id>: { on, w, rail } }. 깨진 값은 버린다(id 는 64자 이하 문자열, 최대 READ_STORE_MAX 개)
function readParseStore(text) {
  let o = null; try { o = JSON.parse(text); } catch { return {}; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const out = {}; let n = 0;
  for (const id of Object.keys(o)) {
    if (n >= READ_STORE_MAX) break;
    const v = o[id]; if (!id || id.length > 64 || id === '__proto__' || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    out[id] = { on: v.on === true, w: panelNum(v.w, READ_TERM_DEFAULT), rail: v.rail === true }; n++;
  }
  return out;
}
// store 에 id 의 상태 일부를 바꾼 새 객체. 상한을 넘으면 앞쪽(오래된) 것부터 뺀다
function readStoreSet(store, id, patch) {
  const base = store && typeof store === 'object' ? store : {}; const cur = base[id] || { on: false, w: READ_TERM_DEFAULT, rail: false }; const p = patch && typeof patch === 'object' ? patch : {};
  const next = { on: p.on === undefined ? cur.on === true : p.on === true, w: p.w === undefined ? panelNum(cur.w, READ_TERM_DEFAULT) : panelNum(p.w, READ_TERM_DEFAULT), rail: p.rail === undefined ? cur.rail === true : p.rail === true };
  const out = {}; for (const k of Object.keys(base)) if (k !== id) out[k] = base[k];
  out[id] = next;
  const keys = Object.keys(out); for (let i = 0; i < keys.length - READ_STORE_MAX; i++) delete out[keys[i]];
  return out;
}

// ---- 읽기 화면 입력창: 보낼 글 정리와 보내도 되는지 판정(순수 함수). main 이 렌더러의 판단을 믿지 않고 다시 검사한다 ----
const READ_LINE_SEP = new RegExp('[\\u2028\\u2029]', 'g'); // 줄 구분 문자(\n 으로 바꾼다)
const READ_KEEP = [String.fromCodePoint(0x200C), String.fromCodePoint(0x200D), String.fromCodePoint(0xFE0F)]; // ZWNJ·ZWJ·변형 선택자 FE0F: 지우지 않는다
const READ_INVISIBLE_ONLY = new RegExp('^[\\s\\u200C\\u200D\\uFE0F]*$');
const READ_SEND_MAX = 16000; // 보낼 글의 길이 상한(정리 뒤, UTF-16 코드 단위)
// 글 -> { ok:true, text } | { ok:false, reason:'invalid'|'empty'|'toolong' }. \r\n·\r 은 \n, 탭은 공백 하나, \n 만 남기고 ESC 를 포함한 제어 문자와 BAD_CHARS 계열은 지운다.
// ESC 가 지워지므로 글 안의 붙여넣기 끝 표시(ESC[201~)는 힘을 잃는다(남는 "[201~" 는 그냥 글자다). 앞뒤 공백·빈 줄은 자른다.
// U+2028·U+2029 는 \n 으로 바꾸고, ZWJ(U+200D)·ZWNJ(U+200C)·변형 선택자 U+FE0F 는 남긴다. 나머지(C0·C1·DEL·양방향 덮어쓰기·짝 없는 서로게이트 등)는 지운다
function readCleanSend(s) {
  if (typeof s !== 'string') return { ok: false, reason: 'invalid' };
  if (s.length > READ_SEND_MAX * 4) return { ok: false, reason: 'toolong' }; // 정리 전의 터무니없는 크기는 훑지 않는다
  // U+2028·U+2029 는 줄 구분이라 \n 으로 바꾼다. 터미널에서 제어 기능이 없는 ZWJ·ZWNJ·변형 선택자 FE0F 는 남긴다(이모지 묶음·일부 문자 체계가 깨진다)
  const t = s.replace(/\r\n?/g, '\n').replace(READ_LINE_SEP, '\n').replace(/\t/g, ' ').replace(BAD_CHARS_G, (c) => (c === '\n' || READ_KEEP.includes(c) ? c : '')).trim();
  if (!t || READ_INVISIBLE_ONLY.test(t)) return { ok: false, reason: 'empty' }; // 보이지 않는 글자뿐인 글은 보내지 않는다
  if (t.length > READ_SEND_MAX) return { ok: false, reason: 'toolong' };
  return { ok: true, text: t };
}
// 포그라운드 프로세스가 Claude Code 인가(순수). 허용 목록 방식이다: 이름을 모르거나 비었거나 셸이면 아니다.
// knownName: 앱이 그 pty 에서 Claude 화면이 떴다고 판정한 시점의 포그라운드 이름(없으면 ''). 있으면 현재 이름이 그것과 같아야 하고, 없으면 이름 허용 목록(claude·node·버전 번호 모양)에 있어야 한다
const CLAUDE_FRONT_NAMES = new Set(['claude']); // 'node' 는 넣지 않는다: 기억한 이름이 없을 때 node 대화형 셸이 통과하면 글이 코드로 실행된다(node 로 도는 설치는 기억한 이름으로만 통과한다)
function procBase(name) {
  if (typeof name !== 'string' || !name || name.length > 1024) return '';
  return name.trim().replace(/\/+$/, '').split('/').pop().replace(/^-+/, '').toLowerCase();
}
function isClaudeFront(procName, knownName) {
  const n = procBase(procName);
  if (!n || isShellProcessName(n)) return false;
  const k = procBase(knownName);
  if (k && !isShellProcessName(k)) return n === k;
  return CLAUDE_FRONT_NAMES.has(n) || /^\d+\.\d+\.\d+$/.test(n);
}
// 터미널이 스스로 보내는 응답만으로 이뤄진 글인가(순수, 엄격). 전체가 아래 응답의 이어 붙임일 때만 true 이고, 한 글자라도 다르면 false(= 사용자 입력으로 친다).
//  포커스 알림 ESC[I / ESC[O, 커서 위치 보고 ESC[<숫자>;<숫자>R, 장치 속성 응답 ESC[?…c / ESC[>…c(숫자와 ; 만), 상태 보고 ESC[0n~ESC[3n.
// isUserInput·draftStep 은 CSI 를 넓게 걸러서(방향키 ESC[A 까지 응답으로 본다) 이 판정에 쓰지 않는다. 빈 문자열·문자열이 아닌 값은 false
// 단 ESC[1;2R ~ ESC[1;8R 은 Shift·Ctrl·Alt 와 F3 을 함께 누른 입력과 같은 모양이라 입력으로 본다(실제 보고가 1행 2~8열일 때 입력으로 치는 것은 안전한 쪽의 오판)
const TERM_REPLY_RE = /^(?:\x1b\[[IO]|\x1b\[(?!1;[2-8]R)\d{1,5};\d{1,5}R|\x1b\[[?>][0-9;]{0,32}c|\x1b\[[0-3]n)+$/;
function isTermReply(data) {
  return typeof data === 'string' && data.length > 0 && data.length <= 4096 && TERM_REPLY_RE.test(data);
}
// 대화 기록 파일의 끝부분 글 -> { role, at(밀리초) } | null. 마지막 비지 않은 줄 하나만 본다(talkLine 과 같은 검증). 해석하지 못하면 null.
// atStart: 이 글이 파일의 맨 처음부터인가(아니면 첫 줄이 잘렸을 수 있으므로 줄이 하나뿐일 때 믿지 않는다). at 은 기록의 초 단위 값을 밀리초로 바꾼다(상태 기록의 atMs 와 같은 단위)
function talkLast(text, atStart) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  if (i < 0) return null;
  if (i === 0 && atStart !== true) return null; // 앞이 잘려 줄 일부일 수 있다
  const c = talkLine(lines[i]);
  return c ? { role: c.role, at: c.at * 1000 } : null;
}
// 입력창이 글을 터미널에 넣어도 되는가. 보내기를 통과하는 조합은 "모든 조건이 맞을 때" 하나뿐이다. 애매하면 거부한다.
// 원칙: "방금 답변이 정상으로 끝났고 그 뒤로 터미널에 아무 입력도 없었다"가 확인될 때만 보낸다.
// c = { hasTerm, cc(Claude 화면), procName, knownName, hooked(훅으로 상태가 들어오는 세션), ux(화면에 그리는 상태), bg(백그라운드 작업 수), bracketed, quietMs, dirty,
//   rawState(상태 파일의 원래 기록 state; 낮추지 않은 값. 없으면 null), recAt(그 기록 시각, 밀리초 T), talkRole(대화 기록 마지막 줄의 role; 못 읽으면 null), talkAt(그 줄의 시각, 밀리초),
//   inAt(작업 공간 pty 에 마지막으로 쓴 시각, 밀리초; 없으면 0), startAt(pty 를 띄운 시각, 밀리초) }
//  -> { ok:true } | { ok:false, reason }. 이유의 우선순위는 검사 순서다:
//   nosession(터미널·Claude 화면 아님, 상태 모름) > notclaude(앞에 있는 것이 Claude 가 아님) > waiting > busy(표시 상태·백그라운드 작업·표시가 idle 이 아닐 때의 원래 기록) >
//   first(끝난 답변 없음·pty 가 기록보다 늦게 뜸) > failed(표시는 idle 인데 원래 기록이 idle 이 아님(중단된 턴 등)·그 시각의 assistant 줄 없음) > touched(답변 뒤 터미널 입력) > settling(출력이 아직 움직임) > draft(입력줄에 글)
const READ_TALK_SLACK_MS = 15000;
// 상태 기록 시각(recAt)은 훅이 파일을 다 쓴 시각이라 실제 턴 종료보다 조금 늦다. 그 틈의 입력이 "답변 앞"으로 판정되지 않게, 기록 시각보다 이만큼 앞선 입력까지 답변 뒤 입력으로 본다.
// 턴이 이보다 길다는 가정이다. 틀리면(더 짧은 턴) 잘못 거부하는 쪽이라 안전하다
const READ_IN_SLACK_MS = 2000; // idle 기록과 assistant 줄 시각이 이 안이어야 같은 턴의 끝으로 본다(Stop 훅이 둘을 거의 동시에 쓴다)
function readCanSend(c) {
  const { hasTerm, cc, procName, knownName, hooked, ux, bg, bracketed, quietMs, dirty, rawState, recAt, talkRole, talkAt, inAt, startAt } = c && typeof c === 'object' ? c : {};
  if (hasTerm !== true || cc !== true) return { ok: false, reason: 'nosession' };
  if (!isClaudeFront(procName, knownName)) return { ok: false, reason: 'notclaude' };
  if (ux === 'waiting') return { ok: false, reason: 'waiting' };
  if (ux === 'busy') return { ok: false, reason: 'busy' };
  if (typeof bg !== 'number' || !(bg >= 0)) return { ok: false, reason: 'nosession' };
  if (bg > 0) return { ok: false, reason: 'busy' }; // 백그라운드 작업이 끝나면 Claude 가 스스로 다음 턴을 시작할 수 있다(그 턴의 권한 확인 창이 입력을 받는다)
  if (ux !== 'idle' && rawState === 'waiting') return { ok: false, reason: 'waiting' }; // 표시 상태는 낮춰졌어도(effectiveAgent: busy 기록이 20초 조용하면 idle) 원래 기록이 busy·waiting 이면 보내지 않는다(권한 확인 창은 출력 없이 멈춘다). 표시가 idle 인 경우는 아래 failed 가 맡는다
  if (ux !== 'idle' && rawState === 'busy') return { ok: false, reason: 'busy' };
  if (hooked !== true) return { ok: false, reason: 'nosession' }; // 상태를 알 수 없는 세션
  if ((rawState === null || rawState === undefined) && ux === 'none') return { ok: false, reason: 'first' }; // 훅 기록이 아직 없다: 첫 메시지는 터미널에서
  if (ux === 'idle' && rawState !== 'idle') return { ok: false, reason: 'failed' }; // 표시는 idle 인데 원래 기록은 idle 이 아니다: 사용자가 Esc 로 중단한 턴 등(답변으로 끝나지 않았다)
  if (ux !== 'idle') return { ok: false, reason: 'nosession' }; // none·unknown·turnEnded 등
  if (bracketed !== true) return { ok: false, reason: 'nosession' };
  if (!Number.isFinite(recAt) || !Number.isFinite(startAt) || recAt < startAt) return { ok: false, reason: 'first' }; // 시각이 없거나, 이 pty 가 뜨기 전의 낡은 기록
  if (talkRole === null || talkRole === undefined) return { ok: false, reason: 'first' }; // 대화 기록이 없거나 읽지 못했다
  if (talkRole !== 'assistant' || !Number.isFinite(talkAt) || Math.abs(talkAt - recAt) > READ_TALK_SLACK_MS) return { ok: false, reason: 'failed' }; // 정상 종료(Stop)가 아니면 assistant 줄이 그 시각에 없다
  if (!Number.isFinite(inAt) || inAt > recAt - READ_IN_SLACK_MS) return { ok: false, reason: 'touched' }; // 답변이 끝난 뒤 터미널에 입력이 있었다(읽기 입력 자신의 쓰기 포함)
  if (!(Number.isFinite(quietMs) && quietMs >= READY_QUIET_MS)) return { ok: false, reason: 'settling' };
  if (dirty !== false) return { ok: false, reason: 'draft' };
  return { ok: true };
}

// ---- 읽기 화면 사용 횟수(내용 없이 날짜별 횟수만): { v:1, days: { 'YYYY-MM-DD': { on, sent } } } ----
const READ_STATS_KEEP_DAYS = 60;
const READ_STATS_MAX = 1000000; // 한 값의 상한
const READ_STATS_FILE_MAX = 64 * 1024; // 파일 크기 상한(넘으면 빈 것으로 본다)
const READ_STATS_DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// 지역 시간의 YYYY-MM-DD
function readDayKey(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
const readStatsInt = (v) => Number.isSafeInteger(v) && v >= 0;
// 글 -> 검증된 구조. 깨졌거나 모양이 틀리면 빈 구조. 정수가 아닌 값·날짜 모양이 아닌 키·__proto__ 는 버린다
function readStatsParse(text) {
  const out = { v: 1, days: Object.create(null) };
  let o = null;
  try { o = typeof text === 'string' ? JSON.parse(text) : null; } catch { o = null; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1 || !o.days || typeof o.days !== 'object' || Array.isArray(o.days)) return { v: 1, days: {} };
  for (const k of Object.keys(o.days)) {
    if (!READ_STATS_DAY_RE.test(k)) continue;
    const e = o.days[k];
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    out.days[k] = { on: readStatsInt(e.on) ? Math.min(e.on, READ_STATS_MAX) : 0, sent: readStatsInt(e.sent) ? Math.min(e.sent, READ_STATS_MAX) : 0 };
  }
  return { v: 1, days: { ...out.days } };
}
// key 가 on|sent 일 때만 그날 값에 1 을 더하고 keepDays 보다 오래된 날을 지운 새 객체를 돌려준다(입력은 바꾸지 않는다)
function readStatsBump(stats, day, key, keepDays = READ_STATS_KEEP_DAYS) {
  const src = readStatsParse(JSON.stringify(stats));
  if ((key !== 'on' && key !== 'sent') || typeof day !== 'string' || !READ_STATS_DAY_RE.test(day)) return src;
  const cur = src.days[day] || { on: 0, sent: 0 };
  src.days[day] = { ...cur, [key]: Math.min(cur[key] + 1, READ_STATS_MAX) };
  const keep = Object.keys(src.days).sort().reverse().slice(0, Number.isSafeInteger(keepDays) && keepDays > 0 ? keepDays : READ_STATS_KEEP_DAYS);
  const days = {};
  for (const k of keep.sort()) days[k] = src.days[k];
  return { v: 1, days };
}
// 파일 읽기(일반 파일만, 심볼릭 링크·큰 파일·없음이면 빈 구조)
function readStatsLoad(file) {
  const fs = require('fs');
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > READ_STATS_FILE_MAX) return { v: 1, days: {} };
    return readStatsParse(fs.readFileSync(file, 'utf8'));
  } catch { return { v: 1, days: {} }; }
}
// 파일 쓰기(임시 파일 + 이름 바꾸기, 모드 600). 실패하면 false
function readStatsSave(file, stats) { return writeJsonAtomic(file, readStatsParse(JSON.stringify(stats)), 'read-stats'); }

// ---- 마크다운 해석(읽기 화면용). 글 -> 블록 목록. 렌더러는 textContent 로만 그리므로 이스케이프하지 않는다 ----
const MD_INPUT_MAX = 256 * 1024; // 입력 길이 상한. UTF-16 코드 단위 기준이라 글자 수와 다를 수 있다(넘는 뒷부분은 버린다)
const MD_BLOCK_MAX = 400; // 블록 개수 상한
const MD_TABLE_COLS = 12; // 표 열 상한
const MD_TABLE_ROWS = 100; // 표 행 상한(머리줄 제외)
const MD_CODE_LINES = 400; // 코드 블록 줄 상한
const MD_PIECE_MAX = 20000; // 조각 v 와 코드 text 글자 상한
const MD_LANG_MAX = 40;
const MD_CELLS_MAX = 5000; // 표 칸 총수 상한(모든 표 합계, 머리줄 포함)
const MD_PIECES_MAX = 20000; // 조각 총수 상한(모든 블록 합계)
// 글을 max 길이(UTF-16 단위)로 자른다. 자른 끝이 짝 없는 높은 서로게이트면 한 칸 더 줄인다
function mdCut(str, max) {
  if (str.length <= max) return str;
  let e = max; const c = str.charCodeAt(e - 1);
  if (c >= 0xD800 && c <= 0xDBFF) e--;
  return str.slice(0, e);
}
// 줄 안 꾸밈을 훑어 push(스타일, 글) 로 낸다. bold 면 일반 글도 'b' 조각이 된다(굵게 안쪽을 한 겹으로 편다).
// 닫는 표시 검색은 위치를 기억하거나 한 번만 훑어 같은 곳을 다시 훑지 않는다(선형)
function mdScan(s, bold, push) {
  const n = s.length; const base = bold ? 'b' : 'text'; let buf = '';
  const cache = Object.create(null);
  const find = (needle, from) => { // from 이 늘어나기만 하는 호출에서만 쓴다
    let p = cache[needle];
    if (p === undefined || (p !== -1 && p < from)) { p = s.indexOf(needle, from); cache[needle] = p; }
    return p;
  };
  const lastTick = s.lastIndexOf('`'); let boldDead = n + 1; // boldDead: 이 위치부터는 닫는 ** 가 없다고 이미 확인됨
  const closeBold = (from) => { // from 부터 코드 조각 밖의 첫 ** 위치, 없으면 -1
    let p = from;
    while (p < n) {
      const c = s.charCodeAt(p);
      if (c === 96) { // 코드 조각이면 통째로 건너뛴다(짝이 없거나 바로 옆이면 글자)
        const q = p === lastTick ? -1 : s.indexOf('`', p + 1);
        p = q > p + 1 ? q + 1 : p + 1; continue;
      }
      if (c === 42 && s.charCodeAt(p + 1) === 42) return p;
      p++;
    }
    return -1;
  };
  const flush = () => { if (buf) { push(base, buf); buf = ''; } };
  const link = (at) => { // s[at] === '[' 일 때 [글](주소) 를 찾는다. {label,url,end} 또는 null
    const j = find(']', at + 1);
    if (j === -1 || s[j + 1] !== '(') return null;
    const k = find(')', j + 2);
    if (k === -1) return null;
    return { label: s.slice(at + 1, j), url: s.slice(j + 2, k), end: k + 1 };
  };
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === '`') {
      const j = find('`', i + 1);
      if (j > i + 1) { flush(); push('c', s.slice(i + 1, j)); i = j + 1; continue; }
    } else if (c === '*' && s[i + 1] === '*' && !bold) {
      if (i + 2 < n && i + 2 < boldDead && !/\s/.test(s[i + 2])) {
        const j = closeBold(i + 2);
        if (j === -1) boldDead = i + 2;
        else if (j > i + 2 && !/\s/.test(s[j - 1])) { flush(); mdScan(s.slice(i + 2, j), true, push); i = j + 2; continue; }
      }
    } else if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      const at = c === '[' ? i : i + 1; const r = link(at);
      if (r) {
        if (r.label) { flush(); mdScan(r.label, bold, push); if (r.url) push(base, ' (' + r.url + ')'); } else buf += r.url;
        i = r.end; continue;
      }
    }
    buf += c; i++;
  }
  flush();
}
// 줄 안 꾸밈 -> [{s,v}]. 이웃한 같은 종류(코드 제외)는 합친다. 조각 총수가 상한이면 남는 조각을 버린다
function mdInline(src, st) {
  const out = [];
  mdScan(String(src), false, (s, v) => {
    if (v === '') return;
    const l = out[out.length - 1];
    if (l && s !== 'c' && l.s === s) l.v += v; else out.push({ s, v });
  });
  const res = [];
  for (const p of out) {
    if (st.pieces >= MD_PIECES_MAX) { st.truncated = true; st.full = true; break; }
    st.pieces++;
    if (p.v.length > MD_PIECE_MAX) { st.truncated = true; res.push({ s: p.s, v: mdCut(p.v, MD_PIECE_MAX) }); } else res.push(p);
  }
  return res;
}
const MD_FENCE_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/; // 1: 들여쓰기, 2: 펜스, 3: 나머지(들여쓰기 칸 수는 가리지 않는다)
const MD_HEAD_RE = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const MD_LIST_RE = /^([ \t]*)([-*]|\d{1,9}\.)[ \t]+(.*)$/;
function mdIsHr(line) { return /^(-{3,}|\*{3,}|_{3,})$/.test(line.replace(/[ \t]/g, '')); }
function mdIsTable(line) { return /^[ \t]*\|/.test(line); }
function mdIsQuote(line) { return /^ {0,3}>/.test(line); }
function mdListItem(line) {
  const m = MD_LIST_RE.exec(line);
  if (!m) return null;
  let indent = 0; for (const ch of m[1]) indent += ch === '\t' ? 4 : 1;
  const ordered = m[2].length > 1 || /\d/.test(m[2]);
  return { indent, type: ordered ? 'ol' : 'ul', num: ordered ? parseInt(m[2], 10) : 0, text: m[3].trim() };
}
function mdTableStart(line) { return mdIsTable(line) && line.trim() !== '|'; } // | 하나뿐인 줄은 칸이 없어 표를 열지 못한다(이미 열린 표의 행으로는 쓰인다)
// 문단 도중(inPara)에는 1. 로 시작하는 번호 항목만 목록을 연다. 그 밖의 숫자 줄은 문단에 이어진다
function mdIsStart(line, inPara) {
  if (MD_FENCE_RE.test(line) || MD_HEAD_RE.test(line) || mdIsHr(line) || mdTableStart(line) || mdIsQuote(line)) return true;
  const li = mdListItem(line);
  return !!li && !(inPara && li.type === 'ol' && li.num !== 1);
}
// 표 구분 줄이면 칸 배열, 아니면 null. - 와 | 와 : 와 공백만으로 되고 - 와 | 가 모두 있어야 한다
function mdSepCells(line) {
  if (line === undefined || !/^[-|: \t]+$/.test(line) || !line.includes('-') || !line.includes('|')) return null;
  const sc = mdCells(line);
  return sc.length > 0 && sc.every((c) => /^:?-+:?$/.test(c)) ? sc : null;
}
// 표 한 줄 -> 칸 글자 배열. 맨 앞 | 와 맨 뒤 | 는 칸이 아니다. \| 는 글자 |
function mdCells(line) {
  const t = line.trim(); const cells = []; let cur = ''; let endsSep = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]; endsSep = false;
    if (ch === '\\' && t[i + 1] === '|') { cur += '|'; i++; } else if (ch === '|') { cells.push(cur); cur = ''; endsSep = true; } else cur += ch;
  }
  cells.push(cur);
  if (t[0] === '|') cells.shift();
  if (endsSep) cells.pop();
  return cells.map((c) => c.trim());
}
function mdAlignOf(cell) {
  const l = cell[0] === ':'; const r = cell[cell.length - 1] === ':';
  return l && r ? 'center' : l ? 'left' : r ? 'right' : null;
}
function mdParse(text) {
  const st = { truncated: false, full: false, pieces: 0, cells: 0 }; const blocks = []; let clean = '';
  try {
    if (typeof text !== 'string') return { blocks: [], truncated: false };
    if (text.length > MD_INPUT_MAX) { text = mdCut(text, MD_INPUT_MAX); st.truncated = true; }
    // 탭과 \n 만 남기고 BAD_CHARS 에 드는 문자를 지운다. 줄 구분 문자(U+2028/2029)는 \n 으로 바꾼다
    clean = text.replace(/\r\n/g, '\n').replace(BAD_CHARS_G, (c) => (c === '\t' || c === '\n' ? c : c === ' ' || c === ' ' ? '\n' : ''));
    const lines = clean.split('\n');
    const nl = lines.length;
    const add = (b) => { if (blocks.length >= MD_BLOCK_MAX) { st.truncated = true; return false; } blocks.push(b); return !st.full; };
    let i = 0;
    while (i < nl) {
      const line = lines[i];
      if (line.trim() === '') { i++; continue; }
      let m = MD_FENCE_RE.exec(line);
      if (m && !(m[2][0] === '`' && m[3].includes('`'))) { // 코드 펜스
        const ind = m[1].length; const ch = m[2][0]; const len = m[2].length; const lang = m[3].trim().split(/\s/)[0].slice(0, MD_LANG_MAX);
        const body = []; let cut = false; i++;
        while (i < nl) {
          const cl = lines[i]; const cm = MD_FENCE_RE.exec(cl);
          if (cm && cm[2][0] === ch && cm[2].length >= len && cm[3].trim() === '') { i++; break; }
          if (body.length < MD_CODE_LINES) { let k = 0; while (k < ind && (cl[k] === ' ' || cl[k] === '\t')) k++; body.push(cl.slice(k)); } else cut = true; // 여는 펜스의 들여쓰기만큼만 걷는다
          i++;
        }
        let code = body.join('\n');
        if (code.length > MD_PIECE_MAX) { code = mdCut(code, MD_PIECE_MAX); cut = true; }
        const b = { t: 'code', lang, text: code };
        if (cut) { b.cut = true; st.truncated = true; }
        if (!add(b)) break;
        continue;
      }
      m = MD_HEAD_RE.exec(line);
      if (m) { if (!add({ t: 'h', level: Math.min(m[1].length, 3), inl: mdInline(m[2].trim(), st) })) break; i++; continue; }
      if (mdIsHr(line)) { if (!add({ t: 'hr' })) break; i++; continue; }
      const pipeless = !mdIsTable(line) && line.includes('|') && mdSepCells(lines[i + 1]) !== null && !MD_LIST_RE.test(line) && !mdIsQuote(line); // 첫 칸 앞 | 가 없는 표: 다음 줄이 구분 줄일 때만
      if (mdTableStart(line) || pipeless) { // 표
        const rowsRaw = [lines[i++]];
        if (pipeless) { rowsRaw.push(lines[i++]); while (i < nl && lines[i].trim() !== '' && lines[i].includes('|') && !mdIsStart(lines[i])) rowsRaw.push(lines[i++]); } else while (i < nl && mdIsTable(lines[i])) rowsRaw.push(lines[i++]);
        const headCells = mdCells(rowsRaw[0]); let align = []; let from = 1;
        if (rowsRaw.length > 1) {
          const sc = mdSepCells(rowsRaw[1]);
          if (sc) { align = sc.map(mdAlignOf); from = 2; }
        }
        const width = Math.min(headCells.length, MD_TABLE_COLS); let cut = headCells.length > MD_TABLE_COLS;
        const fit = (cells) => { // 칸 총수 상한을 넘기면 null
          if (st.cells + width > MD_CELLS_MAX) { st.truncated = true; st.full = true; return null; }
          st.cells += width; const r = []; for (let k = 0; k < width; k++) r.push(mdInline(cells[k] === undefined ? '' : cells[k], st)); return r;
        };
        const head = fit(headCells);
        if (!head) break;
        const rows = [];
        for (let k = from; k < rowsRaw.length && !st.full; k++) {
          if (rows.length >= MD_TABLE_ROWS) { cut = true; break; }
          const r = fit(mdCells(rowsRaw[k]));
          if (!r) { cut = true; break; }
          rows.push(r);
        }
        const al = []; for (let k = 0; k < width; k++) al.push(align[k] === undefined ? null : align[k]);
        const b = { t: 'table', align: al, head, rows };
        if (cut) { b.cut = true; st.truncated = true; }
        if (!add(b)) break;
        continue;
      }
      if (mdIsQuote(line)) { // 인용
        const parts = []; while (i < nl && mdIsQuote(lines[i])) { const q = lines[i++].replace(/^ {0,3}>[ \t]?/, '').trim(); if (q) parts.push(q); }
        if (!add({ t: 'quote', inl: mdInline(parts.join(' '), st) })) break;
        continue;
      }
      const first = mdListItem(line);
      if (first) { // 목록: 첫 항목 들여쓰기보다 2칸 이상 깊으면 하위 항목
        const items = []; let cur = null; let last = null;
        while (i < nl) {
          const ln = lines[i];
          if (ln.trim() === '') { let k = i; while (k < nl && lines[k].trim() === '') k++; if (k < nl && !mdIsHr(lines[k]) && mdListItem(lines[k])) { i = k; continue; } break; }
          if (mdIsHr(ln)) break;
          const li = mdListItem(ln);
          if (li) {
            if (li.indent >= first.indent + 2 && cur) {
              if (!cur.sub) cur.sub = { t: li.type, start: li.num, items: [] };
              last = { raw: li.text }; cur.sub.items.push(last);
            } else if (li.type !== first.type) break;
            else { cur = { raw: li.text }; items.push(cur); last = cur; }
          } else if (/^[ \t]{2,}/.test(ln) && !mdIsStart(ln) && last) last.raw += ' ' + ln.trim();
          else break;
          i++;
        }
        const b = { t: first.type, items: items.map((it) => {
          const o = { inl: mdInline(it.raw, st) };
          if (it.sub) { o.sub = { t: it.sub.t, items: it.sub.items.map((x) => ({ inl: mdInline(x.raw, st) })) }; if (it.sub.t === 'ol') o.sub.start = it.sub.start; }
          return o;
        }) };
        if (first.type === 'ol') b.start = first.num;
        if (!add(b)) break;
        continue;
      }
      const para = [line.trim()]; i++; // 문단(모르는 모양도 여기로 온다)
      while (i < nl && lines[i].trim() !== '' && !mdIsStart(lines[i], true)) para.push(lines[i++].trim());
      if (!add({ t: 'p', inl: mdInline(para.join(' '), st) })) break;
    }
  } catch { // 예외가 나도 답변을 지우지 않는다: 정리한 원문 앞부분을 문단 하나로 낸다
    try {
      const v = mdCut(clean.trim(), MD_PIECE_MAX);
      return { blocks: v ? [{ t: 'p', inl: [{ s: 'text', v }] }] : [], truncated: true };
    } catch { return { blocks: [], truncated: true }; }
  }
  return { blocks, truncated: st.truncated };
}

// ---- 대화 기록(읽기 화면용). data/state/app/<세션 값>.talk.jsonl 의 글 -> 최근 항목 목록 ----
const TALK_MAX_DEFAULT = 80; // 돌려줄 항목 수 기본값(최근 것부터)
const TALK_USER_MAX = 20000; // 질문 글 길이 상한(UTF-16 단위, 넘으면 자르고 cut)
const TALK_BLOCKS_MAX = 3000; // 결과 전체의 블록 수 상한(질문 하나는 블록 1개로 센다)
const TALK_FILE_MAX = 16 * 1024 * 1024; // 이보다 큰 기록 파일은 읽지 않는다(훅이 8MB 근처에서 줄인다)
const TALK_USER_TOTAL_MAX = 200000; // 결과 전체의 질문 글 길이 합계 상한(UTF-16 단위). 넘으면 오래된 항목부터 버린다
// 읽기 결과의 key: <세션 값>:<mtimeMs>-<size>. 세션 값이 다르면 파일 시각·크기가 같아도 key 가 다르다
function talkKey(sid, mtimeMs, size) { return String(sid) + ':' + mtimeMs + '-' + size; }
// 호출자가 가진 key 가 지금 key 와 같은가(빈 key 는 같지 않다). 호출자마다 자기 key 로 판정한다
function talkSame(callerKey, key) { return typeof callerKey === 'string' && callerKey !== '' && callerKey === key; }
// 질문 글 정리: mdParse 와 같은 규칙(탭·\n 만 남기고 BAD_CHARS 를 지운다, \r\n·U+2028·U+2029 는 줄바꿈으로). 마크다운은 해석하지 않는다
function talkCleanText(s) {
  return s.replace(/\r\n/g, '\n').replace(BAD_CHARS_G, (c) => (c === '\t' || c === '\n' ? c : c === ' ' || c === ' ' ? '\n' : ''));
}
// 한 줄을 항목 후보로 바꾼다. 모양이 틀리면 null. 필요한 필드만 뽑아 새 객체를 만든다(__proto__ 등 다른 키는 옮기지 않는다)
function talkLine(line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const has = (k) => Object.prototype.hasOwnProperty.call(o, k);
  const role = has('role') ? o.role : null; const at = has('at') ? o.at : null; const text = has('text') ? o.text : null;
  if (role !== 'user' && role !== 'assistant') return null;
  if (typeof text !== 'string') return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null;
  const lost = has('lost') && o.lost === true; const cut = has('cut') && o.cut === true;
  if (!lost && text === '') return null; // 보일 글이 없다
  return { role, at, text: lost ? '' : text, cut, lost };
}
// 기록 파일의 글 -> { items, more }. 끝에서부터 훑어 max 개만 해석한다(옛 줄은 해석하지 않는다). 예외를 던지지 않는다
function talkParse(text, opts) {
  try {
    if (typeof text !== 'string') return { items: [], more: false };
    const o = opts && typeof opts === 'object' ? opts : {};
    const max = Number.isInteger(o.max) && o.max >= 1 ? Math.min(o.max, 1000) : TALK_MAX_DEFAULT;
    const lines = text.split('\n'); const got = []; let more = false;
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i]; if (!ln.trim()) continue;
      const c = talkLine(ln); if (!c) continue;
      if (got.length >= max) { more = true; break; }
      got.push(c);
    }
    // got 는 최근 것부터. 끝에서부터 항목을 만들다가 블록 수·질문 글자 수 상한에 닿으면 더 오래된 것은 해석하지 않고 멈춘다(가장 최근 하나는 남긴다)
    const blocksMax = Number.isInteger(o.blocksMax) && o.blocksMax >= 1 ? o.blocksMax : TALK_BLOCKS_MAX;
    const userTotalMax = Number.isInteger(o.userTotalMax) && o.userTotalMax >= 1 ? o.userTotalMax : TALK_USER_TOTAL_MAX;
    const items = []; let blocks = 0; let userChars = 0;
    for (const c of got) {
      let it; let nb = 0; let nc = 0;
      if (c.role === 'user') {
        let t = c.text; let cut = c.cut;
        if (t.length > TALK_USER_MAX) { t = mdCut(t, TALK_USER_MAX); cut = true; }
        it = { role: 'user', at: c.at, text: talkCleanText(t) };
        if (cut) it.cut = true;
        if (c.lost) it.lost = true;
        nb = 1; nc = it.text.length;
        if (items.length && userChars + nc > userTotalMax) { more = true; break; }
      } else {
        if (items.length && blocks >= blocksMax) { more = true; break; } // 이미 상한: 답변을 해석하지 않고 멈춘다
        const m = c.lost ? { blocks: [], truncated: false } : mdParse(c.text);
        it = { role: 'assistant', at: c.at, blocks: m.blocks, truncated: m.truncated };
        if (c.cut) it.cut = true;
        if (c.lost) it.lost = true;
        nb = m.blocks.length || 1;
      }
      if (items.length && blocks + nb > blocksMax) { more = true; break; }
      items.push(it); blocks += nb; userChars += nc;
    }
    items.reverse(); // 오래된 것 -> 최근 것
    return { items, more };
  } catch { return { items: [], more: false }; }
}

const api = {
  CHILD_MAX, CHILD_RATE_MAX, CHILD_RATE_MS, CHILD_DAY_MAX, REQ_MAX_BYTES, REQ_STALE_MS, REQ_NAME_RE, REPORT_NAME_RE, REPORT_MAX_BYTES, cleanPromptText, validAbsDir, childMacMessage, childMac, childMacOk, maruEligible, requesterOf, parseChildRequest, budgetOk, recordLaunch, validateBudget, readBudgetFile, saveBudgetFile, decideChildRequest, childLaunchCheck, parentUsable, childWindowReady, expandParent, consentAnswer, consentView, consentChoice, squadChoices, cleanSquadAsk, SQUAD_ASK_MAX, childReasonKey, childReasonCode, reqDirOk, takeChildRequests, purgeChildRequests,
  macSeen, rememberMac, noticeOk, logGate, CHILD_HEADER, PROMPT_FILE_MAX, childPromptText, CHILD_HEADER_USER, parseSubOpen, subDraftAdd, subDraftCheck, subDraftUse, subLimitCheck, subNoticeLine, cleanNoticePart, SUB_TITLE_MAX, SUB_BRIEF_MAX, SUB_DRAFT_MS, SUB_DRAFT_MAX, promptHandoff, childBriefPlan, briefAtSpawn, isMaruRootDir, writeChildPromptFile, cleanStalePromptFiles, childEnvVars, ptyEnv,
  hierarchyOrder, reorderWs, visibleWsIds, stateDisplay, unreadNext, currentLocation, childSubNames, parseReport, readReportsDir, summarizeReports, reportFlash, childLogLine, validWsId, validStableId, validRecCwd, WS_COLLAPSED_MAX,
  MANAGED_MARKER, SYNC_MARKER, FIRST_MEETING_TEXT, cmpVersion, readPayloadVersion, readSyncing, homeStatus, cleanStaleTmp, appendSyncLog, firstMeetingPaste, parseOnboarded, firstMeetingGate, probeMemoryDir, deriveSetupState, mergeProfile, safeManifestPath, parseMarker, readMarker, scanPayload, syncPayload, syncClaudeMd, managedAction,
  defaultSetupState, validateSetupState, parseSetupState, loadSetupState, saveSetupState, setupStage, setupUnfinished,
  claudeUpAfter, PREREQ_IDS, childPath, findInPath, modelPrereqs, prereqsReady, claudeCandidates, nvmVersionDirs, parseClaudeProbe, CLAUDE_PROBE_CMD, setupCommand, buildSetupScript, SETUP_KINDS, SETUP_INSTALL_CMD, firstMeetingBanner,
  INBOX_NOTIF_MAX, PROPOSAL_FILE_MAX, PROPOSAL_TOTAL_MAX, PROPOSAL_FILES_MAX, logAtMs, plausibleLogAt, fmtLogAt, seenToStore, PROPOSAL_LIST_MAX, INBOX_SEEN_MAX_BYTES, validProposalSlug, cleanDisplay, cleanProposalText, proposalMeta, scanProposalDir, listProposals, proposalDetail, trashProposalDir, skillRequestText, parseSquadCheck, summarizeSquadCheck, validateInboxSeen, parseInboxSeen, readInboxSeenFile, saveInboxSeen, markUnseen, newestAt, relativeAgo,
  MEMORIES_PER_LEVEL, QUEST_MAX_CHARS, SUGGESTIONS_MAX_BYTES, LOG_TAIL_BYTES, BRIEFING_MAX,
  DROP_MAX, DROP_PATH_MAX, validDropPath, shellQuote, buildDropPaste, dropNoticeKey, isLineNavKey, isBufNavKey, isPromptBorder, promptEdgeRows, bufNavSeq, isStepKey, stepTarget, isFoldKey, foldTarget, arrowInput,
  validModelId, shortModelName, validTranscriptPath, pathInside, parseTranscriptModel, parseAgentFile, buildAgentParty, summarizeSubs, validSubFileName, parseSubType, PARTY_MAX,
  hasBadChars, isSafeQuestStart, parseAgentState, parseAgentRecord, effectiveAgent, escInterrupted, refineAgentAt, ESC_IDLE_MS, isSessionId, resolveRoot, keyToSeq, isNewlineKey, isShiftEnter, imeCanReset, isClaudeUi, levelInfo, parseSuggestions, cleanQuestText, parseTodos, todosFromSuggestions, resolveTodos, todoKey, todoStarred, matchTodo, fillNoticeKey, sanitizeHostEnv, bgCount, showSubs, agentStatusText, TODO_MAX, isShellProcessName, isUserInput, bpStep, fillStep, retryCheck, sessionUuidOf, workspacesToSave, workspacesJson, decideRestore, pickAliveAt, startupMode, resumeFailureDecision, noteVisible, shouldDropPrev, resumeSessionsOn, RESTORE_ALIVE_SLACK_MS, OTHER_INSTANCE_MS, RESUME_FAIL_MS, RESUME_RECENT_MS, RETRY_TTL_MS, READY_QUIET_MS, TODO_SRC_MAX_BYTES, TODO_SRC_MAX_LINES, TODO_SRC_TTL_SEC, TODO_SRC_CWD_MAX, TODO_RESUME_STALE_SEC, validSessionUuid, validSrcCwd, parseTodoSrc, readTodoSrcFile, findTodoSrc, todoSrcHint, transcriptFileFor, transcriptSessionId, decideTodoOpen, openNoticeKey, validSkillName, mergeSkillNames,
  parseBattery, parseDiskFree, parseUsage, usageView, usageLevel, fmtUsageReset, fmtUsageAge, USAGE_MAX_BYTES, parseLogEvents, mergeBriefing, rcScan, draftStep, rcView, rcCanSend, rcMarkerOk, RC_PENDING_MS, RC_MARKER_MS, RC_TAIL_MAX,
  readRegular, cleanName, defaultLang, validateProfile, parseProfile, loadProfile, saveProfile, NAME_MAX_CHARS,
  HOOK_EVENTS, HOOK_SCRIPTS, hookStatus, parseAuthStatus, cleanBlock, parseInstallSections, sanitizeUpdate, cleanVersion,
  SETTINGS_PANES, settingsPaneUrl, projectSlug, CAL_SCRIPT, parseCalendarOutput, calMonthScript, calMonthDateSetup, parseCalendarMonth, calDayScript, calDayDateSetup, parseCalendarDay, calNotes, CAL_HELPER_FIRST_MS, CAL_HELPER_MS, CAL_OSA_MS, calHelperArgs, calHelperExit, calStatusWord, calChooseReader, calDayJobStale, calDayVictim, calDayAfterFail, CAL_DAY_FRESH_MS,
  DIARY_FILE_MAX_BYTES, DIARY_FILES_MAX, DIARY_TITLE_MAX, DIARY_BODY_MAX, parseDiaryText, readDiaries, parseYm, shiftYm, shiftDay, monthLayout, buildMonthSummary, buildDayGroups,
  SQUADS_MAX, SQUAD_MEMBERS_MAX, SQUAD_NAME_MAX, SQUAD_DESC_MAX, SQUAD_META_MAX_BYTES, parseSquadMeta, squadView, teamChip, matchSubs, squadOpen, claudeLaunchCommand,
  TODO_DONE_MAX, TODO_DONE_MAX_BYTES, fitTodoDone, todoMarkKey, TODO_DONE_KEEP_SEC, TODO_DONE_HIDE_SEC, titleKey, todoTitleRecordable, validTodoDoneEntry, makeTodoDone, todoMarkable, formatTodoDone, parseTodoDone, pruneTodoDone, addTodoDone, removeTodoDone, filterTodos, readTodoDoneFile, saveTodoDone, projectOpenTodos,
  confirmClose, confirmRestart, closeRequestAction, lookupWs, ringFrameInterval, readWorkspacesFile, backupCorruptFile,
  WS_MAX, WS_TITLE_MAX, WS_STATES, workspaceTitle, managedWsTitle, cleanWsTitle, uniqueTitle, normalizeWorkspaces, parseWorkspaces, loadWorkspaces, saveWorkspaces, workspaceDirOk, newSessionId, shortenPath,
  LOGO, logoShapesSvg, RING, ringInit, stepRing, ringView,
  traySummary, trayTitle, trayTodoTitles, trayMenuModel, trayIconPath,
  splitProjectField, projectKey, isProjectKey, neutralizeBody, looksSecret, cleanProjectTitle, parseProjectRegistry, parseJournalText, readJournalEntries,
  validateProjectState, projectStateFits, parseProjectState, readProjectStateFile, saveProjectState, projectRoot, daysBetween, buildProjects, groupProjects, canMerge,
  stateWithStatus, stateWithTitle, stateWithMerge,
  PROJ_UI_MAX_BYTES, PROJ_UI_MAX_TAGS, PROJ_UI_MAX_PER_TAG, GOTO_MAX, defaultProjectUi, validateProjectUi, parseProjectUi, readProjectUiFile, projectUiFits, pruneProjectUi, saveProjectUi, applyOrder, applyProjectUi, moveInOrder, visibleProjectKeys, numberTargets, parseMemoryMeta, relatedMemories, readMemoryMetas, buildProjectDetail,
  MEMV_FILES_MAX, MEMV_FILE_MAX_BYTES, MEMV_TOTAL_MAX_BYTES, MEMV_TYPES, MEMV_TAG_EDGE_MEMBERS_MAX, MEMV_EDGES_MAX, parseMemoryFile, buildMemoryModel, readMemoryFiles, buildMemoryGraph, simulateGraph, fitGraph, layoutGraph, graphDrift, graphStep, graphSettle, graphLabelCount, graphLabelOrder, GRAPH_LABEL_ALL_MAX, graphLabelOpacity, graphEaseView, GRAPH_DRIFT_AMP, GRAPH_DT_MAX_MS, filterMemories, memorySearchText, memoryDisplay, MEMV_CACHE_TTL_MS, MEMV_DIR_SCAN_MAX, MEM_FILE_RE, MEM_LINE_MAX,
  PROJ_TITLE_MAX, PROJ_LOG_MAX, PROJ_MEM_MAX, PROJ_REG_MAX_BYTES, PROJ_STATE_MAX_BYTES, PROJ_STATE_MAX_ENTRIES, CHECK_DAYS, validDay, ttlCache,
  PANEL_DEFAULT, PANEL_RANGE, PANEL_CENTER_MIN, PANEL_STORE_KEY, panelRange, clampPanelWidths, parsePanelWidths, parseColsEnv, panelKeyDelta,
  talkParse, talkCleanText, talkKey, talkSame, TALK_MAX_DEFAULT, TALK_USER_MAX, TALK_USER_TOTAL_MAX, TALK_BLOCKS_MAX, TALK_FILE_MAX,
  READ_TERM_DEFAULT, READ_TERM_MIN, READ_MAIN_MIN, READ_STORE_KEY, READ_STORE_MAX, readIsNarrow, readTermMax, readTermWidth, readIsNumText, readTableAligns, readParseStore, readStoreSet, READ_SEND_MAX, readCleanSend, readCanSend, isClaudeFront, isTermReply, talkLast, READ_TALK_SLACK_MS, READ_STATS_KEEP_DAYS, READ_STATS_MAX, readDayKey, readStatsParse, readStatsBump, readStatsLoad, readStatsSave,
  mdParse, MD_INPUT_MAX, MD_BLOCK_MAX, MD_TABLE_COLS, MD_TABLE_ROWS, MD_CODE_LINES, MD_PIECE_MAX, MD_CELLS_MAX, MD_PIECES_MAX,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.MaruLib = api; // 렌더러(번들러 없음)에서는 전역으로 노출
