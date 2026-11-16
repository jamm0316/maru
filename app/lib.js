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
function todoKey(item) { return item ? item.title + '\n' + item.prompt : ''; }

// main 이 가진 목록의 index 항목이 렌더러가 본 shown(todoKey)과 같을 때만 그 항목을 돌려준다
function matchTodo(items, index, shown) {
  if (!Array.isArray(items) || !Number.isInteger(index) || index < 0 || index >= items.length) return null;
  return typeof shown === 'string' && todoKey(items[index]) === shown ? items[index] : null;
}

// 채우기 거부 사유 -> 사용자 안내 문구
const FILL_NOTICES = {
  stale: '목록이 바뀌어 넣지 않았습니다. 갱신된 목록에서 다시 눌러 주세요.',
  'no-prompt': '이 항목은 직접 해야 하는 일이라 넣을 문장이 없습니다.',
  'unsafe-start': '안전하지 않은 시작 문자라 넣지 않았습니다.',
  'not-ready': '지금은 입력을 넣을 수 없습니다. 입력줄이 보일 때 다시 눌러 주세요.',
  'no-term': '터미널이 실행 중이 아닙니다. Cmd+Shift+R 로 다시 시작해 주세요.',
  invalid: '할 일을 넣지 못했습니다. 목록을 확인해 주세요.',
};
function fillNotice(reason) { return Object.prototype.hasOwnProperty.call(FILL_NOTICES, reason) ? FILL_NOTICES[reason] : FILL_NOTICES.invalid; }

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

// dream.log / reflect.log 꼬리 -> 이벤트 [{at, text}]
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
    let t = null;
    if (kind === 'dream') {
      let x;
      if (/스냅샷 실패/.test(body)) t = '새벽 정리 건너뜀 · 스냅샷 실패';
      else if (/기억 변경 없음/.test(body)) t = '새벽 정리 · 기억 변경 없음';
      else if (/커밋 완료/.test(body)) t = '새벽 정리 완료 · 기억 갱신';
      else if (/되돌림/.test(body)) t = '새벽 정리 되돌림';
      else if ((x = /sweep 끝:.*처리 (\d+)개/.exec(body)) && Number(x[1]) > 0) t = `놓친 대화 ${x[1]}개 회고`;
    } else {
      let x;
      if (/^커밋 완료/.test(body)) t = '회고 완료 · 기억 갱신';
      else if (/^변경 없음\(커밋/.test(body)) t = '회고 · 변경 없음';
      else if (/^되돌림/.test(body)) t = '회고 되돌림(변경 폐기)';
      else if ((x = /^추천 목록 갱신: ok (\d+)줄/.exec(m[2])) && Number(x[1]) > 0) t = `새 퀘스트 ${x[1]}개 도착`;
    }
    if (t) events.push({ at, text: t });
  }
  return events;
}

function mergeBriefing(eventLists, max = BRIEFING_MAX) {
  const all = [].concat(...eventLists);
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // 최신순(안정 아님 허용)
  return all.slice(0, max);
}

const api = {
  MEMORIES_PER_LEVEL, QUEST_MAX_CHARS, SUGGESTIONS_MAX_BYTES, LOG_TAIL_BYTES, BRIEFING_MAX,
  hasBadChars, isSafeQuestStart, parseAgentState, parseAgentRecord, effectiveAgent, isSessionId, resolveRoot, keyToSeq, levelInfo, parseSuggestions, cleanQuestText, parseTodos, todosFromSuggestions, resolveTodos, todoKey, matchTodo, fillNotice, TODO_MAX, validSkillName, mergeSkillNames,
  parseBattery, parseDiskFree, parseLogEvents, mergeBriefing,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.MaruLib = api; // 렌더러(번들러 없음)에서는 전역으로 노출
