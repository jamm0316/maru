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
  const rs = ['stale', 'no-prompt', 'unsafe-start', 'not-ready', 'no-term', 'invalid'];
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
  assert.strictEqual(L.cleanName('a\nb\r\tc‮​d'), 'abcd');
  assert.strictEqual(L.cleanName('가'.repeat(24)), '가'.repeat(24));
  assert.strictEqual(L.cleanName('가'.repeat(25)), '');
  assert.strictEqual(L.cleanName('😀'.repeat(24)).length, 48); // 코드포인트 기준
  for (const bad of ['', '   ', '\n', '​ㅤ', 42, null, undefined, {}]) assert.strictEqual(L.cleanName(bad), '');
});
t('validateProfile 엄격 검증', () => {
  assert.deepStrictEqual(L.validateProfile(good), good);
  assert.deepStrictEqual(L.validateProfile({ ...good, extra: 'x' }), good); // 알려진 필드만 남김
  const bads = [null, 'x', [], 1, { ...good, name: '' }, { ...good, name: 5 }, { ...good, name: 'a\nb' }, { ...good, name: ' 앞공백' },
    { ...good, name: '가'.repeat(25) }, { ...good, name: 'x‮y' }, { ...good, lang: 'fr' }, { ...good, lang: 1 }, { ...good, calendar: 'true' },
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
  const dirty = '\x1b[31m빨강\x1b[0m\n제어\u0007문자‮끝\n' + 'x'.repeat(500) + '\n\n\n\n다음';
  const c = L.cleanBlock(dirty);
  assert.ok(!/[\x1b\u0007‮]/.test(c)); assert.ok(c.startsWith('빨강\n제어문자끝\n'));
  assert.ok(c.split('\n').every((l) => [...l].length <= 200)); assert.ok(!/\n{3}/.test(c));
  assert.ok(L.cleanBlock('줄\n'.repeat(5000), 100).length <= 102);
  assert.strictEqual(L.cleanBlock(5), '');
  assert.deepStrictEqual(L.parseInstallSections('\n== 요구사항 확인\n  ok x\n\n== SessionEnd 훅 등록 (~/.claude/settings.json)\n== 끝\n'), ['요구사항 확인', 'SessionEnd 훅 등록 (~/.claude/settings.json)']);
});
t('sanitizeUpdate', () => {
  const r = L.sanitizeUpdate({ status: 'available', current: '0.1.0', latest: '0.2.0', notes: '노트‮\n' + '가'.repeat(900), repoBehind: 1, message: 'm\x1b[31m', evil: 'x' }, '0.1.0');
  assert.deepStrictEqual(Object.keys(r).sort(), ['current', 'latest', 'message', 'notes', 'repoBehind', 'status']);
  assert.ok([...r.notes].length <= 600 && !r.notes.includes('‮')); assert.strictEqual(r.message, 'm');
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
    rec('2026-11-30', '14:30', '0', '점심 후 ‮미팅​'),
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
  for (const m of src.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\brow\('\w+',\s*'\w+',\s*'([\w.-]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/'(copyLogin|install|open[A-Z]\w+)'/g)) used.add('act.' + m[1]); // 행 동작 버튼 문구
  assert.ok(used.size > 40);
  for (const k of used) if (!k.endsWith('.')) assert.ok(Object.prototype.hasOwnProperty.call(I.STR.ko, k), '표에 없음: ' + k);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} 통과` + (process.exitCode ? ', 실패 있음' : ''));
