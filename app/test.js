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
console.log(`\n${n} 통과` + (process.exitCode ? ', 실패 있음' : ''));
