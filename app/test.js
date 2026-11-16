'use strict';
const assert = require('assert');
const L = require('./lib');
const I = require('./i18n');
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
  assert.deepStrictEqual(e, [{ at: '2026-11-16 03:37:10', code: 'dream.snapshotFail' }, { at: '2026-11-16 06:11:54', code: 'dream.sweep', n: 3 }, { at: '2026-11-16 06:12:19', code: 'dream.commit' }]);
});
t('로그 파서 reflect + 잘린 첫 줄', () => {
  const e = L.parseLogEvents(refl, 'reflect', true);
  assert.deepStrictEqual(e.map(x => x.code), ['reflect.quests', 'reflect.commit', 'reflect.noChange', 'reflect.rollback']);
  assert.strictEqual(e[0].n, 4);
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
  assert.deepStrictEqual([10, 8, 7, 6, 5, 1, NaN].map(L.todoStarred), [true, true, true, false, false, false, false]);
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
t('fillNoticeKey 사유별 키·문구', () => {
  const rs = ['stale', 'no-prompt', 'unsafe-start', 'not-ready', 'no-term', 'inactive', 'invalid'];
  const msgs = rs.map((r) => I.t('ko', L.fillNoticeKey(r)));
  assert.strictEqual(new Set(msgs).size, rs.length);
  assert.strictEqual(L.fillNoticeKey('???'), 'fill.invalid');
  assert.strictEqual(L.fillNoticeKey(undefined), 'fill.invalid');
  assert.strictEqual(L.fillNoticeKey('__proto__'), 'fill.invalid');
  for (const r of rs) assert.notStrictEqual(I.t('en', L.fillNoticeKey(r)), L.fillNoticeKey(r));
});

// ---- 프로필 ----
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maru-test-'));
const good = { name: '마루야', lang: 'ko', calendar: false, createdAt: '2026-11-16T01:02:03.000Z' };
t('cleanName 규칙', () => {
  assert.strictEqual(L.cleanName('  마루친구 '), '마루친구');
  assert.strictEqual(L.cleanName('a\nb\r\tc\u202E\u200Bd'), 'abcd');
  assert.strictEqual(L.cleanName('가'.repeat(24)), '가'.repeat(24));
  assert.strictEqual(L.cleanName('가'.repeat(25)), '');
  assert.strictEqual(L.cleanName('😀'.repeat(24)).length, 48); // 코드포인트 기준
  for (const bad of ['', '   ', '\n', '\u200Bㅤ', 42, null, undefined, {}]) assert.strictEqual(L.cleanName(bad), '');
});
t('validateProfile 엄격 검증', () => {
  assert.deepStrictEqual(L.validateProfile(good), good);
  assert.deepStrictEqual(L.validateProfile({ ...good, extra: 'x' }), good); // 알려진 필드만 남김
  const bads = [null, 'x', [], 1, { ...good, name: '' }, { ...good, name: 5 }, { ...good, name: 'a\nb' }, { ...good, name: ' 앞공백' },
    { ...good, name: '가'.repeat(25) }, { ...good, name: 'x\u202Ey' }, { ...good, lang: 'fr' }, { ...good, lang: 1 }, { ...good, calendar: 'true' },
    { ...good, calendar: 1 }, { ...good, createdAt: 'yesterday' }, { ...good, createdAt: 123 }, { ...good, createdAt: '2026-13-45T00:00:00Z' }, { ...good, createdAt: 'x'.repeat(100) }];
  for (const b of bads) assert.strictEqual(L.validateProfile(b), null, JSON.stringify(b));
  const noKey = { ...good }; delete noKey.calendar; assert.strictEqual(L.validateProfile(noKey), null);
});
t('parseProfile 나쁜 JSON·잘림', () => {
  assert.deepStrictEqual(L.parseProfile({ text: JSON.stringify(good), truncated: false }), good);
  assert.strictEqual(L.parseProfile({ text: JSON.stringify(good), truncated: true }), null);
  for (const text of ['', 'not json', '{', '[]', 'null', '{"name":1}']) assert.strictEqual(L.parseProfile({ text, truncated: false }), null, text);
  assert.strictEqual(L.parseProfile(null), null);
});
t('프로필 저장(0600·원자적)과 읽기, 심볼릭 링크 거부', () => {
  const dir = path.join(tmp, 'data'); const f = path.join(dir, 'profile.json');
  assert.strictEqual(L.loadProfile(f), null);                       // 없음 = 없는 것
  assert.strictEqual(L.saveProfile(f, good), true);                 // data 폴더도 만든다
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepStrictEqual(L.loadProfile(f), good);
  assert.deepStrictEqual(fs.readdirSync(dir), ['profile.json']);     // 임시 파일이 남지 않음
  assert.strictEqual(L.saveProfile(f, { ...good, name: '' }), false); // 잘못된 프로필은 쓰지 않음
  assert.deepStrictEqual(L.loadProfile(f), good);
  const link = path.join(dir, 'link.json'); fs.symlinkSync(f, link);
  assert.strictEqual(L.loadProfile(link), null);                    // 링크는 읽지 않는다
  fs.writeFileSync(f, 'x'.repeat(5000)); assert.strictEqual(L.loadProfile(f), null); // 크기 상한
  fs.writeFileSync(f, '{bad'); assert.strictEqual(L.loadProfile(f), null);
  const real = path.join(tmp, 'real'); fs.mkdirSync(real); const ld = path.join(tmp, 'ldata'); fs.symlinkSync(real, ld);
  assert.strictEqual(L.saveProfile(path.join(ld, 'profile.json'), good), false); // 링크된 data 폴더 거부
  assert.deepStrictEqual(fs.readdirSync(real), []);
});
t('defaultLang', () => {
  assert.strictEqual(L.defaultLang('ko'), 'ko'); assert.strictEqual(L.defaultLang('ko-KR'), 'ko');
  for (const x of ['en-US', 'ja', '', undefined, 'kok']) assert.strictEqual(L.defaultLang(x), 'en');
});

// ---- 훅 상태 ----
t('hookStatus: 무관한 훅이 섞인 설정', () => {
  const R = '/Users/u/maru';
  const settings = { theme: 'dark', hooks: {
    SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }, { hooks: [{ type: 'command', command: 'bash "/Users/u/maru/scripts/reflect.sh"' }] }],
    SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'bash "/Users/u/other/scripts/session-context.sh"' }] }],  // 다른 저장소
    Stop: [{ hooks: [{ type: 'command', command: 'afplay /x.mp3' }, { type: 'command', command: 'bash "/Users/u/maru/scripts/journal-tick.sh"' }] }],
    PreCompact: [{ hooks: [{ type: 'command', command: 'bash /Users/u/maru/scripts/journal-tick.sh.bak' }] }],                         // 이름이 비슷한 다른 파일
    PostToolUse: [{ hooks: [{ type: 'command', command: 'bash "/Users/u/maru/scripts/journal-tick.sh"' }] }],                         // 다른 이벤트
  } };
  assert.deepStrictEqual(L.hookStatus(settings, [R]), { SessionEnd: true, SessionStart: false, Stop: true, PreCompact: false });
  assert.deepStrictEqual(L.hookStatus(settings, R), { SessionEnd: true, SessionStart: false, Stop: true, PreCompact: false });
  assert.deepStrictEqual(L.hookStatus(settings, ['/Users/u/other']).SessionStart, true);
  assert.deepStrictEqual(L.hookStatus(settings, ['/x/Users/u/maru']), { SessionEnd: false, SessionStart: false, Stop: false, PreCompact: false });
  for (const bad of [null, {}, { hooks: null }, { hooks: { SessionEnd: 'x' } }, { hooks: { SessionEnd: [null, { hooks: 'x' }, { hooks: [null, 5, { command: 7 }] }] } }, []]) {
    assert.deepStrictEqual(L.hookStatus(bad, [R]), { SessionEnd: false, SessionStart: false, Stop: false, PreCompact: false });
  }
  assert.deepStrictEqual(L.hookStatus(settings, ['relative/maru']), { SessionEnd: false, SessionStart: false, Stop: false, PreCompact: false });
});
t('hookStatus: 모두 연결', () => {
  const mk = (n) => [{ hooks: [{ type: 'command', command: `bash "/r/maru/scripts/${n}"` }] }];
  const s = { hooks: { SessionEnd: mk('reflect.sh'), SessionStart: mk('session-context.sh'), Stop: mk('journal-tick.sh'), PreCompact: mk('journal-tick.sh') } };
  assert.ok(Object.values(L.hookStatus(s, ['/r/maru'])).every(Boolean));
});

// ---- claude auth status ----
t('parseAuthStatus: 이메일·조직 필드를 버린다', () => {
  const raw = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'secret.person@example.com', orgId: 'org-1234-secret', orgName: 'Secret Org', subscriptionType: 'max', loginExpiresAt: '2026-12-15T20:10:40.922Z', planTier: 'max_5x' });
  const now = Date.parse('2026-11-16T00:00:00Z');
  const r = L.parseAuthStatus(raw, now);
  assert.deepStrictEqual(r, { loggedIn: true, plan: 'max', expiresAt: '2026-12-15', daysLeft: 29, state: 'ok' });
  const dump = JSON.stringify(r);
  for (const leak of ['secret', 'example.com', 'org-1234', 'Secret Org', 'email', 'orgId', 'orgName']) assert.ok(!dump.includes(leak), leak);
  assert.deepStrictEqual(Object.keys(r).sort(), ['daysLeft', 'expiresAt', 'loggedIn', 'plan', 'state']);
  const soon = L.parseAuthStatus(JSON.stringify({ loggedIn: true, subscriptionType: 'pro', loginExpiresAt: '2026-11-18T00:00:00Z' }), now);
  assert.strictEqual(soon.state, 'soon'); assert.strictEqual(soon.daysLeft, 2);
  assert.strictEqual(L.parseAuthStatus(JSON.stringify({ loggedIn: true, loginExpiresAt: '2026-11-10T00:00:00Z' }), now).state, 'expired');
  assert.strictEqual(L.parseAuthStatus(JSON.stringify({ loggedIn: true }), now).expiresAt, null);
  const out = L.parseAuthStatus(JSON.stringify({ loggedIn: false, email: 'a@b.c', orgName: 'O' }), now);
  assert.deepStrictEqual(out, { loggedIn: false, plan: null, expiresAt: null, daysLeft: null, state: 'out' });
  assert.strictEqual(L.parseAuthStatus(JSON.stringify({ loggedIn: true, subscriptionType: 'a@b.c injected<script>' }), now).plan, '?'); // 플랜 문자열 화이트리스트
  for (const bad of ['', 'nope', '{}', '[]', '{"loggedIn":"yes"}', undefined, 'x'.repeat(70000)]) assert.strictEqual(L.parseAuthStatus(bad, now), null);
});

// ---- 출력 정리 ----
t('cleanBlock·parseInstallSections', () => {
  const dirty = '\x1b[31m빨강\x1b[0m\n제어\u0007문자\u202E끝\n' + 'x'.repeat(500) + '\n\n\n\n다음';
  const c = L.cleanBlock(dirty);
  assert.ok(!/[\x1b\u0007\u202E]/.test(c)); assert.ok(c.startsWith('빨강\n제어문자끝\n'));
  assert.ok(c.split('\n').every((l) => [...l].length <= 200)); assert.ok(!/\n{3}/.test(c));
  assert.ok(L.cleanBlock('줄\n'.repeat(5000), 100).length <= 102);
  assert.strictEqual(L.cleanBlock(5), '');
  assert.deepStrictEqual(L.parseInstallSections('\n== 요구사항 확인\n  ok x\n\n== SessionEnd 훅 등록 (~/.claude/settings.json)\n== 끝\n'), ['요구사항 확인', 'SessionEnd 훅 등록 (~/.claude/settings.json)']);
});
t('sanitizeUpdate', () => {
  const r = L.sanitizeUpdate({ status: 'available', current: '0.1.0', latest: '0.2.0', notes: '노트\u202E\n' + '가'.repeat(900), repoBehind: 1, message: 'm\x1b[31m', evil: 'x' }, '0.1.0');
  assert.deepStrictEqual(Object.keys(r).sort(), ['current', 'latest', 'message', 'notes', 'repoBehind', 'status']);
  assert.ok([...r.notes].length <= 600 && !r.notes.includes('\u202E')); assert.strictEqual(r.message, 'm');
  assert.strictEqual(L.sanitizeUpdate({ status: 'bogus' }, '0.1.0').status, 'error');
  assert.strictEqual(L.sanitizeUpdate(null, '0.1.0').current, '0.1.0');
  assert.strictEqual(L.sanitizeUpdate({ status: 'none', latest: '<script>' }, '1').latest, undefined);
});

// ---- 시스템 설정 허용 목록 ----
t('설정 창 딥링크 허용 목록', () => {
  assert.deepStrictEqual(Object.keys(L.SETTINGS_PANES).sort(), ['accessibility', 'automation', 'calendars', 'screen']);
  for (const k of Object.keys(L.SETTINGS_PANES)) assert.ok(L.settingsPaneUrl(k).startsWith('x-apple.systempreferences:'));
  for (const bad of ['', 'unknown', 'https://evil.example', 'file:///etc/passwd', 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera', '__proto__', 'constructor', 'toString', 'hasOwnProperty', null, undefined, 3, {}, ['accessibility']]) assert.strictEqual(L.settingsPaneUrl(bad), null, String(bad));
});

// ---- 캘린더 ----
t('parseCalendarOutput', () => {
  const US = '\x1f'; const RS = '\x1e';
  const now = new Date(2026, 10, 30, 9, 0); // 11/30 → 내일은 12/1(월 경계)
  const rec = (d, tm, fl, ti) => [d, tm, fl, ti].join(US) + RS;
  const out = [
    rec('2026-12-01', '09:00', '0', '내일 회의'),
    rec('2026-11-30', '14:30', '0', '점심 후 \u202E미팅\u200B'),
    rec('2026-11-30', '', '1', '종일 일정'),
    rec('2026-11-30', '08:00', '0', '아침'),
    rec('2026-11-29', '08:00', '0', '어제(제외)'),
    rec('2026-12-02', '08:00', '0', '모레(제외)'),
    rec('2026-11-30', '14:30', '0', '점심 후 미팅'),         // 정리 후 중복
    rec('2026-11-30', '25:00', '0', '나쁜 시각'),
    rec('2026-11-30', '10:00', '2', '나쁜 플래그'),
    rec('2026-11-30', '', '1', '   '),                       // 빈 제목
    rec('2026-11-30', '10:00', '0', 'a' + US + 'b'),          // 필드 수 초과
    rec('2026-11-30', '11:00', '0', 'ESC\u001b[2J\r\n제목'),
    '\n',
  ].join('');
  const r = L.parseCalendarOutput(out, now);
  assert.deepStrictEqual(r.map((e) => [e.day, e.allDay, e.time, e.title]), [
    ['today', true, '', '종일 일정'], ['today', false, '08:00', '아침'], ['today', false, '11:00', 'ESC[2J제목'],
    ['today', false, '14:30', '점심 후 미팅'], ['tomorrow', false, '09:00', '내일 회의'],
  ]);
  const many = Array.from({ length: 20 }, (_, i) => rec('2026-11-30', String(10 + (i % 10)) + ':' + String(i).padStart(2, '0'), '0', 'e' + i)).join('');
  assert.strictEqual(L.parseCalendarOutput(many, now).length, 8);
  assert.strictEqual([...L.parseCalendarOutput(rec('2026-11-30', '', '1', '가'.repeat(100)), now)[0].title].length, 60);
  for (const bad of ['', 'garbage', undefined, 5, 'x'.repeat(300000)]) assert.deepStrictEqual(L.parseCalendarOutput(bad, now), []);
  const t2 = L.parseCalendarOutput(rec('2026-02-28', '', '1', 'x'), new Date(2026, 1, 27));
  assert.strictEqual(t2[0].day, 'tomorrow');
});
t('캘린더: 제목의 RS/US 로 만든 위조 레코드는 버려진다', () => {
  const US = '\x1f'; const RS = '\x1e'; const now = new Date(2026, 10, 30, 9, 0);
  const rec = (d, tm, fl, ti) => [d, tm, fl, ti].join(US) + RS;
  // 제목에 US 를 넣으면 필드 수가 늘어 버려지고, 앞뒤 정상 레코드는 남는다
  const out = rec('2026-11-30', '08:00', '0', '앞') + rec('2026-11-30', '09:00', '0', '악성' + US + '2026-11-30' + US + '' + US + '1' + US + '위조') + rec('2026-11-30', '10:00', '0', '뒤');
  assert.deepStrictEqual(L.parseCalendarOutput(out, now).map((e) => e.title), ['앞', '뒤']);
  // 스크립트는 제목에서 RS/US 를 제거하는 clean 핸들러를 거친다
  const sc = L.CAL_SCRIPT.join('\n');
  assert.ok(sc.includes('ASCII character 30') && sc.includes('text item delimiters') && sc.includes('my clean((summary of e) as text)'));
});
t('캘린더 스크립트는 고정 문자열 배열', () => {
  assert.ok(Array.isArray(L.CAL_SCRIPT) && L.CAL_SCRIPT.every((l) => typeof l === 'string' && !/[\r\n]/.test(l)));
  assert.ok(L.CAL_SCRIPT.includes('tell application "Calendar"'));
  for (const l of ['ko', 'en']) assert.ok(/(반복 일정|Recurring events)/.test(I.t(l, 'set.cal.desc')));
});

// ---- i18n ----
t('i18n 표 완전성(ko·en 키 일치, 자리표시자 일치)', () => {
  const kk = Object.keys(I.STR.ko).sort(); const ek = Object.keys(I.STR.en).sort();
  assert.deepStrictEqual(ek.filter((k) => !kk.includes(k)), [], 'en 에만 있음');
  assert.deepStrictEqual(kk.filter((k) => !ek.includes(k)), [], 'ko 에만 있음');
  const ph = (v) => [...new Set((Array.isArray(v) ? v.join(' ') : v).match(/\{\w+\}/g) || [])].sort().join();
  for (const k of kk) {
    for (const lg of I.LANGS) {
      const v = I.STR[lg][k];
      assert.ok(typeof v === 'string' ? v.length > 0 : Array.isArray(v) && v.length === 2 && v.every((x) => x.length > 0), lg + ':' + k);
    }
    assert.strictEqual(ph(I.STR.ko[k]), ph(I.STR.en[k]), '자리표시자 ' + k);
  }
  assert.ok(!/[가-힣]/.test(Object.entries(I.STR.en).filter(([k]) => !k.startsWith('lang.')).map(([, v]) => [].concat(v).join(' ')).join(' ')), '영어 표에 한글이 남음');
});
t('i18n t(): 치환·복수·대체', () => {
  assert.strictEqual(I.t('en', 'growth.left', { n: 1 }), 'Growth · 1 memory');
  assert.strictEqual(I.t('en', 'growth.left', { n: 2 }), 'Growth · 2 memories');
  assert.strictEqual(I.t('ko', 'growth.left', { n: 1 }), '성장도 · 기억 1개');
  assert.strictEqual(I.t('xx', 'app.title'), '마루');
  assert.strictEqual(I.t('en', 'no.such.key'), 'no.such.key');
  assert.strictEqual(I.t('en', 'batt', {}), 'Battery {p}%');
  assert.strictEqual(I.t('en', '__proto__'), '__proto__');
});
t('화면이 쓰는 키가 표에 모두 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8') + fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8') + fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');
  const used = new Set();
  for (const m of src.matchAll(/\bT\('([a-z][\w.-]*)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/\btr\('([a-z][\w.-]*)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\brow\('\w+',\s*'\w+',\s*'([\w.-]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/'(copyLogin|install|open(?!Directory)[A-Z]\w+)'/g)) used.add('act.' + m[1]); // 행 동작 버튼 문구
  assert.ok(used.size > 40);
  for (const k of used) if (!k.endsWith('.')) assert.ok(Object.prototype.hasOwnProperty.call(I.STR.ko, k), '표에 없음: ' + k);
});

// ---- 작업 공간 ----
const WSDIRS = new Set(['/h/a/blog', '/h/b/blog', '/h/maru', '/h/x', '/h/y', '/h/z', '/h/w', '/h/v', '/']);
const wsExists = (p) => WSDIRS.has(p);
t('workspaceTitle·uniqueTitle 번호 매기기', () => {
  assert.strictEqual(L.workspaceTitle('/h/a/blog'), 'blog');
  assert.strictEqual(L.workspaceTitle('/h/a/blog/'), 'blog');
  assert.strictEqual(L.workspaceTitle('/'), '/');
  assert.strictEqual(L.workspaceTitle('/h/\u202E\u200B'), 'workspace');
  assert.strictEqual(L.workspaceTitle('/h/\u202E\u200B', I.t('ko', 'ws.untitled')), '작업 공간'); // 대체 제목은 i18n
  assert.strictEqual(L.normalizeWorkspaces({ workspaces: [{ cwd: '/h/ ' }] }, { exists: () => true, fallbackTitle: I.t('en', 'ws.untitled') }).list[0].title, 'Workspace');
  assert.strictEqual([...L.workspaceTitle('/h/' + '가'.repeat(60))].length, 40);
  assert.strictEqual(L.uniqueTitle('blog', []), 'blog');
  assert.strictEqual(L.uniqueTitle('blog', ['blog']), 'blog 2');
  assert.strictEqual(L.uniqueTitle('blog', ['blog', 'blog 2', 'blog 3']), 'blog 4');
  assert.strictEqual(L.uniqueTitle('blog', ['blog 2']), 'blog');
  assert.ok([...L.uniqueTitle('가'.repeat(40), ['가'.repeat(40)])].length <= 40);
});
t('normalizeWorkspaces: 정상·중복 제목·활성 위치', () => {
  const r = L.normalizeWorkspaces({ active: 1, workspaces: [{ cwd: '/h/a/blog', title: 'blog' }, { cwd: '/h/b/blog', title: 'blog' }, { cwd: '/h/maru' }] }, { exists: wsExists });
  assert.deepStrictEqual(r, { list: [{ cwd: '/h/a/blog', title: 'blog' }, { cwd: '/h/b/blog', title: 'blog 2' }, { cwd: '/h/maru', title: 'maru' }], active: 1 });
  const same = L.normalizeWorkspaces({ workspaces: [{ cwd: '/h/x' }, { cwd: '/h/x' }, { cwd: '/h/x/' }] }, { exists: (p) => p === '/h/x' });
  assert.deepStrictEqual(same.list.map((x) => x.title), ['x', 'x 2', 'x 3']);
  assert.strictEqual(same.list[2].cwd, '/h/x');
});
t('normalizeWorkspaces: 없는 폴더는 사용 불가로 남기고 나쁜 항목은 버리며 활성 위치를 보정', () => {
  const r = L.normalizeWorkspaces({ active: 2, workspaces: [{ cwd: '/h/gone' }, { cwd: '/h/x' }, { cwd: '/h/y' }, { cwd: 5 }, null, 'str', [], { cwd: 'rel/path' }, { cwd: '/h/x/../y' }, { cwd: '/h/x\u202E' }, { cwd: '/h/z', title: 42 }] }, { exists: wsExists });
  assert.deepStrictEqual(r.list.map((x) => x.cwd), ['/h/gone', '/h/x', '/h/y', '/h/z']); // 없는 폴더(/h/gone)도 버리지 않는다
  assert.deepStrictEqual(r.list.map((x) => !!x.unavailable), [true, false, false, false]);
  assert.strictEqual(r.active, 2); // 원래 2번(/h/y)이 새 목록의 2번
  assert.strictEqual(L.normalizeWorkspaces({ active: 0, workspaces: [{ cwd: '/h/gone' }, { cwd: '/h/x' }] }, { exists: wsExists }).active, 0); // 사용 불가여도 활성 위치는 그대로
  for (const a of [-1, 99, 1.5, '1', null, undefined]) assert.strictEqual(L.normalizeWorkspaces({ active: a, workspaces: [{ cwd: '/h/x' }] }, { exists: wsExists }).active, 0);
  assert.strictEqual(L.normalizeWorkspaces({ workspaces: [{ cwd: '/h/x', title: 'a\u202Eb\nc' }] }, { exists: wsExists }).list[0].title, 'abc');
});
t('normalizeWorkspaces: 6개 초과·잘못된 최상위 형식·exists 오류', () => {
  const many = ['/h/x', '/h/y', '/h/z', '/h/w', '/h/v', '/h/maru', '/h/a/blog', '/h/b/blog'].map((cwd) => ({ cwd }));
  const r = L.normalizeWorkspaces({ workspaces: many }, { exists: wsExists });
  assert.strictEqual(r.list.length, 6); assert.strictEqual(r.list[5].cwd, '/h/maru');
  for (const bad of [null, undefined, 'x', 5, [], {}, { workspaces: 'x' }, { workspaces: {} }]) assert.deepStrictEqual(L.normalizeWorkspaces(bad, { exists: wsExists }), { list: [], active: 0 });
  const un = [{ cwd: '/h/x', title: 'x', unavailable: true }];
  assert.deepStrictEqual(L.normalizeWorkspaces({ workspaces: [{ cwd: '/h/x' }] }, { exists: () => { throw new Error('x'); } }).list, un);
  assert.deepStrictEqual(L.normalizeWorkspaces({ workspaces: [{ cwd: '/h/x' }] }, {}).list, un); // exists 없으면 아무것도 믿지 않는다(사용 불가로 표시)
  assert.deepStrictEqual(L.normalizeWorkspaces({ workspaces: [{ cwd: '/h/x' }] }, { exists: () => 'yes' }).list, un);
  assert.strictEqual(L.normalizeWorkspaces({ workspaces: [{ cwd: '/h/' + 'a'.repeat(1100) }] }, { exists: () => true }).list.length, 0);
});
t('parseWorkspaces: 나쁜 JSON·잘림은 null(없는 것으로 취급)', () => {
  const ok = JSON.stringify({ version: 1, active: 0, workspaces: [{ cwd: '/h/x', title: 'x' }] });
  assert.deepStrictEqual(L.parseWorkspaces({ text: ok, truncated: false }, wsExists), { list: [{ cwd: '/h/x', title: 'x' }], active: 0 });
  assert.strictEqual(L.parseWorkspaces({ text: ok, truncated: true }, wsExists), null);
  for (const text of ['', 'nope', '{', '[]', 'null', '5', '{"workspaces":5}', '{}']) assert.strictEqual(L.parseWorkspaces({ text, truncated: false }, wsExists), null, text);
  assert.strictEqual(L.parseWorkspaces(null, wsExists), null);
  assert.deepStrictEqual(L.parseWorkspaces({ text: '{"workspaces":[]}', truncated: false }, wsExists), { list: [], active: 0 });
});
t('작업 공간 저장(0600·원자적·필드 제한)과 읽기, 심볼릭 링크 거부', () => {
  const dir = path.join(tmp, 'wsdata'); const f = path.join(dir, 'workspaces.json');
  assert.strictEqual(L.loadWorkspaces(f, () => true), null);
  assert.strictEqual(L.saveWorkspaces(f, [{ cwd: '/h/x', title: 'x', extra: 'secret', state: 'busy' }, { cwd: '/h/y', title: 'y' }], 1), true);
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepStrictEqual(fs.readdirSync(dir), ['workspaces.json']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { version: 1, active: 1, workspaces: [{ cwd: '/h/x', title: 'x' }, { cwd: '/h/y', title: 'y' }] });
  assert.deepStrictEqual(L.loadWorkspaces(f, wsExists), { list: [{ cwd: '/h/x', title: 'x' }, { cwd: '/h/y', title: 'y' }], active: 1 });
  assert.deepStrictEqual(L.loadWorkspaces(f, (p) => p === '/h/y'), { list: [{ cwd: '/h/x', title: 'x', unavailable: true }, { cwd: '/h/y', title: 'y' }], active: 1 }); // 없어진 폴더는 사용 불가로 남기고, 파일에서도 지우지 않는다
  fs.writeFileSync(f, 'x'.repeat(40000)); assert.strictEqual(L.loadWorkspaces(f, wsExists), null);
  const link = path.join(dir, 'link.json'); fs.symlinkSync(f, link); assert.strictEqual(L.loadWorkspaces(link, wsExists), null);
  const real = path.join(tmp, 'wsreal'); fs.mkdirSync(real); const ld = path.join(tmp, 'wslink'); fs.symlinkSync(real, ld);
  assert.strictEqual(L.saveWorkspaces(path.join(ld, 'workspaces.json'), [{ cwd: '/h/x' }], 0), false);
  assert.deepStrictEqual(fs.readdirSync(real), []);
});
t('workspaceDirOk: 디렉터리이고 소유자가 현재 사용자', () => {
  const d = (uid) => ({ isDirectory: () => true, uid }); const fl = { isDirectory: () => false, uid: 501 };
  assert.strictEqual(L.workspaceDirOk(d(501), 501), true);
  assert.strictEqual(L.workspaceDirOk(d(0), 501), false);
  assert.strictEqual(L.workspaceDirOk(fl, 501), false);
  assert.strictEqual(L.workspaceDirOk(null, 501), false);
  assert.strictEqual(L.workspaceDirOk(fs.statSync(tmp), process.getuid()), true);
  assert.strictEqual(L.workspaceDirOk(fs.statSync(__filename), process.getuid()), false);
});
t('newSessionId: agent-state.sh 형식([A-Za-z0-9-]{8,64})', () => {
  const crypto = require('crypto');
  const ids = new Set();
  for (let i = 0; i < 20; i++) { const id = L.newSessionId(() => crypto.randomUUID()); assert.ok(L.isSessionId(id)); assert.ok(/^[A-Za-z0-9-]{8,64}$/.test(id)); ids.add(id); }
  assert.strictEqual(ids.size, 20);
  for (const bad of ['short', 'a/b/c/d/e/f/g', 'x'.repeat(65), 5, null]) assert.strictEqual(L.newSessionId(() => bad), null);
  assert.strictEqual(L.newSessionId(() => { throw new Error('x'); }), null);
});
t('shortenPath', () => {
  assert.strictEqual(L.shortenPath('/h/me', '/h/me'), '~');
  assert.strictEqual(L.shortenPath('/h/me/maru', '/h/me'), '~/maru');
  assert.strictEqual(L.shortenPath('/h/mex/maru', '/h/me'), '/h/mex/maru'); // 접두사만 같은 다른 폴더
  assert.strictEqual(L.shortenPath('/opt/x', '/h/me'), '/opt/x');
  assert.strictEqual(L.shortenPath('/', '/h/me'), '/');
  assert.strictEqual(L.shortenPath('/h/me/a/very/deep/nested/project/blog', '/h/me', 20), '~/…/project/blog');
  assert.strictEqual(L.shortenPath('/opt/a/very/deep/nested/project/blog', '/h/me', 20), '/…/project/blog');
  const long = L.shortenPath('/h/me/' + 'x'.repeat(80), '/h/me', 20);
  assert.ok([...long].length <= 20 && long.startsWith('…'));
  for (const bad of ['', null, undefined, 5]) assert.strictEqual(L.shortenPath(bad, '/h/me'), '');
  assert.strictEqual(L.shortenPath('/h/me/한글/프로젝트', '/h/me'), '~/한글/프로젝트');
});
const trK = (k, p) => I.t('ko', k, p); const trE = (k, p) => I.t('en', k, p);
t('traySummary·trayTitle 혼합 상태', () => {
  assert.strictEqual(L.traySummary(['busy', 'busy', 'waiting'], trK), '작업 중 2 · 확인 필요 1');
  assert.strictEqual(L.traySummary(['idle', 'waiting', 'busy', 'busy', 'exited', 'none'], trK), '작업 중 2 · 확인 필요 1 · 입력 대기 1 · 대기 1 · 종료됨 1');
  assert.strictEqual(L.traySummary(['idle'], trE), 'Ready 1');
  assert.strictEqual(L.traySummary(['busy', 'waiting'], trE), 'Working 1 · Needs you 1');
  assert.strictEqual(L.traySummary([], trK), '열린 작업 공간 없음');
  assert.strictEqual(L.traySummary(undefined, trE), 'No workspaces open');
  assert.strictEqual(L.traySummary(['bogus', 'none'], trK), '대기 2');
  assert.strictEqual(L.trayTitle(['busy', 'waiting']), '!');
  assert.strictEqual(L.trayTitle(['busy', 'idle', 'exited']), '');
  assert.strictEqual(L.trayTitle([]), ''); assert.strictEqual(L.trayTitle(null), '');
});
t('trayTodoTitles: 정리·40자 상한·최대 3개', () => {
  const r = L.trayTodoTitles([{ title: '하나' }, { title: 'a\u202Eb\u200Bc' }, { title: '' }, { title: '가'.repeat(60) }, { title: '넷' }, null, { title: 5 }]);
  assert.deepStrictEqual(r, ['하나', 'abc', '가'.repeat(39) + '…']);
  assert.strictEqual([...r[2]].length, 40);
  assert.strictEqual(L.trayTodoTitles([{ title: '가'.repeat(40) }])[0], '가'.repeat(40));
  assert.deepStrictEqual(L.trayTodoTitles(undefined), []);
});
t('trayMenuModel: ko·en 라벨 모델', () => {
  const workspaces = [{ id: 'a', title: 'blog', state: 'busy' }, { id: 'b', title: 'maru', state: 'waiting' }, { id: 'c', title: 'notes 2', state: 'exited' }];
  const todos = [{ title: '글 초안 점검' }, { title: '병원 예약' }, { title: '영수증' }, { title: '넷째는 안 보임' }];
  const ko = L.trayMenuModel({ workspaces, activeId: 'b', todos, t: trK });
  assert.deepStrictEqual(ko.map((m) => [m.type, m.label || '']), [
    ['header', '작업 중 1 · 확인 필요 1 · 종료됨 1'], ['workspace', 'blog · 작업 중'], ['workspace', 'maru · 확인 필요'], ['workspace', 'notes 2 · 종료됨'],
    ['separator', ''], ['todo', '글 초안 점검'], ['todo', '병원 예약'], ['todo', '영수증'], ['separator', ''],
    ['action', '창 열기'], ['action', '새 작업 공간…'], ['action', '설정…'], ['action', '종료'],
  ]);
  assert.strictEqual(ko[0].enabled, false);
  assert.ok(ko.filter((m) => m.type === 'todo').every((m) => m.enabled === false));
  assert.deepStrictEqual(ko.filter((m) => m.type === 'workspace').map((m) => m.checked), [false, true, false]);
  assert.deepStrictEqual(ko.filter((m) => m.type === 'action').map((m) => m.id), ['show', 'new', 'settings', 'quit']);
  const en = L.trayMenuModel({ workspaces, activeId: 'a', todos: [], t: trE });
  assert.deepStrictEqual(en.map((m) => m.label || ''), ['Working 1 · Needs you 1 · Exited 1', 'blog · Working', 'maru · Needs you', 'notes 2 · Exited', '', 'Show Window', 'New Workspace…', 'Settings…', 'Quit']);
  const empty = L.trayMenuModel({ workspaces: [], todos: undefined, t: trK });
  assert.deepStrictEqual(empty.map((m) => m.label || ''), ['열린 작업 공간 없음', '', '창 열기', '새 작업 공간…', '설정…', '종료']);
});
t('trayIconPath: 개발·패키징 경로', () => {
  assert.strictEqual(L.trayIconPath({ isPackaged: false, resourcesPath: '/R', appDir: '/A' }), '/A/build/trayTemplate.png');
  assert.strictEqual(L.trayIconPath({ isPackaged: true, resourcesPath: '/R', appDir: '/A' }), '/R/tray/trayTemplate.png');
});
t('트레이 아이콘 파일: 18·36px PNG, 패키징 설정에 포함', () => {
  const png = (f) => { const b = fs.readFileSync(path.join(__dirname, 'build', f)); assert.strictEqual(b.toString('latin1', 1, 4), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepStrictEqual(png('trayTemplate.png'), [18, 18]);
  assert.deepStrictEqual(png('trayTemplate@2x.png'), [36, 36]);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const to = pkg.build.extraResources.map((r) => r.to).sort();
  assert.deepStrictEqual(to, ['tray/trayTemplate.png', 'tray/trayTemplate@2x.png']);
  for (const r of pkg.build.extraResources) assert.ok(fs.existsSync(path.join(__dirname, r.from)));
});
t('작업 공간·트레이 i18n 키가 ko·en 모두 있고 비어 있지 않다', () => {
  const keys = ['agent.exited', 'agent.exited.sub', 'ws.add', 'ws.add.aria', 'ws.close.aria', 'ws.row.aria', 'ws.empty', 'ws.new', 'term.fail', 'fill.inactive',
    'menu.workspace', 'menu.newWs', 'menu.closeWs', 'menu.nextWs', 'menu.prevWs', 'menu.gotoWs', 'dlg.pick.title', 'dlg.pick.ok', 'dlg.max.title', 'dlg.max.detail',
    'dlg.dir.title', 'dlg.dir.detail', 'dlg.close.title', 'dlg.close.detail', 'dlg.close.ok', 'dlg.quit.title', 'dlg.quit.detail', 'dlg.quit.ok',
    'tray.none', 'tray.tip', 'tray.open', 'tray.new', 'tray.settings', 'tray.quit'];
  for (const k of keys) for (const lg of I.LANGS) assert.ok(Object.prototype.hasOwnProperty.call(I.STR[lg], k) && [].concat(I.STR[lg][k]).every((x) => x.length > 0), lg + ':' + k);
  assert.strictEqual(I.t('en', 'dlg.quit.detail', { n: 1 }).startsWith('1 workspace is'), true);
  assert.strictEqual(I.t('ko', 'dlg.close.title', { title: 'blog' }), '"blog" 작업 공간을 닫을까요?');
});
t('main.js 가 쓰는 작업 공간 IPC 채널이 preload 와 맞는다', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  for (const ch of ['pty:start', 'pty:restart', 'pty:write', 'pty:resize', 'quest:fill', 'ws:get', 'ws:activate', 'ws:new', 'ws:close']) {
    assert.ok(main.includes("'" + ch + "'") && pre.includes("'" + ch + "'"), ch);
  }
  for (const ch of ['pty:start', 'pty:restart', 'pty:write', 'pty:resize', 'ws:activate', 'ws:close']) assert.ok(new RegExp("'" + ch + "', String\\(id\\)").test(pre), 'id 를 싣는지: ' + ch);
  assert.ok(/'quest:fill', String\(id\)/.test(pre));
});

// ---- 로고·링 움직임 ----
t('LOGO 도안: 135 타일, 지정한 반지름·선 굵기, 헤더 SVG 와 일치', () => {
  assert.strictEqual(L.LOGO.tile, 135);
  assert.deepStrictEqual([L.LOGO.ring.r, L.LOGO.ring.w, L.LOGO.dash.r, L.LOGO.dash.w, L.LOGO.dash.on, L.LOGO.dash.off, L.LOGO.dot.r], [40, 6, 24, 2, 4, 5, 10]);
  assert.strictEqual(L.LOGO.color, '#FF8A2B'); assert.strictEqual(L.LOGO.tileColor, '#17110B');
  const mark = L.logoShapesSvg(L.LOGO.color, 'mark');
  assert.ok(mark.includes('r="40"') && mark.includes('stroke-width="6"') && mark.includes('stroke-dasharray="4 5"') && mark.includes('r="10"'));
  const tray = L.logoShapesSvg('#000000', 'tray');
  assert.ok(!tray.includes('stroke-dasharray') && (tray.match(/<circle/g) || []).length === 2); // 고리 + 점만
  const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes(mark), '헤더 SVG 가 도안과 다름');
});
const runRing = (st, ms, mode, step = 16) => { let s = st; for (let t0 = 0; t0 < ms; t0 += step) s = L.stepRing(s, step, mode); return s; };
t('stepRing: busy 로 빠르게 가속(400ms 에 목표의 90% 가까이)', () => {
  const s0 = L.ringInit();
  const s = runRing(s0, 400, 'busy', 10);
  const frac = (s.v - L.RING.vDrift) / (L.RING.vBusy - L.RING.vDrift);
  assert.ok(frac > 0.88 && frac < 0.95, 'frac ' + frac);
  assert.ok(runRing(s0, 2000, 'busy').v > 0.99 * L.RING.vBusy);
  const w = runRing(s0, 3000, 'waiting'); assert.ok(Math.abs(w.v - L.RING.vWaiting) < 2);
  assert.strictEqual(runRing(s0, 3000, 'exited').v < 0.5, true);
});
t('stepRing: busy→idle 은 마찰처럼 천천히(300ms 에 여전히 빠름, 2s 에 15% 미만, 단조 감소)', () => {
  let s = runRing(L.ringInit(), 3000, 'busy');
  const vb = s.v; assert.ok(vb > 530);
  let prev = vb; let v300 = null; let v2000 = null; let t = 0;
  for (; t < 5000; t += 10) {
    s = L.stepRing(s, 10, 'idle');
    assert.ok(s.v <= prev + 1e-9, '단조 감소'); prev = s.v;
    if (t + 10 === 300) v300 = s.v;
    if (t + 10 === 2000) v2000 = s.v;
  }
  assert.ok(v300 > 0.5 * vb, 'v300 ' + v300);
  assert.ok(v2000 < 0.15 * vb, 'v2000 ' + v2000);
  assert.ok(s.v < 12 && s.v >= L.RING.vDrift - 1e-9); // 결국 drift 로 안정
  assert.ok(s.busy < 0.05); // 호 숨쉬기·점 맥동 진폭도 같은 곡선으로 사라진다
});
t('stepRing: dt 상한(50ms)·각도 범위·진폭 포락선·뜨는 느낌', () => {
  const a = L.stepRing(L.ringInit(), 5000, 'busy'); const b = L.stepRing(L.ringInit(), 50, 'busy');
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(L.stepRing(L.ringInit(), -10, 'busy'), L.stepRing(L.ringInit(), 0, 'busy'));
  assert.deepStrictEqual(L.stepRing(L.ringInit(), NaN, 'busy'), L.stepRing(L.ringInit(), 0, 'busy'));
  let s = L.ringInit(); for (let i = 0; i < 2000; i++) s = L.stepRing(s, 16, 'busy');
  assert.ok(s.a1 >= 0 && s.a1 < 360 && s.a2 >= 0 && s.a2 < 360);
  const busyV = []; let u = s; for (let i = 0; i < 200; i++) { u = L.stepRing(u, 16, 'busy'); busyV.push(L.ringView(u)); }
  assert.ok(Math.max(...busyV.map((v) => v.dot)) > 1.1 && Math.min(...busyV.map((v) => v.dot)) < 0.9); // 점 ±12%
  assert.ok(Math.max(...busyV.map((v) => v.arc)) > 160 && Math.min(...busyV.map((v) => v.arc)) < 80); // 호가 숨쉰다
  assert.ok(busyV.every((v) => Math.abs(v.ty) < 0.5 && Math.abs(v.scale - 1) < 0.01)); // busy 에서는 떠오르지 않는다
  let i2 = L.ringInit(); const idleV = []; for (let i = 0; i < 600; i++) { i2 = L.stepRing(i2, 16, 'idle'); idleV.push(L.ringView(i2)); }
  assert.ok(Math.max(...idleV.map((v) => v.ty)) > 2.5 && Math.min(...idleV.map((v) => v.ty)) < -2.5 && idleV.every((v) => Math.abs(v.ty) <= 3 + 1e-9)); // ±3px
  assert.ok(idleV.every((v) => v.scale <= 1.015 + 1e-9 && v.scale >= 0.985 - 1e-9 && v.dot === 1));
  const rot = L.stepRing(L.stepRing(L.ringInit(), 50, 'busy'), 50, 'busy'); assert.ok(rot.a1 > 0 && rot.a2 > 180); // 안쪽 고리는 반대 방향(−0.6×)
});
t('stepRing: reduced-motion 이면 정지 상태', () => {
  let s = runRing(L.ringInit(), 1000, 'busy');
  for (const mode of ['busy', 'idle', 'waiting', 'exited']) {
    s = L.stepRing(s, 16, mode, true);
    assert.deepStrictEqual(s, { a1: 0, a2: 0, v: 0, busy: 0, fl: 0, t: 0 });
    const v = L.ringView(s); assert.deepStrictEqual([v.rot1, v.rot2, v.ty, v.scale, v.dot, v.arc], [0, 0, 0, 1, 1, 120]);
  }
});
t('main.js: 시스템 종료(powerMonitor shutdown)는 확인 창 없이 종료 허용', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.ok(/powerMonitor\.on\('shutdown', \(\) => \{ quitting = true; cleanup\(\); \}\)/.test(main));
  assert.ok(/before-quit[\s\S]{0,80}if \(quitting\) return;/.test(main));
});

// ---- 동작 결정·복원·id 검증 ----
t('confirmClose·confirmRestart: 상태별 확인 여부', () => {
  const all = ['busy', 'waiting', 'idle', 'none', 'pending', 'exited', 'unavailable'];
  assert.deepStrictEqual(all.filter(L.confirmClose), ['busy', 'waiting', 'idle', 'none']); // 세션이 살아 있으면 확인
  assert.deepStrictEqual(all.filter(L.confirmRestart), ['busy', 'waiting']);
  for (const bad of [undefined, null, '', 'bogus', 5]) { assert.strictEqual(L.confirmClose(bad), false); assert.strictEqual(L.confirmRestart(bad), false); }
  assert.deepStrictEqual(L.WS_STATES, ['busy', 'waiting', 'idle', 'none', 'pending', 'exited', 'unavailable']);
});
t('closeRequestAction: 열린 창이 있으면 그것부터 닫는다', () => {
  assert.strictEqual(L.closeRequestAction({ overlayOpen: true, hasActive: true }), 'overlay');
  assert.strictEqual(L.closeRequestAction({ overlayOpen: true, hasActive: false }), 'overlay');
  assert.strictEqual(L.closeRequestAction({ overlayOpen: false, hasActive: true }), 'workspace');
  assert.strictEqual(L.closeRequestAction({ overlayOpen: false, hasActive: false }), 'none');
});
t('lookupWs: 모르는·닫힌·이상한 id 는 버린다', () => {
  const table = new Map([['abc', { id: 'abc' }], ['def', { id: 'def' }]]);
  assert.strictEqual(L.lookupWs(table, 'abc').id, 'abc');
  table.delete('abc');
  for (const bad of ['abc', 'zzz', '', '__proto__', 'constructor', 'toString', 5, null, undefined, {}, ['def'], Symbol.iterator]) assert.strictEqual(L.lookupWs(table, bad), null, String(typeof bad));
  assert.strictEqual(L.lookupWs(null, 'def'), null);
  assert.strictEqual(L.lookupWs({}, 'def'), null);
});
t('readWorkspacesFile: 없음·정상·망가짐 구분, 망가진 파일은 .bak 으로(예전 .bak 덮어씀)', () => {
  const dir = path.join(tmp, 'wsrest'); fs.mkdirSync(dir); const f = path.join(dir, 'workspaces.json');
  assert.strictEqual(L.readWorkspacesFile(f, wsExists).status, 'missing');
  assert.strictEqual(L.saveWorkspaces(f, [{ cwd: '/h/x', title: 'x' }, { cwd: '/h/gone', title: 'gone' }], 0), true);
  const ok = L.readWorkspacesFile(f, wsExists);
  assert.strictEqual(ok.status, 'ok'); assert.deepStrictEqual(ok.data.list.map((x) => !!x.unavailable), [false, true]);
  fs.writeFileSync(f + '.bak', 'old backup');
  fs.writeFileSync(f, '{broken');
  assert.strictEqual(L.readWorkspacesFile(f, wsExists).status, 'corrupt');
  assert.strictEqual(L.backupCorruptFile(f), true);
  assert.strictEqual(fs.readFileSync(f + '.bak', 'utf8'), '{broken'); assert.ok(!fs.existsSync(f));
  assert.strictEqual(L.readWorkspacesFile(f, wsExists).status, 'missing');
  assert.strictEqual(L.saveWorkspaces(f, [{ cwd: '/h/y', title: 'y' }], 0), true); // 새 파일이 깨끗하게 쓰인다
  assert.strictEqual(L.readWorkspacesFile(f, wsExists).data.list[0].cwd, '/h/y');
  fs.writeFileSync(f, '[]'); assert.strictEqual(L.readWorkspacesFile(f, wsExists).status, 'corrupt'); // 형식 오류도 망가진 파일
  assert.strictEqual(L.backupCorruptFile(path.join(dir, 'nope.json')), false);
});
t('ringFrameInterval: 조용하면 30fps, 가라앉으면 멈춤, 활동 중엔 매 프레임', () => {
  const busyS = runRing(L.ringInit(), 2000, 'busy');
  assert.strictEqual(L.ringFrameInterval(busyS, 'busy'), 0);
  assert.strictEqual(L.ringFrameInterval(busyS, 'idle'), 0); // 아직 도는 중(감속)
  assert.strictEqual(L.ringFrameInterval(L.ringInit(), 'idle'), 33);
  assert.strictEqual(L.ringFrameInterval(L.ringInit(), 'none'), 33);
  assert.strictEqual(L.ringFrameInterval(L.ringInit(), 'waiting'), 0);
  const settled = runRing(L.ringInit(), 20000, 'exited');
  assert.strictEqual(L.ringFrameInterval(settled, 'exited'), -1);
  assert.strictEqual(L.ringFrameInterval(settled, 'pending'), -1);
  assert.notStrictEqual(L.ringFrameInterval(L.ringInit(), 'pending'), -1);
});
t('작업 공간 상태 문구(시작 전·사용 불가)와 요약', () => {
  assert.strictEqual(I.t('ko', 'agent.pending'), '시작 전'); assert.strictEqual(I.t('en', 'agent.pending'), 'Not started');
  assert.strictEqual(I.t('ko', 'agent.unavailable'), '사용 불가'); assert.strictEqual(I.t('en', 'agent.unavailable'), 'Unavailable');
  assert.strictEqual(L.traySummary(['busy', 'pending', 'unavailable'], trK), '작업 중 1 · 시작 전 1 · 사용 불가 1');
  for (const k of ['agent.pending.sub', 'agent.unavailable.sub', 'ws.untitled', 'term.unavailable', 'dlg.restart.title', 'dlg.restart.detail', 'dlg.restart.ok', 'dlg.hang.title', 'dlg.hang.detail', 'dlg.hang.reload', 'dlg.hang.wait'])
    for (const lg of I.LANGS) assert.ok(I.STR[lg][k] && [].concat(I.STR[lg][k]).every((x) => x.length > 0), lg + ':' + k);
});
t('main.js: 설치 때 종료 확인 생략(beforeQuit)·종료 경로·화면 복구·패키징 스모크', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.ok(/installAndRelaunch\(upd\.dmgPath, \{ beforeQuit: \(\) => \{ quitting = true; \} \}\)/.test(main));
  assert.ok(main.includes("'render-process-gone'") && main.includes("'unresponsive'"));
  assert.ok(/function killAllSync[\s\S]*SIGHUP[\s\S]*Atomics\.wait[\s\S]*SIGKILL/.test(main));
  assert.ok(/if \(app\.isPackaged\) \{ app\.exit\(ROOT \? 0 : 1\); return; \}/.test(main)); // 패키징 스모크는 한 줄 뒤 바로 종료
  assert.ok(/!\(!app\.isPackaged && \(SMOKE \|\| TEST_FX\)\) && attention/.test(main)); // 확인 생략은 개발 실행에서만
  assert.ok(main.includes("sendToRenderer('ui:close-request')"));
});
t('렌더러: ⌘W 요청·reduced-motion CSS', () => {
  const css = fs.readFileSync(path.join(__dirname, 'renderer', 'style.css'), 'utf8');
  assert.ok(/prefers-reduced-motion:reduce\)\{[^}]*animation:none!important/.test(css));
  assert.ok(fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8').includes("'ui:close-request'"));
});
// ---- 프로젝트 추적 ----
t('parseTodos: 태그/슬러그(프로젝트), 슬러그만 틀리면 슬러그만 뗌, 옛 줄 호환', () => {
  const r = L.parseTodos('maru/desktop-app|8|앱 마무리|이어서 해줘\nmaru|5|옛 줄|\nmaru/Bad|5|대문자 슬러그|\nmaru/|5|빈 슬러그|\nmaru/a/b|5|슬러그 둘|\n블로그/글-1|4|한글 슬러그|');
  assert.deepStrictEqual(r, [
    { tag: 'maru', importance: 8, title: '앱 마무리', prompt: '이어서 해줘', project: 'maru/desktop-app' },
    { tag: 'maru', importance: 5, title: '옛 줄', prompt: '' },
    { tag: 'maru', importance: 5, title: '대문자 슬러그', prompt: '' },
    { tag: 'maru', importance: 5, title: '빈 슬러그', prompt: '' },
    { tag: 'maru', importance: 5, title: '슬러그 둘', prompt: '' },
    { tag: '블로그', importance: 4, title: '한글 슬러그', prompt: '', project: '블로그/글-1' },
  ]);
  for (const bad of ['../x|5|t|', 'maru/../x|5|t|p|q', '/x|5|t|', 'a b/c|5|t|', 'maru/' + 'a'.repeat(25) + '|5|t|p|x'])
    assert.deepStrictEqual(L.parseTodos(bad), [], bad);
  assert.deepStrictEqual(L.parseTodos('maru/' + 'a'.repeat(25) + '|5|t|'), [{ tag: 'maru', importance: 5, title: 't', prompt: '' }]); // 길이 초과 슬러그는 뗀다
  assert.deepStrictEqual(L.parseTodos('maru/a|b|5|t|p'), []); // 슬러그 칸의 | 는 칸 수를 깨뜨려 줄이 버려진다
});
t('parseProjectRegistry: 엄격 형식·중복·상한·위험 줄', () => {
  const ok = 'maru|desktop-app|데스크톱 앱\nmaru|desktop-app|덮어쓰기 시도\n블로그|글-1|글 쓰기\n';
  assert.deepStrictEqual(L.parseProjectRegistry(ok).map((x) => [x.key, x.title]), [['maru/desktop-app', '데스크톱 앱'], ['블로그/글-1', '글 쓰기']]); // 첫 제목 유지
  const bad = ['a|b', 'a|b|c|d', 'a b|x|t', 'maru|Upper|t', 'maru|' + 'a'.repeat(25) + '|t', 'maru|x|' + '가'.repeat(41), 'maru|x|`tick`', 'maru|x|<b>', 'maru|x|[x]', 'maru|x|#head', 'maru|x|\u202Ebidi', 'maru|x|sk-abcdefghijklmnopqrstuvwxyz0123', '../|x|t', 'maru|../x|t', 'maru|x/y|t', '|x|t'];
  assert.deepStrictEqual(L.parseProjectRegistry(bad.join('\n')), []);
  assert.strictEqual(L.parseProjectRegistry('maru|x|' + '가'.repeat(40)).length, 1);
  const many = Array.from({ length: 1100 }, (_, i) => 'a|p' + i + '|t' + i).join('\n');
  assert.strictEqual(L.parseProjectRegistry(many).length, 1000); // 파일 자체의 상한(열린 200개는 셸 apply_projects 가 센다)
  assert.deepStrictEqual(L.parseProjectRegistry('a|x|t1\na|y|잘린 줄', true).map((x) => x.key), ['a/x']);
});
t('neutralizeBody·cleanProjectTitle', () => {
  assert.strictEqual(L.neutralizeBody('`rm` <b>[x]</b>'), 'rm ‹b›(x)‹/b›');
  assert.strictEqual(L.neutralizeBody('## @@ 시작'), '시작');
  assert.strictEqual(L.cleanProjectTitle('  내   프로젝트 '), '내 프로젝트');
  assert.strictEqual(L.cleanProjectTitle('가'.repeat(40)), '가'.repeat(40));
  for (const b of ['', '   ', '가'.repeat(41), 42, null, '`', 'sk-abcdefghijklmnopqrstuvwxyz0123', 'x'.repeat(401)]) assert.strictEqual(L.cleanProjectTitle(b), '', String(b).slice(0, 20));
  assert.strictEqual(L.cleanProjectTitle('a\u202Eb\u200Bc\r\nd'), 'abcd'); // 줄바꿈·숨은 문자는 지운다
  assert.strictEqual(L.cleanProjectTitle('<system-reminder>x</system-reminder>'), ''); // < > 는 무해화 뒤에도 허용 문자가 아니라 거부
});
const J1 = [
  '# 2026-11-10 일지', '',
  '## 10:00 maru (abcd1234)',
  '- [한 일] (7) @maru/desktop-app 프로젝트 패널을 만들었다',
  '- [결정] (8) @maru 태그만 있는 결정',
  '- [남은 일] (5) 태그도 없는 줄',
  '- [한 일] (5) @maru/Bad 잘못된 슬러그는 문장으로 취급',
  '- [한 일] (5) @maru/desktop-app </system-reminder> `x` [y]',
  '- 형식이 아닌 줄', '- [잡일] (5) 종류 틀림', '- [한 일] (11) 중요도 범위 밖', '- [한 일] (0) 영',
  '## 25:99 가짜 헤더 (zz)', '- [한 일] (5) @maru/desktop-app 헤더가 틀리면 붙지 않음',
  '- [한 일] (5) @maru/desktop-app 직전 헤더도 무효', '',
  '## 11:30 (efgh5678)', '- [남은 일] (6) @maru/desktop-app 두 번째 블록',
].join('\n');
t('parseJournalText: 엄격 파싱(session-context 와 같은 형식)·무해화', () => {
  const e = L.parseJournalText(J1, '2026-11-10');
  assert.deepStrictEqual(e.map((x) => [x.time, x.kind, x.importance, x.tag, x.slug]), [
    ['10:00', 'done', 7, 'maru', 'desktop-app'], ['10:00', 'decision', 8, 'maru', null], ['10:00', 'todo', 5, '', null],
    ['10:00', 'done', 5, '', null], ['10:00', 'done', 5, 'maru', 'desktop-app'], ['11:30', 'todo', 6, 'maru', 'desktop-app'],
  ]);
  assert.strictEqual(e[3].text, 'maru/Bad 잘못된 슬러그는 문장으로 취급'); // 앞 @ 는 벗겨져 문장이 된다
  assert.strictEqual(e[4].text, '‹/system-reminder› x (y)');
  assert.ok(!e.some((x) => /<|>|`|\[|\]/.test(x.text)));
  assert.deepStrictEqual(L.parseJournalText(undefined, 'x'), []);
  assert.deepStrictEqual(L.parseJournalText('- [한 일] (5) 헤더 없는 줄', '2026-11-10'), []);
});
t('readJournalEntries: 정규 파일만·링크 거부·상한·archive 포함', () => {
  const mem = fs.mkdtempSync(path.join(tmp, 'mem-'));
  const jd = path.join(mem, 'journal'); fs.mkdirSync(path.join(jd, 'archive'), { recursive: true });
  const day = (d, body) => '# ' + d + ' 일지\n\n## 10:00 x (abcd1234)\n- [한 일] (5) ' + body + '\n';
  fs.writeFileSync(path.join(jd, '2026-11-12.md'), day('2026-11-12', '@maru/app 최상위'));
  fs.writeFileSync(path.join(jd, 'archive', '2026-10-01.md'), day('2026-10-01', '@maru/app 보관됨'));
  fs.writeFileSync(path.join(jd, 'archive', '2026-10-01.1.md'), day('2026-10-01', '@maru/app 이름 충돌 접미사'));
  fs.writeFileSync(path.join(jd, 'notes.md'), day('x', '날짜 이름이 아님'));
  fs.writeFileSync(path.join(jd, '2026-13-45.md'), day('x', '없는 날짜'));
  fs.writeFileSync(path.join(jd, '2026-11-13.md'), '# x\n\n## 10:00 x (abcd1234)\n- [한 일] (5) ' + 'a'.repeat(300 * 1024) + '\n'); // 파일당 상한 초과
  fs.writeFileSync(path.join(tmp, 'secret.md'), day('2026-11-14', '링크 대상'));
  fs.symlinkSync(path.join(tmp, 'secret.md'), path.join(jd, '2026-11-14.md'));
  const r = L.readJournalEntries(mem);
  const texts = r.map((x) => x.text);
  assert.deepStrictEqual(texts.slice().sort(), ['보관됨', '이름 충돌 접미사', '최상위']);
  assert.ok(!texts.some((x) => /링크 대상|날짜 이름이 아님|없는 날짜|aaaa/.test(x)));
  assert.strictEqual(r[0].day, '2026-11-12'); // 최신 날짜 먼저
  // journal 이 심볼릭 링크면 아무것도 읽지 않는다
  const mem2 = fs.mkdtempSync(path.join(tmp, 'mem-')); fs.symlinkSync(jd, path.join(mem2, 'journal'));
  assert.deepStrictEqual(L.readJournalEntries(mem2), []);
  assert.deepStrictEqual(L.readJournalEntries(path.join(tmp, 'no-such')), []);
  // archive 가 링크면 archive 는 건너뛴다
  const mem3 = fs.mkdtempSync(path.join(tmp, 'mem-')); fs.mkdirSync(path.join(mem3, 'journal'));
  fs.symlinkSync(path.join(jd, 'archive'), path.join(mem3, 'journal', 'archive'));
  assert.deepStrictEqual(L.readJournalEntries(mem3), []);
});
t('프로젝트 상태 파일: 엄격 검증·원자적 저장·손상 처리', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'ps-')); const f = path.join(dir, 'project-state.json');
  assert.deepStrictEqual(L.readProjectStateFile(f), { status: 'missing', data: {} });
  const st = { 'maru/a': { status: 'done', doneAt: '2026-11-10', title: '이름', mergedInto: 'maru/b' }, 'maru/b': { status: 'open' } };
  assert.ok(L.saveProjectState(f, st));
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepStrictEqual(fs.readdirSync(dir), ['project-state.json']); // 임시 파일 잔여 없음
  assert.deepStrictEqual(L.readProjectStateFile(f), { status: 'ok', data: st });
  const v = L.validateProjectState({
    'maru/ok': { status: 'open', evil: 1, title: '`x`' }, '../x': { status: 'open' }, 'maru': { status: 'open' }, 'maru/Up': { status: 'open' },
    'maru/s': { status: 'weird' }, 'maru/t': { status: 'open', mergedInto: 'maru/t' }, 'maru/u': { status: 'done', doneAt: '2026-13-40' }, 'maru/w': 5, 'maru/x': { status: 'open', mergedInto: '../y' },
  });
  assert.deepStrictEqual(v, { 'maru/ok': { status: 'open' }, 'maru/t': { status: 'open' }, 'maru/u': { status: 'done', doneAt: null }, 'maru/x': { status: 'open' } });
  assert.strictEqual(L.validateProjectState([]), null); assert.strictEqual(L.validateProjectState('x'), null); assert.strictEqual(L.validateProjectState(null), null);
  assert.strictEqual(L.saveProjectState(f, { '../x': { status: 'open' } }), false); // 이상한 항목이 섞이면 쓰지 않는다
  assert.strictEqual(L.saveProjectState(f, { 'maru/a': { status: 'done', doneAt: 'bad' } }), false);
  assert.deepStrictEqual(L.readProjectStateFile(f).data, st); // 실패한 저장은 기존 파일을 건드리지 않는다
  const many = {}; for (let i = 0; i < 1001; i++) many['t/p' + i] = { status: 'open' };
  assert.strictEqual(L.validateProjectState(many), null);
  for (const bad of ['{', '[]', '"x"', JSON.stringify({ 'maru/a': { status: 'bad' } }).slice(0, 5)]) { fs.writeFileSync(f, bad); assert.strictEqual(L.readProjectStateFile(f).status, 'corrupt', bad); }
  fs.writeFileSync(f, ' '.repeat(70000)); assert.strictEqual(L.readProjectStateFile(f).status, 'corrupt'); // 크기 상한
  assert.ok(L.backupCorruptFile(f) && fs.existsSync(f + '.bak'));
  const link = path.join(dir, 'link.json'); fs.symlinkSync(path.join(dir, 'x'), link); fs.writeFileSync(path.join(dir, 'x'), JSON.stringify(st));
  assert.strictEqual(L.readProjectStateFile(link).status, 'corrupt'); // 심볼릭 링크는 읽지 않는다
  const ldir = path.join(tmp, 'ps-link'); fs.symlinkSync(dir, ldir);
  assert.strictEqual(L.saveProjectState(path.join(ldir, 'project-state.json'), st), false); // 폴더가 링크면 쓰지 않는다
});
const REG = L.parseProjectRegistry('maru|desktop-app|데스크톱 앱\nmaru|old|옛 일\nmaru|other|다른 일\n블로그|글-1|글 쓰기\n');
const ENT = [
  ...L.parseJournalText(J1, '2026-11-10'),
  ...L.parseJournalText('## 09:00 (aaaa1111)\n- [한 일] (5) @maru/old 옛 일 끝냈다\n- [남은 일] (5) @maru/zzz 등록 안 된 슬러그\n', '2026-11-01'),
  ...L.parseJournalText('## 09:00 (bbbb2222)\n- [결정] (8) @블로그/글-1 방향을 정했다\n', '2026-11-12'),
];
t('buildProjects: 요약·확인 필요·분류 안 됨·합치기', () => {
  const todos = L.parseTodos('maru/desktop-app|8|앱 마무리|p\nmaru/desktop-app|3|테스트|\nmaru|5|프로젝트 없는 할 일|\n블로그/글-1|4|초안|');
  const list = L.buildProjects({ registry: REG, entries: ENT, state: {}, todos, today: '2026-11-16' });
  const byKey = Object.fromEntries(list.map((x) => [x.key, x]));
  assert.deepStrictEqual(byKey['maru/desktop-app'], { key: 'maru/desktop-app', kind: 'project', tag: 'maru', title: '데스크톱 앱', status: 'open', doneAt: null, lastDay: '2026-11-10', records: 3, openTodos: 2, needsCheck: false });
  assert.strictEqual(byKey['maru/old'].openTodos, 0); assert.strictEqual(byKey['maru/old'].needsCheck, true); // 남은 일 0, 마지막 기록 15일 전
  assert.strictEqual(byKey['maru/other'].needsCheck, false); assert.strictEqual(byKey['maru/other'].lastDay, null); // 기록이 없으면 판단하지 않는다
  assert.strictEqual(byKey['블로그/글-1'].needsCheck, false); assert.strictEqual(byKey['블로그/글-1'].openTodos, 1); // 남은 일이 있으면 확인 필요 아님
  assert.deepStrictEqual(byKey.maru, { key: 'maru', kind: 'unclassified', tag: 'maru', title: '', status: 'open', doneAt: null, lastDay: '2026-11-10', records: 2, openTodos: 1, needsCheck: false }); // 태그만 있는 줄·미등록 슬러그·할 일(태그 없는 줄은 어느 카테고리에도 안 든다)
  // 3일 경계
  const edge = (d) => L.buildProjects({ registry: REG, entries: [{ day: d, tag: 'maru', slug: 'old', time: '10:00', kind: 'done', importance: 5, text: 'x', seq: 0 }], state: {}, todos: [], today: '2026-11-16' }).find((x) => x.key === 'maru/old').needsCheck;
  assert.strictEqual(edge('2026-11-13'), true); assert.strictEqual(edge('2026-11-14'), false);
  // 상태: 완료·이름·합침
  const st = { 'maru/old': { status: 'done', doneAt: '2026-11-15' }, 'maru/other': { status: 'open', mergedInto: 'maru/desktop-app' }, 'maru/desktop-app': { status: 'open', title: '새 이름' } };
  const l2 = L.buildProjects({ registry: REG, entries: ENT, state: st, todos, today: '2026-11-16' });
  assert.ok(!l2.some((x) => x.key === 'maru/other')); // 합쳐진 프로젝트는 목록에서 숨김
  const d2 = l2.find((x) => x.key === 'maru/desktop-app'); assert.strictEqual(d2.title, '새 이름');
  assert.deepStrictEqual([l2.find((x) => x.key === 'maru/old').status, l2.find((x) => x.key === 'maru/old').doneAt, l2.find((x) => x.key === 'maru/old').needsCheck], ['done', '2026-11-15', false]);
  // 합쳐진 쪽의 기록·할 일은 대표 프로젝트로 모인다
  const e3 = [...ENT, { day: '2026-11-15', tag: 'maru', slug: 'other', time: '10:00', kind: 'done', importance: 5, text: '합쳐진 기록', seq: 0 }];
  const l3 = L.buildProjects({ registry: REG, entries: e3, state: st, todos: L.parseTodos('maru/other|5|합쳐진 할 일|'), today: '2026-11-16' });
  const d3 = l3.find((x) => x.key === 'maru/desktop-app'); assert.deepStrictEqual([d3.records, d3.lastDay, d3.openTodos], [4, '2026-11-15', 1]);
  // 레지스트리에 없는 키의 할 일·기록은 분류 안 됨으로
  assert.ok(!list.some((x) => x.key === 'maru/zzz'));
  assert.deepStrictEqual(L.buildProjects({ registry: [], entries: [], state: {}, todos: [], today: '2026-11-16' }), []);
});
t('groupProjects: 카테고리별·최근순·완료 접기', () => {
  const list = L.buildProjects({ registry: REG, entries: ENT, state: { 'maru/old': { status: 'done', doneAt: '2026-11-15' } }, todos: [], today: '2026-11-16' });
  const g = L.groupProjects(list);
  assert.deepStrictEqual(g.open.map((x) => x.tag), ['블로그', 'maru']); // 최근 기록이 있는 카테고리 먼저
  assert.deepStrictEqual(g.open[1].items.map((x) => x.key), ['maru/desktop-app', 'maru/other', 'maru']); // 분류 안 됨은 맨 뒤
  assert.strictEqual(g.doneCount, 1); assert.deepStrictEqual(g.done.map((x) => [x.tag, x.items.map((i) => i.key)]), [['maru', ['maru/old']]]);
  assert.deepStrictEqual(L.groupProjects(null), { open: [], done: [], doneCount: 0 });
});
t('상태 갱신 순수 함수: 완료·다시 열기·이름·합치기·검증', () => {
  const list = L.buildProjects({ registry: REG, entries: ENT, state: {}, todos: [], today: '2026-11-16' });
  assert.ok(L.canMerge(list, 'maru/old', 'maru/desktop-app'));
  for (const [a, b] of [['maru/old', 'maru/old'], ['maru/old', '블로그/글-1'], ['maru', 'maru/old'], ['maru/old', 'maru'], ['x/y', 'maru/old'], ['maru/old', 'nope']]) assert.strictEqual(L.canMerge(list, a, b), false, a + '>' + b);
  const done = L.stateWithStatus({}, 'maru/old', 'done', '2026-11-16'); assert.deepStrictEqual(done, { 'maru/old': { status: 'done', doneAt: '2026-11-16' } });
  assert.deepStrictEqual(L.stateWithStatus(done, 'maru/old', 'open', '2026-11-17'), { 'maru/old': { status: 'open' } });
  const l2 = L.buildProjects({ registry: REG, entries: ENT, state: done, todos: [], today: '2026-11-16' });
  assert.strictEqual(L.canMerge(l2, 'maru/old', 'maru/desktop-app'), false); // 완료된 것은 합치지 않는다
  assert.deepStrictEqual(L.stateWithTitle({}, 'maru/old', ' 새  이름 '), { 'maru/old': { status: 'open', title: '새 이름' } });
  assert.strictEqual(L.stateWithTitle({}, 'maru/old', '   '), null); assert.strictEqual(L.stateWithTitle({}, 'maru/old', '가'.repeat(41)), null);
  const m = L.stateWithMerge({ 'maru/other': { status: 'open', mergedInto: 'maru/old' } }, 'maru/old', 'maru/desktop-app');
  assert.deepStrictEqual(m, { 'maru/other': { status: 'open', mergedInto: 'maru/desktop-app' }, 'maru/old': { status: 'open', mergedInto: 'maru/desktop-app' } }); // 사슬은 한 단계로 편다
  assert.ok(L.validateProjectState(m) && Object.keys(L.validateProjectState(m)).length === 2);
  assert.strictEqual(L.projectRoot({ 'a/x': { status: 'open', mergedInto: 'a/y' }, 'a/y': { status: 'open', mergedInto: 'a/x' } }, 'a/x'), 'a/x'); // 순환이면 처음 키
});
t('기억 메타: frontmatter 파싱·같은 태그 최대 12개', () => {
  const m = L.parseMemoryMeta('---\nname: pref-x\ndescription: 선호 `x` <b>\nmetadata:\n  type: user\n  tags: [maru, "Desktop-App", bad tag, 가나다라마바사아자차카타카]\n---\n본문 tags: [zzz]');
  assert.deepStrictEqual(m, { name: 'pref-x', description: '선호 x ‹b›', tags: ['maru', 'Desktop-App'] });
  for (const bad of ['', 'name: x', '---\ndescription: 이름 없음\n---', '---\nname: ' + '\u200B\n---', null]) assert.strictEqual(L.parseMemoryMeta(bad), null);
  const metas = Array.from({ length: 20 }, (_, i) => ({ name: 'm' + String(i).padStart(2, '0'), description: 'd', tags: i % 2 ? ['maru'] : ['life', 'MARU'] }));
  assert.strictEqual(L.relatedMemories(metas, 'maru').length, 12); assert.strictEqual(L.relatedMemories(metas, 'maru')[0].name, 'm00');
  assert.deepStrictEqual(L.relatedMemories(metas, 'none'), []); assert.deepStrictEqual(L.relatedMemories(null, 'maru'), []); assert.deepStrictEqual(L.relatedMemories(metas, ''), []);
  const dir = fs.mkdtempSync(path.join(tmp, 'mm-'));
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '---\nname: index\nmetadata:\n  tags: [maru]\n---\n'); fs.writeFileSync(path.join(dir, 'a-note.md'), '---\nname: a-note\ndescription: 설명\nmetadata:\n  tags: [maru, life]\n---\n');
  fs.writeFileSync(path.join(tmp, 'o.md'), '---\nname: outside\nmetadata:\n  tags: [maru]\n---\n'); fs.symlinkSync(path.join(tmp, 'o.md'), path.join(dir, 'linked.md'));
  fs.writeFileSync(path.join(dir, 'Bad Name.md'), '---\nname: bad\nmetadata:\n  tags: [maru]\n---\n');
  assert.deepStrictEqual(L.readMemoryMetas(dir).map((x) => x.name), ['a-note']); // MEMORY.md·링크·이상한 이름은 읽지 않는다
});
t('buildProjectDetail: 기록 최신순·200줄·남은 일·합치기 후보', () => {
  const todos = L.parseTodos('maru/desktop-app|8|앱 마무리|p\nmaru/desktop-app|3|테스트|\nmaru|5|프로젝트 없는 할 일|\n블로그/글-1|4|초안|');
  const list = L.buildProjects({ registry: REG, entries: ENT, state: {}, todos, today: '2026-11-16' });
  const metas = [{ name: 'maru-pref', description: '선호', tags: ['maru'] }, { name: 'blog-pref', description: '', tags: ['블로그'] }];
  const sum = list.find((x) => x.key === 'maru/desktop-app');
  const d = L.buildProjectDetail({ summary: sum, registry: REG, entries: ENT, state: {}, todos, memories: metas, list, today: '2026-11-16' });
  assert.deepStrictEqual(d.todos, [{ title: '앱 마무리', importance: 8 }, { title: '테스트', importance: 3 }]);
  assert.deepStrictEqual(d.log.map((x) => x.kind), ['todo', 'done', 'done']); // 같은 날은 늦은 시각(11:30) 먼저, 한 블록 안은 쓴 순서
  assert.deepStrictEqual(d.log.map((x) => x.text), ['두 번째 블록', '프로젝트 패널을 만들었다', '\u2039/system-reminder\u203a x (y)']);
  assert.deepStrictEqual(d.mergeTargets.map((x) => x.key), ['maru/old', 'maru/other']);
  assert.deepStrictEqual(d.memories, [{ name: 'maru-pref', description: '선호' }]);
  assert.deepStrictEqual(Object.keys(d).sort(), ['key', 'kind', 'lastDay', 'log', 'memories', 'mergeTargets', 'needsCheck', 'records', 'status', 'tag', 'title', 'todos', 'doneAt'].sort());
  const un = L.buildProjectDetail({ summary: list.find((x) => x.key === 'maru'), registry: REG, entries: ENT, state: {}, todos, memories: metas, list, today: '2026-11-16' });
  assert.deepStrictEqual(un.todos, [{ title: '프로젝트 없는 할 일', importance: 5 }]); assert.strictEqual(un.log.length, 2); assert.deepStrictEqual(un.mergeTargets, []);
  const many = Array.from({ length: 300 }, (_, i) => ({ day: '2026-11-10', tag: 'maru', slug: 'old', time: '10:00', kind: 'done', importance: 5, text: 'n' + i, seq: i }));
  const dd = L.buildProjectDetail({ summary: list.find((x) => x.key === 'maru/old'), registry: REG, entries: many, state: {}, todos: [], memories: [], list, today: '2026-11-16' });
  assert.strictEqual(dd.log.length, 200);
});
t('cleanProjectTitle: 멱등·허용 문자 집합·숨은 문자', () => {
  const cases = ['a ` b', '"a ` b"', 'a ​ b', 'a ​ ​ b', 'a⠀b', 'a⠀ b', ' # @x ', '[x] (y)', '한글 제목: a.b, c-d_e/f (g) · +#&', 'a  \t b', 'x@y', 'a<b', 'a`b`c', 'a  b'];
  for (const c of cases) { const r = L.cleanProjectTitle(c); assert.strictEqual(L.cleanProjectTitle(r), r, '멱등: ' + JSON.stringify(c)); }
  assert.strictEqual(L.cleanProjectTitle('a ` b'), 'a b');
});
t('cleanProjectTitle: 큰따옴표·@·꺾쇠는 거부, 허용 기호는 통과', () => {
  assert.strictEqual(L.cleanProjectTitle('"a ` b"'), '');
  for (const bad of ['a@b', 'a<b>', "a'b", 'a"b', 'a*b', 'a|b', 'a\\b', 'a=b', 'a;b', 'a!b', 'a?b', 'a~b', 'a%b', 'a^b', 'a{b}', '‹x›', '😀', 'ㄱㄴ']) assert.strictEqual(L.cleanProjectTitle(bad), '', JSON.stringify(bad));
  assert.strictEqual(L.cleanProjectTitle('앱 v2.0, 설계/구현 (초안): a-b_c · d+e #1 & f'), '앱 v2.0, 설계/구현 (초안): a-b_c · d+e #1 & f');
  assert.strictEqual(L.cleanProjectTitle('a​ b'), 'a b'); assert.strictEqual(L.cleanProjectTitle('a⠀b'), 'ab');
  assert.ok(L.hasBadChars('a⠀b')); // U+2800 점자 빈칸도 셸과 같이 숨은 문자
});
t('레지스트리·상태 제목은 같은 정규형만 통과', () => {
  assert.deepStrictEqual(L.parseProjectRegistry('a|x|a  b\na|y|a b\na|z|a@b\na|w|a<b>').map((x) => x.key), ['a/y']);
  const v = L.validateProjectState({ 'a/x': { status: 'open', title: 'a  b' }, 'a/y': { status: 'open', title: 'a b' }, 'a/z': { status: 'open', title: 'a@b' } });
  assert.deepStrictEqual(v, { 'a/x': { status: 'open' }, 'a/y': { status: 'open', title: 'a b' }, 'a/z': { status: 'open' } });
});
t('ttlCache: 처음 호출·TTL 안·TTL 밖·reset (cache 교체 회귀 방지의 순수 부분)', () => {
  let t = 1000; let calls = 0;
  const c = L.ttlCache(20000, () => ++calls, () => t);
  assert.strictEqual(c.get(), 1); assert.strictEqual(c.get(), 1); // 처음은 at 이 없으므로 NaN 비교 없이 한 번 읽는다
  t += 20000; assert.strictEqual(c.get(), 1); t += 1; assert.strictEqual(c.get(), 2);
  c.reset(); assert.strictEqual(c.get(), 3);
  const bad = L.ttlCache(10, () => 'x', () => NaN); assert.strictEqual(bad.get(), 'x'); assert.strictEqual(bad.get(), 'x'); // 시계가 이상해도 던지지 않는다
});
t('main.js: 프로젝트·기억 캐시는 refresh 가 교체하는 cache 객체 밖에 있다', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const lit = /let cache = \{[\s\S]*?\n\};/.exec(main)[0];
  assert.ok(!/memMetas|projRaw|projList|projView/.test(lit), 'cache 리터럴에 프로젝트·기억 캐시가 있으면 refresh 의 cache = {...} 가 지운다');
  assert.ok(/const memMetasCache = L\.ttlCache\(/.test(main) && /const proj = \{/.test(main));
  assert.ok(!/cache\.(memMetas|projRaw|projList|projView)/.test(main));
});
t('관련 기억 흐름: 읽기 → 캐시 → 태그 필터(캐시가 비면 실패하는 통합 경로)', () => {
  const mem = fs.mkdtempSync(path.join(tmp, 'rm-'));
  fs.writeFileSync(path.join(mem, 'a-note.md'), '---\nname: a-note\ndescription: 설명\nmetadata:\n  tags: [maru]\n---\n');
  let reads = 0; let now = 5;
  const c = L.ttlCache(20000, () => { reads++; return L.readMemoryMetas(mem); }, () => now);
  for (let i = 0; i < 3; i++) assert.deepStrictEqual(L.relatedMemories(c.get(), 'maru'), [{ name: 'a-note', description: '설명' }]);
  assert.strictEqual(reads, 1);
});
t('프로젝트 상태: 정상 최대치가 읽기 상한 안이고 손상으로 치워지지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'big-')); const f = path.join(dir, 'project-state.json');
  const keys = []; for (let i = 0; i < L.PROJ_STATE_MAX_ENTRIES; i++) keys.push('가나다라마바사아자차카타/' + ('가'.repeat(20) + String(1000 + i)).slice(0, 24));
  const full = {};
  for (const k of keys) full[k] = { status: 'done', doneAt: '2026-11-10', title: '가'.repeat(40), mergedInto: keys[0] === k ? keys[1] : keys[0] };
  assert.strictEqual(Object.keys(full).length, L.PROJ_STATE_MAX_ENTRIES);
  assert.ok(L.projectStateFits(full)); assert.ok(L.saveProjectState(f, full));
  assert.ok(fs.statSync(f).size < L.PROJ_STATE_MAX_BYTES / 1.2, '정상 최대치는 상한보다 충분히 작다: ' + fs.statSync(f).size);
  const r = L.readProjectStateFile(f); assert.strictEqual(r.status, 'ok'); assert.strictEqual(Object.keys(r.data).length, 1000);
  const over = { ...full, 'zz/over': { status: 'open' } };
  assert.strictEqual(L.validateProjectState(over), null);
  assert.strictEqual(L.stateWithStatus(full, 'zz/over', 'done', '2026-11-16'), null); // 1001개째는 만들지 않는다
  assert.strictEqual(L.projectStateFits({ 'a/b': { status: 'open', title: 'x'.repeat(L.PROJ_STATE_MAX_BYTES) } }), false); // 상한을 넘는 직렬화는 쓰기 전에 거부
  assert.strictEqual(L.saveProjectState(f, { 'a/b': { status: 'open', title: 'x'.repeat(L.PROJ_STATE_MAX_BYTES) } }), false);
  assert.strictEqual(L.readProjectStateFile(f).status, 'ok'); // 거부된 저장은 기존 정상 파일을 건드리지 않는다
});
t('합친 대상이 레지스트리에 없으면 합침을 무시하고 다시 보인다(셸과 같은 규칙)', () => {
  const st = { 'maru/other': { status: 'open', mergedInto: 'maru/ghost' } };
  const l = L.buildProjects({ registry: REG, entries: [], state: st, todos: [], today: '2026-11-16' });
  assert.ok(l.some((x) => x.key === 'maru/other'));
});
t('journal·memory 읽기: 기억 폴더가 링크여도 둘 다 읽지 않는다', () => {
  const real = fs.mkdtempSync(path.join(tmp, 'lk-')); fs.mkdirSync(path.join(real, 'journal'));
  fs.writeFileSync(path.join(real, 'journal', '2026-11-12.md'), '## 10:00 x (abcd1234)\n- [한 일] (5) @maru/app 기록\n');
  fs.writeFileSync(path.join(real, 'n.md'), '---\nname: n\nmetadata:\n  tags: [maru]\n---\n');
  assert.strictEqual(L.readJournalEntries(real).length, 1); assert.strictEqual(L.readMemoryMetas(real).length, 1);
  const link = path.join(tmp, 'lk-link'); fs.symlinkSync(real, link);
  assert.deepStrictEqual(L.readJournalEntries(link), []); assert.deepStrictEqual(L.readMemoryMetas(link), []);
});
t('화면 시험 모드·상세와 터미널 전환 정적 검사', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(/!app\.isPackaged && \['menu', 'settings', 'update', 'project'\]\.includes\(process\.env\.MARU_APP_UI\)/.test(main)); // 패키징 빌드에서는 무시
  assert.ok(/uiOpen === 'project'\) openFirstProject/.test(rd) && /x\.kind === 'project'\) \|\| all\[0\]/.test(rd));
  assert.ok(/closeDetail\(false\); showActive\(true\)/.test(rd)); // 작업 공간이 바뀌면 상세를 닫고 나서 그린다
  assert.ok(/function showActive\(focus\) \{\s*if \(detailOpen\) return;/.test(rd)); // 숨은 컨테이너에서 xterm open 금지
  assert.ok(/reason === 'size'/.test(rd) && /projectStateFits\(next\)/.test(main));
  for (const lg of I.LANGS) assert.ok(I.STR[lg]['proj.err.size'], lg);
});
t('프로젝트 문구(ko·en): 이어서 하기 템플릿은 안전하게 시작하고 제목만 끼운다', () => {
  for (const lg of I.LANGS) {
    const x = I.t(lg, 'project.continue', { title: '데스크톱 앱' });
    assert.ok(L.isSafeQuestStart(x) && x.includes('"데스크톱 앱"') && [...x].length <= 120 && !L.hasBadChars(x), lg + x);
    assert.ok([...I.t(lg, 'project.continue', { title: '가'.repeat(40) })].length <= 120, lg);
  }
  assert.strictEqual(I.t('ko', 'project.continue', { title: '앱' }), '"앱" 프로젝트를 이어서 하자. 남은 일부터 정리해 줘.');
  const keys = ['proj.eyebrow', 'proj.empty', 'proj.todos', 'proj.check', 'proj.unclassified', 'proj.done.toggle', 'proj.status.done', 'proj.meta', 'proj.suggest', 'proj.act.continue', 'proj.act.reopen', 'proj.merge.title'];
  for (const k of keys) for (const lg of I.LANGS) assert.ok(I.STR[lg][k], lg + ':' + k);
});
t('프로젝트 화면·IPC 정적 검사: textContent 만, preload 좁은 API, main 이 키 대조', () => {
  const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(rd + html.replace(/<script[\s\S]*?<\/script>/g, '')), 'HTML 주입 금지');
  for (const ch of ['projects:detail', 'projects:set-status', 'projects:rename', 'projects:merge', 'projects:continue']) assert.ok(main.includes("'" + ch + "'") && pre.includes("'" + ch + "'"), ch);
  assert.ok(/'projects:continue', String\(id\)/.test(pre));
  const handlers = main.split("ipcMain.handle('projects:").slice(1);
  assert.strictEqual(handlers.length, 5);
  for (const h of handlers) assert.ok(/fromMain\(e\)|wsFrom\(e, id\)/.test(h.slice(0, 220)), 'sender 검사: ' + h.slice(0, 30));
  assert.ok(/projects:continue[\s\S]*findProject\(key\)[\s\S]*writePrompt\(w, tr\('project\.continue'/.test(main)); // 제목은 main 의 요약에서, 문장은 i18n 템플릿
  assert.ok(!/continueProject\([^)]*log|journal/.test(rd.split('async function doContinue')[1].split('\n  }\n')[0])); // 일지 문장을 지시문에 섞지 않는다
  assert.ok(/function writePrompt[\s\S]*cleanQuestText[\s\S]*isSafeQuestStart[\s\S]*bracketed[\s\S]*\\x1b\[200~/.test(main)); // 할 일과 같은 안전장치(붙여넣기 모드, Enter 없음)
  assert.ok(main.indexOf("return writePrompt(w, item.prompt)") > 0);
  assert.ok(html.indexOf('id="party"') > html.indexOf('id="core"') && html.indexOf('id="party"') < html.indexOf('id="quests"'), '파티는 오른쪽 상태 링 아래');
  assert.ok(html.indexOf('id="proj-card"') > html.indexOf('id="workspaces"') && html.indexOf('id="proj-card"') < html.indexOf('id="user-chip"'), '프로젝트는 작업 공간 아래');
  assert.ok(/#terminal\[hidden\]\{display:none\}/.test(fs.readFileSync(path.join(__dirname, 'renderer', 'style.css'), 'utf8')));
  assert.ok(/detailOpen \|\| !e \|\| !e\.opened/.test(rd)); // 상세가 터미널을 가리는 동안 pty 크기를 줄이지 않는다
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} 통과` + (process.exitCode ? ', 실패 있음' : ''));
