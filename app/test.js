'use strict';
const assert = require('assert');
const L = require('./lib');
const I = require('./i18n');
let n = 0;
const pending = []; // 비동기 시험: 모든 동기 시험이 끝난 뒤 차례로 돈다
function ta(name, fn) { pending.push(async () => { try { await fn(); n++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; } }); }
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
  const en = (o) => L.keyToSeq({ type: 'keydown', key: 'Enter', ...o });
  assert.strictEqual(en({ shiftKey: true }), '\x1b\r');           // Shift+Enter: 줄바꿈
  assert.strictEqual(en({}), null);                                 // Enter 는 xterm 기본(전송)
  assert.strictEqual(en({ shiftKey: true, isComposing: true }), null); // 한글 조합 중에는 건드리지 않음
  assert.strictEqual(en({ shiftKey: true, keyCode: 229 }), null);
  assert.strictEqual(en({ shiftKey: true, metaKey: true }), null);
  assert.strictEqual(L.keyToSeq({ type: 'keyup', key: 'Enter', shiftKey: true }), null);
  assert.strictEqual(L.isNewlineKey({ type: 'keypress', key: 'Enter', shiftKey: true }), true);
  assert.strictEqual(L.isNewlineKey({ type: 'keypress', key: 'Enter' }), false);
  assert.strictEqual(L.isNewlineKey({ type: 'keydown', key: 'Enter', shiftKey: true, isComposing: true }), false);
});
t('keyToSeq Cmd+←/→: 줄 맨 앞/끝', () => {
  const k = (key, o) => L.keyToSeq({ type: 'keydown', key, ...o });
  assert.strictEqual(k('ArrowLeft', { metaKey: true }), '\x01');
  assert.strictEqual(k('ArrowRight', { metaKey: true }), '\x05');
  assert.strictEqual(k('ArrowLeft', {}), null);
  for (const m of ['shiftKey', 'altKey', 'ctrlKey']) for (const key of ['ArrowLeft', 'ArrowRight']) assert.strictEqual(k(key, { metaKey: true, [m]: true }), null, m + key);
  assert.strictEqual(k('ArrowLeft', { metaKey: true, isComposing: true }), null);
  assert.strictEqual(k('ArrowRight', { metaKey: true, keyCode: 229 }), null);
  assert.strictEqual(k('ArrowUp', { metaKey: true }), null);
  assert.strictEqual(L.keyToSeq({ type: 'keyup', key: 'ArrowLeft', metaKey: true }), null);
  // alternate screen(vim 등)에서는 변환하지 않는다
  assert.strictEqual(L.keyToSeq({ type: 'keydown', key: 'ArrowLeft', metaKey: true }, true), null);
  assert.strictEqual(L.keyToSeq({ type: 'keydown', key: 'ArrowRight', metaKey: true }, false), '\x05');
  assert.strictEqual(L.isLineNavKey({ type: 'keyup', key: 'ArrowRight', metaKey: true }, true), false);
  assert.strictEqual(L.keyToSeq({ type: 'keydown', key: 'Backspace', metaKey: true }, true), '\x15'); // 다른 단축키는 그대로
  // keypress·keyup 은 렌더러 핸들러가 isLineNavKey 로 삼킨다
  assert.strictEqual(L.isLineNavKey({ type: 'keyup', key: 'ArrowRight', metaKey: true }), true);
  assert.strictEqual(L.isLineNavKey({ type: 'keyup', key: 'ArrowRight', metaKey: true, altKey: true }), false);
  assert.strictEqual(L.isLineNavKey({ type: 'keyup', key: 'ArrowRight' }), false);
});
t('파일 드롭: 경로 검증·인용·조립', () => {
  const paste = (a) => L.buildDropPaste(a);
  assert.strictEqual(paste(['/tmp/a b.png']), '\x1b[200~/tmp/a\\ b.png \x1b[201~'); // 백슬래시 탈출 + 뒤 공백, Enter 없음
  assert.strictEqual(paste(['/tmp/한글 파일.png', '/x/y']), '\x1b[200~/tmp/한글\\ 파일.png /x/y \x1b[201~');
  assert.strictEqual(paste(["/tmp/it's a 사진.png"]), "\x1b[200~/tmp/it\\'s\\ a\\ 사진.png \x1b[201~");
  assert.strictEqual(L.shellQuote('/a/$(rm -rf ~)/`id`'), '/a/\\$\\(rm\\ -rf\\ \\~\\)/\\`id\\`'); // 치환 문자는 글자로 남는다
  assert.strictEqual(L.shellQuote('/a-b_c.d+e,f:g@h%i=j/ABC123'), '/a-b_c.d+e,f:g@h%i=j/ABC123'); // 안전한 문자는 그대로
  // 셸에 그대로 넣어도 한 단어로 읽혀 원래 경로와 같은지(printf 만 실행, 임시 폴더에서)
  {
    const cp = require('child_process'); const os = require('os'); const nodefs = require('fs'); const nodepath = require('path');
    const tdir = nodefs.mkdtempSync(nodepath.join(os.tmpdir(), 'maru-drop-'));
    try {
      const names = ["/t/a b.png", "/t/it's a 사진.png", '/t/$(echo PWNED)`echo X`.png', '/t/q"d\\b.png', '/t/[a]{b}&;|<>*?!#~^.png', '/t/한글 😀️ 👨‍👩.png', '/t/  lead  trail  ', '/t/a=b,c:d@e%f+g'];
      for (const n of names) {
        const out = cp.execFileSync('sh', ['-c', "printf '%s' " + L.shellQuote(n)], { cwd: tdir, encoding: 'utf8' });
        assert.strictEqual(out, n, n);
      }
      const multi = L.buildDropPaste(names).slice('\x1b[200~'.length, -'\x1b[201~'.length).trim(); // 여러 개는 단어 N개
      const outs = cp.execFileSync('sh', ['-c', 'for a in ' + multi + '; do printf "%s\\0" "$a"; done'], { cwd: tdir, encoding: 'utf8' }).split('\0').slice(0, -1);
      assert.deepStrictEqual(outs, names);
      assert.deepStrictEqual(nodefs.readdirSync(tdir), []); // 아무 것도 만들지·실행하지 않았다
    } finally { nodefs.rmSync(tdir, { recursive: true, force: true }); }
  }
  assert.ok(paste(['/a/$(x)/`y`']).includes('/a/\\$\\(x\\)/\\`y\\`'));
  assert.ok(!paste(['/a']).includes('\r') && !paste(['/a']).includes('\n'));
  assert.strictEqual(paste(['/a/b\nc']), null); assert.strictEqual(paste(['/a/b\rc']), null);
  assert.strictEqual(paste(['/a/\x1b[201~evil']), null); assert.strictEqual(paste(['/a/‮b']), null); assert.strictEqual(paste(['/a/​b']), null);
  assert.strictEqual(paste(['/a/\u0000b']), null);
  assert.ok(paste(['/a/😀\uFE0F.png']) && paste(['/a/👨\u200D👩.png']).includes('👨\u200D👩')); // 이모지 이름: 변형 선택자·ZWJ 허용
  for (const bad of ['\u200B', '\u202E', '\u2060', '\uFEFF', '\u200C', '\u200E', '\u0085', '\uE000']) assert.strictEqual(paste(['/a/' + bad + 'b']), null, bad.charCodeAt(0).toString(16));
  assert.strictEqual(paste(['relative/path.png']), null); assert.strictEqual(paste(['']), null); assert.strictEqual(paste([42]), null); assert.strictEqual(paste('/a'), null);
  assert.ok(paste(Array.from({ length: 10 }, (_, i) => '/f/' + i)));
  assert.strictEqual(paste(Array.from({ length: 11 }, (_, i) => '/f/' + i)), null);
  assert.strictEqual(paste([]), null);
  assert.ok(paste(['/' + 'a'.repeat(1023)])); assert.strictEqual(paste(['/' + 'a'.repeat(1024)]), null); // 1024자 / 1025자
  assert.strictEqual(paste(['/ok', '/bad\n']), null); // 하나라도 틀리면 전부 거부
  for (const r of ['invalid', 'inactive', 'busy-ui', 'not-ready', 'no-term', 'too-many', 'missing']) for (const lg of I.LANGS) assert.ok(I.STR[lg]['drop.' + r], lg + r);
  assert.strictEqual(L.dropNoticeKey('zzz'), 'drop.invalid');
});
t('모델 표시: 짧은 이름·transcript 파싱·경로 검증', () => {
  assert.strictEqual(L.shortModelName('claude-opus-4-1-20250805'), 'opus');
  assert.strictEqual(L.shortModelName('claude-sonnet-5-5'), 'sonnet');
  assert.strictEqual(L.shortModelName('claude-haiku-4-5'), 'haiku');
  assert.strictEqual(L.shortModelName('Fable-2'), 'fable'); assert.strictEqual(L.shortModelName('mythos'), 'mythos');
  assert.strictEqual(L.shortModelName('x'.repeat(40)), 'x'.repeat(24));
  assert.strictEqual(L.shortModelName(''), null); assert.strictEqual(L.shortModelName(null), null);
  assert.ok(L.validModelId('claude-opus-4[1m]') && !L.validModelId('a b') && !L.validModelId('x'.repeat(65)) && !L.validModelId('a"b') && !L.validModelId(''));
  assert.ok(L.validTranscriptPath('/h/.claude/projects/p/s.jsonl'));
  for (const bad of ['rel/s.jsonl', '/a/s.json', '/a/\ns.jsonl', '/a/\u0007s.jsonl', '/' + 'a'.repeat(1020) + '.jsonl', 5, '']) assert.strictEqual(L.validTranscriptPath(bad), false, String(bad));
  assert.ok(L.pathInside('/h/.claude/projects/p/s.jsonl', '/h/.claude/projects'));
  assert.ok(!L.pathInside('/h/.claude/projectsX/s.jsonl', '/h/.claude/projects') && !L.pathInside('/etc/passwd', '/h/.claude/projects') && !L.pathInside('/h/.claude/projects', '/h/.claude/projects') && !L.pathInside('/a', '/'));
  const line = (o) => JSON.stringify(o);
  const tr = [line({ type: 'user', message: { role: 'user', content: 'hi' } }), line({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-4-1', content: [] } }),
    line({ type: 'assistant', message: { role: 'assistant', model: '<synthetic>' } }), line({ type: 'user', message: { model: 'claude-haiku-4-5', role: 'user' } }), 'not json {"model"'].join('\n');
  assert.strictEqual(L.parseTranscriptModel(tr), 'claude-opus-4-1'); // 마지막 유효 assistant, synthetic·user·깨진 줄 제외
  assert.strictEqual(L.parseTranscriptModel(line({ type: 'assistant', message: { model: '<synthetic>' } })), null);
  assert.strictEqual(L.parseTranscriptModel('{"type":"assistant","message":{"model":"claude-sonn', true), null); // 잘린 첫 줄은 버린다
  assert.strictEqual(L.parseTranscriptModel('xx\n' + line({ type: 'assistant', message: { model: 'claude-sonnet-5-5' } }), true), 'claude-sonnet-5-5');
  assert.strictEqual(L.parseTranscriptModel(line({ type: 'assistant', message: { model: 'bad model!' } })), null);
  assert.strictEqual(L.parseTranscriptModel(7), null);
  // 상태 기록: transcript·model 은 검증 통과분만
  const r = L.parseAgentRecord('{"state":"idle","at":"2026-01-01T00:00:00Z","transcript_path":"/a/b.jsonl","model":"claude-opus-4-1"}');
  assert.strictEqual(r.transcript, '/a/b.jsonl'); assert.strictEqual(r.model, 'claude-opus-4-1');
  const r2 = L.parseAgentRecord('{"state":"idle","transcript_path":"../b.jsonl","model":"a b"}');
  assert.ok(!('transcript' in r2) && !('model' in r2));
});
t('파티: frontmatter 파싱·구성·서브에이전트 요약', () => {
  assert.deepStrictEqual(L.parseAgentFile('---\nname: scout\ndescription: x: y\nmodel: haiku\n---\n본문'), { name: 'scout', model: 'haiku' });
  assert.deepStrictEqual(L.parseAgentFile('---\r\nname: "w"\r\nmodel: \'sonnet\'\r\n---\r\n'), { name: 'w', model: 'sonnet' });
  for (const bad of ['no front', '---\nname: a b\nmodel: x\n---', '---\nname: ok\nmodel: bad model\n---', '---\nname: ../x\nmodel: x\n---', null]) assert.strictEqual(L.parseAgentFile(bad), null, String(bad));
  assert.deepStrictEqual(L.parseAgentFile('---\nname: ok\n---'), { name: 'ok', model: 'inherit' }); // model 없음 = 마루와 같은 값
  assert.deepStrictEqual(L.parseAgentFile('---\nname: ok\nmodel: inherit\n---'), { name: 'ok', model: 'inherit' });
  assert.deepStrictEqual(L.buildAgentParty([{ name: 'ok', model: 'inherit' }]), [{ name: 'ok', roleKey: null, model: 'inherit' }]);
  assert.deepStrictEqual(L.buildAgentParty([]).map((a) => a.name + ':' + a.model), ['scout:haiku', 'worker:sonnet', 'expert:opus']);
  assert.deepStrictEqual(L.buildAgentParty([{ name: 'scout', model: 'haiku' }, { name: 'scout', model: 'opus' }, { name: 'custom', model: 'claude-opus-4-1' }]),
    [{ name: 'scout', roleKey: 'scout', model: 'haiku' }, { name: 'custom', roleKey: null, model: 'opus' }]);
  assert.strictEqual(L.buildAgentParty(Array.from({ length: 20 }, (_, i) => ({ name: 'a' + i, model: 'm' }))).length, 12);
  assert.deepStrictEqual(L.summarizeSubs(['worker', 'Explore', 'worker', 'bad type', '']), [{ type: 'worker', count: 2 }, { type: 'Explore', count: 1 }]);
  assert.strictEqual(L.parseSubType('general-purpose\n'), 'general-purpose'); assert.strictEqual(L.parseSubType('a b'), null); assert.strictEqual(L.parseSubType('x'.repeat(300)), null);
  assert.ok(L.validSubFileName('agent_1-a') && !L.validSubFileName('../a') && !L.validSubFileName('.hidden') && !L.validSubFileName(''));
  for (const k of ['squad.working', 'squad.working.n']) for (const lg of I.LANGS) assert.ok(I.STR[lg][k], lg + k);
});
t('드롭·파티·모델 정적 검사: 좁은 preload, sender 검사, textContent', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, 'main.js'), 'utf8'); const pre = require('fs').readFileSync(require('path').join(__dirname, 'preload.js'), 'utf8');
  const rd = require('fs').readFileSync(require('path').join(__dirname, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(/webUtils\.getPathForFile/.test(pre) && !/readFile|createReadStream/.test(pre));
  const h = main.split("ipcMain.handle('files:drop'")[1].split('\n});')[0];
  assert.ok(/wsFrom\(e, id\)/.test(h) && /id !== activeId|w\.id !== activeId/.test(h) && /lstatSync/.test(h) && !/realpath/.test(h) && /w\.bracketed/.test(h) && /buildDropPaste/.test(h));
  assert.ok(!/\\r|\\n/.test(h.split('buildDropPaste')[1] || ''), 'Enter 를 보내지 않는다');
  assert.ok(/pathInside\(real, fs\.realpathSync\(path\.join\(claudeDir\(\), 'projects'\)\)\)/.test(main) && /TRANSCRIPT_TAIL = 256 \* 1024/.test(main));
  assert.ok(/TEST_UI = !app\.isPackaged && \[[^\]]*'party'/.test(main));
  assert.ok(!/innerHTML/.test(rd));
  assert.ok(/buffer\.active\.type === 'alternate'/.test(rd));
  assert.ok(/w\.lastTranscript = rec\.transcript/.test(main) && /w\.lastModel = id/.test(main) && /w\.lastTranscript = null; w\.lastModel = null/.test(main)); // 세션이 다시 시작되면 비움
  assert.ok(/SUBS_SCAN_MAX = 512/.test(main) && /types\.slice\(0, SUBS_MAX\)/.test(main));
  assert.ok(/catch \{ \/\* 이 항목만 건너뜀 \*\/ \}/.test(main));
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
t('keyToSeq Cmd+←/→: Claude Code 화면은 alternate screen 이어도 보낸다', () => {
  const d = (key, o) => ({ type: 'keydown', key, metaKey: true, ...o });
  assert.strictEqual(L.keyToSeq(d('ArrowLeft'), true, true), '\x01');
  assert.strictEqual(L.keyToSeq(d('ArrowRight'), true, true), '\x05');
  assert.strictEqual(L.keyToSeq(d('ArrowLeft'), true, false), null);   // vim 등
  assert.strictEqual(L.keyToSeq(d('ArrowLeft'), true), null);
  assert.strictEqual(L.keyToSeq(d('ArrowLeft', { isComposing: true }), true, true), null); // 조합 중
  assert.strictEqual(L.keyToSeq(d('ArrowLeft', { altKey: true }), true, true), null);
  assert.strictEqual(L.isLineNavKey({ type: 'keyup', key: 'ArrowRight', metaKey: true }, true, true), true); // keyup 도 삼킨다
  const c = (o) => L.isClaudeUi(o);
  assert.strictEqual(c({ launched: true, state: 'idle' }), true);
  assert.strictEqual(c({ launched: true, state: 'busy' }), true);
  assert.strictEqual(c({ launched: true, state: 'waiting' }), true);
  assert.strictEqual(c({ launched: true, state: 'none', claudeFound: true }), true);   // 첫 프롬프트 전
  assert.strictEqual(c({ launched: true, state: 'none', claudeFound: false }), false); // claude 없음: 셸이 남아 있다
  assert.strictEqual(c({ launched: false, state: 'idle' }), false);
  assert.strictEqual(c({ launched: true, state: 'exited', claudeFound: true }), false);
  assert.strictEqual(c(), false);
});
t('effectiveAgent Esc 중단', () => {
  const T = 1e6; const rec = (state, atMs) => ({ state, atMs });
  const eff = (r, now, esc) => L.effectiveAgent(r, now, now, 20000, esc);
  assert.strictEqual(eff(rec('busy', T), T + 1000, T + 500), 'busy');          // Esc 뒤 1.5초 전
  assert.strictEqual(eff(rec('busy', T), T + 2000, T + 500), 'idle');          // 1.5초 뒤
  assert.strictEqual(eff(rec('busy', T), T + 2000 - 1, T + 500), 'busy');      // 경계 직전
  assert.strictEqual(eff(rec('busy', T + 800), T + 3000, T + 500), 'busy');    // Esc 뒤 새 busy 기록(PostToolUse): 이긴다
  assert.strictEqual(eff(rec('busy', T + 500), T + 3000, T + 500), 'busy');    // 같은 시각이면 기록이 이긴다
  assert.strictEqual(eff(rec('idle', T), T + 3000, T + 500), 'idle');          // 이미 idle: 영향 없음
  assert.strictEqual(eff(rec('busy', T + 900), T + 3000, T + 500), 'busy');    // Esc 가 기록보다 오래됨: 영향 없음
  assert.strictEqual(eff(rec('waiting', T), T + 2000, T + 500), 'idle');       // 권한 확인 중 Esc 도 같은 규칙
  assert.strictEqual(eff(rec('waiting', T + 100), T + 2000, T + 500), 'idle');
  assert.strictEqual(eff(rec('waiting', T + 700), T + 2000, T + 500), 'waiting');
  assert.strictEqual(eff(rec('busy', T), T + 2000, 0), 'busy');                // Esc 없음
  assert.strictEqual(eff(null, T + 2000, T + 500), 'none');
  assert.strictEqual(eff({ state: 'busy', atMs: NaN }, T + 2000, T + 500), 'busy'); // 시각 불명: 기존 규칙(여기서는 출력이 최근이라 busy)
  // 다음 프롬프트: 기록이 Esc 보다 새로워 덮어쓰기가 풀린다(같은 escAt 로 계속 물어도)
  assert.strictEqual(eff(rec('busy', T), T + 5000, T + 500), 'idle');
  assert.strictEqual(eff(rec('busy', T + 5000), T + 5100, T + 500), 'busy');
  assert.strictEqual(L.escInterrupted(rec('busy', T), T + 500, T + 1999), false);
  assert.strictEqual(L.escInterrupted(rec('busy', T), T + 500, T + 2000), true);
  assert.strictEqual(L.escInterrupted(rec('busy', T), NaN, T + 2000), false);
  // at 은 초 단위로 잘려 있다: mtime 이 2초 안이면 ms 로 다듬는다
  assert.deepStrictEqual(L.refineAgentAt(rec('busy', 5000), 5700), rec('busy', 5700));
  assert.deepStrictEqual(L.refineAgentAt(rec('busy', 5000), 9000), rec('busy', 5000));
  assert.deepStrictEqual(L.refineAgentAt(rec('busy', 5000), 4000), rec('busy', 5000));
  assert.strictEqual(L.refineAgentAt(null, 1), null);
  assert.strictEqual(L.refineAgentAt(rec('busy', 5000), undefined).atMs, 5000);
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
t('parseTodos 최대 12개(셸 apply_todos 병합 결과 상한과 같음)·잘림', () => {
  assert.strictEqual(L.TODO_MAX, 12);
  const lines = Array.from({ length: 15 }, (_, i) => 'a|5|t' + i + '|');
  assert.deepStrictEqual(L.parseTodos(lines.join('\n')).map((x) => x.title), Array.from({ length: 12 }, (_, i) => 't' + i));
  assert.strictEqual(L.parseTodos(lines.slice(0, 12).join('\n')).length, 12);
  assert.strictEqual(L.parseTodos('a|0||\nb|5|x|').length, 1); // 비우기 표지(중요도 0·빈 제목)는 목록에 안 들어간다
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
  assert.strictEqual(L.resolveTodos(null, { text: Array.from({ length: 15 }, (_, i) => 's' + i).join('\n') }).length, 12);
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
  const to = pkg.build.extraResources.map((r) => r.to).filter((x) => x.startsWith('tray/')).sort();
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
  assert.deepStrictEqual(d.todos.map((x) => [x.title, x.importance, x.idx, x.markable]), [['앱 마무리', 8, 0, true], ['테스트', 3, 1, true]]); assert.strictEqual(d.todos[0].shown, L.todoKey(todos[0]));
  assert.deepStrictEqual(d.log.map((x) => x.kind), ['todo', 'done', 'done']); // 같은 날은 늦은 시각(11:30) 먼저, 한 블록 안은 쓴 순서
  assert.deepStrictEqual(d.log.map((x) => x.text), ['두 번째 블록', '프로젝트 패널을 만들었다', '\u2039/system-reminder\u203a x (y)']);
  assert.deepStrictEqual(d.mergeTargets.map((x) => x.key), ['maru/old', 'maru/other']);
  assert.deepStrictEqual(d.memories, [{ name: 'maru-pref', description: '선호' }]);
  assert.deepStrictEqual(Object.keys(d).sort(), ['key', 'kind', 'lastDay', 'log', 'memories', 'mergeTargets', 'needsCheck', 'records', 'status', 'tag', 'title', 'todos', 'doneAt'].sort());
  const un = L.buildProjectDetail({ summary: list.find((x) => x.key === 'maru'), registry: REG, entries: ENT, state: {}, todos, memories: metas, list, today: '2026-11-16' });
  assert.deepStrictEqual(un.todos.map((x) => [x.title, x.importance, x.idx]), [['프로젝트 없는 할 일', 5, 2]]); assert.strictEqual(un.log.length, 2); assert.deepStrictEqual(un.mergeTargets, []);
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
  const uiList = /!app\.isPackaged && \[([^\]]*)\]\.includes\(process\.env\.MARU_APP_UI\)/.exec(main); // 패키징 빌드에서는 무시
  assert.ok(uiList); for (const k of ['menu', 'settings', 'update', 'project', 'party', 'inbox', 'memory', 'memgraph']) assert.ok(uiList[1].includes("'" + k + "'"), k); // 목록 순서에는 기대지 않는다
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
  assert.strictEqual(handlers.length, 7); // + set-collapsed, reorder
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
// ---- ⌘숫자 매핑 · 순서 적용 · 화면 상태 파일 ----
const UI_LIST = L.buildProjects({ registry: L.parseProjectRegistry('maru|a|가\nmaru|b|나\nmaru|c|다\n블로그|x|엑스\n블로그|y|와이\n책|z|지\n'),
  entries: [{ day: '2026-11-10', tag: 'maru', slug: null, time: '10:00', kind: 'done', importance: 5, text: 't', seq: 0 }, { day: '2026-11-01', tag: '블로그', slug: 'x', time: '10:00', kind: 'done', importance: 5, text: 't', seq: 1 }],
  state: {}, todos: [], today: '2026-11-16' });
const flat = (v) => v.open.map((g) => g.tag + ':' + g.items.map((x) => x.key).join(','));
t('numberTargets: 작업 공간 먼저, 이어서 프로젝트, 최대 9', () => {
  const ws = ['w1', 'w2']; const pk = ['maru/a', 'maru/b', '블로그/x'];
  assert.deepStrictEqual(L.numberTargets(ws, pk), [{ kind: 'workspace', id: 'w1' }, { kind: 'workspace', id: 'w2' }, { kind: 'project', id: 'maru/a' }, { kind: 'project', id: 'maru/b' }, { kind: 'project', id: '블로그/x' }]);
  assert.deepStrictEqual(L.numberTargets([], ['maru/a']), [{ kind: 'project', id: 'maru/a' }]); // 작업 공간 0개: ⌘1 이 프로젝트
  assert.deepStrictEqual(L.numberTargets([], []), []);
  const six = ['a', 'b', 'c', 'd', 'e', 'f']; const many = Array.from({ length: 20 }, (_, i) => 'p/' + i);
  const r = L.numberTargets(six, many);
  assert.strictEqual(r.length, 9); assert.strictEqual(r.filter((x) => x.kind === 'workspace').length, 6); assert.deepStrictEqual(r[8], { kind: 'project', id: 'p/2' });
  assert.strictEqual(L.numberTargets([], many).length, 9); assert.strictEqual(L.numberTargets(Array.from({ length: 12 }, (_, i) => 'w' + i), many).filter((x) => x.kind === 'project').length, 0);
  assert.deepStrictEqual(L.numberTargets(['w', 5, null], ['p/1', {}, 'p/2']).map((x) => x.id), ['w', 'p/1', 'p/2']); // 이상한 값은 건너뜀
  assert.deepStrictEqual(L.numberTargets('x', null), []);
});
t('visibleProjectKeys: 접힌 카테고리 제외, 화면 순서, 분류 안 됨 포함', () => {
  const v = L.groupProjects(UI_LIST);
  const all = L.visibleProjectKeys(v.open, []);
  assert.deepStrictEqual(all, v.open.flatMap((g) => g.items.map((x) => x.key)));
  assert.ok(all.includes('maru') && all.includes('maru/a')); // 분류 안 됨(키 = 태그)도 번호를 받는다
  const noMaru = L.visibleProjectKeys(v.open, ['maru']);
  assert.ok(!noMaru.some((k) => k === 'maru' || k.startsWith('maru/')) && noMaru.length === all.length - 4);
  assert.deepStrictEqual(L.visibleProjectKeys(v.open, ['없는태그', 5]), all);
  assert.deepStrictEqual(L.visibleProjectKeys(null, null), []);
  const done = L.groupProjects(L.buildProjects({ registry: L.parseProjectRegistry('maru|a|가\n'), entries: [], state: { 'maru/a': { status: 'done', doneAt: '2026-11-15' } }, todos: [], today: '2026-11-16' }));
  assert.deepStrictEqual(L.visibleProjectKeys(done.open, []), []); // 완료 목록은 번호를 받지 않는다
});
t('moveInOrder', () => {
  assert.deepStrictEqual(L.moveInOrder(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepStrictEqual(L.moveInOrder(['a', 'b', 'c'], 'a', null), ['b', 'c', 'a']);
  assert.deepStrictEqual(L.moveInOrder(['a', 'b', 'c'], 'a', 'c'), ['b', 'a', 'c']);
  for (const [id, b] of [['x', 'a'], ['a', 'x'], ['a', 'a'], ['a', undefined]]) assert.strictEqual(L.moveInOrder(['a', 'b'], id, b), null);
  assert.strictEqual(L.moveInOrder(null, 'a', null), null);
});
t('applyProjectUi: 모르는 키·중복·다른 카테고리 키 무시, 새 항목은 뒤에, 분류 안 됨은 맨 아래', () => {
  const base = L.groupProjects(UI_LIST);
  assert.deepStrictEqual(flat(L.groupProjects(UI_LIST, L.defaultProjectUi())), flat(base)); // 기본값이면 기본 순서
  assert.deepStrictEqual(flat(L.groupProjects(UI_LIST, null)), flat(base));
  const ui = { catOrder: ['책', 'ghost', '책', '블로그'], projOrder: { maru: ['maru/c', 'maru/zzz', '블로그/x', 'maru/c', 'maru/a'], 없는: ['x/y'] }, collapsed: [] };
  const g = L.groupProjects(UI_LIST, ui);
  assert.deepStrictEqual(g.open.map((x) => x.tag), ['책', '블로그', 'maru']); // 정한 순서 먼저
  const maru = g.open.find((x) => x.tag === 'maru').items.map((x) => x.key);
  assert.deepStrictEqual(maru, ['maru/c', 'maru/a', 'maru/b', 'maru']); // c,a 는 정한 순서, b(새 항목)는 뒤, 분류 안 됨은 맨 아래
  assert.ok(!g.open.find((x) => x.tag === '블로그').items.some((x) => x.key.startsWith('maru'))); // 다른 카테고리 키는 옮겨지지 않는다
  assert.deepStrictEqual(g.done, base.done);
  assert.strictEqual(g.open.reduce((n, x) => n + x.items.length, 0), base.open.reduce((n, x) => n + x.items.length, 0)); // 항목이 늘거나 줄지 않는다
  // 분류 안 됨을 projOrder 에 적어도 맨 아래 고정
  assert.strictEqual(L.groupProjects(UI_LIST, { catOrder: [], projOrder: { maru: ['maru', 'maru/b'] }, collapsed: [] }).open.find((x) => x.tag === 'maru').items.at(-1).key, 'maru');
  // 프로토타입 키 이름의 태그도 안전하다
  assert.doesNotThrow(() => L.applyProjectUi(base.open, { catOrder: ['constructor', '__proto__'], projOrder: { constructor: ['constructor/a'] }, collapsed: [] }));
});
t('validateProjectUi: 형식·상한·__proto__·모르는 필드', () => {
  assert.deepStrictEqual(L.validateProjectUi({}), L.defaultProjectUi());
  const v = L.validateProjectUi({ catOrder: ['maru', 'maru', '$bad', 5, '책'], projOrder: { maru: ['maru/a', 'maru/a', '책/z', '../x', 'maru/B'], 'bad tag': ['a/b'] }, collapsed: ['책', '책', 'x y'], extra: 1, evil: { a: 1 } });
  assert.deepStrictEqual(v, { catOrder: ['maru', '책'], projOrder: { maru: ['maru/a'] }, collapsed: ['책'] });
  assert.deepStrictEqual(Object.keys(v).sort(), ['catOrder', 'collapsed', 'projOrder']);
  const p = L.validateProjectUi(JSON.parse('{"catOrder":["__proto__"],"projOrder":{"__proto__":["a/b"],"constructor":["constructor/x"]},"collapsed":["__proto__"]}'));
  assert.deepStrictEqual(p, { catOrder: [], projOrder: { constructor: ['constructor/x'] }, collapsed: [] });
  assert.strictEqual(Object.getPrototypeOf(p.projOrder), Object.prototype); assert.ok(!('polluted' in {}) && !Object.prototype.hasOwnProperty.call(p, '__proto__') && !Object.prototype.hasOwnProperty.call(p.projOrder, '__proto__'));
  for (const bad of [null, [], 'x', 5, { catOrder: 'x' }, { collapsed: {} }, { projOrder: [] }, { projOrder: { maru: 'x' } }, { catOrder: Array(201).fill('a') }, { collapsed: Array(201).fill('a') },
    { projOrder: { maru: Array(201).fill('maru/a') } }, { projOrder: Object.fromEntries(Array.from({ length: 201 }, (_, i) => ['t' + i, []])) }]) assert.strictEqual(L.validateProjectUi(bad), null, JSON.stringify(bad).slice(0, 40));
  const wide = {}; for (let i = 0; i < 6; i++) wide['t' + i] = Array.from({ length: 200 }, (_, j) => 't' + i + '/p' + j);
  assert.strictEqual(L.validateProjectUi({ projOrder: wide }), null); // 전체 키 수 상한(1000)
});
t('프로젝트 화면 상태 파일: 원자적 저장·손상·과대·링크', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'pu-')); const f = path.join(dir, 'project-ui.json');
  assert.deepStrictEqual(L.readProjectUiFile(f), { status: 'missing', data: L.defaultProjectUi() });
  const ui = { catOrder: ['책', 'maru'], projOrder: { maru: ['maru/b', 'maru/a'] }, collapsed: ['책'] };
  assert.ok(L.saveProjectUi(f, ui));
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepStrictEqual(fs.readdirSync(dir), ['project-ui.json']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), ui);
  assert.deepStrictEqual(L.readProjectUiFile(f), { status: 'ok', data: ui });
  assert.strictEqual(L.saveProjectUi(f, { ...ui, extra: 1 }), false); // 모르는 필드·고쳐질 값이 섞이면 쓰지 않는다
  assert.strictEqual(L.saveProjectUi(f, { catOrder: ['a', 'a'], projOrder: {}, collapsed: [] }), false);
  assert.strictEqual(L.saveProjectUi(f, { catOrder: [], projOrder: { __proto__x: [] }, collapsed: [] }), false);
  assert.deepStrictEqual(L.readProjectUiFile(f).data, ui); // 실패한 저장은 기존 파일을 건드리지 않는다
  fs.writeFileSync(f, JSON.stringify({ ...ui, junk: [1], 'x': { y: 1 } })); assert.deepStrictEqual(L.readProjectUiFile(f).data, ui); // 모르는 필드 무시
  for (const bad of ['{', '[]', '"x"', 'null', JSON.stringify({ catOrder: 5 })]) { fs.writeFileSync(f, bad); assert.strictEqual(L.readProjectUiFile(f).status, 'corrupt', bad); }
  fs.writeFileSync(f, JSON.stringify({ catOrder: [], collapsed: [], pad: ' '.repeat(L.PROJ_UI_MAX_BYTES) })); assert.strictEqual(L.readProjectUiFile(f).status, 'corrupt'); // 크기 상한
  assert.ok(L.backupCorruptFile(f) && fs.existsSync(f + '.bak') && !fs.existsSync(f));
  const x = path.join(dir, 'x'); fs.writeFileSync(x, JSON.stringify(ui)); const link = path.join(dir, 'link.json'); fs.symlinkSync(x, link);
  assert.strictEqual(L.readProjectUiFile(link).status, 'corrupt'); // 심볼릭 링크는 읽지 않는다
  const ldir = path.join(tmp, 'pu-link'); fs.symlinkSync(dir, ldir);
  assert.strictEqual(L.saveProjectUi(path.join(ldir, 'project-ui.json'), ui), false); // 폴더가 링크면 쓰지 않는다
});
t('pruneProjectUi: 없는 태그·키는 걸러 낸다', () => {
  const ui = { catOrder: ['책', 'ghost', 'maru'], projOrder: { maru: ['maru/b', 'maru/gone', 'maru'], ghost: ['ghost/a'], 책: ['책/z'] }, collapsed: ['ghost', '블로그'] };
  assert.deepStrictEqual(L.pruneProjectUi(ui, UI_LIST), { catOrder: ['책', 'maru'], projOrder: { maru: ['maru/b'], 책: ['책/z'] }, collapsed: ['블로그'] });
  assert.deepStrictEqual(L.pruneProjectUi(ui, []), L.defaultProjectUi());
  assert.deepStrictEqual(L.pruneProjectUi('x', UI_LIST), L.defaultProjectUi());
  const big = { catOrder: [], projOrder: {}, collapsed: [] }; assert.ok(L.projectUiFits(big));
});
t('메뉴·화면 연결 정적 검사: ⌘1~9 는 numberTargets, 번호 힌트·토글·드래그는 자체 타입', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8'); const css = fs.readFileSync(path.join(__dirname, 'renderer', 'style.css'), 'utf8');
  assert.ok(/L\.numberTargets\(wsOrder\(\)[\s\S]*L\.visibleProjectKeys\(proj\.view\.open, proj\.view\.collapsed\)/.test(main) && /Lib\.numberTargets\(wsList[\s\S]*Lib\.visibleProjectKeys\(projView\.open, projView\.collapsed\)/.test(rd)); // 같은 순수 함수
  assert.ok(/L\.GOTO_MAX/.test(main) && /'CmdOrCtrl\+' \+ \(i \+ 1\)/.test(main));
  for (const ch of ['projects:set-collapsed', 'projects:reorder']) { assert.ok(main.includes("'" + ch + "'") && pre.includes("'" + ch + "'"), ch); assert.ok(new RegExp("ipcMain\\.handle\\('" + ch + "', \\(e,[^)]*\\) => \\{\\n  if \\(!fromMain\\(e\\)").test(main), 'sender 검사 ' + ch); }
  assert.ok(/projects:reorder[\s\S]*L\.moveInOrder\(g\.items\.filter/.test(main)); // 다른 카테고리 키는 moveInOrder 가 거부
  assert.ok(/ui:goto/.test(main) && /ui:goto/.test(pre));
  assert.ok(/PERSIST && \(!ROOT \|\| !L\.saveProjectUi/.test(main) && /r\.status === 'corrupt' && PERSIST/.test(main)); // 스모크·시험에서는 저장·.bak 이동을 하지 않는다
  assert.ok(/DRAG_TYPE = 'application\/x-maru-reorder'/.test(rd) && !/setData\('text/.test(rd));
  assert.ok(/DRAG_TYPE\) < 0/.test(rd) &&/'Files'\) >= 0/.test(rd)); // 터미널 drop 은 Files 타입만 받는다(그대로)
  assert.ok(/aria-expanded/.test(rd) && /e\.altKey/.test(rd));
  assert.ok(/prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important;transition:none!important/.test(css));
  for (const k of ['menu.gotoProj', 'menu.gotoNone', 'proj.cat.aria', 'proj.cat.tip', 'proj.row.tip', 'proj.moved', 'proj.err.move']) for (const lg of I.LANGS) assert.ok(I.STR[lg][k], lg + ':' + k);
  for (const lg of I.LANGS) { assert.ok(I.t(lg, 'proj.moved', { title: 'x', pos: 2, total: 3 }).includes('2')); assert.ok(I.t(lg, 'menu.gotoNone', { n: 4 }).includes('4')); }
});
// ---- 스쿼드 ----
const SQ = (o) => ({ slug: 'dev', name: '개발', description: '개발 팀', source: 'builtin', lead: { agent: 'sq-dev-lead', model: 'sonnet' }, members: [{ role: 'coder', agent: 'sq-dev-coder', model: 'haiku' }, { role: 'tester', agent: 'sq-dev-tester', model: 'inherit' }], ...o });
t('parseSquadMeta: 정상 형식·모르는 필드 무시·개인 표시', () => {
  const r = L.parseSquadMeta(JSON.stringify({ squads: [{ ...SQ(), extra: 1, lead: { agent: 'sq-dev-lead', model: 'opus', x: 1 } }, SQ({ slug: 'mine', name: 'Mine', source: 'personal', lead: { agent: 'sq-mine-lead', model: 'inherit' }, members: [] })], skipped: [{ slug: 'x', reason: 'y' }], more: 1 }));
  assert.deepStrictEqual(r.map((q) => [q.slug, q.name, q.personal, q.lead.model, q.members.length]), [['dev', '개발', false, 'opus', 2], ['mine', 'Mine', true, 'inherit', 0]]);
  assert.deepStrictEqual(Object.keys(r[0]).sort(), ['description', 'lead', 'members', 'name', 'personal', 'slug']);
  assert.deepStrictEqual(r[0].members[0], { role: 'coder', agent: 'sq-dev-coder', model: 'haiku' });
});
t('parseSquadMeta: 틀린 항목은 버린다', () => {
  const bad = [SQ({ slug: 'Bad' }), SQ({ slug: '-x' }), SQ({ slug: 'a'.repeat(21) }), SQ({ name: '' }), SQ({ name: '가'.repeat(25) }), SQ({ name: 'a\u202Eb' }), SQ({ name: ' x' }), SQ({ description: 'd'.repeat(201) }), SQ({ description: 5 }),
    SQ({ source: 'other' }), SQ({ lead: { agent: 'sq-other-lead', model: 'sonnet' } }), SQ({ lead: { agent: 'sq-dev-lead', model: 'gpt' } }), SQ({ lead: null }), SQ({ members: 'x' }),
    SQ({ members: Array.from({ length: 7 }, (_, i) => ({ role: 'r' + i, agent: 'sq-dev-r' + i, model: 'haiku' })) }), null, 'x', 5, []];
  assert.deepStrictEqual(L.parseSquadMeta(JSON.stringify({ squads: bad })), []);
  assert.strictEqual(L.parseSquadMeta(JSON.stringify({ squads: [SQ({ name: '가'.repeat(24) }), SQ({ slug: 'a'.repeat(20), lead: { agent: 'sq-' + 'a'.repeat(20) + '-lead', model: 'haiku' }, members: [] })] })).length, 2); // 경계값
  const m = L.parseSquadMeta(JSON.stringify({ squads: [SQ({ members: [{ role: 'ok', agent: 'sq-dev-ok', model: 'haiku' }, { role: 'lead', agent: 'sq-dev-lead', model: 'haiku' }, { role: 'Bad', agent: 'sq-dev-Bad', model: 'haiku' }, { role: 'x', agent: 'sq-dev-y', model: 'haiku' }, { role: 'ok', agent: 'sq-dev-ok', model: 'opus' }, { role: 'z', agent: 'sq-dev-z', model: 'nope' }] })] }));
  assert.deepStrictEqual(m[0].members.map((x) => x.role), ['ok']); // 틀린 팀원만 버리고 스쿼드는 남긴다(예약어 lead·형식 오류·이름 불일치·중복·모델 오류)
  for (const x of ['', '{', 'null', '[]', '{"squads":5}', '{"squads":{}}', 'x'.repeat(L.SQUAD_META_MAX_BYTES + 1)]) assert.deepStrictEqual(L.parseSquadMeta(x), [], x.slice(0, 10));
  assert.deepStrictEqual(L.parseSquadMeta(undefined), []);
});
t('parseSquadMeta: 스쿼드 12개 상한·같은 slug 는 앞의 것만·__proto__ 안전', () => {
  const many = Array.from({ length: 20 }, (_, i) => SQ({ slug: 's' + i, lead: { agent: 'sq-s' + i + '-lead', model: 'haiku' }, members: [] }));
  assert.strictEqual(L.parseSquadMeta(JSON.stringify({ squads: many })).length, L.SQUADS_MAX);
  assert.deepStrictEqual(L.parseSquadMeta(JSON.stringify({ squads: [SQ(), SQ({ name: '둘째' })] })).map((q) => q.name), ['개발']);
  const evil = '{"squads":[{"__proto__":{"slug":"zz"},"slug":"dev","name":"n","description":"","source":"builtin","lead":{"agent":"sq-dev-lead","model":"haiku","__proto__":{"a":1}},"members":[{"role":"constructor","agent":"sq-dev-constructor","model":"haiku"},{"role":"x","agent":"sq-dev-x","model":"haiku","__proto__":{"p":1}}]}]}';
  const r = L.parseSquadMeta(evil);
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].slug, 'dev'); assert.strictEqual(Object.getPrototypeOf(r[0].lead), Object.prototype); assert.deepStrictEqual(Object.keys(r[0].lead).sort(), ['agent', 'model']);
  assert.deepStrictEqual(r[0].members.map((x) => x.role), ['constructor', 'x']); assert.ok(!Object.prototype.hasOwnProperty.call(r[0].lead, '__proto__'));
});
t('squadView·matchSubs·squadOpen: 모델 상속, 활동 매칭, 임시 줄, 접힘 규칙', () => {
  const v = L.squadView(L.parseSquadMeta(JSON.stringify({ squads: [SQ()] })), 'opus');
  assert.deepStrictEqual(v[0].rows.map((r) => [r.agent, r.lead, r.role, r.model]), [['sq-dev-lead', true, null, 'sonnet'], ['sq-dev-coder', false, 'coder', 'haiku'], ['sq-dev-tester', false, 'tester', 'opus']]);
  assert.strictEqual(L.squadView(L.parseSquadMeta(JSON.stringify({ squads: [SQ()] })), null)[0].rows[2].model, '—');
  assert.deepStrictEqual(L.squadView(null, 'x'), []);
  const m = L.matchSubs([{ type: 'worker', count: 2 }, { type: 'sq-dev-coder', count: 1 }, { type: 'sq-ghost-lead', count: 3 }, { type: 'bad type', count: 1 }, { type: 'x', count: 0 }, { type: 'y', count: 33 }, null], ['worker', 'sq-dev-coder']);
  assert.deepStrictEqual([...m.counts], [['worker', 2], ['sq-dev-coder', 1], ['sq-ghost-lead', 3]]); assert.deepStrictEqual(m.extra, [{ type: 'sq-ghost-lead', count: 3 }]);
  assert.strictEqual(L.squadOpen(undefined, false), false); assert.strictEqual(L.squadOpen(undefined, true), true);
  assert.strictEqual(L.squadOpen(false, true), false); assert.strictEqual(L.squadOpen(true, false), true); // 사용자가 정한 것을 존중
});
t('claudeLaunchCommand: 래퍼가 있으면 인용해 exec, 없거나 이상하면 claude', () => {
  const sid = 'abcd1234-aaaa';
  assert.strictEqual(L.claudeLaunchCommand(sid, null), 'command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec claude ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(null, undefined), 'command -v claude >/dev/null && exec claude ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, '/r/scripts/maru-claude.sh'), 'command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec /r/scripts/maru-claude.sh ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, '/my repo/a b$(x)`y`;&\'"/scripts/maru-claude.sh').split('exec ')[1], String.raw`/my\ repo/a\ b\$\(x\)\`y\`\;\&\'\"/scripts/maru-claude.sh` + ' ; exit 127\r');
  for (const bad of ['/r/a\nb', '/r/a\rb', '/r/a\u001bb', '/r/a\u202Eb', 'relative/x.sh', '', 5, '/' + 'a'.repeat(1030)]) assert.ok(L.claudeLaunchCommand(sid, bad).endsWith('exec claude ; exit 127\r'), String(bad).slice(0, 8)); // 개행·제어·bidi 가 든 경로는 쓰지 않는다
  assert.strictEqual(L.claudeLaunchCommand(sid, '/r/한글 폴더/scripts/maru-claude.sh').split('exec ')[1], '/r/한글\\ 폴더/scripts/maru-claude.sh ; exit 127\r');
});
t('스쿼드 정적 검사: 래퍼 검사·python 도구 폴더·시간·크기 상한·60초 갱신', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(/'\/Library\/Developer\/CommandLineTools\/usr\/bin\/python3'/.test(main) && !/'\/usr\/bin\/python3'/.test(main));
  assert.ok(/'-I', script, 'meta'\], \{ timeout: 3000, maxBuffer: L\.SQUAD_META_MAX_BYTES/.test(main) && L.SQUAD_META_MAX_BYTES === 256 * 1024);
  assert.ok(/setInterval\(refreshSquads, 60000\)/.test(main) && !/refreshSquads\(\)/.test(main.split('setInterval(() => {\n    if (TEST_FX)')[1] || ''), '1초 폴링에 넣지 않는다');
  assert.ok(/lstatSync\(f\)[\s\S]{0,120}st\.isFile\(\) \|\| !safeOwned\(st\)[\s\S]{0,80}X_OK/.test(main) && /L\.claudeLaunchCommand\(sid, claudeWrapper\(\), resume\)/.test(main));
  assert.ok(!/exec claude/.test(main.replace(/\/\/.*$/gm, '')), 'exec claude 문자열은 lib 의 한 곳에만');
  assert.ok(/squadUser/.test(rd) && /aria-expanded/.test(rd) && !/innerHTML/.test(rd));
  for (const k of ['squad.eyebrow', 'squad.base', 'squad.personal', 'squad.head.aria', 'role.squadLead', 'squad.working', 'squad.working.n']) for (const lg of I.LANGS) assert.ok(I.STR[lg][k], lg + ':' + k);
  assert.strictEqual(I.STR.ko['squad.eyebrow'], '스쿼드'); assert.strictEqual(I.STR.en['squad.eyebrow'], 'Squads');
  assert.ok(!Object.keys(I.STR.ko).some((k) => k.startsWith('party.')));
});

// ---- 할 일 완료/안 함 ----
const NOW = 1800000000;
const E = (o) => ({ at: NOW, kind: 'done', tag: 'maru', title: '앱 마무리', ...o });
t('titleKey: 공백 접기 + 소문자(셸 casefold 의 근사, ASCII·한글은 일치)', () => {
  assert.strictEqual(L.titleKey('  Fix   The\tBug \n'), 'fix the bug');
  assert.strictEqual(L.titleKey('ABC  가나  다 Straße'), 'abc 가나 다 strasse');
  assert.strictEqual(L.titleKey('ΣΑΣ'), L.titleKey('σας')); // ς 는 σ 로
  assert.strictEqual(L.titleKey('앱  마무리'), L.titleKey(' 앱 마무리 '));
  assert.notStrictEqual(L.titleKey('앱 마무리'), L.titleKey('앱마무리'));
  assert.strictEqual(L.titleKey(null), '');
});
t('todo-done 줄 파싱: 정확히 4칸·형식 검증', () => {
  const ok = [`${NOW}|done|maru|앱 마무리`, `${NOW}|skip|maru/desktop-app|Fix bug`, `${NOW}|done|책|가나다`].join('\n');
  assert.deepStrictEqual(L.parseTodoDone(ok).map((e) => [e.kind, e.tag, e.title]), [['done', 'maru', '앱 마무리'], ['skip', 'maru/desktop-app', 'Fix bug'], ['done', '책', '가나다']]);
  const bad = ['', 'x', `${NOW}|done|maru`, `${NOW}|done|maru|a|b`, `${NOW}|nope|maru|a`, `abc|done|maru|a`, `12345|done|maru|a`, `${NOW}|done|bad tag|a`, `${NOW}|done|maru/BAD|a`, `${NOW}|done||a`, `${NOW}|done|maru|`, `${NOW}|done|__proto__|a`,
    `${NOW}|done|maru|${'가'.repeat(61)}`, `${NOW}|done|maru|a\u001b[2Jb`, `${NOW}|done|maru|a\u202Eb`, `${NOW}|done|maru|a\u200Bb`, `${NOW}|done|maru| a`, `${NOW}x|done|maru|a`, `-${NOW}|done|maru|a`, `${NOW}.5|done|maru|a`];
  assert.deepStrictEqual(L.parseTodoDone(bad.join('\n')), []);
  assert.strictEqual(L.parseTodoDone(`${NOW}|done|maru|가${'나'.repeat(59)}`).length, 1); // 60자 경계
  assert.deepStrictEqual(L.parseTodoDone(`${NOW}|done|maru|__proto__`).map((e) => e.title), ['__proto__']); // 제목이 __proto__ 여도 일반 값
  assert.deepStrictEqual(L.parseTodoDone(`${NOW}|done|maru|a\r\n${NOW}|skip|maru|b\r\n`).map((e) => e.title), ['a', 'b']);
  assert.deepStrictEqual(L.parseTodoDone(`${NOW}|done|maru|a\n${NOW}|done|maru|잘린`, true).map((e) => e.title), ['a']); // 잘렸으면 마지막 줄 버림
  assert.deepStrictEqual(L.parseTodoDone(undefined), []);
});
t('todo-done: 201줄이면 마지막 200줄만, 만료·미래 줄 제거', () => {
  const lines = Array.from({ length: 201 }, (_, i) => `${NOW + i}|done|maru|일 ${i}`).join('\n');
  const p = L.parseTodoDone(lines); assert.strictEqual(p.length, 200); assert.strictEqual(p[0].title, '일 1'); assert.strictEqual(p[199].title, '일 200');
  const pr = L.pruneTodoDone([E({ at: NOW - 14 * 86400 - 1, title: '옛' }), E({ at: NOW - 14 * 86400, title: '경계' }), E({ at: NOW - 86400, title: '어제' }), E({ at: NOW + 2 * 86400, title: '미래' }), E({ title: '지금' })], NOW);
  assert.deepStrictEqual(pr.map((e) => e.title), ['경계', '어제', '지금']);
  const big = Array.from({ length: 200 }, (_, i) => E({ title: '일 ' + i })); const added = L.addTodoDone(big, [E({ title: '새것' })], NOW);
  assert.strictEqual(added.length, 200); assert.strictEqual(added[199].title, '새것'); assert.strictEqual(added[0].title, '일 1');
  assert.deepStrictEqual(L.addTodoDone(null, [E()], NOW).length, 1);
});
t('filterTodos: 7일 안 기록과 최상위 태그·제목 키가 모두 같은 할 일만 뺀다', () => {
  const todos = L.parseTodos('maru|8|앱 마무리|p\n책|5|앱 마무리|\nmaru|3|Fix Bug|\nmaru|2|다른 일|');
  assert.deepStrictEqual(L.filterTodos(todos, [E()], NOW).map((x) => x.tag + ':' + x.title), ['책:앱 마무리', 'maru:Fix Bug', 'maru:다른 일']); // 같은 제목 다른 태그는 남는다
  assert.deepStrictEqual(L.filterTodos(todos, [E({ tag: '책' })], NOW).map((x) => x.tag + ':' + x.title), ['maru:앱 마무리', 'maru:Fix Bug', 'maru:다른 일']);
  assert.deepStrictEqual(L.filterTodos(todos, [E({ title: '  fix   BUG', kind: 'skip' })], NOW).map((x) => x.title), ['앱 마무리', '앱 마무리', '다른 일']); // 공백·대소문자 접기
  const withProj = L.parseTodos('maru/desktop-app|5|앱 마무리|\nmaru|5|앱 마무리|\nblog/x|5|앱 마무리|');
  assert.deepStrictEqual(L.filterTodos(withProj, [E({ tag: 'maru/desktop-app' })], NOW).map((x) => x.tag + ':' + (x.project || '')), ['blog:blog/x']); // 기록 태그의 최상위(maru)로 비교
  assert.deepStrictEqual(L.filterTodos(withProj, [E({ tag: 'maru' })], NOW).map((x) => x.tag), ['blog']);
  assert.strictEqual(L.filterTodos(todos, [E({ at: NOW - 7 * 86400 })], NOW).length, 3); // 7일 정각은 아직 숨김
  assert.strictEqual(L.filterTodos(todos, [E({ at: NOW - 7 * 86400 - 1 })], NOW).length, 4); // 7일을 넘기면 다시 보인다
  assert.strictEqual(L.filterTodos(todos, [], NOW), todos);
  assert.strictEqual(L.filterTodos(todos, [E({ title: '앱마무리' })], NOW).length, 4); // 공백 제거까지는 같게 보지 않는다
  const open = L.projectOpenTodos({ summary: { kind: 'unclassified', tag: '책' }, registry: [], state: {}, todos: L.filterTodos(todos, [E({ tag: '책' })], NOW) });
  assert.strictEqual(open.length, 0); // 프로젝트·트레이가 쓰는 남은 일 목록도 같은 필터를 거친다
  assert.deepStrictEqual(L.filterTodos(null, [E()], NOW), []);
});
t('makeTodoDone: main 의 항목 값만 쓰고, 주입 문자·| 가 든 제목은 기록하지 않는다', () => {
  const [a] = L.parseTodos('maru/desktop-app|8|앱 마무리|p');
  assert.deepStrictEqual(L.makeTodoDone(a, 'skip', NOW), { at: NOW, kind: 'skip', tag: 'maru/desktop-app', title: '앱 마무리' });
  assert.strictEqual(L.makeTodoDone({ tag: '블로그', title: '글' }, 'done', NOW).tag, '블로그');
  for (const title of ['a|b', 'a\nb', 'a\u001b[2J', 'a\u202Eb', 'a\u200Bb', '', ' a', '가'.repeat(61), '__proto__\n']) assert.strictEqual(L.makeTodoDone({ tag: 'maru', title }, 'done', NOW), null, JSON.stringify(title));
  assert.strictEqual(L.makeTodoDone({ tag: 'bad tag', title: 'a' }, 'done', NOW), null); assert.strictEqual(L.makeTodoDone({ tag: 'maru', title: 'a' }, 'nope', NOW), null); assert.strictEqual(L.makeTodoDone(null, 'done', NOW), null);
  assert.ok(L.todoMarkable({ title: '정상' }) && !L.todoMarkable({ title: 'a|b' }) && !L.todoMarkable(null));
  assert.strictEqual(L.parseTodoDone(L.formatTodoDone([E({ title: '__proto__' })])).length, 1);
});
t('todo-done: 되돌리기는 방금 쓴 그 줄만 뺀다', () => {
  const a = E({ title: 'A' }); const b = E({ title: 'B', at: NOW + 1 }); const a2 = E({ title: 'A', tag: '책' });
  const list = [a, b, a2];
  assert.deepStrictEqual(L.removeTodoDone(list, [b]).map((e) => e.title + e.tag), ['Amaru', 'A책']);
  assert.deepStrictEqual(L.removeTodoDone(list, [a2]).map((e) => e.title + e.tag), ['Amaru', 'Bmaru']); // 같은 제목 다른 태그는 그대로
  assert.strictEqual(L.removeTodoDone(list, [E({ title: '없음' })]).length, 3);
  assert.strictEqual(L.removeTodoDone(list, [a, b]).length, 1);
  assert.deepStrictEqual(L.removeTodoDone([a, a], [a]).length, 1); // 같은 줄이 둘이면 하나만
  assert.strictEqual(L.removeTodoDone(list, null).length, 3);
  const times = L.addTodoDone([], [a], NOW); assert.deepStrictEqual(L.removeTodoDone(times, [a]), []);
});
t('todo-done 파일: 원자적 저장 0600·손상·링크·상한·주입', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'td-')); const f = path.join(dir, 'todo-done.txt');
  assert.strictEqual(L.readTodoDoneFile(f).status, 'missing');
  const list = [E({ title: '앱 마무리' }), E({ kind: 'skip', tag: 'maru/app', title: 'Fix bug', at: NOW + 1 })];
  assert.strictEqual(L.saveTodoDone(f, list), true);
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), `${NOW}|done|maru|앱 마무리\n${NOW + 1}|skip|maru/app|Fix bug\n`);
  assert.deepStrictEqual(L.readTodoDoneFile(f), { status: 'ok', data: list });
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.')), []); // 임시 파일이 남지 않는다
  assert.strictEqual(L.saveTodoDone(f, [E({ title: 'a|b' })]), false); assert.strictEqual(L.saveTodoDone(f, [E({ title: 'a\nb' })]), false); assert.strictEqual(L.saveTodoDone(f, [{ ...E(), extra: 1, kind: 'x' }]), false);
  assert.strictEqual(L.saveTodoDone(f, Array.from({ length: 201 }, (_, i) => E({ title: 'x' + i }))), false);
  assert.strictEqual(L.saveTodoDone(f, Array.from({ length: 200 }, (_, i) => E({ title: 'x' + i }))), true);
  assert.strictEqual(L.parseTodoDone(fs.readFileSync(f, 'utf8')).length, 200);
  assert.ok(fs.statSync(f).size < L.TODO_DONE_MAX_BYTES); // 정상 최대치가 읽기 상한 안
  assert.strictEqual(L.saveTodoDone(f, Array.from({ length: 200 }, (_, i) => E({ tag: '가'.repeat(12) + '/' + '나'.repeat(24), title: '가'.repeat(60) }))), true);
  assert.strictEqual(L.readTodoDoneFile(f).status, 'ok'); assert.ok(L.readTodoDoneFile(f).data.length >= 100 && fs.statSync(f).size <= L.TODO_DONE_MAX_BYTES); // 가장 긴 줄 200개는 바이트 상한까지만 남고 읽힌다
  fs.writeFileSync(f, ' '.repeat(L.TODO_DONE_MAX_BYTES + 1)); assert.strictEqual(L.readTodoDoneFile(f).status, 'corrupt'); // 상한 초과
  assert.ok(L.backupCorruptFile(f) && fs.existsSync(f + '.bak') && !fs.existsSync(f));
  fs.writeFileSync(f, `x\n${NOW}|done|maru|좋은 줄\n쓰레기|\n`); assert.deepStrictEqual(L.readTodoDoneFile(f).data.map((e) => e.title), ['좋은 줄']); // 줄 단위로 걸러 낸다
  const real = path.join(dir, 'real.txt'); fs.writeFileSync(real, `${NOW}|done|maru|a\n`); const link = path.join(dir, 'link.txt'); fs.symlinkSync(real, link);
  assert.strictEqual(L.readTodoDoneFile(link).status, 'corrupt'); // 링크는 읽지 않는다
  assert.strictEqual(L.readTodoDoneFile(dir).status, 'corrupt'); // 일반 파일이 아니면(폴더) 손상
  assert.strictEqual(L.readTodoDoneFile(path.join(real, 'x')).status, 'error'); // 읽기 오류(ENOTDIR)는 손상이 아니다: 치우지 않는다
  if (process.getuid && process.getuid() !== 0) { const noread = path.join(dir, 'noread.txt'); fs.writeFileSync(noread, `${NOW}|done|maru|a\n`, { mode: 0o000 }); assert.strictEqual(L.readTodoDoneFile(noread).status, 'error'); fs.chmodSync(noread, 0o600); } // EACCES
  const ldir = path.join(tmp, 'td-link'); fs.symlinkSync(dir, ldir);
  assert.strictEqual(L.saveTodoDone(path.join(ldir, 'todo-done.txt'), list), false); // 폴더가 링크면 쓰지 않는다
  fs.writeFileSync(f, `${NOW}|done|maru|a\u202Eb\n${NOW}|done|maru|c\u001b[31m\n${NOW}|done|maru|d\n`); assert.deepStrictEqual(L.readTodoDoneFile(f).data.map((e) => e.title), ['d']);
});
t('todo-done: 바이트 상한 32768 을 넘지 않게 오래된 줄부터 덜어 낸다', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'tdb-')); const f = path.join(dir, 'todo-done.txt');
  const longTag = '가'.repeat(12) + '/' + '나'.repeat(24);
  const list = Array.from({ length: 200 }, (_, i) => E({ at: NOW - 200 + i, tag: longTag, title: String(i % 10).repeat(2) + '가'.repeat(58) }));
  assert.ok(Buffer.byteLength(L.formatTodoDone(list), 'utf8') > L.TODO_DONE_MAX_BYTES); // 줄 수 상한만으로는 못 막는 크기
  assert.strictEqual(L.TODO_DONE_MAX_BYTES, 32768);
  assert.strictEqual(L.saveTodoDone(f, list), true);
  const size = fs.statSync(f).size; assert.ok(size <= 32768 && size > 32768 - 300, String(size)); // 한계 가까이까지는 채운다
  const back = L.readTodoDoneFile(f); assert.strictEqual(back.status, 'ok');
  assert.ok(back.data.length < 200 && back.data.length > 100);
  assert.deepStrictEqual(back.data, list.slice(list.length - back.data.length)); // 최신 줄이 남고 오래된 줄이 빠진다
  const added = L.addTodoDone(list.slice(0, 199), [E({ at: NOW, tag: longTag, title: '새것' })], NOW); // 가공 경로도 같은 상한
  assert.ok(Buffer.byteLength(L.formatTodoDone(added), 'utf8') <= 32768 && added[added.length - 1].title === '새것');
  assert.deepStrictEqual(L.fitTodoDone([E()]), [E()]);
  fs.writeFileSync(f, ' '.repeat(32768)); assert.strictEqual(L.readTodoDoneFile(f).status, 'ok'); // 정확히 상한이면 읽힌다
  fs.writeFileSync(f, ' '.repeat(32769)); assert.strictEqual(L.readTodoDoneFile(f).status, 'corrupt');
});
t('셸 textclean.py 의 TODO_DONE_MAX_BYTES 와 같다', () => {
  const py = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'textclean.py'), 'utf8');
  const m = /^TODO_DONE_MAX_BYTES\s*=\s*([0-9_]+)/m.exec(py); assert.ok(m, 'python 상수를 찾지 못했다');
  assert.strictEqual(Number(m[1].replace(/_/g, '')), L.TODO_DONE_MAX_BYTES);
  const ml = /^TODO_DONE_MAX_LINES\s*=\s*([0-9]+)/m.exec(py); assert.ok(ml); assert.strictEqual(Number(ml[1]), L.TODO_DONE_MAX);
});
t('main·preload·renderer 정적 검사: 완료/안 함 IPC 와 UI', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8'); const css = fs.readFileSync(path.join(__dirname, 'renderer', 'style.css'), 'utf8');
  for (const ch of ['todos:mark', 'todos:undo']) { assert.ok(main.includes("'" + ch + "'") && pre.includes("'" + ch + "'"), ch); assert.ok(new RegExp("ipcMain\\.handle\\('" + ch + "', \\(e,[^)]*\\) => \\{\\n  if \\(!fromMain\\(e\\)").test(main), 'sender 검사 ' + ch); }
  const h = main.split("ipcMain.handle('todos:mark'")[1].split('\n});')[0];
  assert.ok(/L\.matchTodo\(cache\.todos, index, shown\)/.test(h) && /L\.makeTodoDone\(item, kind/.test(h)); // 기록은 main 의 항목 값으로(동작은 makeTodoDone 시험이 본다)
  assert.ok(/commitTodoDone[\s\S]*PERSIST && \(!ROOT \|\| !L\.saveTodoDone/.test(main) && /r\.status === 'corrupt' && PERSIST/.test(main.split('function loadTodoDone')[1].split('\n}')[0])); // 스모크·시험에서는 쓰지 않는다
  assert.ok(/applyTodoFilter\(\);\n    loadProjState\(\);/.test(main)); // 프로젝트 요약(남은 일 N)은 걸러 낸 목록으로
  assert.ok(/recentMarks\.has\(id\)/.test(main));
  assert.ok(/L\.projectOpenTodos[\s\S]*dlg\.projDone\.title[\s\S]*makeTodoDone\(p\.item, 'skip'/.test(main));
  const sd = main.split("ipcMain.handle('projects:set-status'")[1].split('\n});')[0];
  assert.ok(/shownKeys\.has\(/.test(sd) && sd.indexOf('projectStateFits') < sd.indexOf('commitTodoDone(L.addTodoDone') && /reason: 'rollback'/.test(sd)); // 창에 보인 항목만, 저장 가능 검사가 표시보다 먼저, 되돌림 실패는 따로
  assert.ok(/status === 'error'\) return/.test(main.split('function loadTodoDone')[1].split('\n}')[0]));
  assert.ok(/class="[^"]*todo-main|'todo todo-main/.test(rd) && !/todo-act[\s\S]{0,40}b\.append\(todoActs/.test(rd)); // 본문 단추와 별도 단추
  assert.ok(/6000/.test(rd.split('function markNote')[1].split('async function markTodo')[0]) && /undoTodoMark/.test(rd));
  assert.ok(/aria-label/.test(rd.split('function todoActs')[1].split('let markTimer')[0]) && /\.todo-act:focus-visible/.test(css));
  for (const k of ['proj.err.busy', 'proj.err.rollback', 'todo.done', 'todo.skip', 'todo.done.aria', 'todo.skip.aria', 'todo.marked.done', 'todo.marked.skip', 'todo.undo', 'dlg.projDone.title', 'dlg.projDone.detail', 'dlg.projDone.ok']) for (const lg of I.LANGS) assert.ok(I.STR[lg][k], lg + ':' + k);
  for (const lg of I.LANGS) { assert.ok(I.t(lg, 'dlg.projDone.title', { n: 3 }).includes('3')); assert.ok(I.t(lg, 'todo.done.aria', { title: 'T' }).includes('T')); }
  assert.strictEqual(I.STR.ko['todo.marked.done'] + ' · ' + I.STR.ko['todo.undo'], '완료로 표시했습니다 · 되돌리기');
  assert.ok(!/MARU_APP_UI[\s\S]{0,40}todo-done/.test(main));
});

// ---- 알림과 승인함 ----
const UID = process.getuid();
const mkProp = (base, slug, files) => { const d = path.join(base, slug); fs.mkdirSync(d, { recursive: true }); for (const [n, c] of Object.entries(files || {})) fs.writeFileSync(path.join(d, n), c); return d; };
t('inbox: 제안 slug 검증(종류별 규칙)', () => {
  for (const s of ['a', 'dev-team', 'a'.repeat(20), '0x']) assert.ok(L.validProposalSlug('squad', s), s);
  for (const s of ['', 'A', '-a', 'a_b', 'a'.repeat(21), '../x', 'a/b', 'a\n', 'a b', '가', '.hidden', 42, null]) assert.ok(!L.validProposalSlug('squad', s), String(s));
  assert.ok(L.validProposalSlug('skill', 'a'.repeat(41)) && !L.validProposalSlug('skill', 'a'.repeat(42)));
  assert.ok(!L.validProposalSlug('other', 'abc') && !L.validProposalSlug(undefined, 'abc'));
});
t('inbox: cleanDisplay·cleanProposalText 는 제어·bidi·ESC 를 지우고 상한을 지킨다', () => {
  assert.strictEqual(L.cleanDisplay('a‮b\u001b[31mc​d\n e\t f', 50), 'ab[31mcd e f');
  assert.strictEqual(L.cleanDisplay('가'.repeat(300), 200).length, 200);
  assert.strictEqual(L.cleanDisplay(5, 10), '');
  const x = L.cleanProposalText('줄1\r\n줄2‮\u0007\n\n\n\n줄3\ttab', 100);
  assert.strictEqual(x, '줄1\n줄2\n\n줄3  tab');
  assert.ok(!/[\u0000-\u0009\u000B-\u001F‮]/.test(x));
});
t('inbox: proposalMeta 는 머리말의 한 줄 name·description 만 읽는다', () => {
  assert.deepStrictEqual(L.proposalMeta('---\nname: "내 팀"\ndescription: 설명 ‮입니다\n---\n본문 name: x'), { name: '내 팀', description: '설명 입니다' });
  assert.deepStrictEqual(L.proposalMeta('머리말 없음\nname: x'), { name: '', description: '' });
  assert.deepStrictEqual(L.proposalMeta('---\ndescription: >\n  접은 문단\n---\n'), { name: '', description: '' });
  assert.strictEqual(L.proposalMeta('---\nname: ' + 'n'.repeat(100) + '\n---\n').name.length, 40);
  assert.deepStrictEqual(L.proposalMeta(null), { name: '', description: '' });
});
t('inbox: listProposals 는 나쁜 이름·링크·일반 파일·큰 파일을 걸러 낸다', () => {
  const base = fs.mkdtempSync(path.join(tmp, 'prop-sq-'));
  mkProp(base, 'good-team', { 'squad.md': '---\nname: 좋은 팀\ndescription: 설명‮ 줄\n---\n', 'lead.md': 'x', 'a.md': 'x', 'b.md': 'x' });
  mkProp(base, 'Bad_Slug', { 'squad.md': 'x' }); mkProp(base, 'a'.repeat(21), { 'squad.md': 'x' }); mkProp(base, '-lead', { 'squad.md': 'x' });
  fs.writeFileSync(path.join(base, 'plainfile'), 'x'); fs.writeFileSync(path.join(base, 'good-team.note.txt'), 'memo');
  const outside = fs.mkdtempSync(path.join(tmp, 'outside-')); fs.writeFileSync(path.join(outside, 'squad.md'), '---\nname: 밖\n---\n');
  fs.symlinkSync(outside, path.join(base, 'linked'));
  const big = mkProp(base, 'big-one', { 'lead.md': 'x' }); fs.writeFileSync(path.join(big, 'squad.md'), 'z'.repeat(L.PROPOSAL_FILE_MAX + 1));
  const sl = mkProp(base, 'sym-file', { 'lead.md': 'x' }); fs.symlinkSync(path.join(outside, 'squad.md'), path.join(sl, 'squad.md'));
  const r = L.listProposals('squad', base, UID);
  assert.deepStrictEqual(r.map((x) => x.slug), ['big-one', 'good-team', 'sym-file']); // 정렬된 유효 slug 폴더만, 링크·일반 파일·나쁜 이름 제외
  const g = r.find((x) => x.slug === 'good-team');
  assert.deepStrictEqual([g.kind, g.name, g.description, g.members], ['squad', '좋은 팀', '설명 줄', 2]);
  assert.strictEqual(r.find((x) => x.slug === 'big-one').name, 'big-one'); // 너무 큰 squad.md 는 읽지 않는다(이름은 slug)
  assert.strictEqual(r.find((x) => x.slug === 'sym-file').name, 'sym-file'); // 링크 파일은 따라가지 않는다
  assert.ok(g.sig.includes('squad.md:') && !JSON.stringify(r).includes('밖'));
  assert.deepStrictEqual(L.listProposals('squad', path.join(base, 'linked'), UID), []); // 기준 폴더가 링크면 비움
  assert.deepStrictEqual(L.listProposals('squad', path.join(base, 'none'), UID), []);
  assert.deepStrictEqual(L.listProposals('squad', base, UID + 1), []); // 소유자가 다르면 거부
  assert.deepStrictEqual(L.listProposals('nope', base, UID), []);
});
t('inbox: listProposals 개수 상한과 스킬 제안(SKILL.md 없는 폴더는 invalid)', () => {
  const base = fs.mkdtempSync(path.join(tmp, 'prop-sk-'));
  for (let i = 0; i < 30; i++) mkProp(base, 's' + String(i).padStart(2, '0'), { 'SKILL.md': '---\nname: n' + i + '\ndescription: d' + i + '\n---\n' });
  assert.strictEqual(L.listProposals('skill', base, UID).length, L.PROPOSAL_LIST_MAX);
  const b2 = fs.mkdtempSync(path.join(tmp, 'prop-sk2-'));
  mkProp(b2, 'ok-skill', { 'SKILL.md': '---\nname: ok-skill\ndescription: 쓸모\n---\n', 'PROPOSAL.md': 'x' }); mkProp(b2, 'empty-one', { 'PROPOSAL.md': 'x' });
  const outside = path.join(tmp, 'outside-skill.md'); fs.writeFileSync(outside, '---\nname: leak\n---\n'); const lk = mkProp(b2, 'link-md', {}); fs.symlinkSync(outside, path.join(lk, 'SKILL.md'));
  const r = L.listProposals('skill', b2, UID);
  assert.deepStrictEqual(r.map((x) => [x.slug, !!x.invalid, x.description]), [['empty-one', true, ''], ['link-md', true, ''], ['ok-skill', false, '쓸모']]);
});
t('inbox: proposalDetail 은 일반 파일만 보여 주고 링크·큰 파일·이상한 이름은 건너뛴다', () => {
  const base = fs.mkdtempSync(path.join(tmp, 'prop-d-'));
  const outside = path.join(tmp, 'secret.txt'); fs.writeFileSync(outside, 'SECRET');
  const d = mkProp(base, 'team-x', { 'squad.md': 'S‮본문', 'lead.md': 'L', 'zed.md': 'Z', 'alpha.md': 'A' });
  fs.symlinkSync(outside, path.join(d, 'evil.md')); fs.mkdirSync(path.join(d, 'subdir')); fs.writeFileSync(path.join(d, 'bad name.md'), 'x'); fs.writeFileSync(path.join(d, 'huge.md'), 'h'.repeat(L.PROPOSAL_FILE_MAX + 5));
  fs.writeFileSync(path.join(base, 'team-x.note.txt'), '메모\u0007');
  const r = L.proposalDetail('squad', base, 'team-x', UID);
  assert.deepStrictEqual(r.sections.map((x) => x.name), ['squad.md', 'lead.md', 'alpha.md', 'huge.md', 'zed.md', 'note.txt']); // squad.md, lead.md, 팀원(이름순), 메모
  assert.strictEqual(r.sections[0].text, 'S본문');
  assert.ok(r.sections.find((x) => x.name === 'huge.md').truncated && r.sections.find((x) => x.name === 'huge.md').text === '');
  assert.strictEqual(r.sections[5].text, '메모');
  assert.ok(!JSON.stringify(r).includes('SECRET') && r.skipped === 3 && !r.files.some((f) => /evil|subdir|bad/.test(f.name))); // 링크·폴더·이름 규칙 위반 3개
  assert.strictEqual(L.proposalDetail('squad', base, '../team-x', UID), null);
  assert.strictEqual(L.proposalDetail('squad', base, 'nothere', UID), null);
  const sk = mkProp(base, 'my-skill', { 'SKILL.md': '---\nname: my-skill\n---\n내용', 'PROPOSAL.md': '메모', 'extra.txt': 'x' });
  const k = L.proposalDetail('skill', base, 'my-skill', UID);
  assert.deepStrictEqual(k.sections.map((x) => x.name), ['SKILL.md']); assert.deepStrictEqual(k.files.map((f) => f.name), ['PROPOSAL.md', 'SKILL.md', 'extra.txt']);
});
t('inbox: 총 읽기 상한 — 상한을 실제로 넘기면 나머지는 읽지 않고 이유를 구분한다', () => {
  const base = fs.mkdtempSync(path.join(tmp, 'prop-tot-'));
  const files = { 'squad.md': 'a'.repeat(16000), 'lead.md': 'b'.repeat(16000) }; for (let i = 0; i < 7; i++) files['m' + i + '.md'] = 'c'.repeat(16000); // 9개 x 16000 = 144000 > 131072(8개 128000 까지만 읽힌다)
  mkProp(base, 'tot', files);
  const r = L.proposalDetail('squad', base, 'tot', UID);
  const read = r.sections.filter((s) => s.text); const cut = r.sections.filter((s) => s.truncated);
  assert.strictEqual(read.length, 8); assert.strictEqual(read.reduce((n, s) => n + s.text.length, 0), 128000);
  assert.deepStrictEqual(cut.map((s) => [s.name, s.limit, s.text]), [['squad.md', 'total', '']]); // 합계 한도 때문에 읽지 않은 파일(이름순으로 읽으므로 마지막인 squad.md)
  const b2 = fs.mkdtempSync(path.join(tmp, 'prop-big-')); mkProp(b2, 'one', { 'squad.md': 'x', 'lead.md': 'y'.repeat(L.PROPOSAL_FILE_MAX + 1), 'a.md': 'z' });
  const r2 = L.proposalDetail('squad', b2, 'one', UID);
  assert.deepStrictEqual(r2.sections.filter((s) => s.truncated).map((s) => [s.name, s.limit]), [['lead.md', 'file']]); // 파일 하나가 너무 큼
  assert.ok(r2.sections.filter((s) => !s.truncated).every((s) => s.limit === undefined));
});
t('inbox: PROPOSAL_TOTAL_MAX 는 스쿼드 최대 구성(squad+lead+팀원 최대)을 다 읽을 만큼 크다', () => {
  assert.ok(L.PROPOSAL_TOTAL_MAX >= (L.SQUAD_MEMBERS_MAX + 2) * L.PROPOSAL_FILE_MAX, String(L.PROPOSAL_TOTAL_MAX));
  assert.ok(L.PROPOSAL_FILES_MAX >= L.SQUAD_MEMBERS_MAX + 2);
  const base = fs.mkdtempSync(path.join(tmp, 'prop-max-')); const f = { 'squad.md': 'a'.repeat(L.PROPOSAL_FILE_MAX), 'lead.md': 'b'.repeat(L.PROPOSAL_FILE_MAX) };
  for (let i = 0; i < L.SQUAD_MEMBERS_MAX; i++) f['m' + i + '.md'] = 'c'.repeat(L.PROPOSAL_FILE_MAX);
  mkProp(base, 'full', f);
  assert.ok(L.proposalDetail('squad', base, 'full', UID).sections.every((s) => !s.truncated)); // 최대 구성은 전부 읽힌다
});
t('inbox: 미래 시각 — logAtMs·plausibleLogAt·newestAt·markUnseen·seenToStore', () => {
  const now = new Date(2026, 5, 10, 12, 0, 0).getTime();
  assert.ok(L.logAtMs('2026-06-10 12:00:00') === now && L.logAtMs('2026-13-01 00:00:00') === null && L.logAtMs('2026-02-30 00:00:00') === null && L.logAtMs('2026-06-10 25:00:00') === null && L.logAtMs('x') === null);
  assert.ok(L.plausibleLogAt('2026-06-11 11:59:59', now) && !L.plausibleLogAt('2026-06-11 12:00:01', now) && !L.plausibleLogAt('9999-12-31 23:59:59', now));
  const ev = [{ at: '2026-06-10 11:00:00' }, { at: '9999-12-31 23:59:59' }, { at: '2026-13-45 99:99:99' }, { at: '2026-06-20 00:00:00' }];
  assert.strictEqual(L.newestAt(ev, now), '2026-06-10 11:00:00'); // 미래·가짜 날짜는 무시
  const m = L.markUnseen(ev, '', now); assert.strictEqual(m.unseen, 1); assert.deepStrictEqual(m.list.map((e) => e.fresh), [true, false, false, false]);
  assert.strictEqual(L.markUnseen(ev, '9999-12-31 23:59:59', now).unseen, 1); // 미래 기준값은 쓰지 않는다(기준 없음으로)
  assert.strictEqual(L.seenToStore(ev, now), '2026-06-10 11:00:00');
  assert.strictEqual(L.seenToStore([{ at: '2026-06-10 12:30:00' }], now), '2026-06-10 12:00:00'); // 가까운 미래는 지금으로 제한
  assert.strictEqual(L.seenToStore([{ at: '9999-12-31 23:59:59' }], now), ''); assert.strictEqual(L.seenToStore([], now), '');
  // 파일: 하루 넘게 미래인 값은 손상, 하루 이내는 정상
  assert.strictEqual(L.validateInboxSeen({ version: 1, seen: '2026-06-12 12:00:01' }, now), null); assert.strictEqual(L.validateInboxSeen({ version: 1, seen: '2026-06-11 11:00:00' }, now), '2026-06-11 11:00:00');
  assert.strictEqual(L.validateInboxSeen({ version: 1, seen: '2026-02-30 00:00:00' }, now), null); // 달력에 없는 날짜
  const f = path.join(tmp, 'seen-future.json');
  fs.writeFileSync(f, JSON.stringify({ version: 1, seen: '9999-12-31 23:59:59' })); assert.strictEqual(L.readInboxSeenFile(f, now).status, 'corrupt');
  assert.ok(!L.saveInboxSeen(f, '9999-12-31 23:59:59', now)); assert.ok(L.saveInboxSeen(f, '2026-06-10 11:00:00', now)); assert.strictEqual(L.readInboxSeenFile(f, now).data, '2026-06-10 11:00:00');
  fs.rmSync(f);
});
t('inbox: 정적 검사 — 내장 이름 거절·digest 대조·request-skill 거부·재검사·캐시', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const sec = main.split('// ---- 알림과 승인함')[1].split('// ---- 프로젝트 IPC')[0];
  const inst = sec.split("ipcMain.handle('inbox:install-squad'")[1].split("ipcMain.handle('inbox:reject'")[0];
  const at = (re) => inst.search(re);
  // 1: 내장 이름 거절(위험·존재 거절과 같은 줄 모양), 확인 창보다 앞
  assert.ok(/c\.existsBuiltin\) return \{ ok: false, reason: 'builtin' \}/.test(inst) && at(/reason: 'builtin'/) < at(/confirmBox\(/));
  // 2: digest 형식(64 hex) 검사 -> 새 검사(checkSquad) -> 같을 때만 다음 단계, 확인 창보다 앞
  assert.ok(/\^\[0-9a-f\]\{64\}\$/.test(inst) && at(/\^\[0-9a-f\]\{64\}/) < at(/await checkSquad\(slug\)/) && at(/c\.digest !== shownDigest/) < at(/reason: 'builtin'/) && /c\.digest !== shownDigest\) \{[^}]*reason: 'changed'/.test(inst) && at(/c\.digest !== shownDigest/) < at(/confirmBox\(/));
  assert.ok(/inboxInstallSquad: \(slug, digest\) =>/.test(pre) && /\(e, slug, shownDigest\) => inboxAction/.test(inst));
  assert.ok(/inboxInstall\(a\.slug, a\.digest\)/.test(rd) && /inboxInstall\(d\.slug, d\.check \? d\.check\.digest : ''\)/.test(rd)); // 화면에 보인 digest 를 싣는다
  assert.ok(/digest: c && c\.ok \? c\.digest : ''/.test(sec) && /builtin: !!\(c && c\.ok && c\.existsBuiltin\)/.test(sec)); // 목록·상세가 digest 와 builtin 을 싣는다
  // 4: request-skill 은 invalid 제안을 main 이 거부
  const rq = sec.split("ipcMain.handle('inbox:request-skill'")[1];
  assert.ok(/it\.invalid\) return \{ ok: false, reason: 'invalid' \}/.test(rq) && rq.search(/it\.invalid/) < rq.search(/confirmBox\(/));
  // 5: 동작 뒤 새로고침은 진행 중이면 한 번 더
  assert.ok(/refreshInbox\(true\)/.test(sec) && /if \(inboxRefreshing\) \{ if \(again\) inboxRefreshAgain = true; return; \}/.test(sec) && /while \(inboxRefreshAgain\)/.test(sec));
  // 8: 상세는 검사를 캐시·공유한다
  const det = sec.split("ipcMain.handle('inbox:detail'")[1].split('let inboxActing')[0];
  assert.ok(/checkCached\(slug, it\.sig\)/.test(det) && !/checkSquad\(/.test(det) && /return e\.p;/.test(sec));
  // 11: 설치 자식이 시간 초과·오류여도 폴더 존재로 판단
  assert.ok(/r\.code !== 0 && !personalSquadExists\(slug\)\) return \{ ok: false, reason: 'install-failed'/.test(inst));
  // 6, 9: 렌더러
  assert.ok(/seenSent = ''; inboxNote\(T\('inbox\.err\.save'\)\)/.test(rd) && /r && r\.ok/.test(rd));
  assert.ok(/for \(const ev of \['pointermove', 'mousedown'\]\) document\.addEventListener\(ev, \(e\) => \{ if \(!e\.metaKey\) setMod\(false\)/.test(rd));
  assert.ok(/s\.limit === 'total' \? 'inbox\.truncated\.total' : 'inbox\.truncated'/.test(rd));
  // 10: 문구
  for (const lg of I.LANGS) {
    for (const k of ['inbox.builtin', 'inbox.check.builtin', 'inbox.err.builtin', 'inbox.truncated.total']) assert.ok(I.STR[lg][k], lg + ':' + k);
    const d = I.t(lg, 'dlg.sqInstall.detail', { slug: 'x', n: 1, roster: 'R' }); assert.ok(!/안전합니다|is safe|No risk signals were found/.test(d), d);
  }
  assert.ok(I.t('ko', 'dlg.sqInstall.detail', { slug: 'x', n: 1, roster: 'R' }).includes('자동 검사에서 위험 신호가 발견되지 않았습니다(본문은 직접 확인하세요)'));
  assert.ok(/마루 폴더/.test(I.STR.ko['inbox.err.risky']) && /Maru folder/.test(I.STR.en['inbox.err.risky']));
  assert.ok(/내장 스쿼드와 같은 이름/.test(I.STR.ko['inbox.builtin']));
  assert.ok(/inbox-seen\.json/.test(sec) && /L\.seenToStore\(cache\.notifs, now\)/.test(sec)); // 3: 본 기준은 min(최근 알림, 지금)
});
t('inbox: trashProposalDir 는 폴더를 휴지 폴더로 옮기고 링크·나쁜 slug·링크 휴지는 거부한다', () => {
  const base = fs.mkdtempSync(path.join(tmp, 'prop-t-')); const trash = path.join(tmp, 'trash-' + Date.now());
  mkProp(base, 'gone-skill', { 'SKILL.md': 'x' }); mkProp(base, 'gone-two', { 'SKILL.md': 'x' });
  const now = new Date(2026, 0, 2, 3, 4, 5);
  assert.deepStrictEqual(L.trashProposalDir(base, trash, 'gone-skill', UID, now), { ok: true });
  assert.ok(!fs.existsSync(path.join(base, 'gone-skill')) && fs.existsSync(path.join(trash, 'gone-skill-20260102-030405', 'SKILL.md')));
  assert.strictEqual(fs.statSync(trash).mode & 0o777, 0o700);
  mkProp(base, 'gone-skill', { 'SKILL.md': 'y' }); // 같은 초에 같은 이름: 덮어쓰지 않고 번호를 붙인다
  assert.ok(L.trashProposalDir(base, trash, 'gone-skill', UID, now).ok && fs.readFileSync(path.join(trash, 'gone-skill-20260102-030405-2', 'SKILL.md'), 'utf8') === 'y' && fs.readFileSync(path.join(trash, 'gone-skill-20260102-030405', 'SKILL.md'), 'utf8') === 'x');
  assert.strictEqual(L.trashProposalDir(base, trash, '../etc', UID).reason, 'invalid');
  assert.strictEqual(L.trashProposalDir(base, trash, 'Bad', UID).reason, 'invalid');
  assert.strictEqual(L.trashProposalDir(base, trash, 'nothere', UID).reason, 'missing');
  const real = fs.mkdtempSync(path.join(tmp, 'real-')); fs.writeFileSync(path.join(real, 'keep.txt'), 'k'); fs.symlinkSync(real, path.join(base, 'link-skill'));
  assert.strictEqual(L.trashProposalDir(base, trash, 'link-skill', UID).reason, 'invalid'); assert.ok(fs.existsSync(path.join(real, 'keep.txt')) && fs.lstatSync(path.join(base, 'link-skill')).isSymbolicLink()); // 링크는 건드리지 않는다
  const lt = path.join(tmp, 'trash-link'); fs.symlinkSync(real, lt);
  assert.strictEqual(L.trashProposalDir(base, lt, 'gone-two', UID).reason, 'trash'); assert.ok(fs.existsSync(path.join(base, 'gone-two')) && fs.readdirSync(real).join() === 'keep.txt'); // 링크 휴지 폴더로는 옮기지 않는다
  assert.strictEqual(L.trashProposalDir(base, trash, 'gone-two', UID + 1).reason, 'invalid');
});
t('inbox: 본 알림 기준 파일 검증·저장(0600, 원자적)·손상 처리', () => {
  assert.strictEqual(L.validateInboxSeen({ version: 1, seen: '2026-01-02 03:04:05' }), '2026-01-02 03:04:05');
  assert.strictEqual(L.validateInboxSeen({ version: 1, seen: '' }), '');
  for (const bad of [null, [], {}, { version: 2, seen: '' }, { version: 1 }, { version: 1, seen: '2026-01-02' }, { version: 1, seen: '2026-01-02 03:04:05\n' }, { version: 1, seen: '2026-01-02 03:04:05', extra: 1 }, { version: 1, seen: 5 }]) assert.strictEqual(L.validateInboxSeen(bad), null, JSON.stringify(bad));
  const f = path.join(tmp, 'inbox-seen.json');
  assert.deepStrictEqual(L.readInboxSeenFile(f), { status: 'missing', data: '' });
  assert.ok(L.saveInboxSeen(f, '2026-01-02 03:04:05')); assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepStrictEqual(L.readInboxSeenFile(f), { status: 'ok', data: '2026-01-02 03:04:05' });
  assert.ok(!L.saveInboxSeen(f, 'not a date') && !L.saveInboxSeen(f, '2026-01-02 03:04:05‮'));
  assert.ok(!fs.readdirSync(tmp).some((n) => /^\.inbox-seen\..*\.tmp$/.test(n)));
  fs.writeFileSync(f, '{broken'); assert.strictEqual(L.readInboxSeenFile(f).status, 'corrupt');
  fs.writeFileSync(f, JSON.stringify({ version: 1, seen: '' }) + ' '.repeat(L.INBOX_SEEN_MAX_BYTES)); assert.strictEqual(L.readInboxSeenFile(f).status, 'corrupt'); // 상한 초과
  fs.rmSync(f); const target = path.join(tmp, 'seen-target.json'); fs.writeFileSync(target, JSON.stringify({ version: 1, seen: '2026-01-02 03:04:05' })); fs.symlinkSync(target, f);
  assert.strictEqual(L.readInboxSeenFile(f).status, 'corrupt'); // 링크는 따르지 않는다
  fs.rmSync(f);
});
t('inbox: markUnseen·newestAt — 새 알림 수는 기준 시각보다 늦은 것만', () => {
  const ev = [{ at: '2026-01-02 10:00:00', code: 'a' }, { at: '2026-01-02 09:00:00', code: 'b' }, { at: '2026-01-01 23:59:59', code: 'c' }, { at: 'garbage', code: 'd' }];
  const m = L.markUnseen(ev, '2026-01-02 09:00:00');
  assert.strictEqual(m.unseen, 1); assert.deepStrictEqual(m.list.map((e) => e.fresh), [true, false, false, false]);
  assert.strictEqual(L.markUnseen(ev, '').unseen, 3); // 기준이 없으면 형식이 맞는 것 전부
  assert.strictEqual(L.markUnseen(ev, 'bad').unseen, 3);
  assert.strictEqual(L.markUnseen(ev, '2026-01-02 10:00:00').unseen, 0);
  assert.deepStrictEqual(L.markUnseen(undefined, ''), { list: [], unseen: 0 });
  assert.strictEqual(L.newestAt(ev), '2026-01-02 10:00:00'); assert.strictEqual(L.newestAt([]), ''); assert.strictEqual(L.newestAt(null), '');
  assert.strictEqual(ev[0].fresh, undefined); // 원본은 바꾸지 않는다
});
t('inbox: relativeAgo', () => {
  const now = new Date(2026, 0, 2, 12, 0, 0).getTime();
  assert.deepStrictEqual(L.relativeAgo('2026-01-02 11:59:30', now), { unit: 'now', n: 0 });
  assert.deepStrictEqual(L.relativeAgo('2026-01-02 12:05:00', now), { unit: 'now', n: 0 }); // 미래
  assert.deepStrictEqual(L.relativeAgo('2026-01-02 11:15:00', now), { unit: 'min', n: 45 });
  assert.deepStrictEqual(L.relativeAgo('2026-01-02 03:00:00', now), { unit: 'hour', n: 9 });
  assert.deepStrictEqual(L.relativeAgo('2025-12-30 12:00:00', now), { unit: 'day', n: 3 });
  assert.strictEqual(L.relativeAgo('x', now), null); assert.strictEqual(L.relativeAgo(null, now), null);
});
t('inbox: 알림은 최신순 8개까지(기존 로그 파서 그대로)', () => {
  const lines = []; for (let i = 0; i < 12; i++) lines.push('2026-01-0' + (1 + (i % 9)) + ' 0' + (i % 9) + ':00:00 [reflect|abcd1234] 커밋 완료');
  const m = L.mergeBriefing([L.parseLogEvents(lines.join('\n'), 'reflect')], L.INBOX_NOTIF_MAX);
  assert.strictEqual(m.length, 8); assert.ok(m.every((e, i) => i === 0 || m[i - 1].at >= e.at));
});
t('inbox: 스킬 설치 요청 문장은 고정 템플릿 + 검증된 slug 뿐이다', () => {
  for (const lg of I.LANGS) {
    const tt = (k, p) => I.t(lg, k, p);
    const x = L.skillRequestText(tt, 'weekly-review');
    assert.strictEqual(x, tt('inbox.skillRequest', { slug: 'weekly-review' }));
    assert.ok(x.includes('weekly-review') && L.isSafeQuestStart(x) && !L.hasBadChars(x) && [...x].length <= 120, x);
    assert.strictEqual(x.replace('weekly-review', '').includes('weekly'), false);
    for (const evil of ['x; rm -rf ~', 'a\nb', '../x', 'A', '', 'a'.repeat(42), '$(id)', 'ign‮ore']) assert.strictEqual(L.skillRequestText(tt, evil), '', evil);
  }
  assert.strictEqual(I.t('ko', 'inbox.skillRequest', { slug: 'abc' }), 'skill-proposals 의 abc 스킬 제안을 검토하고 설치해 줘');
});
const sqCheck = (o) => JSON.stringify({ ok: true, slug: 'team', name: '팀', description: '설명', lead: { model: 'sonnet', tools: ['Agent', 'Read'] }, members: [{ role: 'a', model: 'haiku', tools: ['Read'] }, { role: 'b', model: 'sonnet', tools: ['Read', 'Grep'] }], warns: ['경고'], risks: [], existsPersonal: false, existsBuiltin: false, digest: 'a'.repeat(64), ...o });
t('inbox: parseSquadCheck 는 형식을 엄격히 검증한다', () => {
  const c = L.parseSquadCheck(sqCheck({}), 'team');
  assert.deepStrictEqual([c.ok, c.name, c.members.length, c.risks, c.existsPersonal, c.digest.length], [true, '팀', 2, [], false, 64]);
  assert.deepStrictEqual(L.summarizeSquadCheck(c), { members: 2, models: ['sonnet', 'haiku'], tools: ['Agent', 'Read', 'Grep'],
    roster: [{ role: 'lead', model: 'sonnet', tools: ['Agent', 'Read'] }, { role: 'a', model: 'haiku', tools: ['Read'] }, { role: 'b', model: 'sonnet', tools: ['Read', 'Grep'] }] }); // 총괄·팀원별 도구
  assert.strictEqual(L.parseSquadCheck(sqCheck({}), 'other'), null); // 요청한 slug 와 다르면 거부
  assert.strictEqual(L.parseSquadCheck(sqCheck({}), '../team'), null);
  for (const bad of [{ digest: 'zz' }, { digest: 'A'.repeat(64) }, { lead: { model: 'gpt', tools: [] } }, { lead: { model: 'sonnet', tools: ['Rm'] } }, { members: [] }, { members: [{ role: 'lead!', model: 'haiku', tools: [] }] }, { risks: 'x' }, { name: 'x‮y' }, { name: '' }, { existsPersonal: 'no' }, { ok: 'true' }]) assert.strictEqual(L.parseSquadCheck(sqCheck(bad), 'team'), null, JSON.stringify(bad));
  assert.strictEqual(L.parseSquadCheck('not json', 'team'), null); assert.strictEqual(L.parseSquadCheck(null, 'team'), null);
  assert.strictEqual(L.parseSquadCheck(' '.repeat(40000) + sqCheck({}), 'team'), null); // 출력 상한
  const r = L.parseSquadCheck(JSON.stringify({ ok: false, slug: 'team', reason: '사유‮\u001b[31m' }), 'team');
  assert.deepStrictEqual(r, { ok: false, slug: 'team', reason: '사유[31m' });
  assert.deepStrictEqual(L.parseSquadCheck(sqCheck({ risks: ['위험 ‮신호'] }), 'team').risks, ['위험 신호']); // 위험 신호는 다시 정리돼 남는다
});
t('inbox: 정적 검사 — IPC 송신자 검사·고정 argv·slug 재검증·textContent·스킬 폴더 불변', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8'); const css = fs.readFileSync(path.join(__dirname, 'renderer', 'style.css'), 'utf8'); const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');
  const sec = main.split('// ---- 알림과 승인함')[1].split('// ---- 프로젝트 IPC')[0];
  for (const ch of ['inbox:detail', 'inbox:install-squad', 'inbox:reject', 'inbox:request-skill', 'inbox:mark-seen']) {
    assert.ok(pre.includes("'" + ch + "'") && sec.includes("ipcMain.handle('" + ch + "'"), ch);
  }
  assert.ok(/ipcMain\.handle\('inbox:detail', async \(e, kind, slug\) => \{\n  if \(!fromMain\(e\)\) return null;/.test(sec) && /ipcMain\.handle\('inbox:mark-seen', \(e\) => \{\n  if \(!fromMain\(e\)\)/.test(sec));
  assert.ok(/async function inboxAction\(e, fn\) \{\n  if \(!fromMain\(e\)/.test(sec));
  for (const ch of ['inbox:install-squad', 'inbox:reject', 'inbox:request-skill']) assert.ok(new RegExp("ipcMain\\.handle\\('" + ch + "', \\(e, [^)]*\\) => inboxAction\\(e,").test(sec), ch);
  assert.ok(/-I', script, \.\.\.args\]/.test(sec) && /timeout: 8000, maxBuffer: 128 \* 1024/.test(sec) && !/shell:|execSync|exec\(.*`/.test(sec)); // 고정 argv·셸 없음·python -I·시간·출력 상한
  assert.ok(/squadsQueue = p\.then/.test(sec)); // 한 번에 하나
  assert.ok(/const currentApproval = \(kind, slug\) =>[\s\S]*L\.validProposalSlug\(kind, slug\)[\s\S]*L\.listProposals/.test(sec)); // 형식 검사 + main 의 현재 목록과 대조
  assert.strictEqual((sec.match(/confirmBox\(/g) || []).length, 3); // 설치·거절·설치 요청 각각 네이티브 확인
  assert.ok(/'--expect-digest', c\.digest/.test(sec) && !/--replace|--ack-warnings/.test(sec.replace(/\/\/.*$/gm, ''))); // 앱은 덮어쓰기·경고 승인을 쓰지 않는다
  assert.ok(/c\.risks\.length\) return \{ ok: false, reason: 'risky'/.test(sec) && /c\.existsPersonal\) return \{ ok: false, reason: 'exists'/.test(sec));
  assert.ok(!/\.claude|skills'\)|copyFile|cpSync/.test(sec.replace(/\/\/.*$/gm, '')), '앱이 스킬 폴더에 쓰지 않는다');
  assert.ok(/L\.skillRequestText\(tr, slug\)/.test(sec) && /writePrompt\(w, text\)/.test(sec) && !/writePrompt\([^)]*(description|name|sections)/.test(sec));
  const ui = rd.split('// ---- 알림과 승인함 ----')[1].split('// ---- 프로젝트: 왼쪽 목록')[0];
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(ui)); // 제안·로그 문자열은 textContent 로만
  assert.ok(/body\.mod \.kbd\{display:inline-block\}/.test(css) && /\.kbd\{display:none;/.test(css)); // ⌘ 힌트는 ⌘ 를 누르는 동안만
  assert.ok(/classList\.toggle\('mod', on\)/.test(rd) && /'blur', \(\) => setMod\(false\)/.test(rd));
  assert.ok(/id="inbox-badge"/.test(html) && !/id="briefing"/.test(html) && /id="inbox-detail"/.test(html));
  for (const k of ['inbox.title', 'inbox.sec.approvals', 'inbox.sec.notifs', 'inbox.approvals.empty', 'inbox.notifs.empty', 'inbox.act.view', 'inbox.act.install', 'inbox.act.request', 'inbox.act.reject', 'inbox.skillRequest', 'dlg.sqInstall.title', 'dlg.sqInstall.detail', 'dlg.reject.title', 'dlg.reject.detail.squad', 'dlg.reject.detail.skill', 'dlg.skRequest.title', 'dlg.skRequest.detail', 'inbox.err.risky', 'inbox.err.exists', 'inbox.err.changed', 'inbox.ago.min', 'inbox.ago.hour', 'inbox.ago.day', 'inbox.ago.now', 'inbox.members']) for (const lg of I.LANGS) assert.ok(I.STR[lg][k], lg + ':' + k);
  for (const lg of I.LANGS) assert.ok(I.t(lg, 'dlg.sqInstall.detail', { slug: 'x', n: 2, roster: 'lead (sonnet): Agent, Read' }).includes('lead (sonnet): Agent, Read'));
  assert.ok(/MARU_APP_UI/.test(main) && /\[[^\]]*'memgraph'[^\]]*\]\.includes\(process\.env\.MARU_APP_UI\)/.test(main) && /TEST_UI === 'inbox'\) return \{ ok: false, reason: 'invalid' \}/.test(sec)); // 시험 모드는 동작을 하지 않는다
});
t('inbox: parseSquadCheck 는 existsBuiltin 을 그대로 싣고 형식을 요구한다', () => {
  assert.strictEqual(L.parseSquadCheck(sqCheck({ existsBuiltin: true }), 'team').existsBuiltin, true);
  assert.strictEqual(L.parseSquadCheck(sqCheck({ existsBuiltin: false }), 'team').existsBuiltin, false);
  assert.strictEqual(L.parseSquadCheck(sqCheck({ existsBuiltin: 'yes' }), 'team'), null);
});
// ---- 기억 보기(읽기 전용) ----
const mfile = (name, extra, body) => '---\nname: ' + name + '\ndescription: "설명 ' + name + '"\nmetadata:\n  type: ' + (extra.type || 'project') + '\n' + (extra.tags ? '  tags: [' + extra.tags + ']\n' : '') + '---\n' + (body || '');
t('parseMemoryFile: 정상·종류·태그·링크(중복·대소문자)·날짜', () => {
  const f = L.parseMemoryFile(mfile('Alpha', { type: 'feedback', tags: 'one, "two", bad tag!, one' }, 'x [[beta]] y [[Beta|별칭]] [[gamma#h]] [[beta]]'), 'alpha', 1700000000000);
  assert.strictEqual(f.name, 'Alpha'); assert.strictEqual(f.type, 'feedback'); assert.strictEqual(f.description, '설명 Alpha');
  assert.deepStrictEqual(f.tags, ['one', 'two']); assert.deepStrictEqual(f.links, ['beta', 'gamma']); assert.strictEqual(f.modified, 1700000000000);
});
t('parseMemoryFile: 깨진 frontmatter·잘못된 종류·이름 없음', () => {
  assert.strictEqual(L.parseMemoryFile('name: x\n', 'a', 0), null); // --- 없음
  assert.strictEqual(L.parseMemoryFile('---\nname: x\nno close', 'a', 0), null); // 닫히지 않음
  assert.strictEqual(L.parseMemoryFile('---\nname: x\n---\n', 'Bad Slug', 0), null);
  assert.strictEqual(L.parseMemoryFile(42, 'a', 0), null);
  const f = L.parseMemoryFile('---\ndescription: d\nmetadata:\n  type: weird\n  tags:\n    - a\n    - b\n---\nbody', 'no-name', NaN);
  assert.strictEqual(f.name, 'no-name'); assert.strictEqual(f.type, 'reference'); assert.deepStrictEqual(f.tags, ['a', 'b']); assert.strictEqual(f.modified, 0);
});
t('parseMemoryFile: 제어·bidi 제거와 길이 상한', () => {
  const f = L.parseMemoryFile('---\nname: "N‮am\u0007e' + 'x'.repeat(200) + '"\n---\nline​1\x1b[31m\n' + 'y'.repeat(9000), 'a', 1);
  assert.ok(!/[‮\u0007​\u001b]/.test(f.name + f.body)); assert.ok([...f.name].length <= 80); assert.ok([...f.body].length <= 6000);
  assert.ok(f.body.startsWith('line1'));
  const many = '---\nname: n\n---\n' + Array.from({ length: 100 }, (_, i) => '[[t' + i + ']]').join(' ');
  assert.strictEqual(L.parseMemoryFile(many, 'n', 1).links.length, 40);
});
const mk = (slug, name, tags, links) => ({ slug, name, description: '', type: 'user', tags, body: '', links, modified: 1 });
t('buildMemoryModel: 없는 대상·자기 링크·중복 제거, 들어오는 링크', () => {
  const m = L.buildMemoryModel([mk('a', 'Alpha', [], ['b', 'a', 'zzz', 'b', 'gamma name']), mk('b', 'Beta', [], ['a']), mk('c', 'Gamma Name', [], [])]);
  assert.deepStrictEqual(m[0].out, ['m1', 'm2']); assert.deepStrictEqual(m[0].in, ['m1']); assert.deepStrictEqual(m[1].in, ['m0']); assert.deepStrictEqual(m[2].in, ['m0']);
  assert.strictEqual(m[1].id, 'm1');
});
ta('readMemoryFiles: 심볼릭 링크·큰 파일·MEMORY.md·개수·합계 상한(비동기)', async () => {
  const d = path.join(tmp, 'memv'); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'ok-one.md'), mfile('One', {}, 'body')); fs.writeFileSync(path.join(d, 'MEMORY.md'), '- index');
  fs.writeFileSync(path.join(d, 'big.md'), mfile('Big', {}, 'z'.repeat(70000)));
  fs.writeFileSync(path.join(tmp, 'outside.md'), mfile('Out', {})); fs.symlinkSync(path.join(tmp, 'outside.md'), path.join(d, 'link.md'));
  fs.writeFileSync(path.join(d, 'no-fm.md'), 'just text');
  const p0 = L.readMemoryFiles(d); assert.ok(p0 && typeof p0.then === 'function'); // 비동기
  const r = await p0;
  assert.deepStrictEqual(r.items.map((x) => x.name), ['One']); assert.strictEqual(r.skipped, 3); assert.ok(r.items[0].modified > 0);
  fs.writeFileSync(path.join(d, 'ok-two.md'), mfile('Two', {})); fs.writeFileSync(path.join(d, 'ok-three.md'), mfile('Three', {}));
  assert.strictEqual((await L.readMemoryFiles(d, { files: 2 })).items.length, 2);
  assert.strictEqual((await L.readMemoryFiles(d, { totalBytes: 120 })).items.length, 1);
  const dl = path.join(tmp, 'memv-link'); fs.symlinkSync(d, dl);
  assert.deepStrictEqual(await L.readMemoryFiles(dl), { items: [], skipped: 0 }); // 폴더 링크는 따라가지 않는다
  assert.deepStrictEqual(await L.readMemoryFiles(path.join(tmp, 'none')), { items: [], skipped: 0 });
  assert.strictEqual(L.MEMV_FILES_MAX, 500);
});
ta('readMemoryFiles: 하드링크·위 폴더 링크·이름 규칙·폴더 훑기 상한', async () => {
  const real = path.join(tmp, 'memv2-real'); const d = path.join(real, 'memory'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'solo.md'), mfile('Solo', {})); fs.writeFileSync(path.join(tmp, 'hl-src.md'), mfile('Hard', {}));
  fs.linkSync(path.join(tmp, 'hl-src.md'), path.join(d, 'hard.md')); // nlink 2
  fs.writeFileSync(path.join(d, 'Bad Name.md'), mfile('Bad', {})); fs.writeFileSync(path.join(d, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(d, 'under_score.md'), mfile('Under', {}));
  const r = await L.readMemoryFiles(d);
  assert.deepStrictEqual(r.items.map((x) => x.name).sort(), ['Solo', 'Under']); assert.strictEqual(r.skipped, 2); // hard.md, Bad Name.md (notes.txt 는 세지 않는다)
  assert.deepStrictEqual(L.readMemoryMetas(d).map((x) => x.name).sort(), ['Solo', 'Under']); // 옛 읽기도 같은 이름 규칙·하드링크 거부
  const plink = path.join(tmp, 'memv2-plink'); fs.symlinkSync(real, plink); // 프로젝트 폴더가 링크
  assert.deepStrictEqual(await L.readMemoryFiles(path.join(plink, 'memory')), { items: [], skipped: 0 });
  assert.deepStrictEqual(L.readMemoryMetas(path.join(plink, 'memory')), []);
  const lim = await L.readMemoryFiles(d, { scanMax: 2 }); assert.ok(lim.items.length <= 2 && lim.skipped >= 1); // 훑기 상한을 넘으면 건너뜀으로 센다
  assert.ok(L.MEM_FILE_RE.test('a_b-c.md') && !L.MEM_FILE_RE.test('A.md') && !L.MEM_FILE_RE.test('_a.md') && !L.MEM_FILE_RE.test('a'.repeat(81) + '.md'));
});
const SP = ' '.repeat(60000);
t('기억 파싱: 공백 6만 개 줄에서도 선형(ReDoS 회귀)', () => {
  const body = '---\nname: A' + SP + 'b\ndescription:' + SP + 'd\nmetadata:\n  tags:' + SP + '\n  - ' + SP + 'x\n  type:' + SP + 'user\n---\n' + SP + 'tail' + SP + '\n[[a]]' + SP;
  let t0 = process.hrtime.bigint(); const f = L.parseMemoryFile(body, 'a', 1); let ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(f && ms < 50, 'parseMemoryFile ' + ms); console.log('     60k 공백 줄 parseMemoryFile: ' + ms.toFixed(2) + 'ms');
  t0 = process.hrtime.bigint(); const m = L.parseMemoryMeta(body); ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(m && ms < 50, 'parseMemoryMeta ' + ms); console.log('     60k 공백 줄 parseMemoryMeta: ' + ms.toFixed(2) + 'ms');
  for (const bad of ['---\nname:' + SP + '\n---\n', '---\n' + SP + 'x\n---\n', '---\n- ' + SP + '\n---' + SP]) {
    t0 = process.hrtime.bigint(); L.parseMemoryFile(bad, 'a', 1); L.parseMemoryMeta(bad); assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 50);
  }
  assert.ok([...f.name].length <= 80 && f.name.startsWith('A'));
});
t('기억 파싱: CRLF·BOM·단독 CR·중복 tags·__proto__ 태그', () => {
  const crlf = L.parseMemoryFile('---\r\nname: Win\r\ndescription: d\r\ntags: [x, y]\r\n---\r\nline1\r\nline2\r\n', 'w', 1);
  assert.strictEqual(crlf.name, 'Win'); assert.deepStrictEqual(crlf.tags, ['x', 'y']); assert.strictEqual(crlf.body, 'line1\nline2');
  const bom = L.parseMemoryFile('\uFEFF---\nname: Bom\n---\nb', 'b', 1); assert.strictEqual(bom.name, 'Bom');
  assert.strictEqual(L.parseMemoryMeta('\uFEFF---\nname: Bom\n---\nb').name, 'Bom');
  const cr = L.parseMemoryFile('---\rname: Old\rtags: [q]\r---\rbody here', 'c', 1); assert.strictEqual(cr.name, 'Old'); assert.deepStrictEqual(cr.tags, ['q']); assert.strictEqual(cr.body, 'body here');
  const dup = L.parseMemoryFile('---\nname: D\ntags: [a, b]\nmetadata:\n  tags: [b, c]\ntags:\n  - d\n---\n', 'd', 1);
  assert.deepStrictEqual(dup.tags, ['a', 'b', 'c', 'd']);
  const pr = L.parseMemoryFile('---\nname: P\ntags: [__proto__, constructor, toString]\n---\n', 'p', 1);
  assert.deepStrictEqual(pr.tags, ['__proto__', 'constructor', 'toString']);
  const q = L.parseMemoryFile('---\nname: Q\ntags: [__proto__]\n---\n', 'q', 1);
  const items = L.buildMemoryModel([pr, q]); const edges = L.buildMemoryGraph(items);
  assert.deepStrictEqual(edges.map((e) => e.tag), ['__proto__']); assert.deepStrictEqual(L.filterMemories(items, '', '__proto__'), ['m0', 'm1']);
  assert.strictEqual({}.polluted, undefined); assert.strictEqual(Object.getPrototypeOf(items[0].tags), Array.prototype);
});
t('기억 파싱: YAML 블록 스칼라(>, |)는 빈 값', () => {
  for (const mark of ['>', '|', '>-', '|+', '>2']) {
    const f = L.parseMemoryFile('---\nname: B\ndescription: ' + mark + '\n  folded text\n---\nx', 'b', 1);
    assert.strictEqual(f.description, '', mark);
    assert.strictEqual(L.parseMemoryMeta('---\nname: B\ndescription: ' + mark + '\n  folded\n---\n').description, '', mark);
  }
  assert.strictEqual(L.parseMemoryFile('---\nname: >\n---\n', 'slug-name', 1).name, 'slug-name'); // 이름이 블록 표지면 slug
  assert.strictEqual(L.parseMemoryFile('---\nname: B\ndescription: a > b\n---\n', 'b', 1).description, 'a > b'); // 일반 글자는 그대로
});
const gItems = () => L.buildMemoryModel([
  mk('a', 'A', ['t1', 'big'], ['b']), mk('b', 'B', ['t1'], ['a']), mk('c', 'C', ['t1', 'big'], ['a']), mk('d', 'D', ['big'], []),
  ...Array.from({ length: 10 }, (_, i) => mk('x' + i, 'X' + i, ['big', 'solo'], [])),
]);
t('buildMemoryGraph: 양방향 링크는 선 하나, 링크가 있는 쌍은 태그 선 없음, 큰 태그는 선 없음', () => {
  const it = gItems(); const e = L.buildMemoryGraph(it);
  assert.strictEqual(e.filter((x) => x.kind === 'link').length, 2); // a-b(양방향 하나), c-a
  const tagE = e.filter((x) => x.kind === 'tag');
  assert.ok(tagE.every((x) => x.tag === 't1')); // 'big'(13명)·'solo'(10명)는 상한을 넘어 선이 없다. t1 의 a-b 는 링크가 이미 있다
  assert.deepStrictEqual(tagE.map((x) => [x.a, x.b]), [[1, 2]]);
  assert.ok(e.every((x) => x.a < x.b)); assert.strictEqual(new Set(e.map((x) => x.a + ',' + x.b)).size, e.length);
});
t('buildMemoryGraph: 전체·태그 선 상한', () => {
  const many = L.buildMemoryModel(Array.from({ length: 60 }, (_, i) => mk('n' + i, 'N' + i, ['g' + (i % 30)], [])));
  assert.strictEqual(L.buildMemoryGraph(many, { tagEdgesMax: 5 }).length, 5);
  assert.strictEqual(L.buildMemoryGraph(many, { edgesMax: 3 }).length, 3);
});
t('layoutGraph: 같은 입력이면 같은 좌표, 유한수, 범위 안', () => {
  const it = gItems(); const e = L.buildMemoryGraph(it);
  const a = L.layoutGraph(it.length, e, { width: 800, height: 500, pad: 30 }); const b = L.layoutGraph(it.length, e, { width: 800, height: 500, pad: 30 });
  assert.deepStrictEqual(a, b); assert.strictEqual(a.length, it.length);
  for (const p of a) { assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)); assert.ok(p.x >= 30 && p.x <= 770 && p.y >= 30 && p.y <= 470); }
  assert.notDeepStrictEqual(L.layoutGraph(it.length, e, { seed: 7 }), L.layoutGraph(it.length, e, { seed: 8 }));
  assert.deepStrictEqual(L.layoutGraph(0, []), []); assert.deepStrictEqual(L.layoutGraph(1, []), [{ x: 500, y: 350 }]);
  const big = Array.from({ length: 300 }, (_, i) => ({ id: 'm' + i, tags: [], out: i ? ['m' + (i >> 1)] : [] }));
  const t0 = Date.now(); const pb = L.layoutGraph(300, L.buildMemoryGraph(big)); assert.ok(Date.now() - t0 < 800, '300 nodes ' + (Date.now() - t0) + 'ms'); assert.ok(pb.every((p) => Number.isFinite(p.x)));
});
const spread = (n, tree) => L.buildMemoryModel(Array.from({ length: n }, (_, i) => ({ ...mk('n' + i, 'N' + i, ['g' + (i % 6), 'g' + ((i * 5) % 6)], tree ? (i ? ['n' + (i >> 1)] : []) : (i % 3 === 0 && i + 1 < n ? ['n' + (i + 1)] : [])) })));
t('layoutGraph: 칸을 채운다(1000x500·1000x1500, 25·120개: 두 축 모두 75% 이상)', () => {
  for (const [W, H] of [[1000, 500], [1000, 1500]]) for (const n of [25, 120]) for (const tree of [true, false]) {
    const it = spread(n, tree); const p = L.layoutGraph(n, L.buildMemoryGraph(it), { width: W, height: H });
    const xs = p.map((q) => q.x); const ys = p.map((q) => q.y);
    const cx = (Math.max(...xs) - Math.min(...xs)) / W; const cy = (Math.max(...ys) - Math.min(...ys)) / H;
    assert.ok(cx >= 0.75 && cy >= 0.75, W + 'x' + H + ' n=' + n + ' cover ' + cx.toFixed(2) + ',' + cy.toFixed(2));
    assert.deepStrictEqual(p, L.layoutGraph(n, L.buildMemoryGraph(it), { width: W, height: H })); // 결정적
  }
});
t('simulateGraph/fitGraph: 크기가 바뀌어도 원시 좌표는 그대로, 맞추기만 다시, 일그러짐 비 상한', () => {
  const it = spread(30, true); const e = L.buildMemoryGraph(it);
  const raw = L.simulateGraph(30, e, { width: 1000, height: 600 }); const copy = JSON.parse(JSON.stringify(raw));
  const f1 = L.fitGraph(raw, { width: 1000, height: 600 }); const f2 = L.fitGraph(raw, { width: 1000, height: 1400 });
  assert.deepStrictEqual(raw, copy); assert.notDeepStrictEqual(f1, f2); assert.deepStrictEqual(L.fitGraph(raw, { width: 1000, height: 600 }), f1);
  const sc = (f, a, b) => Math.abs(f[a].x - f[b].x) > 1e-9 && Math.abs(f[a].y - f[b].y) > 1e-9 ? Math.abs((f[a].x - f[b].x) / (raw[a].x - raw[b].x)) / Math.abs((f[a].y - f[b].y) / (raw[a].y - raw[b].y)) : 1;
  for (const [a, b] of [[0, 5], [1, 20], [3, 29]]) for (const f of [f1, f2]) { const r = sc(f, a, b); assert.ok(r <= 2.5001 && r >= 1 / 2.5001 || f.some((q) => q.x <= 40.01 || q.x >= 959.99 || q.y <= 40.01), 'ratio ' + r); }
  assert.strictEqual(L.layoutGraph(30, e, { width: 1000, height: 600 }).length, 30);
});
t('layoutGraph: 노드 2~3개는 양 끝 가장자리로 날아가지 않는다', () => {
  for (const n of [2, 3]) {
    const p = L.layoutGraph(n, n === 2 ? [{ a: 0, b: 1, kind: 'link' }] : [{ a: 0, b: 1, kind: 'link' }, { a: 1, b: 2, kind: 'link' }], { width: 1000, height: 500, pad: 40 });
    const xs = p.map((q) => q.x); const ys = p.map((q) => q.y);
    assert.ok(Math.max(...xs) - Math.min(...xs) <= 0.5 * 920 + 1e-6 && Math.max(...ys) - Math.min(...ys) <= 0.5 * 420 + 1e-6);
    assert.ok(p.every((q) => q.x > 200 && q.x < 800));
  }
});
t('filterMemories: 이름·설명·태그·본문, 대소문자 무시, 태그 필터', () => {
  const it = L.buildMemoryModel([{ ...mk('a', 'Apple Pie', ['fruit'], []), description: 'Sweet', body: 'bake slowly' }, { ...mk('b', 'Beta', ['Veg'], []), body: 'RAW carrots' }]);
  assert.deepStrictEqual(L.filterMemories(it, ''), ['m0', 'm1']); assert.deepStrictEqual(L.filterMemories(it, 'apple'), ['m0']);
  assert.deepStrictEqual(L.filterMemories(it, 'SWEET'), ['m0']); assert.deepStrictEqual(L.filterMemories(it, 'veg'), ['m1']);
  assert.deepStrictEqual(L.filterMemories(it, 'carrots'), ['m1']); assert.deepStrictEqual(L.filterMemories(it, 'nothing'), []);
  assert.deepStrictEqual(L.filterMemories(it, '', 'VEG'), ['m1']); assert.deepStrictEqual(L.filterMemories(it, 'apple', 'veg'), []);
  assert.deepStrictEqual(L.filterMemories(null, 'x'), []);
});
t('기억 보기 IPC 는 보낸 창을 확인하고 렌더러는 innerHTML 을 쓰지 않는다', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const mv = fs.readFileSync(path.join(__dirname, 'renderer', 'memview.js'), 'utf8');
  assert.ok(/ipcMain\.handle\('memories:list', \(e\) => \{\s*if \(!fromMain\(e\)\) return null;/.test(main));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(mv));
});
t('memview.js 정적 검사: HTML 문자열·href·자료로 만든 style 없음', () => {
  const mv = fs.readFileSync(path.join(__dirname, 'renderer', 'memview.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(mv));
  assert.ok(!/setAttribute\(\s*['"](xlink:)?href|xlink:href|\.href\s*=|\.src\s*=/.test(mv));
  assert.ok(!/setAttribute\(\s*['"]style|cssText|style\s*=/.test(mv.replace(/\.style\.(left|top)\s*=/g, ''))); // 쓰는 style 은 계산한 좌표(숫자)뿐
  assert.ok(!/\.style\.(?!left|top)/.test(mv));
  assert.ok(!/mv-hull-o/.test(mv) && !/mv-hull-o/.test(fs.readFileSync(path.join(__dirname, 'renderer', 'style.css'), 'utf8')));
});
t('기억 보기: 접근성·Esc·검색 최적화·캐시 정적 검사', () => {
  const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8'); const mv = fs.readFileSync(path.join(__dirname, 'renderer', 'memview.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8'); const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.ok(!/role="list"/.test(html.split('id="mem-view"')[1].split('</section>')[0]) && !/'listitem'/.test(mv)); // 목록 역할 + h3 / button listitem 구조를 쓰지 않는다
  assert.ok(/id="mv-hint"/.test(html) && /T\('mem\.graph\.hint'\)/.test(mv));
  assert.ok(/memView\.clearSearch\(\)/.test(rd) && /document\.activeElement === \$\('mv-q'\)/.test(rd));
  assert.ok(/setTag\(''\)/.test(mv.split('function select(')[1].split('function setTag')[0])); // 링크로 이동해 필터를 풀 때 태그 <select> 도 되돌린다
  assert.ok(/SEARCH_DEBOUNCE_MS/.test(mv) && /Lib\.memorySearchText/.test(mv) && /Lib\.filterMemories\(items, query, tag, texts\)/.test(mv));
  assert.ok(/Lib\.fitGraph\(graph\.raw/.test(mv) && !/simulateGraph/.test(mv.split('function refit')[1].split('function setMode')[0]));
  assert.ok(/L\.MEMV_CACHE_TTL_MS/.test(main) && L.MEMV_CACHE_TTL_MS >= 20000);
});
t('기억 보기 문구: ko/en 키·형식 일치, 중복 키 없음, 쓰는 키는 모두 있음', () => {
  const keys = (lg) => Object.keys(I.STR[lg]).filter((k) => k.startsWith('mem.')).sort();
  assert.deepStrictEqual(keys('ko'), keys('en'));
  const ph = (v) => [...new Set([].concat(v).join(' ').match(/\{\w+\}/g) || [])].sort().join(','); // 자리표시자({n} 등)가 두 언어에서 같아야 한다(ko 는 복수형 배열이 없어도 된다)
  for (const k of keys('ko')) assert.strictEqual(ph(I.STR.ko[k]), ph(I.STR.en[k]), k);
  const src = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8'); const secs = src.split(/^const en = \{/m);
  for (const sec of secs) { const ks = [...sec.matchAll(/'(mem\.[\w.]+)':/g)].map((m) => m[1]); assert.strictEqual(new Set(ks).size, ks.length, 'duplicate: ' + ks.filter((k, i) => ks.indexOf(k) !== i)); }
  const used = new Set();
  for (const f of ['memview.js', 'renderer.js', 'index.html']) { const txt = fs.readFileSync(path.join(__dirname, 'renderer', f), 'utf8'); for (const m of txt.matchAll(/(?:T\(|data-i18n(?:-aria)?=")'?(mem\.[\w.]+)/g)) used.add(m[1]); }
  used.delete('mem.type.'); used.delete('mem.journal.'); // 동적으로 이어 붙이는 접두사는 위에서 따로 더했다
  for (const k of used) for (const lg of I.LANGS) assert.ok(I.STR[lg][k] !== undefined, lg + ' ' + k);
});

// ---- 관리형 홈·첫 설정·첫 만남 ----
t('resolveRoot: managed 후보는 ~/maru 뒤, 소스 이름 managed', () => {
  const good = new Set(['/h/maru', '/h/.maru', '/m/x']);
  const mk = (o) => L.resolveRoot({ env: {}, home: '/h', isPackaged: true, appDir: '/app/app', io: { readConfig: () => null, isRepo: (d) => good.has(d) }, ...o });
  assert.deepStrictEqual(mk({}), { root: '/h/maru', source: 'home' }); // 기존 사용자 우선
  good.delete('/h/maru');
  assert.deepStrictEqual(mk({}), { root: '/h/.maru', source: 'managed' });
  assert.deepStrictEqual(mk({ managedHome: '/m/x' }), { root: '/m/x', source: 'managed' });
  assert.strictEqual(mk({ io: { readConfig: () => null, isRepo: () => false } }), null);
  assert.deepStrictEqual(mk({ env: { MARU_HOME: '/m/x' } }), { root: '/m/x', source: 'env' }); // env 가 managed 보다 먼저
});
const mkPayload = (extra) => {
  const d = fs.mkdtempSync(path.join(tmp, 'pl-'));
  const w = (rel, txt, mode) => { const f = path.join(d, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt, { mode: mode || 0o644 }); fs.chmodSync(f, mode || 0o644); };
  w('VERSION', '1.2.3\n'); w('CLAUDE.md', '한국어 지침'); w('CLAUDE.en.md', 'english rules');
  w('scripts/maru-status.sh', '#!/bin/bash\n', 0o775); w('scripts/lib.sh', 'x'); w('prompts/a.txt', 'a'); w('.claude/settings.json', '{}');
  if (extra) extra(w, d);
  return { d, w };
};
const newHome = () => path.join(fs.mkdtempSync(path.join(tmp, 'hm-')), '.maru');
const rd = (home, rel) => fs.readFileSync(path.join(home, rel), 'utf8');
t('syncPayload: 새로 만들기(모드·실행 비트·마커·CLAUDE.md 언어)', () => {
  const { d } = mkPayload(); const home = newHome();
  const r = L.syncPayload({ payloadDir: d, home, lang: 'ko' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.version, '1.2.3');
  assert.strictEqual(fs.statSync(home).mode & 0o777, 0o700);
  assert.strictEqual(rd(home, 'CLAUDE.md'), '한국어 지침');
  assert.ok(!fs.existsSync(path.join(home, 'CLAUDE.en.md')));
  assert.strictEqual(fs.statSync(path.join(home, 'scripts/maru-status.sh')).mode & 0o777, 0o755);
  assert.strictEqual(fs.statSync(path.join(home, 'scripts/lib.sh')).mode & 0o777, 0o644);
  const mk = L.readMarker(home);
  assert.strictEqual(mk.version, '1.2.3'); assert.strictEqual(mk.lang, 'ko');
  assert.ok(mk.manifest.includes('scripts/lib.sh') && mk.manifest.includes('CLAUDE.md') && mk.manifest.includes('VERSION'));
  assert.ok(!mk.manifest.some((p) => p.startsWith('data/')));
  assert.strictEqual(fs.statSync(path.join(home, L.MANAGED_MARKER)).mode & 0o022, 0);
  assert.deepStrictEqual(fs.readdirSync(home).filter((n) => n.endsWith('.tmp')), []);
});
t('syncPayload: 업데이트(없어진 파일 제거, data/ 와 settings.local.json 은 그대로, 언어 전환)', () => {
  const { d } = mkPayload(); const home = newHome();
  assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).ok, true);
  fs.mkdirSync(path.join(home, 'data'), { recursive: true }); fs.writeFileSync(path.join(home, 'data', 'mine.txt'), 'private');
  fs.writeFileSync(path.join(home, '.claude', 'settings.local.json'), '{"x":1}');
  fs.writeFileSync(path.join(home, 'user-note.txt'), 'u'); // 매니페스트에 없는 사용자 파일
  fs.rmSync(path.join(d, 'prompts'), { recursive: true }); fs.writeFileSync(path.join(d, 'VERSION'), '1.3.0\n');
  const r = L.syncPayload({ payloadDir: d, home, lang: 'en' });
  assert.strictEqual(r.ok, true); assert.ok(r.removed >= 1);
  assert.ok(!fs.existsSync(path.join(home, 'prompts', 'a.txt')) && !fs.existsSync(path.join(home, 'prompts')));
  assert.strictEqual(rd(home, 'data/mine.txt'), 'private'); assert.strictEqual(rd(home, '.claude/settings.local.json'), '{"x":1}'); assert.strictEqual(rd(home, 'user-note.txt'), 'u');
  assert.strictEqual(rd(home, 'CLAUDE.md'), 'english rules');
  assert.strictEqual(L.readMarker(home).version, '1.3.0'); assert.strictEqual(L.readMarker(home).lang, 'en');
  const s = L.syncClaudeMd({ payloadDir: d, home, lang: 'ko' });
  assert.strictEqual(s.ok, true); assert.strictEqual(rd(home, 'CLAUDE.md'), '한국어 지침'); assert.strictEqual(L.readMarker(home).lang, 'ko'); assert.strictEqual(L.readMarker(home).version, '1.3.0');
});
t('syncPayload: en 인데 CLAUDE.en.md 가 없으면 CLAUDE.md 로 대체', () => {
  const { d } = mkPayload(); fs.unlinkSync(path.join(d, 'CLAUDE.en.md'));
  const home = newHome(); const r = L.syncPayload({ payloadDir: d, home, lang: 'en' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.claudeFallback, true); assert.strictEqual(rd(home, 'CLAUDE.md'), '한국어 지침');
});
t('syncPayload: 마커 없는 비어 있지 않은 폴더·심볼릭 홈·넓은 권한은 거부(아무것도 쓰지 않음)', () => {
  const { d } = mkPayload();
  const h1 = newHome(); fs.mkdirSync(h1, { mode: 0o700 }); fs.writeFileSync(path.join(h1, 'foreign.txt'), 'x');
  assert.deepStrictEqual(L.syncPayload({ payloadDir: d, home: h1, lang: 'ko' }), { ok: false, reason: 'not-managed' });
  assert.deepStrictEqual(fs.readdirSync(h1), ['foreign.txt']);
  const h2 = newHome(); fs.mkdirSync(path.dirname(h2), { recursive: true }); const target = fs.mkdtempSync(path.join(tmp, 'tg-')); fs.symlinkSync(target, h2);
  assert.strictEqual(L.syncPayload({ payloadDir: d, home: h2, lang: 'ko' }).reason, 'home-symlink'); assert.deepStrictEqual(fs.readdirSync(target), []);
  const h3 = newHome(); fs.mkdirSync(h3, { mode: 0o700 }); fs.chmodSync(h3, 0o777);
  assert.strictEqual(L.syncPayload({ payloadDir: d, home: h3, lang: 'ko' }).reason, 'home-mode');
  const h4 = newHome(); fs.mkdirSync(h4, { mode: 0o700 });
  assert.strictEqual(L.syncPayload({ payloadDir: d, home: h4, lang: 'ko', io: { fs, uid: process.getuid() + 1 } }).reason, 'home-owner');
  assert.strictEqual(L.syncClaudeMd({ payloadDir: d, home: h1, lang: 'en' }).reason, 'not-managed'); // 마커 없는 홈에는 CLAUDE.md 만도 쓰지 않는다
  assert.strictEqual(L.syncPayload({ payloadDir: d, home: 'relative', lang: 'ko' }).reason, 'args');
  assert.strictEqual(L.syncPayload({ payloadDir: path.join(tmp, 'nope'), home: newHome(), lang: 'ko' }).reason, 'payload-missing');
  const empty = newHome(); fs.mkdirSync(empty, { mode: 0o700 }); assert.strictEqual(L.syncPayload({ payloadDir: d, home: empty, lang: 'ko' }).ok, true); // 빈 폴더는 채택
});
t('syncPayload: payload 안 심볼릭 링크 거부, 홈 안 링크(목적지·중간 폴더)는 쓰지 않고 거부', () => {
  const { d } = mkPayload((w, dir) => fs.symlinkSync('/etc/hosts', path.join(dir, 'scripts', 'evil')));
  const home = newHome();
  assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).reason, 'payload-symlink'); assert.ok(!fs.existsSync(home));
  const { d: d2 } = mkPayload(); const h2 = newHome();
  assert.strictEqual(L.syncPayload({ payloadDir: d2, home: h2, lang: 'ko' }).ok, true);
  const outside = path.join(tmp, 'outside.txt'); fs.writeFileSync(outside, 'keep');
  fs.unlinkSync(path.join(h2, 'scripts/lib.sh')); fs.symlinkSync(outside, path.join(h2, 'scripts/lib.sh')); // 목적지에 심은 링크
  assert.strictEqual(L.syncPayload({ payloadDir: d2, home: h2, lang: 'ko' }).reason, 'dest-symlink');
  assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'keep'); assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'keep');
  const h3 = newHome(); L.syncPayload({ payloadDir: d2, home: h3, lang: 'ko' });
  const outDir = fs.mkdtempSync(path.join(tmp, 'od-'));
  fs.rmSync(path.join(h3, 'prompts'), { recursive: true }); fs.symlinkSync(outDir, path.join(h3, 'prompts')); // 중간 폴더가 링크
  assert.strictEqual(L.syncPayload({ payloadDir: d2, home: h3, lang: 'ko' }).reason, 'dest-symlink'); assert.deepStrictEqual(fs.readdirSync(outDir), []);
});
t('syncPayload: payload 에 data/·.git 이 있어도 복사하지 않는다', () => {
  const { d } = mkPayload((w) => { w('data/secret.txt', 's'); w('.git/config', 'g'); });
  const home = newHome(); assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).ok, true);
  assert.ok(!fs.existsSync(path.join(home, 'data')) && !fs.existsSync(path.join(home, '.git')));
});
t('매니페스트 경로 검증: ../x·절대경로·data/·마커는 무시, 이전 매니페스트가 오염돼도 밖은 지우지 않는다', () => {
  for (const bad of ['../x', '/etc/passwd', 'a/../../x', 'data/x', 'data', '.claude/settings.local.json', L.MANAGED_MARKER, '', 'a//b', './a', 'a\\b', 'a\0b', 5, null, '.git/config']) assert.strictEqual(L.safeManifestPath(bad), null, String(bad));
  assert.strictEqual(L.safeManifestPath('scripts/a.sh'), 'scripts/a.sh');
  const { d } = mkPayload(); const home = newHome(); L.syncPayload({ payloadDir: d, home, lang: 'ko' });
  const victim = path.join(path.dirname(home), 'victim.txt'); fs.writeFileSync(victim, 'v'); fs.mkdirSync(path.join(home, 'data'), { recursive: true }); fs.writeFileSync(path.join(home, 'data', 'keep'), 'k');
  const mk = JSON.parse(fs.readFileSync(path.join(home, L.MANAGED_MARKER), 'utf8'));
  mk.manifest.push('../victim.txt', victim, 'data/keep', '.claude/settings.local.json');
  fs.writeFileSync(path.join(home, L.MANAGED_MARKER), JSON.stringify(mk));
  assert.ok(!L.readMarker(home).manifest.some((p) => p.includes('victim') || p.startsWith('data')));
  assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).ok, true);
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'v'); assert.strictEqual(rd(home, 'data/keep'), 'k');
  assert.strictEqual(L.parseMarker('x'.repeat(600000)), null); assert.strictEqual(L.parseMarker('{"version":3}'), null); assert.strictEqual(L.parseMarker('nope'), null);
});
t('동기화 실패: 새 홈은 생기지 않고(임시 폴더 정리) 재시도 가능, 기존 홈은 진행 중 표시가 남는다', () => {
  const { d } = mkPayload(); const home = newHome();
  const real = fs.renameSync; const calls = [];
  const failMarker = { fs: Object.assign(Object.create(fs), { renameSync: (x, y) => { calls.push(path.basename(y)); if (path.basename(y) === L.MANAGED_MARKER) throw new Error('boom'); return real(x, y); } }), uid: process.getuid() };
  const r = L.syncPayload({ payloadDir: d, home, lang: 'ko', io: failMarker });
  assert.deepStrictEqual([r.ok, r.reason], [false, 'marker']);
  assert.ok(!fs.existsSync(home)); assert.deepStrictEqual(fs.readdirSync(path.dirname(home)), []); // 홈도 임시 폴더도 남지 않는다
  assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).ok, true); // 곧바로 재시도 성공(not-managed 로 막히지 않는다)
  assert.strictEqual(L.readSyncing(home), false); assert.deepStrictEqual(fs.readdirSync(path.dirname(home)), [path.basename(home)]);
  // 기존 홈 갱신 중 마커 쓰기가 실패하면: 이전 마커 그대로 + 진행 중 표시
  fs.writeFileSync(path.join(d, 'VERSION'), '9.9.9\n'); calls.length = 0;
  const r2 = L.syncPayload({ payloadDir: d, home, lang: 'ko', io: failMarker });
  assert.deepStrictEqual([r2.ok, r2.reason], [false, 'marker']);
  assert.strictEqual(L.readMarker(home).version, '1.2.3'); assert.strictEqual(L.readSyncing(home), true);
  assert.strictEqual(L.managedAction(L.readMarker(home), '9.9.9', 'ko', L.readSyncing(home)), 'sync');
  assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).ok, true); // 재시도하면 표시가 사라진다
  assert.strictEqual(L.readSyncing(home), false); assert.strictEqual(L.readMarker(home).version, '9.9.9');
  assert.deepStrictEqual(fs.readdirSync(home).filter((n) => n.endsWith('.tmp')), []);
});
t('중간에 복사가 실패한 새 홈: 반쯤 만든 홈이 남지 않는다', () => {
  const { d } = mkPayload(); const home = newHome(); let n = 0;
  const io = { fs: Object.assign(Object.create(fs), { openSync: (f, ...rest) => { if (String(f).includes('lib.sh') && String(f).endsWith('.tmp')) throw new Error('disk'); return fs.openSync(f, ...rest); } }), uid: process.getuid() };
  assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko', io }).ok, false);
  assert.ok(!fs.existsSync(home)); assert.deepStrictEqual(fs.readdirSync(path.dirname(home)), []); n++;
  assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).ok, true);
});
t('cleanStaleTmp: 진행 중 표시가 있고 충분히 오래된 내 임시 폴더만 지운다', () => {
  const { d } = mkPayload(); const home = newHome(); fs.mkdirSync(path.dirname(home), { recursive: true });
  const mk = (suffix, withMarker, mode) => { const p = home + '.tmp-' + suffix; fs.mkdirSync(p, { mode: 0o700 }); if (withMarker) fs.writeFileSync(path.join(p, L.SYNC_MARKER), '{}'); return p; };
  const a1 = mk('0123456789', true); const a2 = mk('abcdefabcd', false);
  const tgt = fs.mkdtempSync(path.join(tmp, 'tl-')); fs.writeFileSync(path.join(tgt, L.SYNC_MARKER), '{}'); fs.symlinkSync(tgt, home + '.tmp-ffffffffff');
  assert.strictEqual(L.cleanStaleTmp(home, null), 0); assert.ok(fs.existsSync(a1)); // 방금 만든 것은 다른 동기화일 수 있어 둔다
  assert.strictEqual(L.cleanStaleTmp(home, null, 0), 1);
  assert.ok(!fs.existsSync(a1) && fs.existsSync(a2) && fs.existsSync(tgt) && fs.lstatSync(home + '.tmp-ffffffffff').isSymbolicLink());
  assert.ok(d);
});
t('managedAction: 버전 비교(숫자)·다운그레이드 금지·진행 중 재시도·언어', () => {
  const m = (v, lang) => ({ version: v, lang: lang || 'ko' });
  assert.strictEqual(L.managedAction(null, '1.0.0', 'ko', false), 'none');
  assert.strictEqual(L.managedAction(m('1.0.0'), null, 'ko', false), 'none');
  assert.strictEqual(L.managedAction(m('1.0.0'), '1.1.0', 'ko', false), 'sync');
  assert.strictEqual(L.managedAction(m('9.9.9'), '1.0.0', 'ko', false), 'newer');
  assert.strictEqual(L.managedAction(m('1.10.0'), '1.9.0', 'ko', false), 'newer'); // 문자열 비교가 아니라 숫자 비교
  assert.strictEqual(L.managedAction(m('1.9.0'), '1.10.0', 'ko', false), 'sync');
  assert.strictEqual(L.managedAction(m('2.0.0'), '2.0.0', 'ko', true), 'sync'); // 진행 중 표시가 남음
  assert.strictEqual(L.managedAction(m('3.0.0'), '2.0.0', 'ko', true), 'newer');
  assert.strictEqual(L.managedAction(m('2.0.0', 'ko'), '2.0.0', 'en', false), 'lang');
  assert.strictEqual(L.managedAction(m('2.0.0', 'ko'), '2.0.0', 'ko', false), 'none');
  assert.strictEqual(L.managedAction(m('2.0.0'), '2.0.0', null, false), 'none');
  assert.deepStrictEqual([L.cmpVersion('1.2', '1.2.0'), L.cmpVersion('2', '10'), L.cmpVersion('1.0.1', '1.0.0')], [0, -1, 1]);
  const { d } = mkPayload(); assert.strictEqual(L.readPayloadVersion(d), '1.2.3'); fs.writeFileSync(path.join(d, 'VERSION'), 'bad version!'); assert.strictEqual(L.readPayloadVersion(d), null);
});
t('S1 매니페스트: 대소문자·유니코드 별칭·링크 중간 폴더·보호 대상으로는 지우지 않는다', () => {
  for (const bad of ['Data/profile.json', 'DATA/x', '.Claude/settings.local.json', '.claude/Settings.Local.json', '.GIT/config', 'ſcripts/a', 'scripts/\u212Aa', 'a/b c', '.maru-managed', '.MARU-syncing']) assert.strictEqual(L.safeManifestPath(bad), null, bad);
  assert.strictEqual(L.safeManifestPath('.claude/skills/recall/SKILL.md'), '.claude/skills/recall/SKILL.md');
  const { d } = mkPayload(); const home = newHome(); assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).ok, true);
  const outside = fs.mkdtempSync(path.join(tmp, 'ov-')); fs.writeFileSync(path.join(outside, 'victim.txt'), 'v');
  fs.symlinkSync(outside, path.join(home, 'evil')); // 홈 안의 링크 폴더
  fs.mkdirSync(path.join(home, 'data'), { recursive: true }); fs.writeFileSync(path.join(home, 'data', 'profile.json'), 'p');
  fs.writeFileSync(path.join(home, '.claude', 'settings.local.json'), 'L');
  fs.mkdirSync(path.join(home, 'ghost')); fs.writeFileSync(path.join(home, 'ghost', 'hard.txt'), 'h'); fs.linkSync(path.join(home, 'ghost', 'hard.txt'), path.join(outside, 'hard2.txt')); // 링크 수 2
  fs.writeFileSync(path.join(home, 'scripts', 'plain-old.sh'), 'x');
  const mk = JSON.parse(fs.readFileSync(path.join(home, L.MANAGED_MARKER), 'utf8'));
  mk.manifest.push('Data/profile.json', '.Claude/settings.local.json', 'evil/victim.txt', 'ghost/hard.txt', 'scripts/plain-old.sh', 'data/profile.json', '.claude/settings.local.json');
  fs.writeFileSync(path.join(home, L.MANAGED_MARKER), JSON.stringify(mk));
  assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).ok, true);
  assert.strictEqual(fs.readFileSync(path.join(home, 'data', 'profile.json'), 'utf8'), 'p');
  assert.strictEqual(fs.readFileSync(path.join(home, '.claude', 'settings.local.json'), 'utf8'), 'L');
  assert.strictEqual(fs.readFileSync(path.join(outside, 'victim.txt'), 'utf8'), 'v');
  assert.strictEqual(fs.readFileSync(path.join(home, 'ghost', 'hard.txt'), 'utf8'), 'h'); // 하드링크는 지우지 않는다
  assert.ok(!fs.existsSync(path.join(home, 'scripts', 'plain-old.sh'))); // 정상적인 옛 파일은 지운다
  // 보호 대상과 같은 파일(ino)로 해석되는 경로는 이름이 달라도 지우지 않는다(대소문자를 가리지 않는 파일 시스템 별칭을 모사)
  const prot = path.join(home, 'alias'); fs.symlinkSync(path.join(home, 'data'), prot);
  const mk2 = JSON.parse(fs.readFileSync(path.join(home, L.MANAGED_MARKER), 'utf8')); mk2.manifest.push('alias/profile.json'); fs.writeFileSync(path.join(home, L.MANAGED_MARKER), JSON.stringify(mk2));
  assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).ok, true); assert.strictEqual(fs.readFileSync(path.join(home, 'data', 'profile.json'), 'utf8'), 'p');
});
t('L1 홈 0700 고정·하위 폴더의 그룹/타인 쓰기 제거', () => {
  const { d } = mkPayload(); const home = newHome(); L.syncPayload({ payloadDir: d, home, lang: 'ko' });
  fs.chmodSync(home, 0o755); fs.chmodSync(path.join(home, 'scripts'), 0o777);
  assert.strictEqual(L.syncPayload({ payloadDir: d, home, lang: 'ko' }).ok, true);
  assert.strictEqual(fs.statSync(home).mode & 0o777, 0o700); assert.strictEqual(fs.statSync(path.join(home, 'scripts')).mode & 0o022, 0);
  const e = newHome(); fs.mkdirSync(e, { mode: 0o700 }); fs.chmodSync(e, 0o770);
  assert.strictEqual(L.syncPayload({ payloadDir: d, home: e, lang: 'ko' }).reason, 'home-mode'); // 빈 폴더라도 권한이 넓으면 거부
});
t('homeStatus·resolveRoot isManaged: 마커 없는 ~/.maru·링크 ~/.maru 는 채택하지 않는다', () => {
  const { d } = mkPayload(); const home = newHome();
  assert.strictEqual(L.homeStatus(home), 'absent');
  fs.mkdirSync(home, { mode: 0o700 }); assert.strictEqual(L.homeStatus(home), 'empty'); fs.writeFileSync(path.join(home, 'x'), '1'); assert.strictEqual(L.homeStatus(home), 'foreign');
  const real = newHome(); L.syncPayload({ payloadDir: d, home: real, lang: 'ko' }); assert.strictEqual(L.homeStatus(real), 'managed');
  const lnk = newHome(); fs.mkdirSync(path.dirname(lnk), { recursive: true }); fs.symlinkSync(real, lnk); assert.strictEqual(L.homeStatus(lnk), 'symlink');
  const isRepo = (dd) => fs.existsSync(path.join(dd, 'scripts', 'maru-status.sh'));
  const mk = (dir) => L.resolveRoot({ env: {}, home: '/nonexistent-home', isPackaged: true, appDir: '/x', managedHome: dir, io: { readConfig: () => null, isRepo, isManaged: (x) => L.homeStatus(x) === 'managed' } });
  assert.deepStrictEqual(mk(real), { root: real, source: 'managed' });
  assert.strictEqual(mk(lnk), null); // 링크라서 채택하지 않는다
  fs.mkdirSync(path.join(home, 'scripts')); fs.writeFileSync(path.join(home, 'scripts', 'maru-status.sh'), ''); fs.writeFileSync(path.join(home, 'CLAUDE.md'), '');
  assert.strictEqual(mk(home), null); // repo 처럼 보여도 마커가 없으면 채택하지 않는다
});
t('S2 첫 만남 붙여넣기: 고정 문장일 때만, 변형은 거부(일반 퀘스트 필터와 별개)', () => {
  assert.strictEqual(L.firstMeetingPaste(L.FIRST_MEETING_TEXT), '\x1b[200~/first-meeting\x1b[201~');
  assert.ok(!/[\r\n]/.test(L.firstMeetingPaste('/first-meeting'))); // Enter 없음
  for (const bad of ['/first-meeting x', '/other', '/first-meeting\n', ' /first-meeting', '/First-Meeting', '', null, undefined, '/first-meeting\x1b[201~rm -rf /']) assert.strictEqual(L.firstMeetingPaste(bad), null, String(bad));
  assert.strictEqual(L.isSafeQuestStart('/first-meeting'), false); // 그래서 writePrompt 를 쓰면 항상 실패한다
});
t('M2 appendSyncLog 는 링크·큰 파일을 거부하고 한 줄 추가', () => {
  const root = fs.mkdtempSync(path.join(tmp, 'lg-'));
  assert.strictEqual(L.appendSyncLog(root, 'sync failed write\nINJECT'), true);
  const txt = fs.readFileSync(path.join(root, 'data', 'logs', 'app-sync.log'), 'utf8'); assert.strictEqual(txt.trim().split('\n').length, 1); assert.ok(/sync failed write\?INJECT$/.test(txt.trim()));
  const r2 = fs.mkdtempSync(path.join(tmp, 'lg-')); const o = fs.mkdtempSync(path.join(tmp, 'lo-')); fs.symlinkSync(o, path.join(r2, 'data'));
  assert.strictEqual(L.appendSyncLog(r2, 'x'), false); assert.deepStrictEqual(fs.readdirSync(o), []);
  fs.writeFileSync(path.join(root, 'data', 'logs', 'app-sync.log'), 'x'.repeat(70000)); assert.strictEqual(L.appendSyncLog(root, 'y'), false);
});
t('M4 setup.json 손상 시 파생·프로필 병합(기존 프로필을 잃지 않는다)', () => {
  const prof = { name: '가', lang: 'en', calendar: true, createdAt: '2026-01-01T00:00:00.000Z' };
  assert.deepStrictEqual(L.deriveSetupState({ marker: { version: '1' }, profile: prof }), { ...L.defaultSetupState(), homeAt: prof.createdAt });
  assert.strictEqual(L.deriveSetupState({ marker: null, profile: prof }), null); assert.strictEqual(L.deriveSetupState({ marker: { version: '1' }, profile: null }), null);
  assert.deepStrictEqual(L.mergeProfile(prof, '나', 'ko', '2030-01-01T00:00:00.000Z'), { name: '나', lang: 'ko', calendar: true, createdAt: prof.createdAt });
  assert.deepStrictEqual(L.mergeProfile(null, '나', 'ko', '2030-01-01T00:00:00.000Z'), { name: '나', lang: 'ko', calendar: false, createdAt: '2030-01-01T00:00:00.000Z' });
  assert.deepStrictEqual(L.mergeProfile({ name: '', lang: 'xx' }, '나', 'en', '2030-01-01T00:00:00.000Z').calendar, false);
});
t('M5 기억 폴더 읽기: 없음·정상·링크·권한 없음을 구분하고, 읽지 못하면 배너를 띄우지 않는다', () => {
  const base = fs.mkdtempSync(path.join(tmp, 'pm-'));
  assert.strictEqual(L.probeMemoryDir(path.join(base, 'none')), 'missing');
  const ok = path.join(base, 'ok'); fs.mkdirSync(ok); assert.strictEqual(L.probeMemoryDir(ok), 'ok');
  const ln = path.join(base, 'ln'); fs.symlinkSync(ok, ln); assert.strictEqual(L.probeMemoryDir(ln), 'unreadable');
  const noperm = path.join(base, 'np'); fs.mkdirSync(noperm); fs.chmodSync(noperm, 0o000);
  if (process.getuid() !== 0) assert.strictEqual(L.probeMemoryDir(noperm), 'unreadable'); fs.chmodSync(noperm, 0o700);
  const f = path.join(base, 'file'); fs.writeFileSync(f, ''); assert.strictEqual(L.probeMemoryDir(f), 'unreadable');
  assert.strictEqual(L.probeMemoryDir(''), 'unreadable'); assert.strictEqual(L.probeMemoryDir(null), 'unreadable');
  const prof = { name: 'a', lang: 'ko', calendar: false, createdAt: '2026-01-01T00:00:00Z' }; const S0 = L.defaultSetupState(); const empty = { items: [], skipped: 0 };
  assert.strictEqual(L.firstMeetingBanner({ memories: null, probe: 'missing', state: S0, profile: prof }), true);
  assert.strictEqual(L.firstMeetingBanner({ memories: empty, probe: 'ok', state: S0, profile: prof }), true);
  assert.strictEqual(L.firstMeetingBanner({ memories: empty, probe: 'unreadable', state: S0, profile: prof }), false);
  assert.strictEqual(L.firstMeetingBanner({ memories: empty, state: S0, profile: prof }), false);
  assert.strictEqual(L.firstMeetingBanner({ memories: null, probe: 'ok', state: S0, profile: prof }), false);
});
t('setup.json: 검증·손상·큰 파일·알 수 없는 필드', () => {
  const f = path.join(fs.mkdtempSync(path.join(tmp, 'su-')), 'data', 'setup.json');
  assert.strictEqual(L.loadSetupState(f), null);
  const st = { ...L.defaultSetupState(), homeAt: '2026-01-01T00:00:00.000Z', connect: 'later' };
  assert.strictEqual(L.saveSetupState(f, st), true);
  assert.deepStrictEqual(L.loadSetupState(f), st);
  fs.writeFileSync(f, 'not json'); assert.strictEqual(L.loadSetupState(f), null);
  fs.writeFileSync(f, JSON.stringify({ ...st, extra: 'x', connect: 'weird' })); assert.deepStrictEqual(L.loadSetupState(f), { ...st, connect: null });
  fs.writeFileSync(f, JSON.stringify({ ...st, metAt: 'yesterday' })); assert.strictEqual(L.loadSetupState(f), null);
  fs.writeFileSync(f, JSON.stringify({ ...st, v: 2 })); assert.strictEqual(L.loadSetupState(f), null);
  fs.writeFileSync(f, JSON.stringify({ ...st, pad: 'x'.repeat(5000) })); assert.strictEqual(L.loadSetupState(f), null);
  fs.writeFileSync(f, '[]'); assert.strictEqual(L.loadSetupState(f), null);
  assert.strictEqual(L.saveSetupState(f, { v: 1, connect: 'bogus', homeAt: 5 }), false);
  // profile.json 모양은 그대로(옛 파일 통과)
  assert.deepStrictEqual(L.validateProfile({ name: '가', lang: 'en', calendar: false, createdAt: '2026-01-01T00:00:00Z' }), { name: '가', lang: 'en', calendar: false, createdAt: '2026-01-01T00:00:00Z' });
});
t('setupStage·setupUnfinished', () => {
  const man = { root: '/h/.maru', source: 'managed' };
  assert.deepStrictEqual(L.setupStage({ found: null, state: null }), { needed: true, stage: 'welcome' });
  assert.deepStrictEqual(L.setupStage({ found: { root: '/x', source: 'app' }, state: null }), { needed: false, stage: 'done' });
  assert.deepStrictEqual(L.setupStage({ found: { root: '/h/maru', source: 'home' }, state: null }), { needed: false, stage: 'done' });
  assert.deepStrictEqual(L.setupStage({ found: man, state: null }), { needed: true, stage: 'welcome' });
  assert.deepStrictEqual(L.setupStage({ found: man, state: { ...L.defaultSetupState(), homeAt: '2026-01-01T00:00:00Z' } }), { needed: true, stage: 'connect' });
  assert.deepStrictEqual(L.setupStage({ found: man, state: { ...L.defaultSetupState(), homeAt: '2026-01-01T00:00:00Z', doneAt: '2026-01-02T00:00:00Z', connect: 'later' } }), { needed: false, stage: 'done' });
  assert.strictEqual(L.setupUnfinished({ found: man, state: { ...L.defaultSetupState(), connect: 'later' } }), true);
  assert.strictEqual(L.setupUnfinished({ found: man, state: { ...L.defaultSetupState(), connect: 'done' } }), false);
  assert.strictEqual(L.setupUnfinished({ found: { root: '/x', source: 'app' }, state: null }), false);
});
t('prerequisites 모델링·PATH 탐색', () => {
  const ok = { macos: true, claude: 'ok', auth: { loggedIn: true, state: 'ok' }, git: 'ok', python3: 'ok', jq: 'ok', perl: 'ok' };
  const m = L.modelPrereqs({ ...ok, macosVersion: '15.2' }); assert.strictEqual(m[0].detail, '15.2'); assert.strictEqual(L.modelPrereqs({ ...ok, macosVersion: '<b>' })[0].detail, null); assert.strictEqual(L.prereqsReady(L.modelPrereqs({ ...ok, macosVersion: '12.0' })), true); assert.deepStrictEqual(m.map((x) => x.id), L.PREREQ_IDS); assert.ok(m.every((x) => x.status === 'ok' && x.how === null)); assert.strictEqual(L.prereqsReady(m), true);
  const m2 = L.modelPrereqs({ ...ok, jq: 'missing', git: 'broken', auth: { loggedIn: false, state: 'out' } });
  const by = (id) => m2.find((x) => x.id === id);
  assert.strictEqual(by('jq').status, 'missing'); assert.strictEqual(by('jq').how, 'prereq.how.jq'); assert.strictEqual(by('git').status, 'need'); assert.strictEqual(by('git').how, 'prereq.how.clt');
  assert.strictEqual(by('auth').status, 'need'); assert.strictEqual(L.prereqsReady(m2), false);
  assert.strictEqual(L.prereqsReady(L.modelPrereqs({ ...ok, auth: { loggedIn: false, state: 'out' } })), true); // 로그인은 필수가 아니다
  assert.strictEqual(L.prereqsReady(L.modelPrereqs({ ...ok, claude: 'missing' })), false);
  assert.strictEqual(L.modelPrereqs({ ...ok, auth: null }).find((x) => x.id === 'auth').status, 'unknown');
  assert.strictEqual(L.modelPrereqs({ ...ok, claude: 'missing' }).find((x) => x.id === 'auth').status, 'need');
  assert.strictEqual(L.prereqsReady(L.modelPrereqs({ ...ok, macos: false })), false);
  assert.strictEqual(L.prereqsReady(L.modelPrereqs(null)), false); assert.strictEqual(L.prereqsReady(null), false);
  const ex = new Set(['/b/jq', '/a/jq']);
  assert.strictEqual(L.findInPath('jq', 'rel:/a:/b', (p) => ex.has(p)), '/a/jq');
  assert.strictEqual(L.findInPath('jq', '/c', (p) => ex.has(p)), null); assert.strictEqual(L.findInPath('../jq', '/a', () => true), null);
});
t('첫 만남 배너 판단', () => {
  const prof = { name: 'a', lang: 'ko', calendar: false, createdAt: '2026-01-01T00:00:00Z' }; const empty = { items: [], skipped: 0 };
  const S = L.defaultSetupState(); const B = (o) => L.firstMeetingBanner({ memories: empty, probe: 'ok', state: S, profile: prof, ...o });
  assert.strictEqual(B({}), true); assert.strictEqual(B({ state: null }), true);
  assert.strictEqual(B({ memories: { items: [{}], skipped: 0 } }), false); assert.strictEqual(B({ memories: { items: [], skipped: 2 } }), false);
  assert.strictEqual(B({ state: { ...S, metAt: '2026-01-01T00:00:00Z' } }), false); assert.strictEqual(B({ state: { ...S, dismissedAt: '2026-01-01T00:00:00Z' } }), false);
  assert.strictEqual(B({ profile: null }), false); assert.strictEqual(B({ memories: null }), false);
  assert.strictEqual(L.FIRST_MEETING_TEXT, '/first-meeting');
});
t('parseInstallSections: 머리글 언어와 무관(마지막 끝 표시는 어떤 말이든 뺀다)', () => {
  assert.deepStrictEqual(L.parseInstallSections('\n== Checking requirements\n  ok x\n\n== Register SessionEnd hook\n== Done\n  note\n'), ['Checking requirements', 'Register SessionEnd hook']);
  assert.deepStrictEqual(L.parseInstallSections('\n== 요구사항 확인\n== 끝\n'), ['요구사항 확인']);
  assert.deepStrictEqual(L.parseInstallSections('no headers'), []);
});
t('앱 연결(소스 구조): fromMain·고정 문장·dev 전용 환경변수·install 환경', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  for (const ch of ['setup:get', 'setup:prereqs', 'setup:create-home', 'setup:connect-later', 'setup:finish', 'meet:get', 'meet:dismiss']) assert.ok(new RegExp("ipcMain\\.handle\\('" + ch + "', (async )?\\(e[,)][^\\n]*\\n?[\\s\\S]{0,80}fromMain\\(e\\)").test(main), ch);
  const ms = main.split("ipcMain.handle('meet:start'")[1].split('\n});')[0];
  assert.ok(/wsFrom\(e, id\)/.test(ms) && /isMaruWs\(w\)/.test(ms) && /w\.bracketed/.test(ms) && /confirmBox/.test(ms) && /firstMeetingPaste\(text\)/.test(ms) && !/writePrompt/.test(ms) && !/\\r|\\n/.test(ms));
  assert.ok(/!app\.isPackaged && typeof process\.env\[k\]/.test(main) && /MARU_APP_MANAGED_HOME/.test(main) && /MARU_APP_PAYLOAD/.test(main));
  assert.ok(/MARU_LANG: curLang\(\)/.test(main) && /installEnv\(\)/.test(main));
  assert.ok(/app\.relaunch\(\)/.test(main) && /'setup'\]\.includes\(process\.env\.MARU_APP_UI\)/.test(main));
  assert.ok(!/innerHTML/.test(fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8')));
  const pk = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).build.extraResources.map((e) => e.to);
  for (const x of ['payload/scripts', 'payload/prompts', 'payload/squads', 'payload/squads-en', 'payload/launchd', 'payload/bin', 'payload/install.sh', 'payload/uninstall.sh', 'payload/CLAUDE.md', 'payload/CLAUDE.en.md', 'payload/README.md', 'payload/.claude/agents', 'payload/.claude/skills', 'payload/.claude/settings.json']) assert.ok(pk.includes(x), x);
  assert.ok(!pk.some((p) => /data|\.git|settings\.local|cmux|payload\/app/.test(p)));
});

// ---- 할 일 -> 원래 세션 열기: 출처 파일 파싱·결정 함수·실행 명령·세션 매핑 ----
const U1 = 'aaaaaaaa-1111-4222-8333-444444444441'; const U2 = 'bbbbbbbb-1111-4222-8333-444444444442'; const U3 = 'cccccccc-1111-4222-8333-444444444443';
const NOWS = 1800000000;
const srcLine = (o = {}) => [o.at ?? NOWS - 100, o.sid ?? U1, o.cwd ?? '/Users/me/proj-a', o.tag ?? 'maru', o.key ?? '첫 일'].join('|');
t('parseTodoSrc: 정상 줄·키 규칙·슬러그', () => {
  const r = L.parseTodoSrc(srcLine() + '\n' + srcLine({ tag: 'blog/post-1', key: 'hello world' }) + '\n', NOWS);
  assert.deepStrictEqual(r.map((e) => [e.tag, e.project || null, e.key, e.sid, e.cwd]), [['maru', null, '첫 일', U1, '/Users/me/proj-a'], ['blog', 'blog/post-1', 'hello world', U1, '/Users/me/proj-a']]);
  assert.strictEqual(L.findTodoSrc(r, { tag: 'blog', title: 'Hello   World' }).project, 'blog/post-1'); // 제목 키(공백 접기·소문자)로 맺는다
  assert.strictEqual(L.findTodoSrc(r, { tag: 'maru', title: 'Hello World' }), null); // 다른 태그
  assert.strictEqual(L.findTodoSrc(r, null), null);
});
t('parseTodoSrc: 깨진 줄·잘못된 uuid·상대 cwd·| · 제어 문자·시각 범위를 버림', () => {
  const bad = [
    'garbage', '', srcLine({ sid: 'not-a-uuid' }), srcLine({ sid: U1.toUpperCase() }), srcLine({ cwd: 'relative/dir' }), srcLine({ cwd: '/a/../b' }), srcLine({ cwd: '/a//b' }), srcLine({ cwd: '/a/b/' }), srcLine({ cwd: '/a/\u0007b' }), srcLine({ cwd: '/a/‮b' }),
    srcLine({ tag: 'bad tag' }), srcLine({ tag: 'maru/BAD' }), srcLine({ tag: '' }), srcLine({ key: '' }), srcLine({ key: 'x\u0000y' }), srcLine({ key: 'k'.repeat(241) }),
    srcLine({ at: NOWS - 31 * 86400 }), srcLine({ at: NOWS + 2 * 86400 }), srcLine({ at: 'abc' }), srcLine({ at: 12345 }), srcLine() + '|extra', 'a|b|c|d',
  ];
  assert.deepStrictEqual(L.parseTodoSrc(bad.join('\n'), NOWS), []);
  assert.deepStrictEqual(L.parseTodoSrc(null, NOWS), []); assert.deepStrictEqual(L.parseTodoSrc('x', NaN), []);
  assert.strictEqual(L.parseTodoSrc(srcLine({ at: NOWS + 3600 }), NOWS).length, 1); // 하루 안의 미래는 허용
  assert.strictEqual(L.parseTodoSrc(srcLine({ at: NOWS - 29 * 86400 }), NOWS).length, 1);
});
t('parseTodoSrc: 같은 키가 여럿이면 가장 새 것(같으면 뒤의 것), 잘린 마지막 줄은 버림', () => {
  const r = L.parseTodoSrc([srcLine({ at: NOWS - 10, sid: U2 }), srcLine({ at: NOWS - 500, sid: U3 }), srcLine({ at: NOWS - 10, sid: U1 })].join('\n'), NOWS);
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].sid, U1); assert.strictEqual(r[0].at, NOWS - 10);
  assert.strictEqual(L.parseTodoSrc(srcLine() + '\n' + srcLine({ tag: 'b', key: 'x' }).slice(0, 30), NOWS, true).length, 1);
});
t('readTodoSrcFile: 일반 파일·소유자·모드·크기를 검사하고 링크·FIFO·큰 파일은 []', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'src-')); const f = path.join(dir, 'todo-src.txt'); const uid = process.getuid();
  assert.deepStrictEqual(L.readTodoSrcFile(f, NOWS, uid), []); // 없음
  fs.writeFileSync(f, srcLine() + '\n', { mode: 0o600 });
  assert.strictEqual(L.readTodoSrcFile(f, NOWS, uid).length, 1);
  assert.deepStrictEqual(L.readTodoSrcFile(f, NOWS, uid + 1), []); // 소유자가 다름
  fs.chmodSync(f, 0o666); assert.deepStrictEqual(L.readTodoSrcFile(f, NOWS, uid), []); // 누구나 쓸 수 있음
  fs.chmodSync(f, 0o600);
  const link = path.join(dir, 'link.txt'); fs.symlinkSync(f, link); assert.deepStrictEqual(L.readTodoSrcFile(link, NOWS, uid), []);
  const big = path.join(dir, 'big.txt'); fs.writeFileSync(big, 'x'.repeat(L.TODO_SRC_MAX_BYTES + 1), { mode: 0o600 }); assert.deepStrictEqual(L.readTodoSrcFile(big, NOWS, uid), []);
  assert.deepStrictEqual(L.readTodoSrcFile(dir, NOWS, uid), []); // 폴더
  fs.writeFileSync(f, srcLine() + '\n' + 'ÿþ\u0000garbage\n', { mode: 0o600 }); assert.strictEqual(L.readTodoSrcFile(f, NOWS, uid).length, 1); // 깨진 줄은 그 줄만
});
t('셸 textclean.py 의 TODO_SRC_* 상수와 같다', () => {
  const py = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'textclean.py'), 'utf8');
  const g = (k) => { const m = new RegExp('^' + k + '\\s*=\\s*([0-9_ *]+)', 'm').exec(py); assert.ok(m, k); return m[1].split('#')[0].split('*').map((x) => Number(x.replace(/[_ ]/g, ''))).reduce((a, b) => a * b, 1); };
  assert.strictEqual(g('TODO_SRC_MAX_BYTES'), L.TODO_SRC_MAX_BYTES); assert.strictEqual(g('TODO_SRC_MAX_LINES'), L.TODO_SRC_MAX_LINES);
  assert.strictEqual(g('TODO_SRC_TTL'), L.TODO_SRC_TTL_SEC); assert.strictEqual(g('TODO_SRC_CWD_MAX'), L.TODO_SRC_CWD_MAX);
});
t('todoSrcHint: 폴더 이름만(경로 전체·제어 문자 없음)', () => {
  assert.deepStrictEqual(L.todoSrcHint({ cwd: '/Users/me/my proj', at: 5 }), { folder: 'my proj', at: 5 });
  assert.strictEqual(L.todoSrcHint({ cwd: '/Users/me/' + '가'.repeat(40), at: 5 }).folder.length, 24);
  assert.strictEqual(L.todoSrcHint(null), null);
});
// 결정 함수: 주입한 가짜 파일 시스템(읽기 전용)
function fakeFs(spec) { // spec: { '<경로>': { kind: 'dir'|'file'|'link', mtimeMs, uid } }  (realpath 는 link 의 to 를 따름)
  const mk = (e) => ({ isDirectory: () => e.kind === 'dir', isFile: () => e.kind === 'file', isSymbolicLink: () => e.kind === 'link', mtimeMs: e.mtimeMs, uid: e.uid ?? 501 });
  return {
    lstat: (p) => { if (!spec[p]) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return mk(spec[p]); },
    stat: (p) => { if (!spec[p]) throw new Error('ENOENT'); return mk(spec[p].kind === 'link' ? spec[spec[p].to] : spec[p]); },
    realpath: (p) => { if (!spec[p]) throw new Error('ENOENT'); return spec[p].kind === 'link' ? spec[p].to : p; },
  };
}
const PD = '/h/.claude/projects'; const CWD = '/Users/me/proj-a';
const TR = PD + '/-Users-me-proj-a/' + U1 + '.jsonl';
const DNOW = 1800000000000;
const dctx = (over = {}, spec = {}) => ({ projectsDir: PD, nowMs: DNOW, uid: 501, force: false, workspaces: [], fs: fakeFs({ [CWD]: { kind: 'dir' }, [TR]: { kind: 'file', mtimeMs: DNOW - 3600 * 1000 }, ...spec }), ...over });
const dsrc = { sid: U1, cwd: CWD, tag: 'maru', key: '첫 일', at: NOWS };
t('decideTodoOpen: 출처 없음·형식 오류는 새 세션', () => {
  assert.deepStrictEqual(L.decideTodoOpen(null, dctx()), { action: 'new', reason: 'no-source' });
  assert.deepStrictEqual(L.decideTodoOpen({ ...dsrc, sid: 'x' }, dctx()), { action: 'new', reason: 'bad-source' });
  assert.deepStrictEqual(L.decideTodoOpen({ ...dsrc, cwd: 'rel' }, dctx()), { action: 'new', reason: 'bad-source' });
  assert.deepStrictEqual(L.decideTodoOpen({ ...dsrc, cwd: '/a|b' }, dctx()), { action: 'new', reason: 'bad-source' });
});
t('decideTodoOpen: 열린 작업 공간이 있으면 그리로(여럿이면 가장 최근 활동), 닫힌 것은 제외', () => {
  const ws = [{ id: 'w1', sid: U1, atMs: 100, live: true }, { id: 'w2', sid: U1, atMs: 900, live: true }, { id: 'w3', sid: U2, atMs: 5000, live: true }, { id: 'w4', sid: U1, atMs: 9999, live: false }];
  assert.deepStrictEqual(L.decideTodoOpen(dsrc, dctx({ workspaces: ws })), { action: 'switch', wsId: 'w2' });
  assert.deepStrictEqual(L.decideTodoOpen(dsrc, dctx({ workspaces: [{ id: 'a', sid: U1, atMs: NaN, live: true }, { id: 'b', sid: U1, atMs: 1, live: true }] })), { action: 'switch', wsId: 'b' });
  // 폴더·기록이 사라졌어도 열려 있으면 그리로(파일 시스템을 보지 않는다)
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({ workspaces: ws, fs: fakeFs({}) })).action, 'switch');
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({ workspaces: [{ id: 'w3', sid: U2, atMs: 1, live: true }] })).action, 'resume');
});
t('decideTodoOpen: 이어 열 수 있으면 resume(마지막 활동 시각 포함)', () => {
  assert.deepStrictEqual(L.decideTodoOpen(dsrc, dctx()), { action: 'resume', sid: U1, cwd: CWD, lastMs: DNOW - 3600 * 1000, recent: false });
});
t('decideTodoOpen: 폴더 없음·링크·파일·소유자 다름 → no-folder', () => {
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({ fs: fakeFs({ [TR]: { kind: 'file', mtimeMs: DNOW } }) })).reason, 'no-folder');
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [CWD]: { kind: 'link', to: '/elsewhere' }, '/elsewhere': { kind: 'dir' } })).reason, 'no-folder');
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [CWD]: { kind: 'file' } })).reason, 'no-folder');
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [CWD]: { kind: 'dir', uid: 0 } })).reason, 'no-folder');
});
t('decideTodoOpen: 기록 파일 없음·링크·폴더 → no-transcript', () => {
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({ fs: fakeFs({ [CWD]: { kind: 'dir' } }) })).reason, 'no-transcript');
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [TR]: { kind: 'link', to: '/x' } })).reason, 'no-transcript');
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [TR]: { kind: 'dir' } })).reason, 'no-transcript');
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [TR]: { kind: 'file', mtimeMs: NaN } })).reason, 'no-transcript');
  const other = { ...dsrc, sid: U2 }; // 다른 세션의 기록은 이 세션 것이 아님
  assert.strictEqual(L.decideTodoOpen(other, dctx()).reason, 'no-transcript');
});
t('decideTodoOpen: 2일 넘은 세션은 기본으로 새 세션(+명시적 두 번째 동작), force 면 이어 열기', () => {
  const old = { [TR]: { kind: 'file', mtimeMs: DNOW - (2 * 86400 + 60) * 1000 } };
  assert.deepStrictEqual(L.decideTodoOpen(dsrc, dctx({}, old)), { action: 'new', reason: 'too-old', canForce: true });
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({ force: true }, old)).action, 'resume');
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [TR]: { kind: 'file', mtimeMs: DNOW - (2 * 86400 - 60) * 1000 } })).action, 'resume'); // 경계 안
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({ force: 'yes' }, old)).action, 'new'); // force 는 true 일 때만
  // 폴더·기록 문제는 force 로도 못 넘는다
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({ force: true, fs: fakeFs({ [CWD]: { kind: 'dir' } }) })).reason, 'no-transcript');
});
t('decideTodoOpen: 파일 시스템 예외·ctx 누락은 새 세션(던지지 않는다)', () => {
  const thrower = { lstat: () => { throw new Error('boom'); }, stat: () => { throw new Error('boom'); }, realpath: () => { throw new Error('boom'); } };
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({ fs: thrower })).reason, 'no-folder');
  assert.strictEqual(L.decideTodoOpen(dsrc, null).reason, 'bad-source');
  assert.strictEqual(L.decideTodoOpen(dsrc, { projectsDir: PD }).reason, 'bad-source');
});
t('decideTodoOpen: 실제 파일 시스템(임시 폴더)에서도 같은 판정', () => {
  const root = fs.mkdtempSync(path.join(tmp, 'dec-')); const proj = path.join(root, 'work dir'); fs.mkdirSync(proj);
  const pd = path.join(root, 'projects'); const slug = L.projectSlug(proj); fs.mkdirSync(path.join(pd, slug), { recursive: true });
  const tf = path.join(pd, slug, U1 + '.jsonl'); fs.writeFileSync(tf, '{}\n');
  const real = { lstat: fs.lstatSync, stat: fs.statSync, realpath: fs.realpathSync };
  const c = { projectsDir: pd, nowMs: Date.now(), uid: process.getuid(), force: false, workspaces: [], fs: real };
  assert.strictEqual(L.decideTodoOpen({ ...dsrc, cwd: proj }, c).action, 'resume');
  fs.utimesSync(tf, new Date(Date.now() - 3 * 86400 * 1000), new Date(Date.now() - 3 * 86400 * 1000));
  assert.strictEqual(L.decideTodoOpen({ ...dsrc, cwd: proj }, c).reason, 'too-old');
  const ln = path.join(root, 'linked'); fs.symlinkSync(proj, ln);
  assert.strictEqual(L.decideTodoOpen({ ...dsrc, cwd: ln }, c).reason, 'no-folder'); // 링크로 가리킨 폴더는 거부
  fs.unlinkSync(tf); assert.strictEqual(L.decideTodoOpen({ ...dsrc, cwd: proj }, { ...c, force: true }).reason, 'no-transcript');
  fs.rmSync(proj, { recursive: true }); assert.strictEqual(L.decideTodoOpen({ ...dsrc, cwd: proj }, c).reason, 'no-folder');
});
t('claudeLaunchCommand: 이어 열기(--resume <uuid>)는 검증된 uuid 만, 잘못된 값은 null', () => {
  const sid = 'abcd1234-aaaa';
  assert.strictEqual(L.claudeLaunchCommand(sid, null, U1), 'command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec claude --resume ' + U1 + ' ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, '/r/scripts/maru-claude.sh', U1), 'command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec /r/scripts/maru-claude.sh --resume ' + U1 + ' ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, null), 'command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec claude ; exit 127\r'); // 인자 없으면 예전과 같다
  assert.strictEqual(L.claudeLaunchCommand(sid, null, null), L.claudeLaunchCommand(sid, null));
  for (const bad of ['', 'x', U1.toUpperCase(), U1 + ' ; rm -rf ~', U1 + '\n', '$(id)', '--fork-session', U1.slice(1), U1 + 'a', 5, {}, ['a'], '../' + U1]) assert.strictEqual(L.claudeLaunchCommand(sid, '/r/scripts/maru-claude.sh', bad), null, JSON.stringify(bad));
  assert.ok(!/fork-session|bypass|skip-permissions/.test(L.claudeLaunchCommand(sid, null, U1)));
});
t('transcriptSessionId: <projects>/<slug>/<uuid>.jsonl 만 세션 uuid 로 받는다', () => {
  assert.strictEqual(L.transcriptSessionId(PD + '/-Users-me-a/' + U1 + '.jsonl', PD), U1);
  assert.strictEqual(L.transcriptSessionId(PD + '/-Users-me-a/' + U1 + '.jsonl', [PD + '/', '/real/projects']), U1); // 끝 / 무시·여러 후보
  assert.strictEqual(L.transcriptSessionId('/real/projects/-s/' + U2 + '.jsonl', [PD, '/real/projects']), U2);
  const hostile = [
    PD + '/-s/' + U1 + '.jsonl.evil', PD + '/-s/' + U1 + '.txt', PD + '/-s/' + U1.toUpperCase() + '.jsonl', PD + '/-s/agent-123.jsonl', PD + '/-s/' + U1 + '/subagents/agent-1.jsonl',
    PD + '/../x/-s/' + U1 + '.jsonl', PD + '/-s/../' + U1 + '.jsonl', PD + '/./-s/' + U1 + '.jsonl', PD + '//-s/' + U1 + '.jsonl', '/other/projects/-s/' + U1 + '.jsonl', '/h/.claude/-s/' + U1 + '.jsonl',
    PD + '/' + U1 + '.jsonl', PD + '/-s\n/' + U1 + '.jsonl', PD + '/-s/‮' + U1 + '.jsonl', 'projects/-s/' + U1 + '.jsonl', '', null, undefined, 5, PD + '/-s/' + 'a'.repeat(2000) + '.jsonl',
    PD + '/-s/' + U1 + '.jsonl\u0000', PD + '/-s/.' + U1 + '.jsonl', PD + '/-s/xx' + U1 + '.jsonl',
  ];
  for (const h of hostile) assert.strictEqual(L.transcriptSessionId(h, PD), null, String(JSON.stringify(h)).slice(0, 60));
  assert.strictEqual(L.transcriptSessionId(PD + '/-s/' + U1 + '.jsonl', ''), null); assert.strictEqual(L.transcriptSessionId(PD + '/-s/' + U1 + '.jsonl', ['/', 'rel']), null); assert.strictEqual(L.transcriptSessionId(PD + '/-s/' + U1 + '.jsonl', null), null);
});
t('parseAgentRecord → transcriptSessionId: 상태 파일에서 세션 uuid 를 꺼낸다', () => {
  const rec = L.parseAgentRecord(JSON.stringify({ state: 'idle', at: '2026-01-01T00:00:00Z', transcript_path: PD + '/-s/' + U3 + '.jsonl' }));
  assert.strictEqual(L.transcriptSessionId(rec.transcript, PD), U3);
  assert.strictEqual(L.parseAgentRecord(JSON.stringify({ state: 'idle', transcript_path: 'rel/x.jsonl' })).transcript, undefined);
});
t('transcriptFileFor·projectSlug: 영숫자가 아닌 문자는 모두 -', () => {
  assert.strictEqual(L.transcriptFileFor('/h/.claude/projects/', '/Users/me/my proj.v2', U1), '/h/.claude/projects/-Users-me-my-proj-v2/' + U1 + '.jsonl');
});
t('openNoticeKey: 알려진 사유만, 나머지는 invalid. ko/en 문구가 모두 있다', () => {
  assert.strictEqual(L.openNoticeKey('too-old'), 'todo.open.too-old'); assert.strictEqual(L.openNoticeKey('zzz'), 'todo.open.invalid'); assert.strictEqual(L.openNoticeKey(undefined), 'todo.open.invalid');
  for (const r of ['no-source', 'bad-source', 'no-folder', 'no-transcript', 'too-old', 'agent-busy', 'timeout', 'inactive', 'busy-ui', 'max', 'stale', 'no-prompt', 'invalid', 'no-term', 'not-ready', 'unsafe-start', 'no-maru', 'shell', 'typed']) {
    for (const lang of I.LANGS) assert.ok(I.t(lang, L.openNoticeKey(r), { text: 'x' }) !== L.openNoticeKey(r), lang + ' ' + r);
  }
  assert.ok(/다시 눌러/.test(I.t('ko', 'todo.open.agent-busy')));
  for (const k of ['todo.open.choose.new', 'todo.open.choose.orig', 'todo.open.retry', 'todo.src.today', 'todo.src.days', 'todo.src.aria', 'todo.open.working']) for (const lang of I.LANGS) assert.ok(I.t(lang, k, { folder: 'f', n: 2 }) !== k, lang + ' ' + k);
});
t('할 일 열기 흐름은 pty 에 직접 쓰지 않고(writePrompt 만), 위험한 플래그를 쓰지 않는다', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const lib = fs.readFileSync(path.join(__dirname, 'lib.js'), 'utf8');
  const flow = main.split('// ---- 할 일 클릭 -> 원래 세션으로')[1].split("ipcMain.handle('todos:retry-fill'")[0];
  assert.ok(!/term\.write/.test(flow), 'pty 에 직접 쓰지 않는다');
  assert.ok(!/fork-session|--dangerously|skip-permissions|--bare/.test(main + lib));
});
// ---- 입력줄 안전장치(순수 함수) ----
t('isShellProcessName: 셸·login 만 거부하고 모르는·빈 이름은 통과', () => {
  for (const n of ['zsh', '-zsh', 'bash', '-bash', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'login', '/bin/zsh', '/usr/bin/login', '/opt/homebrew/bin/fish', '-/bin/zsh', 'ZSH', ' zsh ', '/bin/zsh/']) assert.strictEqual(L.isShellProcessName(n), true, n);
  for (const n of ['claude', 'node', '', null, undefined, 5, {}, 'zsh-helper', 'bashful', '/usr/local/bin/claude', 'ssh', 'tmux', 'python3', 'x'.repeat(2000)]) assert.strictEqual(L.isShellProcessName(n), false, String(n).slice(0, 20));
});
t('isUserInput: 터미널의 자동 응답(CSI·OSC·DCS)은 입력이 아니다', () => {
  for (const d of ['\x1b[I', '\x1b[O', '\x1b[12;40R', '\x1b[?1;2c', '\x1b]10;rgb:ffff/ffff/ffff\x07', '\x1b]11;rgb:0000/0000/0000\x1b\\', '\x1bP1$r0m\x1b\\', '\x1b[A', '']) assert.strictEqual(L.isUserInput(d), false, JSON.stringify(d));
  for (const d of ['a', '\r', '한', '\x03', '\x7f', '\x1b[200~paste\x1b[201~', '\x1b', '\x1b[I\r']) assert.strictEqual(L.isUserInput(d), true, JSON.stringify(d));
  assert.strictEqual(L.isUserInput(null), false);
});
const feed = (st, chunks) => chunks.reduce((s, c) => L.bpStep(s, c), st);
const st0 = (o = {}) => ({ tail: '', bracketed: false, awaitClaude: true, sawOff: false, claudeUp: false, ...o });
const ready = (st, o = {}) => L.fillStep({ elapsedMs: 100, timeoutMs: 20000, exists: true, active: true, hasTerm: true, state: 'none', claudeOnly: true, claudeUp: st.claudeUp, bracketed: st.bracketed, quietMs: 1000, procName: 'claude', typed: false, ...o });
t('bpStep: Claude 시작 순서(셸 h → l → claude h)에서 claudeUp, 청크가 어디서 잘려도 같다', () => {
  const seq = '% \x1b[?2004h' + '\x1b[?2004l\r\n' + 'claude banner \x1b[?2004h';
  const whole = feed(st0(), [seq]);
  assert.deepStrictEqual([whole.claudeUp, whole.bracketed], [true, true]);
  for (let i = 1; i < seq.length; i++) { const r = feed(st0(), [seq.slice(0, i), seq.slice(i)]); assert.deepStrictEqual([r.claudeUp, r.bracketed], [true, true], 'split at ' + i); }
  const bytes = feed(st0(), [...seq]); assert.deepStrictEqual([bytes.claudeUp, bytes.bracketed], [true, true]); // 한 글자씩 와도 같다
  assert.strictEqual(feed(st0(), ['% \x1b[?2004h']).claudeUp, false); // 셸 프롬프트만: 아직 아님
  assert.strictEqual(feed(st0(), ['\x1b[?2004h\x1b[?2004l']).bracketed, false);
  assert.strictEqual(feed(st0({ awaitClaude: false }), [seq]).claudeUp, false); // 우리가 연 작업 공간이 아니면 세지 않는다
});
t('셸만 남은 순서(claude 가 안 떴다)는 claudeUp 이 돼도 준비로 보지 않는다(포그라운드가 셸)', () => {
  const shellOnly = feed(st0(), ['% \x1b[?2004h', '\x1b[?2004l\r\n', '% \x1b[?2004h']); // command -v 실패 후 새 프롬프트
  assert.strictEqual(shellOnly.claudeUp, true); // 바이트만으로는 구분되지 않는다
  assert.deepStrictEqual(ready(shellOnly, { procName: 'zsh' }), { do: 'wait' });
  assert.deepStrictEqual(ready(shellOnly, { procName: '-zsh' }), { do: 'wait' });
  assert.deepStrictEqual(ready(shellOnly, { procName: 'login' }), { do: 'wait' });
  assert.deepStrictEqual(ready(shellOnly, { procName: 'zsh', elapsedMs: 20000 }), { do: 'stash', reason: 'timeout' });
  assert.deepStrictEqual(ready(shellOnly, { procName: 'claude' }), { do: 'fill' });
  assert.deepStrictEqual(ready(shellOnly, { procName: '' }), { do: 'fill' }); // 이름을 모르면 막지 않는다
});
t('fillStep: 준비·대기·시간 초과·바쁨·닫힘·전환·입력 취소', () => {
  const up = feed(st0(), ['\x1b[?2004h', '\x1b[?2004l', '\x1b[?2004h']);
  assert.deepStrictEqual(ready(up), { do: 'fill' });
  assert.deepStrictEqual(ready(st0()), { do: 'wait' }); // claude 가 아직
  assert.deepStrictEqual(ready(st0(), { elapsedMs: 20000 }), { do: 'stash', reason: 'timeout' });
  assert.deepStrictEqual(ready(up, { quietMs: 100 }), { do: 'wait' }); // 출력이 아직 계속된다
  assert.deepStrictEqual(ready(up, { bracketed: false }), { do: 'wait' });
  assert.deepStrictEqual(ready(up, { state: 'busy' }), { do: 'busy' }); assert.deepStrictEqual(ready(up, { state: 'waiting' }), { do: 'busy' });
  assert.deepStrictEqual(ready(up, { exists: false }), { do: 'abort', reason: 'invalid' }); // 기다리는 사이 닫혔다
  assert.deepStrictEqual(ready(up, { active: false }), { do: 'stash', reason: 'inactive' }); // 다른 작업 공간으로 옮겼다
  assert.deepStrictEqual(ready(up, { typed: true }), { do: 'cancel' }); // 사용자가 입력했다
  assert.deepStrictEqual(ready(up, { state: 'exited', hasTerm: false }), { do: 'abort', reason: 'no-term' });
  assert.deepStrictEqual(ready(up, { state: 'unavailable', hasTerm: false }), { do: 'abort', reason: 'no-folder' });
  assert.deepStrictEqual(ready(up, { state: 'pending', hasTerm: false }), { do: 'wait' }); // pty 가 아직 시작 전
  assert.deepStrictEqual(ready(st0(), { claudeOnly: false, claudeUp: false, bracketed: true }), { do: 'fill' }); // 이미 떠 있던 작업 공간은 bracketed 면 충분
  assert.strictEqual(L.fillStep(null).do, 'abort');
});
t('다시 시작한 pty: 새 상태에서는 이전 claudeUp 이 이어지지 않는다', () => {
  const up = feed(st0(), ['\x1b[?2004h', '\x1b[?2004l', '\x1b[?2004h']); assert.strictEqual(up.claudeUp, true);
  const restarted = st0(); // spawnPty 가 만드는 초기 상태
  assert.deepStrictEqual(ready(restarted), { do: 'wait' });
  assert.strictEqual(feed(restarted, ['% \x1b[?2004h']).claudeUp, false);
});
t('retryCheck: 같은 pty(gen)·5분 안·문장이 있을 때만', () => {
  const now = 1e12; const e = { wsId: 'w', gen: 'g1', text: '이어서 해줘', at: now - 1000 };
  assert.deepStrictEqual(L.retryCheck(e, { exists: true, gen: 'g1' }, now), { ok: true });
  assert.strictEqual(L.retryCheck(e, { exists: true, gen: 'g2' }, now).ok, false); // 다시 시작한 pty
  assert.strictEqual(L.retryCheck(e, { exists: false, gen: 'g1' }, now).ok, false); // 닫힘
  assert.strictEqual(L.retryCheck(e, { exists: true, gen: 'g1' }, now - 1000 + L.RETRY_TTL_MS).ok, true);
  assert.strictEqual(L.retryCheck(e, { exists: true, gen: 'g1' }, now + L.RETRY_TTL_MS + 5000).ok, false); // 만료
  assert.strictEqual(L.retryCheck({ ...e, at: now + 5000 }, { exists: true, gen: 'g1' }, now).ok, false); // 미래 시각
  assert.strictEqual(L.retryCheck(undefined, { exists: true, gen: 'g1' }, now).ok, false); // 없는(이미 쓴) 토큰
  assert.strictEqual(L.retryCheck({ ...e, text: '' }, { exists: true, gen: 'g1' }, now).ok, false);
  assert.strictEqual(L.retryCheck({ ...e, gen: '' }, { exists: true, gen: '' }, now).ok, false);
});
t('sessionUuidOf: 훅 값이 우선, --resume uuid 는 훅 상태가 없고 입력 전일 때만', () => {
  assert.strictEqual(L.sessionUuidOf({ hookSid: U2, resumeSid: U1, hasState: true, typed: false }), U2);
  assert.strictEqual(L.sessionUuidOf({ lastSid: U3, resumeSid: U1, hasState: false, typed: false }), U3);
  assert.strictEqual(L.sessionUuidOf({ resumeSid: U1, hasState: false, typed: false }), U1);
  assert.strictEqual(L.sessionUuidOf({ resumeSid: U1, hasState: true, typed: false }), null); // 훅 상태는 있는데 transcript 가 없다
  assert.strictEqual(L.sessionUuidOf({ resumeSid: U1, hasState: false, typed: true }), null); // 입력이 들어간 뒤(/clear 등)
  assert.strictEqual(L.sessionUuidOf({ hookSid: 'bad', resumeSid: 'bad' }), null); assert.strictEqual(L.sessionUuidOf(), null);
});
t('sid ≠ 기록 파일 이름이면 그 경로는 세션으로 인정하지 않는다(파일 이름이 곧 uuid)', () => {
  assert.strictEqual(L.transcriptSessionId(PD + '/-s/' + U2 + '.jsonl', PD), U2); // 이 경로의 세션은 U2 이지 다른 id 가 아니다
  assert.notStrictEqual(L.transcriptSessionId(PD + '/-s/' + U2 + '.jsonl', PD), U1);
  assert.strictEqual(L.transcriptSessionId(PD + '/-s/not-the-uuid.jsonl', PD), null);
});
t('workspacesToSave: 이어 열기로 띄운 임시 작업 공간은 저장하지 않고 활성 위치를 맞춘다', () => {
  const items = [{ id: 'a', cwd: '/a', title: 'A' }, { id: 'r', cwd: '/r', title: 'R', transient: true }, { id: 'b', cwd: '/b', title: 'B' }];
  assert.deepStrictEqual(L.workspacesToSave(items, 'b'), { list: [{ cwd: '/a', title: 'A' }, { cwd: '/b', title: 'B' }], active: 1 });
  assert.deepStrictEqual(L.workspacesToSave(items, 'r'), { list: [{ cwd: '/a', title: 'A' }, { cwd: '/b', title: 'B' }], active: 0 }); // 활성이 임시였다
  assert.strictEqual(L.workspacesToSave([{ id: 'r', cwd: '/r', title: 'R', transient: true }], 'r'), null); // 남는 게 없으면 파일을 건드리지 않는다
  assert.strictEqual(L.workspacesToSave(null, 'x'), null);
  const f = path.join(fs.mkdtempSync(path.join(tmp, 'ws-')), 'workspaces.json'); fs.mkdirSync(path.join(tmp, 'a'), { recursive: true });
  const k = L.workspacesToSave([{ id: 'a', cwd: tmp, title: 'A' }, { id: 'r', cwd: tmp + '/a', title: 'R', transient: true }], 'r');
  assert.ok(L.saveWorkspaces(f, k.list, k.active)); assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).workspaces.map((x) => x.title), ['A']);
});
t('decideTodoOpen: 방금까지 쓴 세션(10분 안)은 recent 표시, 열린 작업 공간이 없을 때만 의미가 있다', () => {
  const r = L.decideTodoOpen(dsrc, dctx({}, { [TR]: { kind: 'file', mtimeMs: DNOW - 5 * 60 * 1000 } }));
  assert.strictEqual(r.action, 'resume'); assert.strictEqual(r.recent, true);
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [TR]: { kind: 'file', mtimeMs: DNOW - 11 * 60 * 1000 } })).recent, false);
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({ workspaces: [{ id: 'w', sid: U1, atMs: 1, live: true }] }, { [TR]: { kind: 'file', mtimeMs: DNOW - 60 * 1000 } })).action, 'switch'); // 열려 있으면 묻지 않고 전환
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({ force: true }, { [TR]: { kind: 'file', mtimeMs: DNOW - 3 * 86400 * 1000 } })).recent, false);
});
t('parseTodoSrc: 깨진 바이트(U+FFFD)가 든 줄만 버리고 나머지는 유지', () => {
  const text = srcLine({ tag: 'a', key: 'one' }) + '\n' + srcLine({ cwd: '/Users/x/�bad', tag: 'b', key: 'two' }) + '\n' + srcLine({ tag: 'c', key: 'three' }) + '\n';
  assert.deepStrictEqual(L.parseTodoSrc(text, NOWS).map((e) => e.tag), ['a', 'c']);
  const f = path.join(fs.mkdtempSync(path.join(tmp, 'sb-')), 'todo-src.txt'); fs.writeFileSync(f, Buffer.concat([Buffer.from(srcLine({ tag: 'a', key: 'one' }) + '\n'), Buffer.from([0x61, 0xff, 0xfe, 0x0a]), Buffer.from(srcLine({ tag: 'c', key: 'three' }) + '\n')]), { mode: 0o600 });
  assert.deepStrictEqual(L.readTodoSrcFile(f, NOWS, process.getuid()).map((e) => e.tag), ['a', 'c']);
});

(async () => {
  for (const f of pending) await f();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} 통과` + (process.exitCode ? ', 실패 있음' : ''));
})();
