'use strict';
const assert = require('assert');
const L = require('./lib');
let n = 0;
function t(name, fn) { try { fn(); n++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; } }

t('levelInfo 35개', () => { const r = L.levelInfo(35); assert.deepStrictEqual([r.level, r.toNext, r.ratio], [1, 15, 0.7]); });
t('levelInfo 경계 50/0/129/null', () => {
  assert.strictEqual(L.levelInfo(50).level, 2); assert.strictEqual(L.levelInfo(50).toNext, 50);
  assert.strictEqual(L.levelInfo(0).level, 1); assert.strictEqual(L.levelInfo(129).level, 3);
  assert.strictEqual(L.levelInfo(null).memories, 0);
});
t('parseSuggestions 필터', () => {
  const txt = ['  정상 문장  ', '', '   ', 'a'.repeat(121), 'b'.repeat(120), 'x\u202Ey', 'z\u200Bw', 'ctl\u0007x', 'esc\u001b[31m', '한글 문장'].join('\r\n');
  assert.deepStrictEqual(L.parseSuggestions(txt), ['정상 문장', 'b'.repeat(120), '한글 문장']);
  assert.deepStrictEqual(L.parseSuggestions(undefined), []);
});
t('120자 한글은 코드포인트 기준', () => { assert.strictEqual(L.parseSuggestions('가'.repeat(120)).length, 1); assert.strictEqual(L.parseSuggestions('가'.repeat(121)).length, 0); });
t('cleanQuestText 개행·제어 제거', () => {
  assert.strictEqual(L.cleanQuestText('안녕\r\n rm -rf /\u001b[2J\u0003\u202E끝\u200B'), '안녕 rm -rf /[2J끝');
  assert.ok(!/[\r\n\u0000-\u001f]/.test(L.cleanQuestText('a\rb\nc\td')));
  assert.strictEqual(L.cleanQuestText(42), '');
});
t('스킬 이름 필터', () => {
  assert.deepStrictEqual(L.mergeSkillNames(['recall', '.hidden', 'a/b', 'bad\u202E', 'x'.repeat(65)], ['recall', 'mac-control']), ['mac-control', 'recall']);
});
t('parseBattery', () => {
  const o = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=23265379)\t100%; charged; 0:00 remaining present: true\n";
  assert.deepStrictEqual(L.parseBattery(o), { percent: 100, state: 'charged', onAC: true });
  const b = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t57%; discharging; 3:10 remaining present: true";
  assert.deepStrictEqual(L.parseBattery(b), { percent: 57, state: 'discharging', onAC: false });
  assert.strictEqual(L.parseBattery("Now drawing from 'AC Power'\n"), null);
});
t('parseDiskFree', () => {
  const o = 'Filesystem     1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on\n/dev/disk3s1s1   482797652  12343240 154244100     8%  458732 1542441000    0%   /\n';
  assert.deepStrictEqual(L.parseDiskFree(o), { freeGB: 147 });
  assert.strictEqual(L.parseDiskFree('x'), null);
});
const dream = [
  '2026-11-16 03:37:09 [dream] 시작 (model=sonnet)',
  '2026-11-16 03:37:09 [dream] sweep 끝: 후보 0개, 건너뜀 0개, 처리 0개(상한 8)',
  '2026-11-16 03:37:10 [dream] 스냅샷 실패 — 정리 건너뜀',
  '2026-11-16 06:11:54 [dream] sweep 끝: 후보 15개, 건너뜀 12개, 처리 3개(상한 8)',
  '2026-11-16 06:12:19 [dream] claude 종료 rc=0',
  '변경 없음',
  '2026-11-16 06:12:19 [dream] 커밋 완료',
].join('\n');
const refl = [
  'partial line cut',
  '2026-11-16 09:22:19 추천 목록 갱신: ok 4줄(버린 줄 0, 상한 초과 0)',
  '2026-11-16 09:22:19 [e78a16cc] 커밋 완료',
  '2026-11-16 09:22:20 [c1bd2524] 새 사용자 턴 0개(줄 1916) — 건너뜀',
  '2026-11-16 09:25:00 [8a1eb234] 변경 없음(커밋 생략)',
  '2026-11-16 09:26:00 [8a1eb234] 되돌림(변경 폐기, rc=1)',
].join('\n');
t('로그 파서 dream', () => {
  const e = L.parseLogEvents(dream, 'dream');
  assert.deepStrictEqual(e.map(x => x.text), ['새벽 정리 건너뜀 · 스냅샷 실패', '놓친 대화 3개 회고', '새벽 정리 완료 · 기억 갱신']);
});
t('로그 파서 reflect + 잘린 첫 줄', () => {
  const e = L.parseLogEvents(refl, 'reflect', true);
  assert.deepStrictEqual(e.map(x => x.text), ['새 퀘스트 4개 도착', '회고 완료 · 기억 갱신', '회고 · 변경 없음', '회고 되돌림(변경 폐기)']);
});
t('mergeBriefing 최신순·개수 제한', () => {
  const m = L.mergeBriefing([L.parseLogEvents(dream, 'dream'), L.parseLogEvents(refl, 'reflect')], 3);
  assert.strictEqual(m.length, 3); assert.strictEqual(m[0].at, '2026-11-16 09:26:00'); assert.ok(m[0].at >= m[1].at && m[1].at >= m[2].at);
});
t('M1 보이지 않는 문자', () => {
  const bad = ['\u{E0041}', '\uFE0F', '\u{E0100}', '\u3164', '\u115F', '\u1160', '\uFFA0', '\u034F', '\u200D', '\uE000', '\u0378', '\uD800'];
  for (const c of bad) {
    assert.ok(L.hasBadChars('a' + c + 'b'), 'hasBad ' + c.codePointAt(0).toString(16));
    assert.deepStrictEqual(L.parseSuggestions('가' + c + '나'), []);
    assert.strictEqual(L.cleanQuestText('가' + c + '나'), '가나');
  }
  assert.deepStrictEqual(L.parseSuggestions('정상 😀 문장'), ['정상 😀 문장']);
});
t('M2 시작 문자 거부', () => {
  for (const s of ['1 번', '!ls', '/help', '9x']) assert.strictEqual(L.isSafeQuestStart(s), false);
  assert.strictEqual(L.isSafeQuestStart('블로그 점검해 줘'), true);
  assert.strictEqual(L.isSafeQuestStart(''), false);
});
t('L5 잘린 목록은 마지막 줄 버림', () => { assert.deepStrictEqual(L.parseSuggestions('하나\n둘\n세', true), ['하나', '둘']); });
t('keyToSeq 단축키', () => {
  const k = (o) => L.keyToSeq({ type: 'keydown', key: 'Backspace', ...o });
  assert.strictEqual(k({ metaKey: true }), '\x15');
  assert.strictEqual(k({ altKey: true }), '\x17');
  assert.strictEqual(k({}), null);
  assert.strictEqual(k({ metaKey: true, isComposing: true }), null);
  assert.strictEqual(k({ altKey: true, keyCode: 229 }), null);
  assert.strictEqual(k({ metaKey: true, altKey: true }), null);
  assert.strictEqual(k({ ctrlKey: true, metaKey: true }), null);
  assert.strictEqual(L.keyToSeq({ type: 'keyup', key: 'Backspace', metaKey: true }), null);
  assert.strictEqual(L.keyToSeq({ type: 'keydown', key: 'a', metaKey: true }), null);
});
t('resolveRoot 순서와 검증', () => {
  const good = new Set(['/e/x', '/cfg/y', '/app', '/h/maru']);
  const mk = (o) => L.resolveRoot({ env: {}, home: '/h', isPackaged: false, appDir: '/app/app', io: { readConfig: () => null, isRepo: (d) => good.has(d) }, ...o });
  assert.deepStrictEqual(mk({}), { root: '/app', source: 'app' });
  assert.deepStrictEqual(mk({ env: { MARU_HOME: '/e/x' } }), { root: '/e/x', source: 'env' });
  assert.deepStrictEqual(mk({ env: { MARU_HOME: '/bad' }, io: { readConfig: () => '/cfg/y\nsecond', isRepo: (d) => good.has(d) } }), { root: '/cfg/y', source: 'config' });
  assert.deepStrictEqual(mk({ isPackaged: true }), { root: '/h/maru', source: 'home' });
  assert.deepStrictEqual(mk({ io: { readConfig: () => '~/maru', isRepo: (d) => good.has(d) } }), { root: '/h/maru', source: 'config' });
  assert.strictEqual(mk({ isPackaged: true, io: { readConfig: () => '', isRepo: () => false } }), null);
  assert.strictEqual(mk({ env: { MARU_HOME: 'relative/path' }, isPackaged: true, io: { readConfig: () => null, isRepo: (d) => d === 'relative/path' } }), null);
  assert.strictEqual(mk({ isPackaged: true, io: { readConfig: () => { throw new Error('x'); }, isRepo: () => { throw new Error('y'); } } }), null);
});
t('parseAgentState', () => {
  assert.strictEqual(L.parseAgentState('{"state":"busy","at":"x"}'), 'busy');
  assert.strictEqual(L.parseAgentState('{"state":"idle"}'), 'idle');
  assert.strictEqual(L.parseAgentState('{"state":"waiting"}'), 'waiting');
  for (const bad of ['', 'not json', '{"state":"BUSY"}', '{"state":1}', '[]', 'null', '{}', undefined, 'x'.repeat(5000)]) assert.strictEqual(L.parseAgentState(bad), null);
  assert.ok(L.isSessionId('abcd1234') && L.isSessionId('6054e0aa-03e5-4050-b22e-c186ad026154'));
  for (const bad of ['short', '../../etc/passwd1', 'a b c d e f g h', 'x'.repeat(65), '', null]) assert.strictEqual(L.isSessionId(bad), false);
});
t('effectiveAgent 되살림', () => {
  const rec = (state, ago) => ({ state, atMs: 1e6 - ago });
  assert.strictEqual(L.effectiveAgent(null, 1e6, 0), 'none');
  assert.strictEqual(L.effectiveAgent(rec('busy', 1000), 1e6, 1e6 - 50000), 'busy');   // 기록이 최근
  assert.strictEqual(L.effectiveAgent(rec('busy', 30000), 1e6, 1e6 - 1000), 'busy');   // 출력 있음
  assert.strictEqual(L.effectiveAgent(rec('busy', 30000), 1e6, 1e6 - 30000), 'idle');  // 둘 다 오래됨
  assert.strictEqual(L.effectiveAgent({ state: 'busy', atMs: NaN }, 1e6, 0), 'idle');
  assert.strictEqual(L.effectiveAgent(rec('waiting', 99999), 1e6, 0), 'waiting');
  assert.strictEqual(L.effectiveAgent(rec('idle', 99999), 1e6, 0), 'idle');
  assert.deepStrictEqual(L.parseAgentRecord('{"state":"busy","at":"2026-01-01T00:00:00Z"}'), { state: 'busy', atMs: Date.parse('2026-01-01T00:00:00Z') });
  assert.strictEqual(L.parseAgentRecord('zzz'), null);
});
t('parseTodos 정상·정리', () => {
  const r = L.parseTodos('블로그|8|글 초안 점검|초안을 점검해 줘\r\n생활-1|3|  병원 예약  |\n');
  assert.deepStrictEqual(r, [
    { tag: '블로그', importance: 8, title: '글 초안 점검', prompt: '초안을 점검해 줘' },
    { tag: '생활-1', importance: 3, title: '병원 예약', prompt: '' },
  ]);
  assert.deepStrictEqual(L.parseTodos(undefined), []);
});
t('parseTodos 필드 수·| 개수', () => {
  for (const bad of ['a|5|t', 'a|5|t|p|x', 'a|5||p|', 'a5tp', '|5|t|p', 'a|5|t|p|']) assert.deepStrictEqual(L.parseTodos(bad), [], bad);
});
t('parseTodos 태그 문자·길이', () => {
  assert.strictEqual(L.parseTodos('abcdefghijkl|5|t|').length, 1);
  assert.strictEqual(L.parseTodos('가나다라마바사아자차카타|5|t|').length, 1);
  for (const tag of ['abcdefghijklm', '', 'a b', 'a_b', 'a.b', 'a\u200Bb', 'ㄱㄴ', 'a\u3164']) assert.deepStrictEqual(L.parseTodos(tag + '|5|t|'), [], JSON.stringify(tag));
});
t('parseTodos 중요도 범위', () => {
  for (const i of ['1', '5', '10']) assert.strictEqual(L.parseTodos('a|' + i + '|t|').length, 1);
  for (const i of ['0', '11', '-1', '5.5', '05', '', 'x', ' 5', '5 ', '１']) assert.deepStrictEqual(L.parseTodos('a|' + i + '|t|'), [], JSON.stringify(i));
});
t('parseTodos 길이 상한(제목 60·프롬프트 120)', () => {
  assert.strictEqual(L.parseTodos('a|5|' + '가'.repeat(60) + '|' + '나'.repeat(120)).length, 1);
  assert.deepStrictEqual(L.parseTodos('a|5|' + '가'.repeat(61) + '|'), []);
  assert.deepStrictEqual(L.parseTodos('a|5|t|' + '나'.repeat(121)), []);
  assert.deepStrictEqual(L.parseTodos('a|5|t|' + 'x'.repeat(500)), []);
});
t('parseTodos 최대 7개·잘림', () => {
  const lines = Array.from({ length: 10 }, (_, i) => 'a|5|t' + i + '|');
  assert.deepStrictEqual(L.parseTodos(lines.join('\n')).map((x) => x.title), ['t0', 't1', 't2', 't3', 't4', 't5', 't6']);
  assert.deepStrictEqual(L.parseTodos('a|5|x|\nb|5|y|p', true).map((x) => x.title), ['x']);
});
t('parseTodos 보이지 않는 문자 제거·빈 제목 거부', () => {
  const r = L.parseTodos('a|5|할\u202E일\u200B|하\u0007라\u{E0041}');
  assert.deepStrictEqual(r, [{ tag: 'a', importance: 5, title: '할일', prompt: '하라' }]);
  assert.deepStrictEqual(L.parseTodos('a|5|\u200B\u3164|p'), []);
  assert.deepStrictEqual(L.parseTodos('a|5|t|\u200B')[0].prompt, '');
});
t('parseTodos 잘못된 줄만 건너뜀', () => {
  assert.deepStrictEqual(L.parseTodos('bad\n\na|5|ok|\nb|99|no|').map((x) => x.title), ['ok']);
});
t('resolveTodos 대체(suggestions)', () => {
  const sug = { text: '하나\n1 번\n둘', truncated: false };
  const fb = [{ tag: '추천', importance: 5, title: '하나', prompt: '하나' }, { tag: '추천', importance: 5, title: '1 번', prompt: '1 번' }, { tag: '추천', importance: 5, title: '둘', prompt: '둘' }];
  assert.deepStrictEqual(L.resolveTodos(null, sug), fb);
  assert.deepStrictEqual(L.resolveTodos({ text: 'garbage\n', truncated: false }, sug), fb);
  assert.deepStrictEqual(L.resolveTodos({ text: '', truncated: false }, sug), fb);
  assert.strictEqual(L.resolveTodos({ text: 'a|5|t|', truncated: false }, sug).length, 1);
  assert.deepStrictEqual(L.resolveTodos(null, null), []);
  assert.strictEqual(L.resolveTodos(null, { text: Array.from({ length: 12 }, (_, i) => 's' + i).join('\n') }).length, 7);
});
t('matchTodo index·shown 일치', () => {
  const items = L.parseTodos('a|5|제목1|프롬프트1\nb|9|제목2|');
  assert.strictEqual(L.matchTodo(items, 0, L.todoKey(items[0])), items[0]);
  assert.strictEqual(L.matchTodo(items, 1, L.todoKey(items[1])), items[1]);
  assert.strictEqual(L.matchTodo(items, 0, L.todoKey(items[1])), null);   // 오래된 목록: 다른 항목
  assert.strictEqual(L.matchTodo(items, 0, '제목1'), null);               // 제목만으로는 불가
  assert.strictEqual(L.matchTodo(items, 0, '제목1\n다른 프롬프트'), null); // 프롬프트가 바뀜
  for (const i of [-1, 2, 1.5, NaN, '0', null]) assert.strictEqual(L.matchTodo(items, i, L.todoKey(items[0])), null);
  assert.strictEqual(L.matchTodo(items, 0, undefined), null);
  assert.strictEqual(L.matchTodo([], 0, ''), null);
});
t('parseTodos 안전하지 않은 프롬프트 시작은 비움', () => {
  for (const p of ['1 번', '!ls', '/help', '9x']) assert.strictEqual(L.parseTodos('a|5|t|' + p)[0].prompt, '', p);
  assert.strictEqual(L.parseTodos('a|5|t|\u200B/help')[0].prompt, ''); // 정리 뒤 기준
  assert.strictEqual(L.parseTodos('a|5|t|점검해 줘')[0].prompt, '점검해 줘');
  assert.strictEqual(L.parseTodos('a|5|/title|')[0].title, '/title'); // 제목은 영향 없음
});
t('fillNotice 사유별 문구', () => {
  const rs = ['stale', 'no-prompt', 'unsafe-start', 'not-ready', 'no-term', 'invalid'];
  const msgs = rs.map((r) => L.fillNotice(r));
  assert.strictEqual(new Set(msgs).size, rs.length);
  assert.strictEqual(L.fillNotice('???'), L.fillNotice('invalid'));
  assert.strictEqual(L.fillNotice(undefined), L.fillNotice('invalid'));
  assert.strictEqual(L.fillNotice('__proto__'), L.fillNotice('invalid'));
});
console.log(`\n${n} 통과` + (process.exitCode ? ', 실패 있음' : ''));
