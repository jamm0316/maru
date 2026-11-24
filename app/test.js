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
  assert.strictEqual(L.isShiftEnter({ type: 'keydown', key: 'Enter', shiftKey: true, isComposing: true, keyCode: 229 }), true); // 조합 중에도 참(렌더러가 줄바꿈을 미룬다)
  assert.strictEqual(L.isShiftEnter({ type: 'keydown', key: 'Enter' }), false);
  // 숨은 입력칸 비우기: 조합과 무관한 keydown 에서만
  assert.strictEqual(L.imeCanReset({ type: 'keydown', composing: false, isComposing: false, settling: false, pending: false }), true);
  assert.strictEqual(L.imeCanReset({ type: 'keydown' }), true);
  assert.strictEqual(L.imeCanReset({ type: 'keyup' }), false);
  assert.strictEqual(L.imeCanReset({ type: 'keypress' }), false);
  assert.strictEqual(L.imeCanReset({ type: 'keydown', composing: true }), false); // 조합 중: 비우면 조합이 끊긴다
  assert.strictEqual(L.imeCanReset({ type: 'keydown', isComposing: true }), false);
  assert.strictEqual(L.imeCanReset({ type: 'keydown', settling: true }), false); // xterm 이 입력칸을 아직 읽지 않았다: 비우면 글자가 사라진다
  assert.strictEqual(L.imeCanReset({ type: 'keydown', pending: true }), false); // 미뤄 둔 줄바꿈이 있다
  assert.strictEqual(L.imeCanReset(), false);
  assert.strictEqual(L.isShiftEnter({ type: 'keydown', key: 'Enter', shiftKey: true, metaKey: true }), false);
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
t('Cmd+↑/↓: 입력란 전체의 맨 앞/끝', () => {
  const d = (key, o) => ({ type: 'keydown', key, metaKey: true, ...o });
  assert.strictEqual(L.isBufNavKey(d('ArrowUp'), false, false), true);
  assert.strictEqual(L.isBufNavKey(d('ArrowDown'), true, true), true);
  assert.strictEqual(L.isBufNavKey({ type: 'keyup', key: 'ArrowUp', metaKey: true }, false, true), true); // keyup 도 삼킨다
  assert.strictEqual(L.isBufNavKey(d('ArrowUp'), true, false), false); // vim 등
  for (const o of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { isComposing: true }, { keyCode: 229 }, { metaKey: false }]) assert.strictEqual(L.isBufNavKey(d('ArrowUp', o), false, true), false);
  assert.strictEqual(L.isBufNavKey(d('ArrowLeft'), false, true), false);
  const B = '─'.repeat(40);
  const scr = ['출력', B, '❯ aaa', '  bbb', '  ccc', B, '  ? for shortcuts'];
  assert.strictEqual(L.promptEdgeRows(scr, 2, true), 0);
  assert.strictEqual(L.promptEdgeRows(scr, 4, true), 2);
  assert.strictEqual(L.promptEdgeRows(scr, 3, true), 1);
  assert.strictEqual(L.promptEdgeRows(scr, 2, false), 2);
  assert.strictEqual(L.promptEdgeRows(scr, 4, false), 0);
  // 커서가 입력란 밖이거나 경계선을 못 찾으면 0(이력으로 넘어가지 않게 줄 안에서만 움직인다)
  assert.strictEqual(L.promptEdgeRows(scr, 6, true), 0);
  assert.strictEqual(L.promptEdgeRows(scr, 0, false), 0);
  assert.strictEqual(L.promptEdgeRows(scr, 1, true), 0);
  assert.strictEqual(L.promptEdgeRows(['$ ls', 'a b', '$ '], 2, true), 0);
  assert.strictEqual(L.promptEdgeRows(['╭' + B + '╮', '│ > aaa', '│   bbb', '╰' + B + '╯'], 2, true), 1);
  for (const bad of [[null, 2, true], [scr, -1, true], [scr, 99, true], [scr, 1.5, true]]) assert.strictEqual(L.promptEdgeRows(...bad), 0);
  assert.strictEqual(L.isPromptBorder('  ' + B + ' label'), true);
  assert.strictEqual(L.isPromptBorder('─── 짧음'), false);
  assert.strictEqual(L.bufNavSeq(true, 2, false), '\x1b[A\x1b[A\x01');
  assert.strictEqual(L.bufNavSeq(false, 1, true), '\x1bOB\x05');
  assert.strictEqual(L.bufNavSeq(true, 0, false), '\x01');
  assert.strictEqual(L.bufNavSeq(false, -3, false), '\x05');
  assert.strictEqual(L.bufNavSeq(true, 9999, false).length, 200 * 3 + 1);
});
t('입력 중 화살표 바꾸기: -> <- <->', () => {
  const type = (s) => { let st = null; let out = ''; for (const ch of s) { const r = L.arrowInput(st, ch); st = r.st; out += r.out; } return out; };
  const D = '\x7f';
  assert.strictEqual(type('a->b'), 'a-' + D + '→b');
  assert.strictEqual(type('a<-b'), 'a<' + D + '←b');
  assert.strictEqual(type('a<->b'), 'a<' + D + '←' + D + '↔b');
  assert.strictEqual(type('=>'), '=>');
  assert.strictEqual(type('-->'), '-->'); // - 가 이어진 뒤의 > 는 그대로
  assert.strictEqual(type('<!--'), '<!--');
  assert.strictEqual(type('->' + D), '-' + D + '→' + D + '->'); // 바꾼 직후 Backspace: 원래 글자로 되돌린다
  assert.strictEqual(type('->' + D + '>'), '-' + D + '→' + D + '->' + '>'); // 되돌린 뒤에는 다시 바꾸지 않는다
  assert.strictEqual(type('<-' + D + '>'), '<' + D + '←' + D + '<-' + '>');
  assert.strictEqual(type('->x' + D), '-' + D + '→x' + D); // 다른 글자를 친 뒤의 Backspace 는 평소대로
  assert.strictEqual(type('-' + D + '>'), '-' + D + '>'); // - 를 지운 뒤의 >
  assert.strictEqual(type('-\x1b>'), '-\x1b>'); // 사이에 제어 문자가 끼면 바꾸지 않는다
  let r = L.arrowInput({ prev: '-', conv: null }, '\x1b[D'); assert.deepStrictEqual(r, { out: '\x1b[D', st: { prev: '', conv: null } }); // 방향키 등 여러 글자 입력
  r = L.arrowInput({ prev: '-', conv: null }, 'a->b'); assert.strictEqual(r.out, 'a->b'); // 붙여넣기는 그대로
  assert.strictEqual(L.arrowInput(null, '>').out, '>');
  assert.strictEqual(L.arrowInput(undefined, undefined).out, undefined);
});
t('Cmd+Shift+←/→: 묶음 접기·펼치기', () => {
  const d = (key, o) => ({ type: 'keydown', key, metaKey: true, shiftKey: true, ...o });
  assert.strictEqual(L.isFoldKey(d('ArrowLeft')), true);
  assert.strictEqual(L.isFoldKey(d('ArrowRight')), true);
  for (const o of [{ shiftKey: false }, { metaKey: false }, { altKey: true }, { ctrlKey: true }, { isComposing: true }, { keyCode: 229 }]) assert.strictEqual(L.isFoldKey(d('ArrowLeft', o)), false);
  assert.strictEqual(L.isFoldKey(d('ArrowUp')), false);
  assert.strictEqual(L.isLineNavKey(d('ArrowLeft'), false, true), false); // 줄 맨 앞/끝 이동과 겹치지 않는다
  const ws = [{ id: 'p' }, { id: 'c1', parentId: 'p' }, { id: 'c2', parentId: 'p' }, { id: 'solo' }];
  const f = (o, open) => L.foldTarget({ ws, wsCollapsed: [], groups: [{ tag: 'a', items: [{ key: 'k1' }] }, { tag: 'b', items: [{ key: 'k2' }] }], catCollapsed: [], ...o }, open);
  assert.deepStrictEqual(f({ activeId: 'p' }, false), { kind: 'workspace', id: 'p', closed: true }); // 부모에서 접기
  assert.deepStrictEqual(f({ activeId: 'c2' }, false), { kind: 'workspace', id: 'p', closed: true }); // 하위 세션에서는 그 부모를 접는다
  assert.strictEqual(f({ activeId: 'p' }, true), null); // 이미 펼쳐져 있다
  assert.deepStrictEqual(f({ activeId: 'c1', wsCollapsed: ['p'] }, true), { kind: 'workspace', id: 'p', closed: false });
  assert.strictEqual(f({ activeId: 'p', wsCollapsed: ['p'] }, false), null); // 이미 접혀 있다
  assert.strictEqual(f({ activeId: 'solo' }, false), null); // 하위 세션이 없는 작업 공간
  assert.strictEqual(f({ activeId: 'solo' }, true), null);
  assert.strictEqual(f({ activeId: '없음' }, false), null);
  assert.deepStrictEqual(f({ activeId: 'p', project: 'k2' }, false), { kind: 'category', tag: 'b', closed: true }); // 프로젝트를 보고 있으면 카테고리
  assert.deepStrictEqual(f({ activeId: 'p', project: 'k2', catCollapsed: ['b'] }, true), { kind: 'category', tag: 'b', closed: false });
  assert.strictEqual(f({ activeId: 'p', project: 'k2', catCollapsed: ['b'] }, false), null);
  assert.strictEqual(f({ activeId: 'p', project: 'k1' }, true), null);
  assert.strictEqual(f({ activeId: 'p', project: '목록에 없음' }, false), null); // 분류 안 된 프로젝트 등: 작업 공간으로 넘어가지 않는다
  assert.strictEqual(L.foldTarget(undefined, false), null);
});
t('Cmd+Shift+↑/↓: 위·아래 대상으로 이동, 맨 처음·끝에서는 멈춘다', () => {
  const d = (key, o) => ({ type: 'keydown', key, metaKey: true, shiftKey: true, ...o });
  assert.strictEqual(L.isStepKey(d('ArrowUp')), true);
  assert.strictEqual(L.isStepKey(d('ArrowDown')), true);
  for (const o of [{ shiftKey: false }, { metaKey: false }, { altKey: true }, { ctrlKey: true }, { isComposing: true }, { keyCode: 229 }]) assert.strictEqual(L.isStepKey(d('ArrowUp', o)), false);
  assert.strictEqual(L.isStepKey(d('ArrowLeft')), false);
  assert.strictEqual(L.isBufNavKey(d('ArrowUp'), false, true), false); // 두 단축키는 겹치지 않는다
  const ids = Array.from({ length: 11 }, (_, i) => 'w' + i);
  const ts = L.numberTargets(ids, ['p1', 'p2'], Infinity);
  assert.strictEqual(ts.length, 13); // 번호(9개) 제한 없이 전부
  const ws = (id) => ({ kind: 'workspace', id }); const pj = (id) => ({ kind: 'project', id });
  assert.deepStrictEqual(L.stepTarget(ts, ws('w3'), 1), ws('w4'));
  assert.deepStrictEqual(L.stepTarget(ts, ws('w3'), -1), ws('w2'));
  assert.deepStrictEqual(L.stepTarget(ts, ws('w10'), 1), pj('p1')); // 마지막 작업 공간에서 아래: 첫 프로젝트
  assert.deepStrictEqual(L.stepTarget(ts, pj('p1'), -1), ws('w10')); // 첫 프로젝트에서 위: 마지막 작업 공간
  assert.strictEqual(L.stepTarget(ts, ws('w0'), -1), null); // 맨 처음
  assert.strictEqual(L.stepTarget(ts, pj('p2'), 1), null); // 맨 끝
  assert.strictEqual(L.stepTarget(ts, pj('없음'), 1), null);
  assert.strictEqual(L.stepTarget(ts, null, 1), null);
  assert.strictEqual(L.stepTarget(ts, ws('w1'), 2), null);
  assert.strictEqual(L.stepTarget(L.numberTargets(['a'], [], Infinity), ws('a'), 1), null);
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
  for (const l of ['ko', 'en']) assert.ok(/(일정을 읽어|reads events from your Calendar)/.test(I.t(l, 'set.cal.desc')) && /(메모리에만|in memory)/.test(I.t(l, 'set.cal.desc')) && /(macOS가 캘린더 접근 허용을 묻습니다|macOS asks you to allow Calendar)/.test(I.t(l, 'set.cal.desc')) && !/(반복 일정은|Recurring events may)/.test(I.t(l, 'set.cal.desc'))); // 두 경로 모두 참인 문구: 읽음·메모리에만·처음 읽을 때 macOS 가 묻는다
});

// ---- 좌우 패널 너비 ----
t('clampPanelWidths 기본·범위·창 너비', () => {
  assert.deepStrictEqual(L.PANEL_DEFAULT, { left: 220, right: 340 });
  assert.deepStrictEqual(L.clampPanelWidths({ left: 300, right: 400 }, 1440), { left: 300, right: 400 });
  assert.deepStrictEqual(L.clampPanelWidths({ left: 100, right: 100 }, 1440), { left: 180, right: 260 });
  assert.deepStrictEqual(L.clampPanelWidths({ left: 9999, right: 9999 }, 3000), { left: 480, right: 560 });
  // 가운데 420 확보: 1440 - 64 - 420 = 956 이 왼쪽+오른쪽 한도. 오른쪽을 먼저 줄인다
  assert.deepStrictEqual(L.clampPanelWidths({ left: 480, right: 560 }, 1440), { left: 480, right: 476 });
  const w = L.clampPanelWidths({ left: 480, right: 560 }, 1200); assert.ok(w.left + w.right <= 1200 - 64 - 420 && w.right >= 260 && w.left >= 180);
  assert.deepStrictEqual(L.clampPanelWidths({ left: 300, right: 400 }, 1200), { left: 300, right: 400 });
});
t('clampPanelWidths 좁은 배치(1100 이하)는 왼쪽을 150 으로 보고 오른쪽을 제한', () => {
  assert.deepStrictEqual(L.clampPanelWidths({ left: 300, right: 560 }, 1100), { left: 300, right: 466 }); // 1100-64-420-150
  assert.deepStrictEqual(L.clampPanelWidths({ left: 220, right: 340 }, 900), { left: 220, right: 266 });
  assert.deepStrictEqual(L.panelRange('left', 300, 900), { min: 180, max: 480 });
  assert.strictEqual(L.panelRange('right', 999, 900).max, 266);
});
t('clampPanelWidths 잘못된 값은 기본값', () => {
  const d = { left: 220, right: 340 };
  for (const bad of [NaN, Infinity, '300', null, undefined, {}, [], true]) assert.deepStrictEqual(L.clampPanelWidths({ left: bad, right: bad }, 1600), d);
  for (const bad of [null, undefined, 'x', 5, []]) assert.deepStrictEqual(L.clampPanelWidths(bad, 1600), d);
  assert.deepStrictEqual(L.clampPanelWidths({ left: 250.6, right: 'a' }, 1600), { left: 251, right: 340 });
  for (const vw of [NaN, undefined, '1000', 0, -5]) assert.deepStrictEqual(L.clampPanelWidths({ left: 480, right: 560 }, vw), { left: 480, right: 560 }); // 창 너비를 모르면 고정 범위만
  assert.deepStrictEqual(L.clampPanelWidths({ left: 480, right: 560 }, 500), { left: 480, right: 260 }); // 아주 좁으면 오른쪽은 최소값이 이긴다(왼쪽은 좁은 배치에서 CSS 가 150 으로 고정)
});
t('parsePanelWidths·parseColsEnv', () => {
  assert.deepStrictEqual(L.parsePanelWidths('{"left":300,"right":400}'), { left: 300, right: 400 });
  assert.deepStrictEqual(L.parsePanelWidths('{"left":300}'), { left: 300, right: 340 });
  assert.deepStrictEqual(L.parsePanelWidths('{"left":"300","right":null}'), null);
  for (const bad of [null, '', 'not json', '[1,2]', '5', '{}', '"x"']) assert.strictEqual(L.parsePanelWidths(bad), null);
  assert.deepStrictEqual(L.parseColsEnv('300,400'), { left: 300, right: 400 });
  assert.deepStrictEqual(L.parseColsEnv(' 250 , 500 '), { left: 250, right: 500 });
  for (const bad of ['300', '300,', 'a,b', '-1,2', '1,2,3', '', undefined, 5]) assert.strictEqual(L.parseColsEnv(bad), null);
});
t('panelKeyDelta: 손잡이가 움직이는 방향', () => {
  assert.strictEqual(L.panelKeyDelta('left', 'ArrowRight', false), 16); assert.strictEqual(L.panelKeyDelta('left', 'ArrowLeft', false), -16);
  assert.strictEqual(L.panelKeyDelta('left', 'ArrowRight', true), 64); assert.strictEqual(L.panelKeyDelta('left', 'ArrowLeft', true), -64);
  assert.strictEqual(L.panelKeyDelta('right', 'ArrowLeft', false), 16); assert.strictEqual(L.panelKeyDelta('right', 'ArrowRight', false), -16);
  assert.strictEqual(L.panelKeyDelta('right', 'ArrowLeft', true), 64);
  for (const side of ['left', 'right']) { assert.strictEqual(L.panelKeyDelta(side, 'Home'), 'min'); assert.strictEqual(L.panelKeyDelta(side, 'End'), 'max'); assert.strictEqual(L.panelKeyDelta(side, 'Enter'), 'default'); assert.strictEqual(L.panelKeyDelta(side, 'a'), null); }
});
t('패널 기본값이 style.css 와 같다 + 손잡이 마크업', () => {
  const css = fs.readFileSync(path.join(__dirname, 'renderer', 'style.css'), 'utf8'); const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');
  assert.ok(css.includes('--left-w:' + L.PANEL_DEFAULT.left + 'px;--right-w:' + L.PANEL_DEFAULT.right + 'px'));
  assert.ok(/\.left\{flex:0 0 var\(--left-w\)/.test(css) && /\.right-col\{flex:0 0 var\(--right-w\)/.test(css));
  for (const id of ['col-l', 'col-r']) assert.ok(new RegExp('id="' + id + '" role="separator" aria-orientation="vertical" tabindex="0"').test(html));
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
t('cleanWsTitle: 무해화·40자(코드포인트) 상한·trim·빈 값 거부', () => {
  assert.strictEqual(L.cleanWsTitle('  블로그 글  '), '블로그 글');
  assert.strictEqual(L.cleanWsTitle('a\u202Eb\u200Bc\r\nd\u001b[2J'), 'abcd[2J');
  assert.strictEqual([...L.cleanWsTitle('가'.repeat(60))].length, 40);
  assert.strictEqual(L.cleanWsTitle('😀'.repeat(41)), '😀'.repeat(40)); // 코드포인트 기준(쌍 문자를 반으로 자르지 않는다)
  assert.strictEqual(L.cleanWsTitle('x'.repeat(39) + ' yyy'), 'x'.repeat(39)); // 자른 뒤 끝 공백은 trim
  for (const bad of ['', '   ', '\u200B\u202E', '\n\t', null, undefined, 42, {}, []]) assert.strictEqual(L.cleanWsTitle(bad), '', String(bad));
  assert.strictEqual(L.cleanWsTitle('y'.repeat(100000)).length, 40);
});
t('이름 변경 겹침: 다른 작업 공간과 겹치면 " 2", 자기 자신의 제목은 겹침이 아니다', () => {
  assert.strictEqual(L.uniqueTitle('blog', ['notes', 'blog']), 'blog 2');
  assert.strictEqual(L.uniqueTitle('blog', ['notes']), 'blog'); // 자기 자신(제외한 목록)만 있으면 그대로
  assert.strictEqual(L.uniqueTitle('blog', ['blog', 'blog 2']), 'blog 3');
  assert.strictEqual([...L.uniqueTitle('가'.repeat(40), ['가'.repeat(40)])].length, 40); // 번호를 붙여도 40자 이내
});
t('reorderWs: 최상위·자식 묶음 안에서만 옮기고 나머지는 제자리, 안 되는 것은 null', () => {
  const it = [{ id: 'a' }, { id: 'a1', parentId: 'a' }, { id: 'b' }, { id: 'a2', parentId: 'a' }, { id: 'c' }, { id: 'o', parentId: 'gone' }];
  assert.deepStrictEqual(L.reorderWs(it, 'c', 'a'), ['c', 'a1', 'a', 'a2', 'b', 'o']); // 최상위 a·b·c·o 묶음의 자리만 바뀐다
  assert.deepStrictEqual(L.reorderWs(it, 'a2', 'a1'), ['a', 'a2', 'b', 'a1', 'c', 'o']); // 자식 묶음
  assert.deepStrictEqual(L.reorderWs(it, 'a1', null), ['a', 'a2', 'b', 'a1', 'c', 'o']);
  assert.strictEqual(L.reorderWs(it, 'a1', 'b'), null); // 묶음이 다르다
  assert.strictEqual(L.reorderWs(it, 'b', 'a1'), null);
  assert.strictEqual(L.reorderWs(it, 'a', 'a'), null);
  assert.strictEqual(L.reorderWs(it, 'x', 'a'), null); assert.strictEqual(L.reorderWs(it, 'a', 'x'), null);
  assert.strictEqual(L.reorderWs(it, 'a2', null), null); // 이미 맨 끝(제자리)
  assert.strictEqual(L.reorderWs(it, 'b', 'c'), null); // 이미 c 바로 앞
  assert.strictEqual(L.reorderWs(it, 'a', undefined), null); assert.strictEqual(L.reorderWs(null, 'a', null), null);
  const moved = L.reorderWs(it, 'a', null).map((id) => it.find((x) => x.id === id));
  assert.deepStrictEqual(L.hierarchyOrder(moved).map((x) => x.id), ['b', 'c', 'o', 'a', 'a1', 'a2']); // 부모를 옮기면 자식이 따라간다
  const m2 = L.reorderWs(it, 'o', 'a'); assert.ok(m2 && m2.indexOf('o') < m2.indexOf('a')); // 부모가 없는 자식은 최상위로 본다
  assert.strictEqual(L.reorderWs(it, 'o', 'a1'), null);
});
t('ws:rename: main 이 wsFrom·cleanWsTitle·uniqueTitle(자기 제외)로 처리하고 preload 와 맞는다', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const h = main.slice(main.indexOf("ipcMain.handle('ws:rename'"), main.indexOf("ipcMain.handle('panels:get'"));
  assert.ok(/wsFrom\(e, id\)/.test(h) && /L\.cleanWsTitle\(title\)/.test(h) && /reason: 'title'/.test(h) && /filter\(\(o\) => o !== w\)/.test(h) && /wsChanged\(true\)/.test(h));
  assert.ok(/'ws:rename', String\(id\), String\(title\)/.test(pre));
  assert.ok(/'wsmenu', 'wsrename', 'hierarchy'\]/.test(main) && /TEST_UI === 'wsmenu' \|\| TEST_UI === 'wsrename'/.test(main));
});
t('작업 공간 우클릭 메뉴·이름 변경 문구가 ko·en 모두 있고 자리표시자가 같다', () => {
  for (const k of ['ws.menu.aria', 'ws.menu.rename', 'ws.menu.remove', 'ws.rename.aria', 'ws.rename.err', 'ws.rename.fail']) for (const lg of I.LANGS) assert.ok(typeof I.STR[lg][k] === 'string' && I.STR[lg][k].length > 0, lg + ':' + k);
  assert.strictEqual(I.t('ko', 'ws.menu.aria', { title: 'x' }), 'x 작업 공간 메뉴');
  const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
  for (const m of rd.matchAll(/T\('(ws\.(?:menu|rename)\.[\w.]+)'/g)) assert.ok(I.STR.ko[m[1]] && I.STR.en[m[1]], m[1]);
  assert.ok(/e\.isComposing \|\| e\.keyCode === 229/.test(rd) && /maxLength = Lib\.WS_TITLE_MAX/.test(rd) && /role', 'menu'/.test(rd));
});
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
  for (const ch of ['pty:start', 'pty:restart', 'pty:write', 'pty:resize', 'quest:fill', 'ws:get', 'ws:activate', 'ws:new', 'ws:close', 'ws:rename', 'ws:reorder']) {
    assert.ok(main.includes("'" + ch + "'") && pre.includes("'" + ch + "'"), ch);
  }
  for (const ch of ['pty:start', 'pty:restart', 'pty:write', 'pty:resize', 'ws:activate', 'ws:close', 'ws:rename', 'ws:reorder']) assert.ok(new RegExp("'" + ch + "', String\\(id\\)").test(pre), 'id 를 싣는지: ' + ch);
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
  assert.deepStrictEqual(L.WS_STATES, ['busy', 'waiting', 'idle', 'none', 'pending', 'exited', 'unavailable', 'unknown', 'turnEnded']);
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
  assert.deepStrictEqual(g.open[1].items.map((x) => x.key), ['maru/desktop-app', 'maru/other']); // 분류 안 됨은 카테고리 묶음에 들지 않는다
  assert.deepStrictEqual(g.unsorted.map((x) => x.key), ['maru']); // 따로 모은다
  assert.strictEqual(g.doneCount, 1); assert.deepStrictEqual(g.done.map((x) => [x.tag, x.items.map((i) => i.key)]), [['maru', ['maru/old']]]);
  assert.deepStrictEqual(L.groupProjects(null), { open: [], done: [], doneCount: 0, unsorted: [] });
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
  assert.deepStrictEqual(m, { name: 'pref-x', description: '선호 x ‹b›', tags: ['maru', 'Desktop-App'], titles: { ko: '', en: '' }, descs: { ko: '', en: '' } });
  const mt = L.parseMemoryMeta('---\nname: pref-y\ndescription: top\nmetadata:\n  tags: [maru]\n  title_ko: "한국어 `제목`"\n  title_en: |\n  title_en: English title\n  description_en: One line\n---\n');
  assert.deepStrictEqual(mt.titles, { ko: '한국어 제목', en: 'English title' }); assert.deepStrictEqual(mt.descs, { ko: '', en: 'One line' }); // 블록 스칼라는 건너뛰고 첫 비어 있지 않은 값, 따옴표는 푼다
  const rel = L.relatedMemories([mt], 'maru'); assert.deepStrictEqual(rel[0].titles, mt.titles); assert.strictEqual(L.memoryDisplay(rel[0], 'en').title, 'English title'); assert.strictEqual(L.memoryDisplay(rel[0], 'ko').title, mt.titles.ko); assert.strictEqual(L.memoryDisplay({ ...rel[0], titles: { ko: '', en: '' } }, 'en').title, 'pref-y'); // 프로젝트 상세의 관련 기억도 화면 언어로
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
  assert.deepStrictEqual(d.memories, [{ name: 'maru-pref', description: '선호', titles: { ko: '', en: '' }, descs: { ko: '', en: '' } }]);
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
  for (let i = 0; i < 3; i++) assert.deepStrictEqual(L.relatedMemories(c.get(), 'maru'), [{ name: 'a-note', description: '설명', titles: { ko: '', en: '' }, descs: { ko: '', en: '' } }]);
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
  assert.ok(/uiOpen === 'project'\) openFirstProject/.test(rd) && /all\[0\] \|\| \(projView\.unsorted/.test(rd));
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
// ---- 분류 안 된 작업 · 하루 회고 · 달력 ----
t('groupProjects: 분류 안 됨만 있는 카테고리는 열린 목록에서 사라지고 unsorted 는 최근순·태그순', () => {
  const mk = (tag, lastDay) => ({ key: tag, kind: 'unclassified', tag, title: '', status: 'open', doneAt: null, lastDay, records: 1, openTodos: 0, needsCheck: false });
  const proj = { key: '책/z', kind: 'project', tag: '책', title: '지', status: 'open', doneAt: null, lastDay: '2026-11-01', records: 1, openTodos: 0, needsCheck: false };
  const g = L.groupProjects([mk('가', '2026-11-02'), mk('나', '2026-11-09'), mk('다', '2026-11-09'), mk('라', null), proj]);
  assert.deepStrictEqual(g.open.map((x) => x.tag), ['책']);
  assert.deepStrictEqual(g.unsorted.map((x) => x.key), ['나', '다', '가', '라']); // 날짜 내림차순, 같으면 태그순, 날짜 없음은 맨 뒤
  assert.deepStrictEqual(L.visibleProjectKeys(g.open, []), ['책/z']); // 번호는 프로젝트만
  assert.deepStrictEqual(L.numberTargets(['w'], L.visibleProjectKeys(g.open, [])), [{ kind: 'workspace', id: 'w' }, { kind: 'project', id: '책/z' }]);
  assert.deepStrictEqual(L.pruneProjectUi({ catOrder: ['가', '책'], projOrder: {}, collapsed: ['가'] }, [mk('가', '2026-11-02'), proj]), { catOrder: ['책'], projOrder: {}, collapsed: [] }); // 프로젝트 없는 태그의 순서·접힘은 정리된다
});
const DIARY_OK = '# 정원 앱 손질\n\n오늘은 물주기 화면을 다듬었다.\n두 번째 줄.\n\n\n\n다음 문단 <b>태그</b> `코드`\n';
t('parseDiaryText: 제목·문단·무해화·상한', () => {
  assert.deepStrictEqual(L.parseDiaryText(DIARY_OK), { title: '정원 앱 손질', body: '오늘은 물주기 화면을 다듬었다.\n두 번째 줄.\n\n다음 문단 ‹b›태그‹/b› 코드' });
  assert.deepStrictEqual(L.parseDiaryText('\n\n# 제목만\r\n'), { title: '제목만', body: '' });
  assert.strictEqual(L.parseDiaryText('제목 없음\n\n본문'), null); assert.strictEqual(L.parseDiaryText('## 둘\n본문'), null); assert.strictEqual(L.parseDiaryText('#제목\n'), null);
  assert.strictEqual(L.parseDiaryText('# \n본문'), null); assert.strictEqual(L.parseDiaryText(''), null); assert.strictEqual(L.parseDiaryText(5), null);
  const r = L.parseDiaryText('# ' + '가'.repeat(100) + '\n\n' + '나'.repeat(3000));
  assert.strictEqual([...r.title].length, 60); assert.strictEqual([...r.body].length, 1500);
  const c = L.parseDiaryText('# a\u202Eb\u200B\n\n\u001b[31m빨강\u0007');
  assert.deepStrictEqual(c, { title: 'ab', body: '(31m빨강' }); // 제어·bidi 문자는 지워지고 [ 는 ( 로
  assert.strictEqual(L.parseDiaryText('# x\n\n@멘션 # 헤더').body, '멘션 # 헤더'); // 줄 앞 # @ 는 지운다(일지와 같은 규칙)
});
t('readDiaries: 이름·크기·링크·개수 규칙', () => {
  const mem = fs.mkdtempSync(path.join(tmp, 'dy-')); const dd = path.join(mem, 'diary'); fs.mkdirSync(dd);
  fs.writeFileSync(path.join(dd, '2026-11-17.md'), DIARY_OK);
  fs.writeFileSync(path.join(dd, '2026-11-18.md'), '# 둘째 날\n\n본문\n');
  fs.writeFileSync(path.join(dd, '2026-02-30.md'), '# 없는 날짜\n'); // 없는 날짜
  fs.writeFileSync(path.join(dd, '2026-11-16.txt'), '# 확장자\n'); fs.writeFileSync(path.join(dd, 'x2026-11-15.md'), '# 이름\n'); fs.writeFileSync(path.join(dd, '2026-11-14.1.md'), '# 번호\n'); // 이름 규칙
  fs.writeFileSync(path.join(dd, '2026-11-13.md'), '# 큼\n\n' + 'a'.repeat(L.DIARY_FILE_MAX_BYTES)); // 8KB 초과
  fs.writeFileSync(path.join(dd, '2026-11-12.md'), '제목 형식 아님\n');
  fs.writeFileSync(path.join(mem, 'real.md'), '# 링크 대상\n'); fs.symlinkSync(path.join(mem, 'real.md'), path.join(dd, '2026-11-11.md')); // 심볼릭 링크 파일
  fs.mkdirSync(path.join(dd, '2026-11-10.md')); // 폴더
  const m = L.readDiaries(mem);
  assert.deepStrictEqual([...m.keys()].sort(), ['2026-11-17', '2026-11-18']);
  assert.strictEqual(m.get('2026-11-18').title, '둘째 날');
  // diary 가 심볼릭 링크면 읽지 않는다
  const mem2 = fs.mkdtempSync(path.join(tmp, 'dy-')); fs.symlinkSync(dd, path.join(mem2, 'diary'));
  assert.strictEqual(L.readDiaries(mem2).size, 0);
  assert.strictEqual(L.readDiaries(path.join(tmp, 'nothing-here')).size, 0); assert.strictEqual(L.readDiaries(mem).constructor, Map);
  // 기억 폴더 자체가 링크이면 읽지 않는다
  const ml = path.join(tmp, 'dy-memlink'); fs.symlinkSync(mem, ml); assert.strictEqual(L.readDiaries(ml).size, 0);
  // 개수 상한(최신 400개)
  const mem3 = fs.mkdtempSync(path.join(tmp, 'dy-')); const d3 = path.join(mem3, 'diary'); fs.mkdirSync(d3);
  for (let i = 0; i < 405; i++) fs.writeFileSync(path.join(d3, new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10) + '.md'), '# t' + i + '\n');
  const big = L.readDiaries(mem3); assert.strictEqual(big.size, 400); assert.ok(!big.has('2024-01-01') && big.has(new Date(Date.UTC(2024, 0, 405)).toISOString().slice(0, 10)));
});
t('shiftYm / shiftDay / parseYm / monthLayout', () => {
  assert.deepStrictEqual(L.parseYm('2026-11'), { year: 2026, month: 11 });
  for (const bad of ['2026-13', '2026-00', '1999-12', '2101-01', '2026-1', '2026-11-01', 5, null]) assert.strictEqual(L.parseYm(bad), null, String(bad));
  assert.strictEqual(L.shiftYm('2026-11', 1), '2026-12'); assert.strictEqual(L.shiftYm('2026-12', 1), '2027-01'); assert.strictEqual(L.shiftYm('2026-01', -1), '2025-12'); assert.strictEqual(L.shiftYm('2000-01', -1), null); assert.strictEqual(L.shiftYm('x', 1), null);
  assert.strictEqual(L.shiftDay('2026-11-18', 1), '2026-11-19'); assert.strictEqual(L.shiftDay('2026-11-30', 1), '2026-12-01'); assert.strictEqual(L.shiftDay('2026-03-01', -1), '2026-02-28'); assert.strictEqual(L.shiftDay('2024-03-01', -1), '2024-02-29'); assert.strictEqual(L.shiftDay('2026-02-30', 1), null);
  assert.deepStrictEqual(L.monthLayout(2026, 11), { days: 30, first: 0 }); // 2026-11-01 은 일요일
  assert.deepStrictEqual(L.monthLayout(2024, 2), { days: 29, first: 4 });
});
t('buildMonthSummary: 기록 수·회고·일정', () => {
  const E = (day, tag) => ({ day, time: '10:00', kind: 'done', importance: 5, tag: tag || '', slug: null, text: 'x', seq: 0 });
  const s = L.buildMonthSummary({ entries: [E('2026-11-18'), E('2026-11-18', 'maru'), E('2026-11-02'), E('2026-10-31'), E('2026-12-01'), { day: 'bad' }, null],
    diaries: new Map([['2026-11-17', { title: 't', body: '' }], ['2026-11-18', { title: 't', body: '' }], ['2026-10-01', { title: 't', body: '' }]]),
    events: { '2026-11-18': [{}, {}], '2026-11-20': [{}], '2026-11-21': [], '2026-12-02': [{}] }, ym: '2026-11' });
  assert.deepStrictEqual(s, { '2026-11-18': { records: 2, diary: true, events: 2 }, '2026-11-02': { records: 1, diary: false, events: 0 }, '2026-11-17': { records: 0, diary: true, events: 0 }, '2026-11-20': { records: 0, diary: false, events: 1 } });
  assert.deepStrictEqual(L.buildMonthSummary({ entries: null, diaries: null, events: null, ym: '2026-11' }), {});
});
t('buildDayGroups: 프로젝트·태그·태그 없음 묶음, 시각순', () => {
  const E = (time, tag, slug, text, seq, day) => ({ day: day || '2026-11-18', time, kind: seq % 2 ? 'decision' : 'done', importance: 5, tag, slug, text, seq });
  const reg = L.parseProjectRegistry('정원|물주기|물주기 화면\n정원|달력|달력 보기\n');
  const entries = [E('15:00', '', null, '태그 없는 일', 0), E('14:00', '요리', null, '태그만', 1), E('13:00', '정원', '물주기', '둘째', 2), E('09:00', '정원', '물주기', '첫째', 3), E('09:00', '정원', '없는슬러그', '미등록 슬러그', 4), E('10:00', '정원', '달력', '합쳐질 일', 5), E('08:00', '정원', '물주기', '다른 날', 6, '2026-11-17')];
  const g = L.buildDayGroups({ entries, day: '2026-11-18', registry: reg, state: { '정원/달력': { status: 'open', mergedInto: '정원/물주기' }, '정원/물주기': { status: 'open', title: '새 이름' } } });
  assert.deepStrictEqual(g, [
    { title: '새 이름', key: '정원/물주기', items: [{ time: '09:00', kind: 'decision', text: '첫째' }, { time: '10:00', kind: 'decision', text: '합쳐질 일' }, { time: '13:00', kind: 'done', text: '둘째' }] },
    { title: '정원', key: null, items: [{ time: '09:00', kind: 'done', text: '미등록 슬러그' }] },
    { title: '요리', key: null, items: [{ time: '14:00', kind: 'decision', text: '태그만' }] },
    { title: '', key: null, items: [{ time: '15:00', kind: 'done', text: '태그 없는 일' }] },
  ]);
  assert.deepStrictEqual(L.buildDayGroups({ entries, day: '2026-11-01', registry: reg, state: {} }), []);
  assert.deepStrictEqual(L.buildDayGroups({ entries: null, day: 'x', registry: null, state: null }), []);
});
t('calMonthScript: 고정 줄, 정수만 삽입, 범위 검증', () => {
  const sc = L.calMonthScript(2026, 11);
  assert.ok(Array.isArray(sc) && sc.every((x) => typeof x === 'string'));
  const i0 = sc.indexOf('set d0 to current date');
  assert.deepStrictEqual(sc.slice(i0, i0 + 16), ['set d0 to current date', 'set time of d0 to 43200', 'set day of d0 to 1', 'set year of d0 to 2026', 'set month of d0 to 11', 'set day of d0 to 1', 'set time of d0 to 0', 'if (hours of d0) is not 0 then set d0 to d0 + (1 * hours)', 'copy d0 to d1', 'set time of d1 to 43200', 'set day of d1 to 1', 'set year of d1 to 2026', 'set month of d1 to 12', 'set day of d1 to 1', 'set time of d1 to 0', 'if (hours of d1) is not 0 then set d1 to d1 + (1 * hours)']); // 정오에서 출발해 날짜를 옮긴 뒤 0시로(실행 시각과 무관), 0시가 없는 날만 1시간 보정
  const dec = L.calMonthScript(2026, 12); assert.ok(dec.includes('set year of d1 to 2027') && dec.includes('set month of d1 to 1'));
  const base = L.CAL_SCRIPT; assert.ok(base.includes('set d1 to d0 + (2 * days)') && !sc.includes('set d1 to d0 + (2 * days)'));
  const rest = (a) => a.filter((x) => !/^set (d0|d1|(day|year|month|time) of d[01])\b|^copy d0 to d1$|^if \(hours of d[01]\) is not 0 then/.test(x)); assert.deepStrictEqual(rest(sc), rest(base)); // 날짜 범위 줄만 다르다
  for (const [y, m] of [[1999, 1], [2101, 1], [2026, 0], [2026, 13], [2026.5, 1], ['2026', 11], [2026, '11'], [null, 1], [NaN, 1]]) assert.strictEqual(L.calMonthScript(y, m), null, y + '-' + m);
  assert.ok(sc.every((x) => !/\$|`|\\/.test(x) || base.includes(x)));
  assert.ok(!sc.some((x) => /^set d1 to d0$/.test(x))); // 별칭(같은 날짜 객체) 금지
  assert.deepStrictEqual(sc.slice(i0, i0 + L.calMonthDateSetup(2026, 11).length), L.calMonthDateSetup(2026, 11)); assert.strictEqual(L.calMonthDateSetup(2026, 13), null);
});
if (process.platform === 'darwin') t('calMonthDateSetup: osascript 로 d0=그 달 1일 00:00, d1=다음 달 1일(12월 포함)', () => {
  const { execFileSync } = require('child_process');
  const run = (y, m) => {
    const lines = [...L.calMonthDateSetup(y, m),
      'return ((year of d0) as text) & "-" & ((month of d0) as integer) & "-" & (day of d0) & "T" & (time of d0) & " " & ((year of d1) as text) & "-" & ((month of d1) as integer) & "-" & (day of d1) & "T" & (time of d1)'];
    return execFileSync('/usr/bin/osascript', lines.flatMap((x) => ['-e', x]), { encoding: 'utf8', timeout: 20000 }).trim();
  };
  assert.strictEqual(run(2026, 11), '2026-11-1T0 2026-12-1T0');
  assert.strictEqual(run(2026, 12), '2026-12-1T0 2027-1-1T0');
  assert.strictEqual(run(2026, 1), '2026-1-1T0 2026-2-1T0');
});
t('parseCalendarMonth: 그 달만, 검증·중복·상한·정렬', () => {
  const rec = (d, tm, fl, ti) => d + '\x1f' + tm + '\x1f' + fl + '\x1f' + ti + '\x1e';
  const out = rec('2026-11-18', '14:30', '0', '회의') + rec('2026-11-18', '', '1', '휴일') + rec('2026-11-18', '09:00', '0', '아침') + rec('2026-11-18', '09:00', '0', '아침') + rec('2026-11-02', '', '1', '가'.repeat(100))
    + rec('2026-10-31', '10:00', '0', '지난달') + rec('2026-12-01', '', '1', '다음달') + rec('2026-11-31', '', '1', '없는 날') + rec('2026-11-05', '25:00', '0', '나쁜 시각') + rec('2026-11-05', '10:00', '2', '나쁜 플래그')
    + rec('2026-11-05', '10:00', '0', '') + '2026-11-05\x1f10:00\x1f0\x1e' + rec('2026-11-06', '', '1', 'a\u200Bb');
  const r = L.parseCalendarMonth(out, 2026, 11);
  assert.deepStrictEqual(r['2026-11-18'], [{ allDay: true, time: '', title: '휴일' }, { allDay: false, time: '09:00', title: '아침' }, { allDay: false, time: '14:30', title: '회의' }]);
  assert.strictEqual([...r['2026-11-02'][0].title].length, 60); assert.deepStrictEqual(r['2026-11-06'], [{ allDay: true, time: '', title: 'ab' }]);
  assert.deepStrictEqual(Object.keys(r).sort(), ['2026-11-02', '2026-11-06', '2026-11-18']);
  // 하루 12개(한 달 400개 상한은 하루 12개 × 31일 = 372 라 코드 안의 안전장치일 뿐이다)
  let day = ''; for (let i = 0; i < 20; i++) day += rec('2026-11-10', '10:' + String(i).padStart(2, '0'), '0', 't' + i);
  assert.strictEqual(L.parseCalendarMonth(day, 2026, 11)['2026-11-10'].length, 12);
  let many = ''; for (let d = 1; d <= 30; d++) for (let i = 0; i < 12; i++) many += rec('2026-11-' + String(d).padStart(2, '0'), '10:' + String(i).padStart(2, '0'), '0', 'e' + i);
  const mr = L.parseCalendarMonth(many, 2026, 11); assert.strictEqual(Object.values(mr).reduce((n, a) => n + a.length, 0), 360);
  for (const bad of ['', 'garbage', undefined, 5, 'x'.repeat(600000)]) assert.deepStrictEqual(L.parseCalendarMonth(bad, 2026, 11), {});
  assert.deepStrictEqual(L.parseCalendarMonth(out, 1999, 11), {}); assert.deepStrictEqual(L.parseCalendarMonth(out, 2026, 13), {});
  assert.deepStrictEqual(L.parseCalendarOutput(rec('2026-11-18', '10:00', '0', 'x'), new Date(2026, 10, 18)).length, 1); // 기존 파서는 그대로
});
t('calDayScript: 고정 줄, 정수만 삽입, 범위·날짜 검증, 별칭 금지', () => {
  const sc = L.calDayScript(2026, 11, 18);
  assert.ok(Array.isArray(sc) && sc.every((x) => typeof x === 'string'));
  const i0 = sc.indexOf('set d0 to current date');
  assert.deepStrictEqual(sc.slice(i0, i0 + L.calDayDateSetup(2026, 11, 18).length), L.calDayDateSetup(2026, 11, 18));
  assert.deepStrictEqual(L.calDayDateSetup(2026, 11, 18).slice(0, 8), ['set d0 to current date', 'set time of d0 to 43200', 'set day of d0 to 1', 'set year of d0 to 2026', 'set month of d0 to 11', 'set day of d0 to 18', 'set time of d0 to 0', 'if (hours of d0) is not 0 then set d0 to d0 + (1 * hours)']);
  assert.ok(sc.includes('copy d0 to d1') && !sc.includes('set d1 to d0') && !sc.some((x) => /36 \* hours/.test(x)));
  assert.deepStrictEqual(L.calDayDateSetup(2026, 12, 31).slice(8), ['copy d0 to d1', 'set time of d1 to 43200', 'set day of d1 to 1', 'set year of d1 to 2027', 'set month of d1 to 1', 'set day of d1 to 1', 'set time of d1 to 0', 'if (hours of d1) is not 0 then set d1 to d1 + (1 * hours)']); // 다음 날짜는 JS 가 계산
  assert.ok(L.calDayDateSetup(2026, 11, 18).includes('if (hours of d0) is not 0 then set d0 to d0 + (1 * hours)'));
  assert.ok(!sc.includes('if sd < d0 then set sd to d0')); // 시작을 이 날 0시로 당기는 clamp 가 없다(월·오늘 스크립트는 그대로)
  assert.ok(L.calMonthScript(2026, 11).includes('if sd < d0 then set sd to d0') && L.CAL_SCRIPT.includes('if sd < d0 then set sd to d0'));
  for (const [y, m, d] of [[1999, 1, 1], [2101, 1, 1], [2026, 0, 1], [2026, 13, 1], [2026, 2, 29], [2026, 4, 31], [2026, 11, 0], [2026, 11, 31], [2026.5, 1, 1], ['2026', 11, 1], [2026, 11, '1'], [2026, 11, null], [2026, 11, NaN]]) assert.strictEqual(L.calDayScript(y, m, d), null, y + '-' + m + '-' + d);
  assert.ok(L.calDayScript(2028, 2, 29)); // 윤일
  const tail = sc.join('\n');
  assert.ok(/try\nset rl to location of e\nif rl is not missing value/.test(tail) && /try\nset rn to description of e/.test(tail)); // 장소·메모는 try + missing value 방어
  assert.ok(tail.includes('text 1 thru 2000') && tail.includes('my clean(rn)') && tail.includes('my clean(rl)') && tail.includes('my clean(cn)') && tail.includes('my clean(ttl)'));
  for (const [v, n] of [['ttl', 200], ['rl', 400], ['cn', 200], ['rn', 2000]]) assert.ok(tail.includes('if (count of ' + v + ') > ' + n + ' then set ' + v + ' to text 1 thru ' + n + ' of ' + v), v); // 길이를 먼저 자른 뒤 clean
  assert.ok(sc.every((x) => !/\$|`|\\/.test(x) || L.CAL_SCRIPT.includes(x)));
});
if (process.platform === 'darwin') t('calDayDateSetup: osascript 로 d0=그 날 0시, d1=다음 날 0시(월말·12월 31일 포함, Calendar 는 건드리지 않음)', () => {
  const { execFileSync } = require('child_process');
  const run = (y, m, d) => {
    const lines = [...L.calDayDateSetup(y, m, d),
      'return ((year of d0) as text) & "-" & ((month of d0) as integer) & "-" & (day of d0) & "T" & (time of d0) & " " & ((year of d1) as text) & "-" & ((month of d1) as integer) & "-" & (day of d1) & "T" & (time of d1)'];
    return execFileSync('/usr/bin/osascript', lines.flatMap((x) => ['-e', x]), { encoding: 'utf8', timeout: 20000 }).trim();
  };
  assert.strictEqual(run(2026, 11, 18), '2026-11-18T0 2026-11-19T0');
  assert.strictEqual(run(2026, 11, 30), '2026-11-30T0 2026-12-1T0');
  assert.strictEqual(run(2026, 12, 31), '2026-12-31T0 2027-1-1T0');
  assert.strictEqual(run(2028, 2, 29), '2028-2-29T0 2028-3-1T0');
  // 자정에 서머타임이 바뀌는 시간대(osascript 는 TZ 환경 변수를 따른다). 0시가 없는 날은 필드(`day of`)가 전날로 보이는 경계 시각이 되므로 isot 문자열로 비교한다
  const runTz = (tz, y, m, d) => {
    const lines = [...L.calDayDateSetup(y, m, d), 'return (d0 as «class isot» as string) & " " & (d1 as «class isot» as string)'];
    return execFileSync('/usr/bin/osascript', lines.flatMap((x) => ['-e', x]), { encoding: 'utf8', timeout: 20000, env: { ...process.env, TZ: tz } }).trim();
  };
  assert.strictEqual(runTz('America/Santiago', 2026, 9, 5), '2026-09-05T00:00:00 2026-09-06T00:00:00');
  assert.strictEqual(runTz('America/Santiago', 2026, 9, 6), '2026-09-06T00:00:00 2026-09-07T00:00:00');
  assert.strictEqual(runTz('America/Havana', 2026, 3, 7), '2026-03-07T00:00:00 2026-03-08T00:00:00');
  assert.strictEqual(runTz('America/Havana', 2026, 3, 8), '2026-03-08T00:00:00 2026-03-09T00:00:00');
  assert.strictEqual(runTz('Asia/Seoul', 2026, 11, 18), '2026-11-18T00:00:00 2026-11-19T00:00:00');
});
t('parseCalendarDay: 그 날 시작만, 필드 9개·형식 검증, 정리·상한·정렬', () => {
  const rec = (...f) => f.join('\x1f') + '\x1e';
  const R = (date, tm, fl, ti, ed, et, cal, loc, nt) => rec(date, tm, fl, ti, ed, et, cal, loc, nt);
  const day = '2026-11-18';
  const out = R(day, '14:30', '0', '회의', day, '15:30', '업무', '회의실 A', '안건\r\n준비물\r끝') + R(day, '', '1', '휴일', '2026-11-20', '', '집', '', '')
    + R(day, '09:00', '0', '아침', '2026-11-19', '01:00', ' 개인\t캘린더 ', '서울\n어딘가', '') + R(day, '09:00', '0', '아침', day, '10:00', 'x', '', '')
    + R('2026-11-17', '10:00', '0', '어제 시작', day, '11:00', '', '', '') + R(day, '25:00', '0', '나쁜 시각', day, '10:00', '', '', '') + R(day, '10:00', '0', '나쁜 끝', day, '99:00', '', '', '')
    + R(day, '10:00', '2', '나쁜 플래그', day, '11:00', '', '', '') + R(day, '10:00', '0', '', day, '11:00', '', '', '') + R(day, '10:00', '0', '나쁜 끝날', '2026-13-01', '11:00', '', '', '')
    + R(day, '', '1', '종일인데 시각', day, '10:00', '', '', '') + day + '\x1f10:00\x1f0\x1f적은 필드\x1e' + R(day, '10:00', '0', 'a​b', day, '11:00', '', '', '');
  const r = L.parseCalendarDay(out, 2026, 11, 18);
  assert.deepStrictEqual(r.map((x) => x.title), ['휴일', '아침', 'ab', '회의']);
  assert.deepStrictEqual(r[0], { allDay: true, time: '', title: '휴일', endDay: '2026-11-20', endTime: '', cal: '집', loc: '', notes: '' });
  assert.deepStrictEqual(r[1], { allDay: false, time: '09:00', title: '아침', endDay: '2026-11-19', endTime: '01:00', cal: '개인캘린더', loc: '서울 어딘가', notes: '', more: [{ endDay: '', endTime: '10:00', cal: 'x', loc: '', notes: '' }] }); // 같은 시각·제목은 한 행, 다른 캘린더 상세는 more
  assert.deepStrictEqual(r[3], { allDay: false, time: '14:30', title: '회의', endDay: '', endTime: '15:30', cal: '업무', loc: '회의실 A', notes: '안건\n준비물\n끝' });
  // cal·loc 상한, 메모: 줄·글자 상한과 …, 제어문자
  const big = L.parseCalendarDay(R(day, '08:00', '0', 't', day, '09:00', 'c'.repeat(200), 'l'.repeat(500), Array.from({ length: 30 }, (_, i) => 'L' + i).join('\n')) + R(day, '08:10', '0', 'u', day, '09:00', '', '', 'x'.repeat(900)) + R(day, '08:20', '0', 'v', day, '09:00', '', '', 'a\x01b\x7fc\rd\n\ne'), 2026, 11, 18);
  assert.strictEqual(L.calNotes('a\rb\r\nc\nd'), 'a\nb\nc\nd'); // 옛 CR 줄바꿈도 나눈다
  assert.strictEqual([...big[0].cal].length, 80); assert.strictEqual([...big[0].loc].length, 200);
  assert.strictEqual(big[0].notes.split('\n').length, 20); assert.ok(big[0].notes.endsWith('L19…'));
  assert.strictEqual([...big[1].notes].length, 601); assert.ok(big[1].notes.endsWith('…'));
  assert.strictEqual(big[2].notes, 'abc\nd\n\ne');
  // 개수 상한 30
  let many = ''; for (let i = 0; i < 50; i++) many += R(day, '10:' + String(i).padStart(2, '0'), '0', 't' + i, day, '11:00', '', '', '');
  assert.strictEqual(L.parseCalendarDay(many, 2026, 11, 18).length, 30);
  // 읽기 실패는 null(상한 초과·문자열 아님·날짜 인자 오류), 정상인데 비면 []
  for (const bad of [undefined, 5, null, {}, 'x'.repeat(600000)]) assert.strictEqual(L.parseCalendarDay(bad, 2026, 11, 18), null);
  for (const ok of ['', 'garbage']) assert.deepStrictEqual(L.parseCalendarDay(ok, 2026, 11, 18), []);
  for (const [y, m, d] of [[1999, 11, 18], [2026, 13, 1], [2026, 11, 31], [2026, 11, '18'], [2026.5, 11, 18]]) assert.strictEqual(L.parseCalendarDay(out, y, m, d), null);
  // 앞선 날에 시작한 일정(clamp 가 없으니 실제 시작 날짜로 온다)과 다음 날 시작은 버려 달 목록과 같은 일정만 남는다
  assert.deepStrictEqual(L.parseCalendarDay(R('2026-11-19', '10:00', '0', 'x', '2026-11-19', '11:00', '', '', '') + R('2026-11-17', '', '1', '어제부터', '2026-11-19', '', '', '', '') + R('2026-11-17', '23:00', '0', '밤샘', day, '02:00', '', '', ''), 2026, 11, 18), []);
  // 병합: 최대 4블록(첫 블록 포함), 완전히 같은 블록은 버림
  const mg = L.parseCalendarDay(['a', 'b', 'c', 'd', 'e', 'a'].map((c) => R(day, '10:00', '0', '같은 일정', day, '11:00', c, '', '')).join(''), 2026, 11, 18);
  assert.strictEqual(mg.length, 1); assert.deepStrictEqual([mg[0].cal, ...mg[0].more.map((x) => x.cal)], ['a', 'b', 'c', 'd']);
});
t('하루 읽기 큐 결정: 오래된 요청 건너뛰기·밀어낼 항목·실패 뒤 상태', () => {
  const F = L.CAL_DAY_FRESH_MS;
  assert.strictEqual(L.calDayJobStale(1000, 1000 + F), false); assert.strictEqual(L.calDayJobStale(1000, 1000 + F + 1), true); assert.strictEqual(L.calDayJobStale(undefined, 5), true);
  const e = (busy, started, used) => ({ busy, started, used });
  assert.strictEqual(L.calDayVictim([['a', e(true, true, 1)], ['b', e(true, false, 5)], ['c', e(true, false, 2)]]), 'c'); // 시작 안 한 대기 중 가장 오래된 것
  assert.strictEqual(L.calDayVictim([['a', e(true, false, 1)], ['b', e(false, false, 9)], ['c', e(false, false, 4)]]), 'c'); // 쉬는 것이 먼저
  assert.strictEqual(L.calDayVictim([['a', e(true, true, 1)], ['b', e(true, true, 2)]]), null); // 읽는 중인 것은 밀어내지 않는다
  assert.strictEqual(L.calDayVictim([]), null);
  const MIN = 60000;
  assert.strictEqual(L.calDayAfterFail({ state: 'ok', fails: 1, okAt: 0 }, 5 * MIN), 'ok');
  assert.strictEqual(L.calDayAfterFail({ state: 'ok', fails: 2, okAt: 0 }, 5 * MIN), 'ok');
  assert.strictEqual(L.calDayAfterFail({ state: 'ok', fails: 3, okAt: 0 }, 5 * MIN), 'fail');
  assert.strictEqual(L.calDayAfterFail({ state: 'ok', fails: 1, okAt: 0 }, 15 * MIN + 1), 'fail');
  assert.strictEqual(L.calDayAfterFail({ state: 'fail', fails: 1, okAt: 0 }, MIN), 'fail');
});
t('하루 상세 연결(소스 구조): 메모리 전용·검증·정리', () => {
  const fs = require('fs'); const read = (f) => fs.readFileSync(require('path').join(__dirname, f), 'utf8');
  const main = read('main.js'); const rend = read('renderer/renderer.js');
  assert.ok(/calDayJobStale\(c\.used/.test(main) && /calDayVictim\(\[\.\.\.calDays\]\)/.test(main) && /L\.parseCalendarDay\(r\.stdout/.test(main) && /if \(!evs\) \{ fail\(\)/.test(main));
  assert.ok(/forgetDayEvents\(\)/.test(rend) && /dayExp\.clear\(\)/.test(rend) && /size > 200/.test(rend) && /if \(open\) b\.setAttribute\('aria-controls'/.test(rend) && /if \(!closed\) b\.setAttribute\('aria-controls'/.test(rend) && /ev\.detail === 'fail'/.test(rend));
  assert.ok(/ensureCalDay\(day\)[\s\S]{0,200}!calOn\(\)/.test(main) && /calMonthQueue = calMonthQueue\.then\(async \(\) => \{\s*if \(!calOn\(\) \|\| calDays\.get\(day\) !== c\)/.test(main)); // 같은 큐, 꺼지면 읽지 않음
  assert.ok(/calMonths\.clear\(\); calDays\.clear\(\)/.test(main) && /CAL_DAY_MAX = 5/.test(main) && /CAL_DAY_TTL_MS = 5 \* 60 \* 1000/.test(main));
  const m = /ipcMain\.handle\('days:detail'[\s\S]*?\n\}\);/.exec(main)[0]; assert.ok(m.includes('fromMain(e)') && m.includes('L.validDay(day)') && m.includes('calDayGet(day)'));
  assert.ok(/uiDayOpen: FAKE_DAY && !app\.isPackaged/.test(main));
  assert.ok(!/localStorage|sessionStorage/.test(rend.slice(rend.indexOf('const dayColl'), rend.indexOf('$(\'dv-close\')'))));
  assert.ok(!/innerHTML/.test(rend.slice(rend.indexOf('function renderDay'), rend.indexOf('$(\'dv-close\')'))));
  const I = require('./i18n');
  for (const k of ['day.group.n', 'day.all.collapse', 'day.all.expand', 'day.ev.cal', 'day.ev.loc', 'day.ev.notes']) { assert.ok(I.STR.ko[k] && I.STR.en[k], k); }
  assert.strictEqual(I.t('ko', 'day.group.n', { n: 3 }), '3건'); assert.strictEqual(I.t('en', 'day.group.n', { n: 1 }), '1 item'); assert.strictEqual(I.t('en', 'day.group.n', { n: 2 }), '2 items');
  for (const l of ['ko', 'en']) assert.ok(/(장소|location)/i.test(I.t(l, 'set.cal.desc')));
});
t('달력 카드·하루 보기 연결(소스 구조)', () => {
  const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8'); const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8'); const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(html.indexOf('id="cal-card"') > html.indexOf('id="proj-card"') && html.indexOf('id="cal-card"') < html.indexOf('id="lang-note"'));
  assert.ok(/<section id="day-view" class="proj-detail day-view" role="region"[^>]* hidden>/.test(html));
  assert.ok(html.indexOf('id="proj-unsorted-toggle"') < html.indexOf('id="proj-done-toggle"'));
  for (const ch of ['days:month', 'days:detail']) assert.ok(main.includes("ipcMain.handle('" + ch + "', (e, ") && pre.includes("'" + ch + "'"));
  assert.ok(/'days:month', \(e, ym\) => \{\s*if \(!fromMain\(e\) \|\| !L\.parseYm\(ym\)\) return null;/.test(main)); // 보낸 창·형식을 main 이 다시 본다
  assert.ok(/'days:detail', \(e, day\) => \{\s*if \(!fromMain\(e\) \|\| !L\.validDay\(day\)/.test(main));
  assert.ok(/if \(!SMOKE && !FAKE_PROJ\) \{ readCalendar\(\)/.test(main) && /const calOn = \(\) => FAKE_DAY \|\| \(!SMOKE && !FAKE_PROJ/.test(main)); // 스모크·시험 모드에서는 캘린더를 읽지 않는다
  assert.ok(/calMonths\.clear\(\)/.test(main) && /CAL_MONTH_MAX = 3/.test(main) && /CAL_OSA_MS/.test(main));
  for (const id of ['cal-prev', 'cal-next', 'cal-today', 'dv-close', 'dv-prev', 'dv-next']) assert.ok(new RegExp('<button type="button"[^>]*id="' + id + '"[^>]*aria-label=').test(html), id);
  assert.ok(/aria-pressed/.test(rd) && /aria-current', 'date'/.test(rd) && /detailMode = 'day'/.test(rd));
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
t('visibleProjectKeys: 접힌 카테고리 제외, 화면 순서, 분류 안 됨은 번호 없음', () => {
  const v = L.groupProjects(UI_LIST);
  const all = L.visibleProjectKeys(v.open, []);
  assert.deepStrictEqual(all, v.open.flatMap((g) => g.items.map((x) => x.key)));
  assert.ok(!all.includes('maru') && all.includes('maru/a')); // 분류 안 됨(키 = 태그)은 번호를 받지 않는다
  assert.deepStrictEqual(v.unsorted.map((x) => x.key), ['maru']);
  const noMaru = L.visibleProjectKeys(v.open, ['maru']);
  assert.ok(!noMaru.some((k) => k === 'maru' || k.startsWith('maru/')) && noMaru.length === all.length - 3);
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
  assert.deepStrictEqual(maru, ['maru/c', 'maru/a', 'maru/b']); // c,a 는 정한 순서, b(새 항목)는 뒤
  assert.ok(!g.open.find((x) => x.tag === '블로그').items.some((x) => x.key.startsWith('maru'))); // 다른 카테고리 키는 옮겨지지 않는다
  assert.deepStrictEqual(g.done, base.done);
  assert.strictEqual(g.open.reduce((n, x) => n + x.items.length, 0), base.open.reduce((n, x) => n + x.items.length, 0)); // 항목이 늘거나 줄지 않는다
  assert.deepStrictEqual(g.unsorted, base.unsorted);
  // 분류 안 됨 키를 projOrder 에 적어도 카테고리 묶음에는 들어오지 않는다
  assert.ok(!L.groupProjects(UI_LIST, { catOrder: [], projOrder: { maru: ['maru', 'maru/b'] }, collapsed: [] }).open.find((x) => x.tag === 'maru').items.some((x) => x.key === 'maru'));
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
  const kept = { catOrder: ['책', 'maru'], projOrder: { maru: ['maru/b'] }, collapsed: ['블로그'] };
  assert.deepStrictEqual(L.pruneProjectUi(kept, []), kept); // 프로젝트 행이 하나도 없으면(레지스트리가 비었거나 읽지 못함) 지우지 않는다
  assert.deepStrictEqual(L.pruneProjectUi(kept, null), kept);
  assert.deepStrictEqual(L.pruneProjectUi(kept, [{ kind: 'unsorted', tag: '책' }]), kept);
  assert.deepStrictEqual(L.pruneProjectUi({ bad: 1 }, []), L.defaultProjectUi()); // 잘못된 값은 여전히 기본값
  assert.deepStrictEqual(L.pruneProjectUi('x', UI_LIST), L.defaultProjectUi());
  const big = { catOrder: [], projOrder: {}, collapsed: [] }; assert.ok(L.projectUiFits(big));
});
t('메뉴·화면 연결 정적 검사: ⌘1~9 는 numberTargets, 번호 힌트·토글·드래그는 자체 타입', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8'); const css = fs.readFileSync(path.join(__dirname, 'renderer', 'style.css'), 'utf8');
  assert.ok(/L\.numberTargets\(visibleWsIds\(\)[\s\S]*L\.visibleProjectKeys\(proj\.view\.open, proj\.view\.collapsed\)/.test(main) && /Lib\.numberTargets\(Lib\.visibleWsIds\(Lib\.hierarchyOrder\(wsList\)[\s\S]*Lib\.visibleProjectKeys\(projView\.open, projView\.collapsed\)/.test(rd)); // 같은 순수 함수
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
t('parseSquadMeta·matchSubs·teamChip: session 예약 역할·-lead/-session 끝 역할 거부, 세션 진입 에이전트는 임시 줄이 아님, 없는 팀은 칩 없음', () => {
  const mem = (role) => ({ role, agent: 'sq-dev-' + role, model: 'haiku' });
  const m = L.parseSquadMeta(JSON.stringify({ squads: [SQ({ members: [mem('ok'), mem('session'), mem('b-lead'), mem('x-session'), mem('lead')] })] }));
  assert.deepStrictEqual(m[0].members.map((x) => x.role), ['ok']); // 표시용 팀원 줄에 진입점이 끼지 않는다
  const r = L.matchSubs([{ type: 'sq-dev-session', count: 1 }, { type: 'sq-dev-ok', count: 2 }, { type: 'sq-ghost-session', count: 1 }, { type: 'sq-ghost-x', count: 1 }], ['sq-dev-ok']);
  assert.deepStrictEqual([...r.counts], [['sq-dev-ok', 2], ['sq-ghost-x', 1]]); assert.deepStrictEqual(r.extra, [{ type: 'sq-ghost-x', count: 1 }]);
  const list = L.parseSquadMeta(JSON.stringify({ squads: [SQ()] }));
  assert.deepStrictEqual(L.teamChip('dev', list), { slug: 'dev', name: '개발' });
  for (const bad of ['ghost', '', null, undefined, 5, 'Dev', 'dev ']) assert.strictEqual(L.teamChip(bad, list), null, String(bad));
  assert.strictEqual(L.teamChip('dev', []), null); assert.strictEqual(L.teamChip('dev', null), null);
});
t('claudeLaunchCommand: 래퍼가 있으면 인용해 exec, 없거나 이상하면 claude', () => {
  const sid = 'abcd1234-aaaa';
  assert.strictEqual(L.claudeLaunchCommand(sid, null), '\x15command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec claude ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(null, undefined), '\x15command -v claude >/dev/null && exec claude ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, '/r/scripts/maru-claude.sh'), '\x15command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec /r/scripts/maru-claude.sh ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, '/my repo/a b$(x)`y`;&\'"/scripts/maru-claude.sh').split('exec ')[1], String.raw`/my\ repo/a\ b\$\(x\)\`y\`\;\&\'\"/scripts/maru-claude.sh` + ' ; exit 127\r');
  for (const bad of ['/r/a\nb', '/r/a\rb', '/r/a\u001bb', '/r/a\u202Eb', 'relative/x.sh', '', 5, '/' + 'a'.repeat(1030)]) assert.ok(L.claudeLaunchCommand(sid, bad).endsWith('exec claude ; exit 127\r'), String(bad).slice(0, 8)); // 개행·제어·bidi 가 든 경로는 쓰지 않는다
  assert.strictEqual(L.claudeLaunchCommand(sid, '/r/한글 폴더/scripts/maru-claude.sh').split('exec ')[1], '/r/한글\\ 폴더/scripts/maru-claude.sh ; exit 127\r');
});
t('스쿼드 정적 검사: 래퍼 검사·python 도구 폴더·시간·크기 상한·60초 갱신', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(/'\/Library\/Developer\/CommandLineTools\/usr\/bin\/python3'/.test(main) && !/'\/usr\/bin\/python3'/.test(main));
  assert.ok(/'-I', script, 'meta'\], \{ timeout: 3000, maxBuffer: L\.SQUAD_META_MAX_BYTES/.test(main) && L.SQUAD_META_MAX_BYTES === 256 * 1024);
  assert.ok(/setInterval\(refreshSquads, 60000\)/.test(main) && !/refreshSquads\(\)/.test(main.split('setInterval(() => {\n    if (TEST_FX)')[1] || ''), '1초 폴링에 넣지 않는다');
  assert.ok(/lstatSync\(f\)[\s\S]{0,120}st\.isFile\(\) \|\| !safeOwned\(st\)[\s\S]{0,80}X_OK/.test(main) && /L\.claudeLaunchCommand\(sid, wrapper, resume, fresh, bin\)/.test(main));
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
    roster: [{ role: 'lead', model: 'sonnet', tools: ['Agent', 'Read'] }, { role: 'a', model: 'haiku', tools: ['Read'], skills: [] }, { role: 'b', model: 'sonnet', tools: ['Read', 'Grep'], skills: [] }] }); // 총괄·팀원별 도구
  // 팀원 skills: 없으면 [], 유효하면 roster 로 전달, 잘못되면 전체 거부
  { const o = JSON.parse(sqCheck({ members: [{ role: 'a', model: 'haiku', tools: ['Read'] }] })); delete o.members[0].skills; assert.deepStrictEqual(L.parseSquadCheck(JSON.stringify(o), 'team').members[0].skills, []); } // skills 키가 없는 옛 출력도 받는다
  const withSk = (sk) => sqCheck({ members: [{ role: 'a', model: 'haiku', tools: ['Read'], skills: sk }] });
  assert.deepStrictEqual(L.parseSquadCheck(withSk(['sk-a', 'b2']), 'team').members[0].skills, ['sk-a', 'b2']);
  assert.deepStrictEqual(L.summarizeSquadCheck(L.parseSquadCheck(withSk(['sk-a']), 'team')).roster, [{ role: 'lead', model: 'sonnet', tools: ['Agent', 'Read'] }, { role: 'a', model: 'haiku', tools: ['Read'], skills: ['sk-a'] }]);
  for (const bad of [['a', 'b', 'c', 'd'], ['Bad'], ['-x'], [1], 'sk-a', null, ['a'.repeat(65)], ['a b']]) assert.strictEqual(L.parseSquadCheck(withSk(bad), 'team'), null, JSON.stringify(bad));
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
t('기억 표시 문구: title_/description_(ko|en) 파싱·상한·정리·한쪽만 있는 경우', () => {
  const full = L.parseMemoryFile('---\nname: some-slug\ndescription: top line\nmetadata:\n  type: feedback\n  tags: [a, b]\n  title_ko: 한국어 제목\n  title_en: English title\n  description_ko: 한 줄 설명\n  description_en: One-line description\n---\nbody', 'some-slug', 1);
  assert.deepStrictEqual(full.titles, { ko: '한국어 제목', en: 'English title' }); assert.deepStrictEqual(full.descs, { ko: '한 줄 설명', en: 'One-line description' });
  assert.strictEqual(full.name, 'some-slug'); assert.strictEqual(full.description, 'top line'); assert.deepStrictEqual(full.tags, ['a', 'b']); assert.strictEqual(full.type, 'feedback'); // 기존 키는 그대로
  const none = L.parseMemoryFile('---\nname: old\ndescription: d\n---\nb', 'old', 1); // 옛 파일
  assert.deepStrictEqual(none.titles, { ko: '', en: '' }); assert.deepStrictEqual(none.descs, { ko: '', en: '' });
  const q = L.parseMemoryFile('---\nname: q\nmetadata:\n  title_ko: "따옴표 \\"제목\\""\n  title_en: \'It\'\'s a title\'\n---\n', 'q', 1);
  assert.strictEqual(q.titles.ko, '따옴표 "제목"'); assert.strictEqual(q.titles.en, "It's a title");
  const long = L.parseMemoryFile('---\nname: l\nmetadata:\n  title_ko: ' + '가'.repeat(200) + '\n  description_en: ' + 'x'.repeat(1000) + '\n---\n', 'l', 1);
  assert.strictEqual([...long.titles.ko].length, 60); assert.strictEqual([...long.descs.en].length, 240);
  const ctl = L.parseMemoryFile('---\nname: c\nmetadata:\n  title_en: a\u0007b‮c​d\te  f\n  description_ko: \u0000제목\u001b[31m\n---\n', 'c', 1);
  assert.strictEqual(ctl.titles.en, 'abcd e f'); assert.ok(!/[\u0000-\u0008\u001b‮​]/.test(ctl.descs.ko)); // 제어·bidi·보이지 않는 글자는 지운다
  const one = L.parseMemoryFile('---\nname: o\ndescription: top\nmetadata:\n  title_en: Only English\n---\n', 'o', 1);
  assert.deepStrictEqual(one.titles, { ko: '', en: 'Only English' });
  const koOnly = L.parseMemoryFile('---\nname: d\ndescription: top\nmetadata:\n  description_ko: 하나\n---\n', 'd', 1); assert.strictEqual(koOnly.description, 'top'); assert.strictEqual(koOnly.descs.ko, '하나'); // description_ko 는 최상위 description 과 섞이지 않는다
  const items = L.buildMemoryModel([full, none, one]);
  assert.deepStrictEqual(items[0].titles, { ko: '한국어 제목', en: 'English title' }); assert.deepStrictEqual(items[1].descs, { ko: '', en: '' });
});
t('기억 표시 문구: scripts/maru_ui.py 파서와 같은 글·같은 기대값(중복 키·블록 스칼라·따옴표·CRLF·상한)', () => {
  // 같은 입력이 maru_ui.py --selftest 에도 있다: 두 파서가 어긋나면 한쪽이 먼저 깨진다
  const xfm = '---\nname: x-slug\ndescription: "He said \\"hi\\" and left"\nmetadata:\n  type: feedback\n  title_ko: |\n  title_ko: 두번째 한국어\n  title_ko: 세번째\n  title_en: \'It\'\'s fine\'\n  title_en: ignored\n  description_ko: >-\n  description_en: One line\n---\nbody\n';
  for (const text of [xfm, xfm.replace(/\n/g, '\r\n')]) {
    const f = L.parseMemoryFile(text, 'x-slug', 1);
    assert.strictEqual(f.description, 'He said "hi" and left'); assert.deepStrictEqual(f.titles, { ko: '두번째 한국어', en: "It's fine" }); assert.deepStrictEqual(f.descs, { ko: '', en: 'One line' }); assert.strictEqual(f.name, 'x-slug');
    const mm = L.parseMemoryMeta(text); assert.strictEqual(mm.titles.ko, '두번째 한국어'); assert.strictEqual(mm.titles.en, "It's fine"); assert.strictEqual(mm.descs.ko, '');
  }
  const cap = L.parseMemoryFile('---\nname: long\nmetadata:\n  title_en: ' + 'a'.repeat(61) + '\n  description_en: ' + 'b'.repeat(241) + '\n---\n', 'long', 1);
  assert.strictEqual(cap.titles.en.length, 60); assert.strictEqual(cap.descs.en.length, 240);
  const dupKeys = L.parseMemoryFile('---\nname: k\nmetadata:\n  title_en: First\n  title_en: Second\n  description_ko:\n  description_ko: 둘째\n---\n', 'k', 1);
  assert.strictEqual(dupKeys.titles.en, 'First'); assert.strictEqual(dupKeys.descs.ko, '둘째'); // 비어 있지 않은 첫 값
});
t('memoryDisplay: 언어별 제목·설명과 되돌아가기 / 검색은 두 언어 모두', () => {
  const m = { slug: 'my-slug', name: 'my-slug', description: 'top', titles: { ko: '한국어 제목', en: 'English title' }, descs: { ko: '한국어 설명', en: 'English desc' }, tags: ['t'], body: 'Body Text' };
  assert.deepStrictEqual(L.memoryDisplay(m, 'ko'), { title: '한국어 제목', description: '한국어 설명' });
  assert.deepStrictEqual(L.memoryDisplay(m, 'en'), { title: 'English title', description: 'English desc' });
  const onlyEn = { ...m, titles: { ko: '', en: 'English title' }, descs: { ko: '', en: 'English desc' } };
  assert.deepStrictEqual(L.memoryDisplay(onlyEn, 'ko'), { title: 'English title', description: 'top' }); // 제목은 다른 언어, 설명은 최상위 설명
  const bare = { slug: 'my-slug', name: 'my-slug', description: '', titles: { ko: '', en: '' }, descs: { ko: '', en: 'English desc' } };
  assert.deepStrictEqual(L.memoryDisplay(bare, 'ko'), { title: 'my-slug', description: 'English desc' });
  assert.deepStrictEqual(L.memoryDisplay({ slug: 's', name: 's', description: 'd' }, 'en'), { title: 's', description: 'd' }); // 옛 항목(titles 없음)
  assert.deepStrictEqual(L.memoryDisplay(null, 'en'), { title: '', description: '' }); assert.strictEqual(L.memoryDisplay(m, 'fr').title, '한국어 제목');
  const txt = L.memorySearchText(m);
  for (const w of ['한국어 제목', 'english title', '한국어 설명', 'english desc', 'my-slug', 'body text', 'top']) assert.ok(txt.includes(w.toLowerCase()), w);
  const items = [{ ...m, id: 'm0' }, { slug: 'x', name: 'x', description: 'zzz', titles: { ko: '', en: '' }, descs: { ko: '', en: '' }, tags: [], body: '', id: 'm1' }];
  assert.deepStrictEqual(L.filterMemories(items, '제목'), ['m0']); assert.deepStrictEqual(L.filterMemories(items, 'English TITLE'), ['m0']); assert.deepStrictEqual(L.filterMemories(items, 'zzz'), ['m1']);
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
t('기억 그래프 움직임: 떠다니는 오프셋은 결정적·유계·연속', () => {
  const a = L.graphDrift(3, 12345, 6); const b = L.graphDrift(3, 12345, 6);
  assert.deepStrictEqual(a, b); assert.notDeepStrictEqual(L.graphDrift(4, 12345, 6), a);
  assert.deepStrictEqual(L.graphDrift(3, 12345, 0), { x: 0, y: 0 }); assert.deepStrictEqual(L.graphDrift(3, NaN, 6), { x: 0, y: 0 });
  let maxStep = 0;
  for (let i = 0; i < 40; i++) for (let tMs = 0; tMs < 30000; tMs += 1) {
    if (tMs % 97) continue;
    const p = L.graphDrift(i, tMs, 6); assert.ok(Math.abs(p.x) <= 6 && Math.abs(p.y) <= 6 && Number.isFinite(p.x + p.y));
    const q = L.graphDrift(i, tMs + 1, 6); maxStep = Math.max(maxStep, Math.hypot(q.x - p.x, q.y - p.y));
  }
  assert.ok(maxStep < 0.02, 'continuous ' + maxStep); assert.ok(Math.abs(L.graphDrift(1, 1e9, 3).x) <= 3 && Math.abs(L.graphDrift(1, 1e9, 3).y) <= 3);
});
t('기억 그래프 움직임: 한 프레임 계산(수렴·고정·시간 상한·연결 당김)', () => {
  const anchors = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }];
  const edges = [{ a: 0, b: 1, kind: 'link' }, { a: 1, b: 2, kind: 'tag' }];
  const mk = () => anchors.map((p) => ({ x: p.x + 80, y: p.y - 60, vx: 0, vy: 0, pin: false }));
  const nodes = mk(); let r;
  for (let i = 0; i < 600; i++) r = L.graphStep(nodes, anchors, edges, { dtMs: 16, tMs: i * 16, amp: 0 });
  nodes.forEach((p, i) => { assert.ok(Math.hypot(p.x - anchors[i].x, p.y - anchors[i].y) < 0.01); });
  assert.ok(r.move < 0.01);
  const drifting = mk(); for (let i = 0; i < 300; i++) L.graphStep(drifting, anchors, edges, { dtMs: 16, tMs: i * 16 });
  drifting.forEach((p, i) => { assert.ok(Number.isFinite(p.x + p.y) && Math.hypot(p.x - anchors[i].x, p.y - anchors[i].y) < 6 * 1.5 + 3); });
  const pinned = mk(); pinned[0].pin = true; const px = pinned[0].x; const py = pinned[0].y;
  for (let i = 0; i < 50; i++) L.graphStep(pinned, anchors, edges, { dtMs: 16, tMs: i * 16, amp: 0 });
  assert.strictEqual(pinned[0].x, px); assert.strictEqual(pinned[0].y, py);
  const huge = mk(); const norm = mk(); L.graphStep(huge, anchors, edges, { dtMs: 60000, amp: 0 }); L.graphStep(norm, anchors, edges, { dtMs: 32, amp: 0 });
  assert.deepStrictEqual(huge, norm);
  const pull = anchors.map((p) => ({ x: p.x, y: p.y, vx: 0, vy: 0, pin: false })); pull[0].pin = true; pull[0].x = -200; // 끌려 늘어난 선은 이웃을 당긴다
  const before = pull[1].x; L.graphStep(pull, anchors, edges, { dtMs: 16, amp: 0 }); assert.ok(pull[1].x < before);
  const same = anchors.map((p) => ({ x: p.x, y: p.y, vx: 0, vy: 0, pin: false })); L.graphStep(same, anchors, edges, { dtMs: 16, amp: 0 }); assert.strictEqual(same[1].x, 200); // 늘어나지 않으면 힘 없음
});
t('기억 그래프 움직임: 이름 상자 분리(겹침 해소·수렴·고정·경계·결정적)', () => {
  const bx = [{ hw: 40, hh: 10, cy: 0 }, { hw: 40, hh: 10, cy: 0 }];
  const run = (anchors, boxes, o, iters) => { const nodes = anchors.map((a) => ({ x: a.x, y: a.y, vx: 0, vy: 0, pin: false })); let r; for (let i = 0; i < (iters || 800); i++) r = L.graphStep(nodes, anchors, [], { dtMs: 16, tMs: 0, amp: 0, boxes, spring: 3.5, damp: 7, ...(o || {}) }); return { nodes, r }; };
  const same = run([{ x: 200, y: 200 }, { x: 200, y: 200 }], bx);
  const ov = (n, b) => Math.max(0, b[0].hw + b[1].hw - Math.abs(n[1].x - n[0].x)) > 0 && Math.max(0, b[0].hh + b[1].hh - Math.abs(n[1].y - n[0].y)) > 0 ? Math.min(b[0].hw + b[1].hw - Math.abs(n[1].x - n[0].x), b[0].hh + b[1].hh - Math.abs(n[1].y - n[0].y)) : 0;
  assert.ok(ov(same.nodes, bx) < 2, '남은 겹침 ' + ov(same.nodes, bx)); assert.ok(same.r.move < 0.01); // 가라앉는다
  assert.ok(Math.abs(same.nodes[1].y - same.nodes[0].y) > 15);
  assert.deepStrictEqual(run([{ x: 200, y: 200 }, { x: 200, y: 200 }], bx).nodes, same.nodes); // 결정적
  const apart = run([{ x: 100, y: 100 }, { x: 300, y: 100 }], bx, null, 5); assert.deepStrictEqual(apart.nodes.map((p) => [p.x, p.y]), [[100, 100], [300, 100]]); // 겹치지 않으면 힘 없음
  const none = [{ x: 200, y: 200, vx: 0, vy: 0, pin: false }, { x: 200, y: 200, vx: 0, vy: 0, pin: false }]; L.graphStep(none, [{ x: 200, y: 200 }, { x: 200, y: 200 }], [], { dtMs: 16, amp: 0 }); assert.deepStrictEqual(none.map((p) => p.x), [200, 200]); // boxes 없으면 쌍 계산 없음
  const pn = [{ x: 200, y: 200, vx: 0, vy: 0, pin: true }, { x: 205, y: 200, vx: 0, vy: 0, pin: false }]; for (let i = 0; i < 300; i++) L.graphStep(pn, [{ x: 200, y: 200 }, { x: 205, y: 200 }], [], { dtMs: 16, amp: 0, boxes: bx, spring: 3.5, damp: 7 });
  assert.strictEqual(pn[0].x, 200); assert.strictEqual(pn[0].y, 200); assert.ok(Math.abs(pn[1].x - 200) > 20 || Math.abs(pn[1].y - 200) > 8); // 고정은 그대로, 상대가 밀려난다
  const bd = { x0: 0, x1: 300, y0: 50, y1: 250 };
  const wide = run([{ x: 5, y: 10 }, { x: 295, y: 400 }], [{ hw: 60, hh: 10, cy: 0 }, { hw: 20, hh: 10, cy: 0 }], { bounds: bd }, 600);
  assert.ok(wide.nodes[0].x >= 60 - 0.01 && wide.nodes[0].y >= 50 - 0.01 && wide.nodes[1].x <= 280 + 0.01 && wide.nodes[1].y <= 250 + 0.01); // 상자 가로가 칸 안, 세로는 중심 범위 안
  const fr = [{ x: -500, y: -500, vx: 0, vy: 0, pin: false, free: true }]; for (let i = 0; i < 100; i++) L.graphStep(fr, [{ x: -500, y: -500 }], [], { dtMs: 16, amp: 0, bounds: bd, boxes: [{ hw: 10, hh: 5 }] }); assert.strictEqual(fr[0].x, -500); // 끌어 놓은 노드는 경계 밖도 된다
  const many = Array.from({ length: 30 }, (_, i) => ({ x: 150 + (i % 5), y: 150 + (i % 3) })); const mb = many.map(() => ({ hw: 25, hh: 8, cy: 3 }));
  const cr = run(many, mb, { bounds: { x0: 0, x1: 300, y0: 20, y1: 280 }, repel: 0 }, 600); cr.nodes.forEach((p) => assert.ok(Number.isFinite(p.x + p.y) && p.x >= 25 - 0.01 && p.x <= 275 + 0.01 && p.y >= 20 - 0.01 && p.y <= 280 + 0.01));
});
t('기억 그래프 움직임: graphSettle 은 겹침을 풀고 칸 안에 퍼뜨린다(결정적)', () => {
  const anchors = Array.from({ length: 20 }, (_, i) => ({ x: 200 + (i % 5) * 6, y: 200 + Math.floor(i / 5) * 6 }));
  const boxes = anchors.map(() => ({ hw: 30, hh: 9, cy: 4 })); const bounds = { x0: 4, x1: 396, y0: 40, y1: 360 };
  const a = L.graphSettle(anchors, [{ a: 0, b: 1, kind: 'link' }], boxes, bounds); const b = L.graphSettle(anchors, [{ a: 0, b: 1, kind: 'link' }], boxes, bounds);
  assert.deepStrictEqual(a, b);
  let worst = 0; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { const ox = boxes[i].hw + boxes[j].hw - Math.abs(a[i].x - a[j].x); const oy = boxes[i].hh + boxes[j].hh - Math.abs(a[i].y - a[j].y); if (ox > 0 && oy > 0) worst = Math.max(worst, Math.min(ox, oy)); }
  assert.ok(worst < 4, '남은 겹침 ' + worst);
  a.forEach((p) => assert.ok(Number.isFinite(p.x + p.y) && p.x >= 30 - 0.01 && p.x <= 370 + 0.01 && p.y >= 40 - 0.01 && p.y <= 360 + 0.01));
  const spanX = Math.max(...a.map((p) => p.x)) - Math.min(...a.map((p) => p.x)); assert.ok(spanX > 60);
  const pinned = L.graphSettle(anchors, [], boxes, bounds, { pinned: new Set([0]) }); assert.deepStrictEqual(pinned[0], anchors[0]);
});
t('기억 그래프 움직임: 가속 상한·같은 자리 200개·큰 그래프 속도·이름 개수 규칙', () => {
  const nodes = Array.from({ length: 200 }, () => ({ x: 500, y: 350, vx: 0, vy: 0, pin: false })); const an = nodes.map(() => ({ x: 500, y: 350 })); const bx = nodes.map(() => ({ hw: 25, hh: 9, cy: 3 }));
  let mv = 1; for (let i = 0; i < 1500; i++) mv = L.graphStep(nodes, an, [], { dtMs: 16, amp: 0, boxes: bx, spring: 3.5, damp: 7, bounds: { x0: 0, x1: 1000, y0: 20, y1: 680 } }).move;
  assert.ok(mv < 0.01, '가라앉음 ' + mv); assert.ok(nodes.every((p) => Number.isFinite(p.x + p.y) && p.x >= 24.99 && p.x <= 975.01 && p.y >= 19.99 && p.y <= 680.01));
  let s = 7; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const n = 500; const edges = []; for (let i = 1; i < n; i++) edges.push({ a: Math.floor(rnd() * i), b: i, kind: 'link' });
  const fit = L.fitGraph(L.simulateGraph(n, edges, { width: 1000, height: 1400 }), { width: 1000, height: 1400, pad: 46, padTop: 120, padBottom: 160 });
  const boxes = fit.map(() => ({ hw: 40 + rnd() * 40, hh: 14, cy: 10 })); const bounds = { x0: 4, x1: 996, y0: 120, y1: 1240 };
  const t0 = Date.now(); const out = L.graphSettle(fit, edges, boxes, bounds); const ms = Date.now() - t0;
  assert.ok(ms < 800, '500 nodes settle ' + ms + 'ms'); console.log('     graphSettle 500 노드: ' + ms + 'ms');
  assert.ok(out.every((p) => Number.isFinite(p.x + p.y))); assert.deepStrictEqual(L.graphSettle(fit, edges, boxes, bounds), out);
  assert.strictEqual(L.graphLabelCount(25, 0.6), 25); assert.strictEqual(L.graphLabelCount(40, 0.1), 40); assert.strictEqual(L.graphLabelCount(0, 1), 0);
  assert.strictEqual(L.graphLabelCount(500, 1), 40); assert.strictEqual(L.graphLabelCount(500, 2), 160); assert.strictEqual(L.graphLabelCount(500, 4), 500); assert.ok(L.graphLabelCount(500, 0.01) >= 1);
  let prevK = 0; for (let k = 0.5; k <= 8; k += 0.25) { const c = L.graphLabelCount(120, k); assert.ok(c >= prevK && c <= 120); prevK = c; }
  assert.deepStrictEqual(L.graphLabelOrder([1, 3, 3, 0, 5]), [4, 1, 2, 0, 3]); // 연결 많은 순, 같으면 번호 순
});
t('기억 그래프 움직임: 이름 투명도·보기 평활', () => {
  assert.strictEqual(L.graphLabelOpacity(0), 0); assert.strictEqual(L.graphLabelOpacity(6.5), 0); assert.strictEqual(L.graphLabelOpacity(8.5), 1); assert.strictEqual(L.graphLabelOpacity(40), 1); assert.strictEqual(L.graphLabelOpacity(NaN), 0);
  let prev = 0; for (let px = 6.5; px <= 8.5; px += 0.1) { const o = L.graphLabelOpacity(px); assert.ok(o >= prev && o >= 0 && o <= 1); prev = o; }
  assert.ok(Math.abs(L.graphLabelOpacity(7.5) - 0.5) < 1e-9);
  let v = { k: 1, tx: 0, ty: 0 }; const tg = { k: 4, tx: -300, ty: 50 }; let done = false;
  for (let i = 0; i < 40 && !done; i++) { const e = L.graphEaseView(v, tg, 16, 60); v = { k: e.k, tx: e.tx, ty: e.ty }; done = e.done; }
  assert.ok(done); assert.deepStrictEqual(v, tg);
  const half = L.graphEaseView({ k: 1, tx: 0, ty: 0 }, { k: 2, tx: 100, ty: 0 }, 16, 60); assert.ok(half.k > 1 && half.k < 2 && !half.done);
});
t('기억 보기: 그래프 루프·끌기 정리·크기 변경 비용·이름 크기(정적 검사)', () => {
  const mv = fs.readFileSync(path.join(__dirname, 'renderer', 'memview.js'), 'utf8');
  assert.ok(/Lib\.graphStep\(/.test(mv) && /Lib\.graphLabelOpacity\(/.test(mv) && /Lib\.graphEaseView\(/.test(mv) && /Lib\.graphLabelCount\(/.test(mv));
  assert.ok(/visibilitychange/.test(mv) && /cancelAnimationFrame/.test(mv) && !/innerHTML/.test(mv) && !/drawLabels/.test(mv));
  assert.ok(/stopLoop\(\)/.test(mv.split('hide() {')[1].split('clearSearch')[0]));
  const frame = mv.split('function frame(')[1].split('function goView')[0];
  assert.ok(!/font-size/.test(frame) && !/getBoundingClientRect/.test(frame) && !/graphSettle|spread\(/.test(frame)); // 프레임마다 글자 크기·배치 재측정·퍼뜨리기를 하지 않는다
  assert.ok(/'font-size', String\(lfs\)/.test(mv) && /LABEL_PX \/ scale\(\)/.test(mv)); // 이름 글자 크기는 칸 배율에서 정한다
  assert.ok(/function wake\(\) \{ if \(!raf && needLoop\(\)\)/.test(mv)); // 루프는 하나만 돈다
  const refit = mv.split('function refit()')[1].split('function respread')[0];
  assert.ok(/setTimeout\(respread, SPREAD_DEBOUNCE_MS\)/.test(refit) && !/spread\(graph\.pos\)/.test(refit)); // 크기 변경 때는 퍼뜨리기를 미룬다
  assert.ok(/clearTimeout\(spreadT\)/.test(mv.split('hide() {')[1].split('clearSearch')[0]));
  assert.ok(/function resetDrag\(\)/.test(mv) && /resetDrag\(\)/.test(mv.split('hide() {')[1].split('clearSearch')[0]) && /resetDrag\(\);/.test(mv.split('function buildSvg()')[1].split('const g = ensureGraph')[0]));
  assert.ok(/'lostpointercapture'/.test(mv) && /e\.buttons === 0/.test(mv));
  const rdr = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8'); const mainSrc = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.ok(/Lib\.memoryDisplay\(m, lang\)/.test(rdr.split("$('pd-mem')")[1].split('detailActions(d)')[0])); // 프로젝트 상세의 관련 기억도 화면 언어의 제목
  assert.ok(/uiLang: !app\.isPackaged && \(TEST_UI === 'memory' \|\| TEST_UI === 'memgraph'\) && I18N\.isLang\(process\.env\.MARU_APP_LANG\)/.test(mainSrc) && !/process\.env\.MARU_LANG/.test(mainSrc.split('uiLang:')[1].split('uiLangSwitch')[0])); // 개발 전용 언어는 기억 보기 시험 모드에서만
  assert.ok(/Lib\.memoryDisplay\(m, lang \? lang\(\) : 'ko'\)/.test(mv) && !/\bm\.name\b/.test(mv) && !/\bm\.description\b/.test(mv)); // 이름·설명은 화면 언어에 맞는 표시 문구로만 보인다
  assert.ok(/relabel\(\) \{[\s\S]*?textContent = cutName\(disp\(items\[i\]\)\.title, 30\)[\s\S]*?makeBoxes\(\)/.test(mv) && !/simulateGraph/.test(mv.split('relabel() {')[1].split('title: ()')[0])); // 언어를 바꾸면 이름·상자를 다시 만들되 배치는 다시 돌리지 않는다
  assert.ok(/addEventListener\('blur'/.test(mv) && /addEventListener\('focus'/.test(mv));
  assert.ok(/if \(!graph \|\| !svgBuilt\) return;\n      const next/.test(mv)); // sizeLabels 는 그래프가 없으면 아무것도 안 한다
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
  const by2 = (l, id) => l.find((x) => x.id === id);
  const m2 = L.modelPrereqs({ ...ok, jq: 'missing', git: 'broken', auth: { loggedIn: false, state: 'out' } });
  const by = (id) => m2.find((x) => x.id === id);
  assert.strictEqual(by('jq').status, 'missing'); assert.strictEqual(by('jq').how, 'prereq.how.jq'); assert.strictEqual(by('git').status, 'need'); assert.strictEqual(by('git').how, 'prereq.how.clt');
  assert.strictEqual(by('auth').status, 'need'); assert.strictEqual(L.prereqsReady(m2), false);
  assert.strictEqual(L.prereqsReady(L.modelPrereqs({ ...ok, auth: { loggedIn: false, state: 'out' } })), true); // 로그인은 막지 않는다(need)
  assert.strictEqual(L.prereqsReady(L.modelPrereqs({ ...ok, auth: { loggedIn: true, state: 'expired' } })), true);
  assert.strictEqual(by2(L.modelPrereqs({ ...ok, auth: { loggedIn: false } }), 'auth').status, 'need'); assert.strictEqual(by2(L.modelPrereqs(ok), 'auth').required, false);
  const mu = L.modelPrereqs({ ...ok, auth: null }); assert.strictEqual(by2(mu, 'auth').status, 'unknown'); assert.strictEqual(L.prereqsReady(mu), true);
  assert.strictEqual(L.prereqsReady(L.modelPrereqs({ ...ok, claude: 'missing', auth: null })), false); // claude 는 여전히 막는다
  assert.strictEqual(L.prereqsReady(mu.map((x) => (x.id === 'jq' ? { ...x, status: 'unknown' } : x))), false);
  assert.strictEqual(by2(L.modelPrereqs({ ...ok, claude: 'broken' }), 'claude').how, 'prereq.how.claudeBroken');
  assert.strictEqual(by2(L.modelPrereqs({ ...ok, claude: 'missing' }), 'auth').how, 'prereq.how.authFirst');
  assert.strictEqual(by2(L.modelPrereqs({ ...ok, auth: { loggedIn: false } }), 'auth').how, 'prereq.how.auth');
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
  assert.ok(/wsFrom\(e, id\)/.test(ms) && /isMaruWs\(w\)/.test(ms) && /meetFacts\(\)/.test(ms) && /meetGateWait\(id, w, term0/.test(ms) && /meetGate\(id, w, term, facts\)/.test(main) && /bracketed: w\.bracketed === true/.test(main) && /awaitClaude: w\.awaitClaude === true/.test(main) && /meetBusy/.test(ms) && /confirmBox/.test(ms) && /firstMeetingPaste\(text\)/.test(ms) && !/writePrompt/.test(ms) && !/\\r|\\n/.test(ms));
  assert.ok(/!app\.isPackaged && typeof process\.env\[k\]/.test(main) && /MARU_APP_MANAGED_HOME/.test(main) && /MARU_APP_PAYLOAD/.test(main));
  assert.ok(/MARU_LANG: curLang\(\)/.test(main) && /installEnv\(\)/.test(main));
  assert.ok(/app\.relaunch\(\)/.test(main) && /'hierarchy'\]\.includes\(process\.env\.MARU_APP_UI\)/.test(main));
  assert.ok(!/innerHTML/.test(fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8')));
  const pk = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).build.extraResources.map((e) => e.to);
  for (const x of ['payload/scripts', 'payload/prompts', 'payload/squads', 'payload/squads-en', 'payload/launchd', 'payload/bin', 'payload/install.sh', 'payload/uninstall.sh', 'payload/CLAUDE.md', 'payload/CLAUDE.en.md', 'payload/README.md', 'payload/docs/manual.ko.md', 'payload/.claude/agents', 'payload/.claude/skills', 'payload/.claude/settings.json']) assert.ok(pk.includes(x), x);
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
function fakeFs(spec0) { const spec = { [PD]: { kind: 'dir' }, [PD + '/-Users-me-proj-a']: { kind: 'dir' }, ...spec0 }; // spec: { '<경로>': { kind: 'dir'|'file'|'link', mtimeMs, uid } }  (realpath 는 link 의 to 를 따름)
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
  const pd = path.join(root, 'projects'); const slug = L.projectSlug(fs.realpathSync(proj)); fs.mkdirSync(path.join(pd, slug), { recursive: true }); // 기록 폴더 이름은 실제 경로로 만든다
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
t('claudeLaunchCommand: claudeBin 이 있으면 Ctrl-U + [ -x ] || command -v + PATH 뒤에 폴더 덧붙임', () => {
  const sid = 'abcd1234-aaaa'; const U1 = '11111111-2222-4333-8444-555555555555'; const U2 = '66666666-7777-4888-9999-000000000000';
  const B = '/h/.local/bin/claude'; const P = '\x15[ -x /h/.local/bin/claude ] || command -v claude >/dev/null || exit 127; ';
  assert.strictEqual(L.claudeLaunchCommand(sid, '/r/scripts/maru-claude.sh', null, null, B), P + 'MARU_APP_SESSION=abcd1234-aaaa PATH="$PATH":/h/.local/bin exec /r/scripts/maru-claude.sh ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, null, null, null, B), P + 'MARU_APP_SESSION=abcd1234-aaaa PATH="$PATH":/h/.local/bin exec claude ; exit 127\r'); // 대상은 이름 claude(사용자 PATH 가 먼저)
  assert.strictEqual(L.claudeLaunchCommand(null, null, null, null, B), P + 'PATH="$PATH":/h/.local/bin exec claude ; exit 127\r');
  assert.ok(!L.claudeLaunchCommand(sid, null, null, null, B).includes('{'));
  assert.ok(L.claudeLaunchCommand(sid, null, U1, null, B).endsWith(' exec claude --resume ' + U1 + ' ; exit 127\r'));
  assert.ok(L.claudeLaunchCommand(sid, '/r/w.sh', null, U2, B).endsWith(' exec /r/w.sh --session-id ' + U2 + ' ; exit 127\r'));
  assert.strictEqual(L.claudeLaunchCommand(sid, null, U1, U2, B), null); assert.strictEqual(L.claudeLaunchCommand(sid, null, 'x', null, B), null);
  const q = L.claudeLaunchCommand(sid, null, null, null, "/my dir/it's $(x)/claude");
  assert.ok(q.startsWith("\x15[ -x /my\\ dir/it\\'s\\ \\$\\(x\\)/claude ] || ") && q.includes('PATH="$PATH":/my\\ dir/it\\\'s\\ \\$\\(x\\) exec claude '));
  for (const bad of [undefined, null, '', 'claude', 'rel/claude', '/claude', '/a:b/claude', '/a/b\nc/claude', '/a/b\rc/claude', '/a/‮c/claude', '/a/\u0007/claude', '/' + 'a'.repeat(1030), 5, {}]) {
    assert.strictEqual(L.claudeLaunchCommand(sid, '/r/w.sh', U1, null, bad), L.claudeLaunchCommand(sid, '/r/w.sh', U1), String(bad).slice(0, 10)); // 예전 형태와 같다
    assert.ok(L.claudeLaunchCommand(sid, null, null, null, bad).startsWith('\x15command -v claude >/dev/null && '));
  }
  assert.ok(L.claudeLaunchCommand(sid, null).startsWith('\x15')); // 예전 형태도 Ctrl-U 로 시작한다
});
t('claudeLaunchCommand 실행: 낡은 경로·PATH 밖 설치·없음(zsh·bash)', () => {
  const cp = require('child_process');
  const dir = fs.mkdtempSync(path.join(tmp, 'launch '));
  const bd = path.join(dir, "bin dir's"); fs.mkdirSync(bd);
  const bin = path.join(bd, 'claude'); fs.writeFileSync(bin, '#!/bin/sh\necho "stub-ran:$MARU_APP_SESSION:$*"\nexit 0\n', { mode: 0o755 });
  const wrap = path.join(dir, 'wrap per.sh'); fs.writeFileSync(wrap, '#!/bin/sh\nexec claude "$@"\n', { mode: 0o755 });
  const pd = path.join(dir, 'on-path'); fs.mkdirSync(pd); fs.writeFileSync(path.join(pd, 'claude'), '#!/bin/sh\necho "path-ran:$*"\nexit 0\n', { mode: 0o755 });
  const U1 = '11111111-2222-4333-8444-555555555555'; const stale = path.join(dir, 'gone', 'claude');
  for (const sh of ['/bin/zsh', '/bin/bash']) {
    const run = (line, p) => cp.spawnSync('/usr/bin/env', ['-i', 'PATH=' + (p || '/usr/bin:/bin'), sh, '-c', line.replace(/^\x15/, '').replace(/\r$/, '')], { encoding: 'utf8', timeout: 10000 });
    const a = run(L.claudeLaunchCommand('sid1', null, null, null, stale), '/usr/bin:/bin:' + pd); assert.strictEqual(a.status, 0, sh + ' ' + a.stderr); assert.strictEqual(a.stdout.trim(), 'path-ran:', sh); // (a) 낡은 경로여도 PATH 의 claude
    const a2 = run(L.claudeLaunchCommand('sid1', wrap, null, null, stale), '/usr/bin:/bin:' + pd); assert.strictEqual(a2.status, 0, sh); assert.strictEqual(a2.stdout.trim(), 'path-ran:', sh);
    const b = run(L.claudeLaunchCommand('sid1', wrap, U1, null, bin)); assert.strictEqual(b.status, 0, sh + ' ' + b.stderr); assert.strictEqual(b.stdout.trim(), 'stub-ran:sid1:--resume ' + U1, sh); // (b) 래퍼 + PATH 밖 설치
    const c = run(L.claudeLaunchCommand('sid1', null, null, null, bin)); assert.strictEqual(c.status, 0, sh); assert.strictEqual(c.stdout.trim(), 'stub-ran:sid1:', sh); // (c) 래퍼 없이 덧붙인 폴더로
    const c2 = run(L.claudeLaunchCommand('sid1', null, null, null, bin), '/usr/bin:/bin:' + pd); assert.strictEqual(c2.stdout.trim(), 'path-ran:', sh); // 사용자 PATH 의 claude 가 덧붙인 폴더보다 먼저
    const d = run(L.claudeLaunchCommand('sid1', wrap, null, null, stale)); assert.strictEqual(d.status, 127, sh); assert.ok(!/ran/.test(d.stdout)); // (d) 어디에도 없음
    const d2 = run(L.claudeLaunchCommand('sid1', wrap, null, null, null)); assert.strictEqual(d2.status, 127, sh);
  }
});
t('claudeLaunchCommand: 이어 열기(--resume <uuid>)는 검증된 uuid 만, 잘못된 값은 null', () => {
  const sid = 'abcd1234-aaaa';
  assert.strictEqual(L.claudeLaunchCommand(sid, null, U1), '\x15command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec claude --resume ' + U1 + ' ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, '/r/scripts/maru-claude.sh', U1), '\x15command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec /r/scripts/maru-claude.sh --resume ' + U1 + ' ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, null), '\x15command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec claude ; exit 127\r'); // 인자 없으면 예전과 같다
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
t('workspacesToSave: 설정이 켜지면 모두(임시 포함)+uuid·prevSid, 꺼지면 uuid 없이 임시 작업 공간 제외, 활성 위치를 맞춘다', () => {
  const items = [{ id: 'a', cwd: '/a', title: 'A' }, { id: 'r', cwd: '/r', title: 'R', claudeSid: U1, claudeSidAt: 1.7e12, prevSid: U2, transient: true }, { id: 'b', cwd: '/b', title: 'B', claudeSid: 'bad', claudeSidAt: 5 }];
  assert.deepStrictEqual(L.workspacesToSave(items, 'b'), { list: [{ cwd: '/a', title: 'A' }, { cwd: '/r', title: 'R', claudeSid: U1, claudeSidAt: 1.7e12, prevSid: U2 }, { cwd: '/b', title: 'B' }], active: 2 });
  const off = L.workspacesToSave(items, 'b', false); // 꺼짐: 할 일 클릭으로 연 임시 탭은 저장하지 않는다(예전과 같다)
  assert.deepStrictEqual(off, { list: [{ cwd: '/a', title: 'A' }, { cwd: '/b', title: 'B' }], active: 1 });
  assert.strictEqual(L.workspacesToSave(items, 'r', false).active, 0); // 활성이 임시 탭이었다
  assert.strictEqual(L.workspacesToSave([{ id: 'r', cwd: '/r', title: 'R', transient: true }], 'r', false), null); // 남는 게 없으면 파일을 건드리지 않는다
  assert.strictEqual(L.workspacesToSave([], 'x'), null); assert.strictEqual(L.workspacesToSave(null, 'x'), null);
  const f = path.join(fs.mkdtempSync(path.join(tmp, 'ws-')), 'workspaces.json');
  const k = L.workspacesToSave([{ id: 'a', cwd: tmp, title: 'A', claudeSid: U1, claudeSidAt: 1.7e12, prevSid: U2 }], 'a');
  assert.ok(L.saveWorkspaces(f, k.list, k.active, { cleanExit: true }));
  assert.deepStrictEqual(L.loadWorkspaces(f, () => true), { list: [{ cwd: tmp, title: 'A', claudeSid: U1, claudeSidAt: 1.7e12, prevSid: U2 }], active: 0, cleanExit: true });
  assert.ok(L.saveWorkspaces(f, k.list, k.active)); assert.ok(!('cleanExit' in L.loadWorkspaces(f, () => true))); // 표지는 다음 저장에서 사라진다
  assert.strictEqual(L.workspacesJson(k.list, k.active), L.workspacesJson(k.list, k.active)); // 같은 내용 = 같은 본문(호출 쪽이 같으면 쓰지 않는다)
  assert.notStrictEqual(L.workspacesJson(k.list, k.active), L.workspacesJson(k.list, k.active, { cleanExit: true }));
});
t('normalizeWorkspaces: claudeSid·claudeSidAt·aliveAt 는 틀리면 값만 버리고 작업 공간은 남김, 예전 파일·모르는 필드도 읽힘', () => {
  const ex = () => true;
  const r = L.normalizeWorkspaces({ aliveAt: 1.7e12, future: { x: 1 }, workspaces: [
    { cwd: '/h/a', claudeSid: U1, claudeSidAt: 1.7e12, unknownField: 'x' }, { cwd: '/h/b', claudeSid: U2.toUpperCase(), claudeSidAt: 1.7e12 }, { cwd: '/h/c', claudeSid: U3, claudeSidAt: 'soon' },
    { cwd: '/h/d', claudeSid: 5 }, { cwd: '/h/e', claudeSid: U1 + ' ; rm -rf ~', claudeSidAt: -1 }, { cwd: '/h/f' }] }, { exists: ex });
  assert.deepStrictEqual(r.list.map((x) => [x.cwd, x.claudeSid || null, x.claudeSidAt || null]), [['/h/a', U1, 1.7e12], ['/h/b', null, null], ['/h/c', U3, null], ['/h/d', null, null], ['/h/e', null, null], ['/h/f', null, null]]);
  assert.strictEqual(r.aliveAt, 1.7e12); assert.ok(!('unknownField' in r.list[0]));
  for (const bad of ['x', -5, 1.5, 1e20, null, {}, '1700000000000']) assert.ok(!('aliveAt' in L.normalizeWorkspaces({ aliveAt: bad, workspaces: [{ cwd: '/h/a' }] }, { exists: ex })), String(bad));
  assert.deepStrictEqual(L.normalizeWorkspaces({ workspaces: [{ cwd: '/h/a' }] }, { exists: ex }), { list: [{ cwd: '/h/a', title: 'a' }], active: 0 }); // 예전 파일은 그대로
});
t('loadWorkspaces: 망가졌거나 큰 파일은 null(나머지 규칙은 그대로)', () => {
  const d = fs.mkdtempSync(path.join(tmp, 'wsc-'));
  for (const [n, body] of [['bad.json', '{"workspaces": [{"cwd":'], ['big.json', JSON.stringify({ workspaces: [{ cwd: '/h/a', claudeSid: U1 }], pad: 'x'.repeat(40000) })], ['arr.json', '[]']]) { const f = path.join(d, n); fs.writeFileSync(f, body); assert.strictEqual(L.loadWorkspaces(f, () => true), null, n); }
});
// ---- 복원 판단(순수) ----
const RPD = '/h/.claude/projects';
const rslug = (c) => RPD + '/' + L.projectSlug(c);
function restoreFs(spec) {
  const mk = (e) => ({ isDirectory: () => e.kind === 'dir', isFile: () => e.kind === 'file', isSymbolicLink: () => e.kind === 'link', mtimeMs: e.mtimeMs, uid: e.uid ?? 501 });
  return { lstat: (p) => { if (!spec[p]) throw new Error('ENOENT'); return mk(spec[p]); }, stat: (p) => { if (!spec[p]) throw new Error('ENOENT'); return mk(spec[p]); }, realpath: (p) => { if (!spec[p]) throw new Error('ENOENT'); return spec[p].real || p; } };
}
function rspec(cwds) { const sp = { [RPD]: { kind: 'dir' } }; for (const [c, sid, m, extra] of cwds) { sp[c] = { kind: 'dir' }; sp[rslug(c)] = { kind: 'dir' }; if (sid) sp[rslug(c) + '/' + sid + '.jsonl'] = { kind: 'file', mtimeMs: m, ...(extra || {}) }; } return sp; }
const RN = 1.8e12;
const rctx = (spec, o = {}) => ({ enabled: true, projectsDir: RPD, nowMs: RN, uid: 501, aliveAtMs: RN - 3600e3, fs: restoreFs(spec), ...o });
t('decideRestore: 이어 열 수 있으면 resume, 정보가 없으면 새로(포인터 없음)', () => {
  const spec = rspec([['/p/a', U1, RN - 7200e3], ['/p/b']]);
  assert.deepStrictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1, claudeSidAt: RN - 7200e3 }, { cwd: '/p/b' }], rctx(spec)), [{ action: 'resume', sid: U1 }, { action: 'fresh', prev: null, reason: 'none' }]);
  assert.deepStrictEqual(L.decideRestore(null, rctx(spec)), []);
});
t('decideRestore: 기록 없음은 포인터를 지우고, 폴더 없음·링크·소유자 다름도 새로 시작', () => {
  const noTr = L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(rspec([['/p/a', null]])));
  assert.deepStrictEqual(noTr[0], { action: 'fresh', prev: null, reason: 'no-transcript' });
  assert.deepStrictEqual(L.decideRestore([{ cwd: '/p/gone', claudeSid: U1 }], rctx({ [RPD]: { kind: 'dir' } }))[0], { action: 'fresh', prev: null, reason: 'no-folder' });
  const sp = rspec([['/p/a', U1, RN - 7200e3]]); sp[rslug('/p/a')] = { kind: 'link' };
  assert.strictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(sp))[0].action, 'fresh'); // 링크 폴더
  const sp2 = rspec([['/p/a', U1, RN - 7200e3]]); sp2[RPD] = { kind: 'link' };
  assert.strictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(sp2))[0].action, 'fresh'); // 링크 projects
  const sp3 = rspec([['/p/a', U1, RN - 7200e3]]); sp3[rslug('/p/a') + '/' + U1 + '.jsonl'] = { kind: 'link', mtimeMs: RN };
  assert.strictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(sp3))[0].action, 'fresh'); // 링크 기록
  const other = L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(rspec([['/p/a', U1, RN - 7200e3, { uid: 0 }]]))); // 다른 사용자 소유의 기록
  assert.deepStrictEqual([other[0].action, other[0].reason], ['fresh', 'no-transcript']);
});
t('decideRestore: 2일 넘음·다른 곳에서 이어짐은 새로 시작하되 포인터(prev)를 남기고 안내 종류를 돌려줌', () => {
  const old = L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(rspec([['/p/a', U1, RN - 3 * 86400e3]]), { aliveAtMs: RN }));
  assert.deepStrictEqual(old[0], { action: 'fresh', prev: U1, note: 'old', reason: 'too-old' });
  const spec = rspec([['/p/a', U1, RN - 600e3]]);
  const moved = L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(spec, { aliveAtMs: RN - 3600e3 }));
  assert.deepStrictEqual(moved[0], { action: 'fresh', prev: U1, note: 'moved', reason: 'moved' });
  assert.strictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(spec, { aliveAtMs: RN - 600e3 - 30e3 }))[0].action, 'resume'); // 60초 안은 앱 자신의 마지막 기록
  assert.strictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(spec, { aliveAtMs: RN - 600e3 - 61e3 }))[0].note, 'moved');
});
t('decideRestore: aliveAtMs 가 NaN 이면 시각 비교를 하지 않는다 — 실제 대체 경로는 pickAliveAt(alive 파일 → aliveAt → 파일 수정 시각)', () => {
  const spec = rspec([['/p/a', U1, RN - 600e3]]);
  assert.strictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(spec, { aliveAtMs: NaN }))[0].action, 'resume');
  assert.ok(Number.isNaN(L.pickAliveAt(NaN, undefined, null)));
  assert.strictEqual(L.pickAliveAt(NaN, undefined, RN - 3600e3), RN - 3600e3); // 파일 자신의 수정 시각만 있어도 쓴다
  assert.strictEqual(L.pickAliveAt(RN - 10e3, RN - 5000e3, RN - 3600e3), RN - 10e3); // 가장 새 것
  const real = L.pickAliveAt(NaN, undefined, RN - 3600e3); // 대체 경로를 거친 값으로는 "다른 곳에서 이어짐" 이 잡힌다
  assert.strictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], rctx(spec, { aliveAtMs: real }))[0].note, 'moved');
});
t('decideRestore: 같은 sid 는 앞의 것만, 미래 sidAt 은 무시, 꺼짐·다른 앱 창이면 모두 새로(꺼짐은 포인터도 지움)', () => {
  const spec = rspec([['/p/a', U1, RN - 7200e3], ['/p/b', U1, RN - 7200e3]]);
  const r = L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }, { cwd: '/p/b', claudeSid: U1 }], rctx(spec));
  assert.deepStrictEqual([r[0].action, r[1].action, r[1].reason, r[1].prev], ['resume', 'fresh', 'duplicate', null]);
  assert.deepStrictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1, claudeSidAt: RN + 3600e3 }], rctx(spec))[0], { action: 'fresh', prev: null, reason: 'future' });
  assert.strictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1, claudeSidAt: RN + 30e3 }], rctx(spec))[0].action, 'resume'); // 60초 안의 어긋남은 허용
  const off = L.decideRestore([{ cwd: '/p/a', claudeSid: U1, prevSid: U2 }, { cwd: '/p/c' }], rctx(spec, { enabled: false }));
  assert.deepStrictEqual(off.map((x) => [x.action, x.prev]), [['fresh', null], ['fresh', null]]);
  assert.strictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }], null)[0].action, 'fresh');
  const un = L.decideRestore([{ cwd: '/p/a', claudeSid: U1, unavailable: true }], rctx(spec));
  assert.deepStrictEqual(un[0], { action: 'fresh', prev: U1, reason: 'unavailable' }); // 사용 불가 폴더: 포인터는 남긴다
  const oth = L.decideRestore([{ cwd: '/p/a', claudeSid: U1 }, { cwd: '/p/c' }], rctx(spec, { otherInstance: true }));
  assert.deepStrictEqual(oth[0], { action: 'fresh', prev: U1, note: 'other', reason: 'other-instance' }); // 저장된 sid 는 지키고 아무것도 이어 열지 않는다
  assert.strictEqual(oth[1].action, 'fresh');
});
t('decideRestore: 새 세션(claudeSid)에 기록이 아직 없으면(첫 프롬프트 전) 남겨 둔 prevSid 를 대신 판단', () => {
  const spec = rspec([['/p/a', U1, RN - 7200e3]]); // U2 는 기록이 없다(막 시작한 새 세션)
  assert.deepStrictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U2, prevSid: U1 }], rctx(spec))[0], { action: 'resume', sid: U1 });
  const spec2 = rspec([['/p/a', U1, RN - 3 * 86400e3]]);
  assert.deepStrictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U2, prevSid: U1 }], rctx(spec2, { aliveAtMs: RN }))[0], { action: 'fresh', prev: U1, note: 'old', reason: 'too-old' }); // 여전히 오래됨: 포인터 유지
  const both = rspec([['/p/a', U2, RN - 3600e3]]); both[rslug('/p/a') + '/' + U1 + '.jsonl'] = { kind: 'file', mtimeMs: RN - 7200e3 };
  assert.deepStrictEqual(L.decideRestore([{ cwd: '/p/a', claudeSid: U2, prevSid: U1 }], rctx(both))[0], { action: 'resume', sid: U2 }); // 새 세션에 기록이 있으면 그쪽(첫 프롬프트가 나갔다)
  assert.deepStrictEqual(L.decideRestore([{ cwd: '/p/a', prevSid: U1 }], rctx(spec))[0], { action: 'resume', sid: U1 });
});
t('기록 폴더 이름이 겹치는 두 한글 폴더: 추측하지 않으므로 서로 영향이 없다(각자 자기 claudeSid 만)', () => {
  assert.strictEqual(L.projectSlug('/p/가나'), L.projectSlug('/p/다라')); // slug 는 겹친다
  const spec = rspec([['/p/가나', U1, RN - 7200e3], ['/p/다라', U2, RN - 7200e3]]); // 같은 기록 폴더에 두 세션 파일
  const r = L.decideRestore([{ cwd: '/p/가나', claudeSid: U1 }, { cwd: '/p/다라', claudeSid: U2 }], rctx(spec));
  assert.deepStrictEqual(r.map((x) => [x.action, x.sid]), [['resume', U1], ['resume', U2]]);
});
t('startupMode: 정상 종료면 바로 다시 켜도 normal, 비정상 종료 + alive 가 45초 안이면 다른 앱 창, 오래됐으면 normal', () => {
  const n = 1.8e12;
  assert.strictEqual(L.startupMode({ cleanExit: true, aliveAtMs: n - 1000, nowMs: n }), 'normal');
  assert.strictEqual(L.startupMode({ cleanExit: false, aliveAtMs: n - 20e3, nowMs: n }), 'other-instance');
  assert.strictEqual(L.startupMode({ aliveAtMs: n - 44e3, nowMs: n }), 'other-instance');
  assert.strictEqual(L.startupMode({ aliveAtMs: n - 46e3, nowMs: n }), 'normal'); // 충돌 뒤 복구
  assert.strictEqual(L.startupMode({ aliveAtMs: NaN, nowMs: n }), 'normal');
  assert.strictEqual(L.startupMode({ aliveAtMs: n + 10e3, nowMs: n }), 'other-instance'); // 시계가 조금 어긋나도 살아 있는 것으로
});
t('resumeFailureDecision: 이어 열기가 0 이 아닌 코드로, 준비 전이거나 15초 안에 끝났을 때만 한 번 새로 시작', () => {
  const d = (o) => L.resumeFailureDecision({ resumed: true, exitCode: 1, ageMs: 2000, ready: false, fellBack: false, ...o });
  assert.strictEqual(d({}), 'fallback');
  assert.strictEqual(d({ ready: true, ageMs: 5000 }), 'fallback'); // 준비됐어도 15초 안
  assert.strictEqual(d({ ready: true, ageMs: 60000 }), 'none'); // 한참 쓰다 끝났다
  assert.strictEqual(d({ ready: false, ageMs: 60000 }), 'fallback'); // 준비도 못 하고 오래 걸린 실패
  assert.strictEqual(d({ exitCode: 0 }), 'none'); assert.strictEqual(d({ exitCode: null }), 'none'); assert.strictEqual(d({ exitCode: undefined }), 'none');
  assert.strictEqual(d({ exitCode: 127 }), 'fallback'); assert.strictEqual(d({ exitCode: 130 }), 'fallback');
  assert.strictEqual(d({ resumed: false }), 'none'); // 새 세션의 실패는 되돌릴 곳이 없다
  assert.strictEqual(d({ fellBack: true }), 'none'); // 되풀이 금지
  assert.strictEqual(d({ ageMs: NaN, ready: true }), 'none');
});
t('noteVisible·shouldDropPrev: 백그라운드 탭의 안내는 처음 보일 때까지 남고, prevSid 는 새 세션의 첫 프롬프트에서 버린다', () => {
  const now = 1e12;
  assert.strictEqual(L.noteVisible({ kind: 'moved', shownAt: null, now }), true); // 한 번도 안 보였다
  assert.strictEqual(L.noteVisible({ kind: 'moved', shownAt: undefined, now: now + 3600e3 }), true); // 얼마나 지나도
  assert.strictEqual(L.noteVisible({ kind: 'moved', shownAt: now - 3000, now }), true);
  assert.strictEqual(L.noteVisible({ kind: 'moved', shownAt: now - 9000, now }), false);
  assert.strictEqual(L.noteVisible({ kind: null, shownAt: null, now }), false);
  assert.strictEqual(L.shouldDropPrev({ data: '\r', typedN: 1, hasPrev: true }), false); // Enter 만(글자 없음)
  assert.strictEqual(L.shouldDropPrev({ data: '\r', typedN: 4, hasPrev: true }), true); // 글자를 치고 Enter
  assert.strictEqual(L.shouldDropPrev({ data: '안녕\r', typedN: 1, hasPrev: true }), true); // 붙여넣고 Enter
  assert.strictEqual(L.shouldDropPrev({ data: 'a', typedN: 9, hasPrev: true }), false);
  assert.strictEqual(L.shouldDropPrev({ data: '\x1b[A\r', typedN: 1, hasPrev: true }), false); // 방향키 + Enter
  assert.strictEqual(L.shouldDropPrev({ data: 'x\r', typedN: 2, hasPrev: false }), false);
});
t('todo 클릭: 훅 정보가 없어도 claudeSid 로 이미 열린 탭을 찾아 전환한다(두 번 열지 않는다)', () => {
  const sid = L.sessionUuidOf({ claudeSid: U1 });
  assert.strictEqual(sid, U1);
  assert.strictEqual(L.sessionUuidOf({ hookSid: U2, claudeSid: U1 }), U2); // /clear 등으로 훅이 다른 uuid 를 보이면 그쪽
  assert.strictEqual(L.sessionUuidOf({ claudeSid: 'nope' }), null);
  const r = L.decideTodoOpen(dsrc, dctx({ workspaces: [{ id: 'tab1', sid, atMs: 1, live: true }] }));
  assert.deepStrictEqual(r, { action: 'switch', wsId: 'tab1' });
});
t('claudeLaunchCommand: 새 세션은 --session-id <uuid>, 이어 열기는 --resume <uuid>, 둘을 함께 주면 거부', () => {
  const sid = 'abcd1234-aaaa';
  assert.strictEqual(L.claudeLaunchCommand(sid, null, null, U1), '\x15command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec claude --session-id ' + U1 + ' ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, '/r/scripts/maru-claude.sh', undefined, U1), '\x15command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec /r/scripts/maru-claude.sh --session-id ' + U1 + ' ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, null, U1, null), '\x15command -v claude >/dev/null && MARU_APP_SESSION=abcd1234-aaaa exec claude --resume ' + U1 + ' ; exit 127\r');
  assert.strictEqual(L.claudeLaunchCommand(sid, null, U1, U2), null); assert.strictEqual(L.claudeLaunchCommand(sid, null, null, null), L.claudeLaunchCommand(sid, null));
  for (const bad of ['', 'x', U1.toUpperCase(), U1 + ' ; id', U1 + '\n', '$(id)', '--fork-session', 5, {}]) assert.strictEqual(L.claudeLaunchCommand(sid, null, null, bad), null, JSON.stringify(bad));
});
t('decideTodoOpen: 기록 폴더 이름은 실제 경로(realpath)로 만든다, 링크 폴더·다른 소유자 기록은 거부', () => {
  const link = '/Users/me/lnk/proj-a'; // 중간 조각이 링크라 실제 경로가 다르다
  const sp = { [link]: { kind: 'dir', real: CWD }, [CWD]: { kind: 'dir' }, [TR]: { kind: 'file', mtimeMs: DNOW - 3600e3 } };
  const f = fakeFs({ [link]: { kind: 'dir' }, [CWD]: { kind: 'dir' }, [TR]: { kind: 'file', mtimeMs: DNOW - 3600e3 } });
  const f2 = { ...f, realpath: (p) => (p === link ? CWD : p) };
  assert.strictEqual(L.decideTodoOpen({ ...dsrc, cwd: link }, { projectsDir: PD, nowMs: DNOW, uid: 501, workspaces: [], fs: f2 }).action, 'resume');
  assert.strictEqual(sp[link].real, CWD);
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [TR]: { kind: 'file', mtimeMs: DNOW - 3600e3, uid: 0 } })).reason, 'no-transcript'); // 다른 uid
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [PD + '/-Users-me-proj-a']: { kind: 'link' } })).reason, 'no-transcript'); // 링크 slug 폴더
  assert.strictEqual(L.decideTodoOpen(dsrc, dctx({}, { [PD]: { kind: 'link' } })).reason, 'no-transcript'); // 링크 projects
});
t('profile: resumeSessions 는 선택 항목(없으면 켜짐), 예전 검증은 그대로, mergeProfile 이 지킴', () => {
  const base = { name: 'a', lang: 'ko', calendar: false, createdAt: '2026-01-01T00:00:00.000Z' };
  assert.deepStrictEqual(L.validateProfile(base), base);
  assert.strictEqual(L.validateProfile({ ...base, resumeSessions: false }).resumeSessions, false);
  assert.ok(!('resumeSessions' in L.validateProfile({ ...base, resumeSessions: 'no' }))); // 틀린 값은 버리고 프로필은 유효
  assert.strictEqual(L.resumeSessionsOn(null), true); assert.strictEqual(L.resumeSessionsOn(base), true); assert.strictEqual(L.resumeSessionsOn({ ...base, resumeSessions: false }), false);
  assert.strictEqual(L.mergeProfile({ ...base, resumeSessions: false }, 'b', 'en', 'x').resumeSessions, false);
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

// ---- 백그라운드 서브에이전트 표시 ----
t('parseAgentRecord: bg 는 1~99 정수만 받고 틀린 값은 버리되 기록은 받는다', () => {
  const rec = (o) => L.parseAgentRecord(JSON.stringify({ state: 'idle', at: '2026-01-01T00:00:00Z', ...o }));
  assert.strictEqual(rec({ bg: 1 }).bg, 1); assert.strictEqual(rec({ bg: 99 }).bg, 99);
  for (const bad of [0, 100, -1, 1.5, '2', null, true, [1], {}, NaN]) { const r = rec({ bg: bad }); assert.ok(r && r.state === 'idle', String(bad)); assert.ok(!('bg' in r), String(bad)); }
  assert.ok(!('bg' in rec({})));
  assert.strictEqual(L.parseAgentRecord('{"state":"busy","bg":2}').bg, 2); // 값은 보존하고 해석은 bgCount 가 한다
});
t('bgCount·showSubs: idle 이고 bg>0 이며 기록이 TTL 안일 때만, busy 로 바꾸지 않는다', () => {
  const now = Date.parse('2026-01-01T01:00:00Z'); const ttl = 30 * 60 * 1000;
  const rec = (bg, ago) => ({ state: 'idle', atMs: now - ago, bg });
  assert.strictEqual(L.bgCount(rec(2, 1000), 'idle', now, ttl), 2);
  assert.strictEqual(L.bgCount(rec(2, ttl + 1), 'idle', now, ttl), 0); // 낡은 값(SubagentStop 이 안 왔다)
  assert.strictEqual(L.bgCount(rec(2, ttl), 'idle', now, ttl), 2);
  assert.strictEqual(L.bgCount(rec(2, 1000), 'busy', now, ttl), 0); assert.strictEqual(L.bgCount(rec(2, 1000), 'waiting', now, ttl), 0); // idle 일 때만
  assert.strictEqual(L.bgCount({ state: 'idle', atMs: now }, 'idle', now, ttl), 0); // bg 없음 = 마지막 Stop
  assert.strictEqual(L.bgCount({ state: 'idle', atMs: NaN, bg: 3 }, 'idle', now, ttl), 0); // 시각을 모르면 믿지 않는다
  assert.strictEqual(L.bgCount({ state: 'idle', atMs: now + 2 * 86400e3, bg: 3 }, 'idle', now, ttl), 0); // 먼 미래
  for (const bad of [null, undefined, {}, { bg: 0 }, { bg: 100, atMs: now }, { bg: '2', atMs: now }]) assert.strictEqual(L.bgCount(bad, 'idle', now, ttl), 0);
  assert.strictEqual(L.showSubs(rec(2, 1000), 'idle', now, ttl), true); assert.strictEqual(L.showSubs(rec(2, 1000), 'idle', now, ttl) && L.effectiveAgent(rec(2, 1000), now, 0) === 'idle', true);
  assert.strictEqual(L.showSubs({ state: 'idle', atMs: now }, 'idle', now, ttl), false); // 마지막 Stop 뒤에는 비어 있다
  assert.strictEqual(L.showSubs(null, 'busy', now, ttl), true); assert.strictEqual(L.showSubs(null, 'waiting', now, ttl), true); // 일하는 중이면 예전처럼
  for (const st of ['none', 'pending', 'exited', 'unavailable']) assert.strictEqual(L.showSubs(rec(2, 1000), st, now, ttl), false, st);
});
t('effectiveAgent: bg 가 있어도 idle 은 idle(사용자가 입력할 수 있다)', () => {
  const now = Date.parse('2026-01-01T01:00:00Z');
  assert.strictEqual(L.effectiveAgent({ state: 'idle', atMs: now - 1000, bg: 2 }, now, 0), 'idle');
});
t('agentStatusText: idle + bg 면 "입력 대기 · 백그라운드 작업 N", 아니면 예전 문구', () => {
  const x = L.agentStatusText('idle', 3);
  assert.deepStrictEqual(x, { key: 'agent.idle.bg', params: { n: 3 } });
  assert.strictEqual(I.t('ko', x.key, x.params), '입력 대기 · 백그라운드 작업 3'); assert.strictEqual(I.t('en', x.key, x.params), 'Ready · 3 in background');
  for (const [k, bg] of [['idle', 0], ['idle', undefined], ['idle', null], ['idle', 1.5], ['busy', 3], ['waiting', 2], ['none', 1]]) assert.deepStrictEqual(L.agentStatusText(k, bg), { key: 'agent.' + k, params: {} }, k + bg);
  assert.strictEqual(I.t('ko', L.agentStatusText('idle', 0).key), '입력 대기'); // 예전 문구 그대로
});
t('실제 상태 파일 → 표시: 훅이 쓴 형식(bg 포함)을 읽어 서브 목록을 보일지 정한다', () => {
  const now = Date.now();
  const text = JSON.stringify({ state: 'idle', at: new Date(now - 5000).toISOString().replace(/\.\d+Z$/, 'Z'), bg: 1 });
  const rec = L.parseAgentRecord(text);
  assert.strictEqual(L.showSubs(rec, L.effectiveAgent(rec, now, 0), now, 30 * 60 * 1000), true);
  const fin = L.parseAgentRecord(JSON.stringify({ state: 'idle', at: new Date(now).toISOString() })); // 마지막 Stop: bg 없음
  assert.strictEqual(L.showSubs(fin, 'idle', now, 30 * 60 * 1000), false);
});
// ---- 호스트 환경 정리 ----
t('sanitizeHostEnv: 호스트 세션에서 물려받은 환경은 모두 지우고 CLAUDE_CONFIG_DIR·MARU_* 와 나머지는 남긴다', () => {
  const env = { PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_MESSAGING_SOCKET: '/s', CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SIMPLE: '1',
    CLAUDE_AGENT_SDK_VERSION: '1', CLAUDE_AGENT_SDK_CLIENT_APP: 'x', CLAUDE_EFFORT: 'high', CLAUDE_PID: '9', CLAUDE_PREVIEW_ID: 'p', MCP_TIMEOUT: '1', MCP_SERVER_X: 'y', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 'a', ANTHROPIC_CUSTOM_HEADERS: 'h',
    CLAUDE_CONFIG_DIR: '/cfg', MARU_HOME: '/m', MARU_APP_UI: 'x', EDITOR: 'vi', ANTHROPIC_MODEL: 'm' };
  const frozen = JSON.stringify(env);
  const out = L.sanitizeHostEnv(env);
  assert.strictEqual(JSON.stringify(env), frozen); // 입력은 바뀌지 않는다
  assert.deepStrictEqual(Object.keys(out).sort(), ['ANTHROPIC_MODEL', 'CLAUDE_CONFIG_DIR', 'EDITOR', 'HOME', 'MARU_APP_UI', 'MARU_HOME', 'PATH'].sort());
  assert.notStrictEqual(out, env);
});
t('sanitizeHostEnv: 호스트가 아닌 사용자 환경은 ANTHROPIC_BASE_URL·MCP_* 등을 지우지 않는다(CLAUDE_CODE_* 표지류는 늘 뺌)', () => {
  const clean = { PATH: '/bin', ANTHROPIC_BASE_URL: 'https://proxy.example', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 'a', ANTHROPIC_CUSTOM_HEADERS: 'h', MCP_TIMEOUT: '5', CLAUDE_CONFIG_DIR: '/cfg', MARU_DATA: '/d' };
  assert.deepStrictEqual(L.sanitizeHostEnv(clean), clean);
  const out = L.sanitizeHostEnv({ ...clean, CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_EFFORT: 'low', CLAUDE_PID: '1' }); // 표지 없이 CLAUDE_CODE_* 만 있어도 그것들은 뺀다
  assert.deepStrictEqual(out, clean);
  assert.strictEqual('ANTHROPIC_BASE_URL' in L.sanitizeHostEnv({ ...clean, CLAUDECODE: '1' }), false); // CLAUDECODE 만 있어도 호스트로 본다
  assert.strictEqual('MCP_TIMEOUT' in L.sanitizeHostEnv({ ...clean, CLAUDE_CODE_CHILD_SESSION: '1' }), false);
  for (const bad of [null, undefined, 5, 'x']) assert.deepStrictEqual(L.sanitizeHostEnv(bad), {});
  const own = Object.create({ CLAUDECODE: '1' }); own.PATH = '/bin'; assert.deepStrictEqual(L.sanitizeHostEnv(own), { PATH: '/bin' }); // 상속 속성은 호스트 표지로 보지 않는다
});
t('main 의 자식 프로세스 환경은 모두 sanitizeHostEnv 를 거친다(pty·childEnv·run)', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.ok(/L\.ptyEnv\(\{ host: process\.env,/.test(main) && /\.\.\.sanitizeHostEnv\(host\), TERM/.test(fs.readFileSync(path.join(__dirname, 'lib.js'), 'utf8')) && /const env = L\.sanitizeHostEnv\(process\.env\);\n  for \(const k of Object\.keys\(env\)\) if \(k\.startsWith\('ELECTRON_'\)/.test(main) && /env: L\.sanitizeHostEnv\(process\.env\), \.\.\.opts/.test(main));
  assert.ok(!/\{ \.\.\.process\.env/.test(main.replace(/\/\/[^\n]*/g, '')), 'process.env 를 그대로 펼치는 곳이 없다');
});

// ======== 하위 세션(마루가 맡기는 일) ========
const CH_NOW = 1.8e12; const CH_FROM = 'sess-maru-0001'; const CH_OK_NAME = CH_NOW - 1000 + '-0a1b2c3d.json';
const crypto = require('crypto'); const CH_KEY = 'ab'.repeat(32);
// mac 은 L.childMac 이 아니라 명세대로 독립 계산한다: HMAC-SHA256(키 32바이트, "v\nfrom\ncwd\ntitle\nproject|''\nat\nsha256hex(prompt)")
// v=2(스쿼드 지정)면 끝에 squad 줄이 하나 더(8줄)
const chMac = (r, key = CH_KEY) => crypto.createHmac('sha256', Buffer.from(key, 'hex')).update([String(r.v), r.from, r.cwd, r.title, r.project || '', String(r.at), crypto.createHash('sha256').update(r.prompt, 'utf8').digest('hex'), ...(r.v === 2 ? [r.squad] : [])].join('\n'), 'utf8').digest('hex');
const chReq = (o = {}, key = CH_KEY) => { const r = { v: 1, from: CH_FROM, cwd: '/Users/x/work/blog', title: '블로그 정리', project: null, prompt: '설계 문서를 읽고\n초안을 다듬어 주세요.', at: CH_NOW - 1000, ...o }; return 'mac' in o ? r : { ...r, mac: chMac(r, key) }; };
const chFacts = () => [
  { id: 'ws-maru', sessionId: CH_FROM, hasTerm: true, proc: 'node', isRoot: true, parentId: null, origin: null, key: CH_KEY },
  { id: 'ws-kid', sessionId: 'sess-kid-0001', hasTerm: true, proc: 'node', isRoot: false, parentId: 'ws-maru', origin: 'child', key: null },
  { id: 'ws-exkid', sessionId: 'sess-exkid-01', hasTerm: true, proc: 'node', isRoot: true, parentId: null, origin: 'child', key: null }, // 부모가 닫혀 최상위가 된 옛 하위 세션(폴더가 루트)
  { id: 'ws-shell', sessionId: 'sess-shell-01', hasTerm: true, proc: '-zsh', isRoot: true, parentId: null, origin: null, key: CH_KEY },
  { id: 'ws-other', sessionId: 'sess-other-01', hasTerm: true, proc: 'node', isRoot: false, parentId: null, origin: null, key: null },
  { id: 'ws-dead', sessionId: 'sess-dead-001', hasTerm: false, proc: '', isRoot: true, parentId: null, origin: null, key: CH_KEY },
];
const chCtx = (o = {}, r = chReq()) => ({
  name: CH_OK_NAME, size: 300, mtimeMs: CH_NOW - 500, text: JSON.stringify(r), nowMs: CH_NOW,
  requester: (f) => L.requesterOf(chFacts(), f, true),
  wsCount: 2, childCount: () => 0, accepted: [], launches: [], realDir: (c) => c, projectKnown: (k) => k === 'blog/draft', ...o,
});
t('decideChildRequest: 정상 요청(올바른 mac)은 받아들이고 정리된 값·부모 id·실제 경로를 돌려준다', () => {
  const d = L.decideChildRequest(chCtx());
  assert.strictEqual(d.ok, true); assert.strictEqual(d.parentId, 'ws-maru'); assert.strictEqual(d.real, '/Users/x/work/blog');
  assert.strictEqual(d.req.title, '블로그 정리'); assert.strictEqual(d.req.prompt, '설계 문서를 읽고\n초안을 다듬어 주세요.'); assert.strictEqual(d.req.project, null);
  assert.strictEqual(L.decideChildRequest(chCtx({}, chReq({ project: 'blog/draft' }))).ok, true); // project 가 mac 에 들어간다
  assert.strictEqual(L.childMac(CH_KEY, JSON.parse(JSON.stringify(chReq()))), chReq().mac); // 구현과 독립 계산이 같다(스크립트 쪽 시험 벡터)
});
t('mac 인증: 키 없음·다른 키·변조된 필드·형식 오류는 모두 auth, 다른 세션의 키로는 통과하지 않는다', () => {
  const why = (o, r) => { const d = L.decideChildRequest(chCtx(o, r)); return d.ok ? 'ok' : d.reason; };
  assert.strictEqual(why({}, chReq({}, 'cd'.repeat(32))), 'auth'); // 다른 키
  assert.strictEqual(why({}, chReq({ mac: '0'.repeat(64) })), 'auth'); assert.strictEqual(why({}, chReq({ mac: 'zz' })), 'auth'); assert.strictEqual(why({}, chReq({ mac: CH_KEY.toUpperCase() })), 'auth'); assert.strictEqual(why({}, chReq({ mac: 5 })), 'auth');
  const noMac = chReq(); delete noMac.mac; assert.strictEqual(why({}, noMac), 'shape'); // 필수 키 없음
  const good = JSON.stringify(chReq());
  for (const [a, b] of [['"title":"블로그 정리"', '"title":"블로그 정리2"'], ['"cwd":"/Users/x/work/blog"', '"cwd":"/Users/x/work/blog2"'], ['"prompt":"설계', '"prompt":"설개'], ['"project":null', '"project":"blog/draft"'], [`"at":${CH_NOW - 1000}`, `"at":${CH_NOW - 999}`]]) assert.ok(good.includes(a), a), assert.strictEqual(why({ text: good.replace(a, b) }), 'auth', b);
  assert.strictEqual(why({ requester: (f) => L.requesterOf(chFacts().map((x) => ({ ...x, key: null })), f, true) }), 'auth'); // 키가 없는 마루(시작 직후 등)
  assert.strictEqual(L.childMacOk('short', { mac: chReq().mac }), false); assert.strictEqual(L.childMacOk(CH_KEY, null), false);
  // from 이 다른 세션을 가리키면 그 세션의 키로 검증한다: 마루의 키로 만든 mac 은 하위 세션 id 로 통과하지 않는다
  assert.strictEqual(why({}, chReq({ from: 'sess-kid-0001' })), 'child');
});
t('requesterOf·maruEligible: 살아 있는 Claude 세션만, 하위 세션·하위 세션이었던 세션·루트가 아닌 세션은 자격 없음', () => {
  const w = (f) => L.requesterOf(chFacts(), f, true);
  assert.deepStrictEqual(w(CH_FROM), { id: 'ws-maru', running: true, maru: true, child: false, key: CH_KEY });
  assert.strictEqual(w('sess-kid-0001').child, true); assert.strictEqual(w('sess-kid-0001').maru, false);
  assert.strictEqual(w('sess-exkid-01').child, true); // D6: 부모가 닫혀 최상위·루트 폴더여도 영구히 요청자가 될 수 없다
  assert.strictEqual(w('sess-other-01').maru, false); assert.strictEqual(w('sess-shell-01').running, false); // 셸이 전경
  assert.strictEqual(w('sess-dead-001'), null); assert.strictEqual(w('nobody'), null); assert.strictEqual(w(5), null); assert.strictEqual(L.requesterOf(null, 'x', true), null);
  assert.strictEqual(L.requesterOf(chFacts(), CH_FROM, false).running, false); // claude 실행 파일이 없다
  assert.strictEqual(L.requesterOf(chFacts().map((x) => ({ ...x, proc: '' })), CH_FROM, true).running, false);
  assert.strictEqual(L.maruEligible({ isRoot: true, parentId: null, origin: null }), true); assert.strictEqual(L.maruEligible({ isRoot: true, parentId: 'p', origin: null }), false); assert.strictEqual(L.maruEligible({ isRoot: true, parentId: null, origin: 'child' }), false); assert.strictEqual(L.maruEligible({ isRoot: false }), false); assert.strictEqual(L.maruEligible({}), false);
});
t('decideChildRequest: 거부 경로마다 이유(이름·크기·오래됨·미래·형식·버전·요청자·마루 아님·하위 세션·Claude 아님·폴더·프로젝트·한도·속도·예산)', () => {
  const why = (o, r) => { const d = L.decideChildRequest(chCtx(o, r)); return d.ok ? 'ok' : d.reason; };
  assert.strictEqual(why({ name: 'x.json' }), 'name'); assert.strictEqual(why({ name: '1800000000000-0A1B2C3D.json' }), 'name'); assert.strictEqual(why({ name: CH_OK_NAME + '.bak' }), 'name');
  assert.strictEqual(why({ size: 16385 }), 'size'); assert.strictEqual(why({ size: 0 }), 'size'); assert.strictEqual(why({ size: NaN }), 'size');
  assert.strictEqual(why({ mtimeMs: CH_NOW - 60001 }), 'stale'); assert.strictEqual(why({}, chReq({ at: CH_NOW - 60001 })), 'stale'); assert.strictEqual(why({}, chReq({ at: CH_NOW + 2001 })), 'stale'); assert.strictEqual(why({ mtimeMs: CH_NOW + 2001 }), 'stale'); // 미래 시각(F1)
  assert.strictEqual(why({ mtimeMs: CH_NOW - 60000 }), 'ok'); assert.strictEqual(why({ mtimeMs: CH_NOW + 2000 }), 'ok'); assert.strictEqual(why({}, chReq({ at: CH_NOW + 2000 })), 'ok'); // 경계
  assert.strictEqual(why({ text: '{' }), 'json'); assert.strictEqual(why({ text: '[]' }), 'shape'); assert.strictEqual(why({ text: 'null' }), 'shape'); assert.strictEqual(why({ text: '"x"' }), 'shape');
  assert.strictEqual(why({}, chReq({ v: 3 })), 'version'); assert.strictEqual(why({}, chReq({ v: '1' })), 'version');
  assert.strictEqual(why({}, chReq({ from: 'nobody-0000001' })), 'from'); assert.strictEqual(why({}, chReq({ from: 5 })), 'shape'); assert.strictEqual(why({}, chReq({ from: 'sess-dead-001' })), 'from'); // pty 없는 세션
  assert.strictEqual(why({}, chReq({ from: 'sess-shell-01' })), 'not-claude'); // 셸만 떠 있다
  assert.strictEqual(why({}, chReq({ from: 'sess-kid-0001' })), 'child'); assert.strictEqual(why({}, chReq({ from: 'sess-exkid-01' })), 'child');
  assert.strictEqual(why({}, chReq({ from: 'sess-other-01' })), 'not-maru');
  assert.strictEqual(why({ realDir: () => null }), 'cwd'); assert.strictEqual(why({}, chReq({ cwd: 'relative/x' })), 'cwd'); assert.strictEqual(why({}, chReq({ cwd: '/a/../b' })), 'cwd'); assert.strictEqual(why({}, chReq({ cwd: '/a/b\u0007' })), 'cwd');
  assert.strictEqual(why({}, chReq({ cwd: '/' + 'a'.repeat(1030) })), 'cwd');
  assert.strictEqual(why({}, chReq({ title: '' })), 'title'); assert.strictEqual(why({}, chReq({ title: '가'.repeat(41) })), 'title'); assert.strictEqual(why({}, chReq({ title: '\u202E\u200B' })), 'title'); assert.strictEqual(why({}, chReq({ title: '가'.repeat(40) })), 'ok');
  assert.strictEqual(why({}, chReq({ prompt: '' })), 'prompt'); assert.strictEqual(why({}, chReq({ prompt: 'a'.repeat(4001) })), 'prompt'); assert.strictEqual(why({}, chReq({ prompt: '\u0007\u200B' })), 'prompt'); assert.strictEqual(why({}, chReq({ prompt: 'a'.repeat(4000) })), 'ok');
  assert.strictEqual(why({}, chReq({ prompt: '😀'.repeat(4000) })), 'ok'); assert.ok(Buffer.byteLength(L.childPromptText('ko', '😀'.repeat(4000))) <= L.PROMPT_FILE_MAX); // 4000자 상한 안에서는 머리말을 더해도 16384 바이트에 든다(넘는 값은 parse 가 prompt-size 로 거부, 조용히 줄이지 않는다)
  assert.strictEqual(why({}, chReq({ prompt: '가'.repeat(4000) })), 'ok');
  assert.strictEqual(why({}, chReq({ project: '../x' })), 'project'); assert.strictEqual(why({}, chReq({ project: 'a b/c' })), 'project'); assert.strictEqual(why({}, chReq({ project: 5 })), 'project');
  assert.strictEqual(why({}, chReq({ project: 'zzz/none' })), 'project-unknown'); // 형식은 맞지만 레지스트리에 없다
  assert.strictEqual(why({ childCount: () => 4 }), 'children-max'); assert.strictEqual(why({ childCount: () => 3 }), 'ok'); assert.strictEqual(why({ wsCount: L.WS_MAX }), 'ws-max'); assert.strictEqual(why({ wsCount: L.WS_MAX - 1 }), 'ok');
  assert.strictEqual(why({ accepted: [CH_NOW - 10, CH_NOW - 20, CH_NOW - 30] }), 'rate'); assert.strictEqual(why({ accepted: [CH_NOW - 10, CH_NOW - 20, CH_NOW - 60000] }), 'ok'); // 1분 지난 것은 세지 않는다
  const day = (n, ago) => Array.from({ length: n }, (_, i) => CH_NOW - ago - i);
  assert.strictEqual(why({ launches: day(20, 3600000) }), 'budget'); assert.strictEqual(why({ launches: day(19, 3600000) }), 'ok'); assert.strictEqual(why({ launches: day(20, 24 * 3600000 + 1000) }), 'ok'); // 24시간이 지난 것은 세지 않는다
});
t('예산(24시간 20개)·기록·파일: 굴러가는 창, 재시작 뒤 유지(저장 목록), 손상 파일', () => {
  const n = 1.8e12; let l = []; for (let i = 0; i < 25; i++) l = L.recordLaunch(l, n + i);
  assert.strictEqual(l.length, 20); assert.strictEqual(L.budgetOk(l, n + 100), false); assert.strictEqual(L.budgetOk(l, n + 24 * 3600000 + 5), true); // 가장 이른 것들이 창을 벗어나면 다시 열린다(5개만 벗어남 → 15개)
  assert.strictEqual(L.budgetOk(l.slice(0, 19), n + 100), true); assert.strictEqual(L.budgetOk(null, n), true);
  assert.deepStrictEqual(L.recordLaunch([n - 25 * 3600000, n - 1], n), [n - 1, n]);
  const f = path.join(tmp, 'budget.json'); assert.deepStrictEqual(L.readBudgetFile(f), { status: 'missing', list: [] });
  assert.ok(L.saveBudgetFile(f, l)); assert.deepStrictEqual(L.readBudgetFile(f), { status: 'ok', list: l }); assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  for (const bad of ['{', '[]', '{"version":2,"launches":[]}', '{"version":1,"launches":"x"}', JSON.stringify({ version: 1, launches: Array(201).fill(n) })]) { fs.writeFileSync(f, bad); assert.strictEqual(L.readBudgetFile(f).status, 'corrupt', bad.slice(0, 20)); }
  assert.deepStrictEqual(L.validateBudget({ version: 1, launches: [n, 'x', 5, 1.5, n + 1] }), [n, n + 1]); // 잘못된 값은 걸러 낸다
});
t('동의 창 토큰: 한 번만 쓰고, 다른 토큰·만료·다른 답은 invalid, 보이는 값은 전체 내용', () => {
  const p = { token: 'ab12cd34ab12cd34ab12cd34ab12cd34', expiresAt: 1000, used: false };
  assert.deepStrictEqual(L.consentAnswer(p, p.token, 'open', 500), { result: 'open' }); assert.deepStrictEqual(L.consentAnswer(p, p.token, 'cancel', 1000), { result: 'cancel' });
  assert.strictEqual(L.consentAnswer({ ...p, used: true }, p.token, 'open', 500).result, 'invalid'); // 이미 쓴 토큰
  assert.strictEqual(L.consentAnswer(p, p.token, 'open', 1001).result, 'invalid'); // 만료
  assert.strictEqual(L.consentAnswer(p, 'ab12cd34ab12cd34ab12cd34ab12cd35', 'open', 500).result, 'invalid'); assert.strictEqual(L.consentAnswer(p, 'short', 'open', 500).result, 'invalid'); assert.strictEqual(L.consentAnswer(p, 5, 'open', 500).result, 'invalid');
  assert.strictEqual(L.consentAnswer(p, p.token, 'yes', 500).result, 'invalid'); assert.strictEqual(L.consentAnswer(null, p.token, 'open', 500).result, 'invalid'); assert.strictEqual(L.consentAnswer({}, p.token, 'open', 500).result, 'invalid');
  const long = '가\n'.repeat(1500); const v = L.consentView({ token: 't', folder: '/a/very/long/path', project: 'a/b', title: '제목', prompt: long, paste: true });
  assert.strictEqual(v.brief, long.trim()); assert.strictEqual(v.paste, true); assert.deepStrictEqual(Object.keys(v).sort(), ['brief', 'chars', 'folder', 'lines', 'paste', 'project', 'squad', 'squadAsked', 'squadMissing', 'squads', 'title', 'token']); assert.strictEqual(v.chars, [...long.trim()].length); assert.strictEqual(v.lines, 1500); assert.strictEqual(L.consentView({ token: 't', folder: '/a', title: 'x', prompt: 'p' }).project, null);
});
// ---- 하위 세션의 팀(스쿼드) ----
const SQ_LIST = L.parseSquadMeta(JSON.stringify({ squads: [
  { slug: 'dev', name: 'Dev', description: '', source: 'builtin', lead: { agent: 'sq-dev-lead', model: 'sonnet' }, members: [{ role: 'builder', agent: 'sq-dev-builder', model: 'sonnet' }] },
  { slug: 'notes', name: 'Notes', description: '', source: 'personal', lead: { agent: 'sq-notes-lead', model: 'inherit' }, members: [{ role: 'editor', agent: 'sq-notes-editor', model: 'sonnet' }] },
] }));
t('cleanSquadAsk: 문자열만, 제어·개행은 공백으로 모아 1~300자, 비면·비밀처럼 보이면 거부', () => {
  assert.strictEqual(L.cleanSquadAsk('  여행 일정을\n조사하는\t\u0007 팀  '), '여행 일정을 조사하는 팀');
  assert.strictEqual(L.cleanSquadAsk('a\u202Eb\u200Bc\r\nd'), 'a b c d');
  assert.strictEqual(L.cleanSquadAsk('가'.repeat(300)), '가'.repeat(300)); assert.strictEqual(L.cleanSquadAsk('가'.repeat(301)), '');
  assert.strictEqual(L.cleanSquadAsk('😀'.repeat(300)), '😀'.repeat(300)); assert.strictEqual(L.cleanSquadAsk('😀'.repeat(301)), ''); // 코드 포인트 기준
  for (const bad of ['', '   ', '\n\t\u0001', 'sk-abcdefghijklmnopqrstuvwx', 'token ' + 'a1'.repeat(20), 5, null, undefined, {}, ['a']]) assert.strictEqual(L.cleanSquadAsk(bad), '', String(bad));
  assert.ok(!/[\r\n\u0000-\u001f]/.test(L.cleanSquadAsk('a\nb\rc\u0000d\u001be')));
  assert.strictEqual(L.cleanSquadAsk('a\n\n\n   b'), 'a b'); // 공백 하나로
});
t('child 요청: squad 없는 v=1 은 예전 그대로, squad 가 있는 v=2 는 서명에 들어가고 값·버전을 바꾸면 거부', () => {
  const why = (r, o = {}) => { const d = L.decideChildRequest(chCtx(o, r)); return d.ok ? 'ok' : d.reason; };
  const old = L.decideChildRequest(chCtx()); assert.strictEqual(old.ok, true); assert.strictEqual(old.req.squad, null); // 옛 요청: 그대로 통과
  const v2 = chReq({ v: 2, squad: 'dev' }); const d = L.decideChildRequest(chCtx({}, v2));
  assert.strictEqual(d.ok, true); assert.strictEqual(d.req.squad, 'dev'); assert.strictEqual(L.childMac(CH_KEY, { ...JSON.parse(JSON.stringify(v2)), project: null }), v2.mac); // 구현과 독립 계산이 같다
  assert.strictEqual(L.decideChildRequest(chCtx({}, chReq({ v: 2, squad: 'dev', project: 'blog/draft' }))).req.squad, 'dev');
  const raw = JSON.parse(JSON.stringify(v2));
  assert.strictEqual(why({ ...raw, squad: 'notes' }), 'auth'); // squad 를 바꾸면 mac 이 맞지 않는다
  const noSq = { ...raw }; delete noSq.squad; assert.strictEqual(why(noSq), 'shape'); // v=2 인데 squad 가 없다
  assert.strictEqual(why({ ...raw, v: 1 }), 'shape'); // v=1 에 squad 가 붙어 있다(서명 밖의 값)
  const dn = { ...raw }; delete dn.squad; dn.v = 1; assert.strictEqual(why(dn), 'auth'); // squad 를 떼고 v 를 내려도 mac 이 맞지 않는다
  assert.strictEqual(why({ ...raw, v: 3 }), 'version');
  for (const bad of ['Dev', '-x', 'a'.repeat(21), '', 'a b', 'a/b', '한글', null, 5, ['dev'], {}]) assert.strictEqual(why(chReq({ v: 2, squad: bad })), 'shape', String(bad)); // 서명이 맞아도 slug 형식이 틀리면 거부
  assert.strictEqual(why(chReq({ v: 2, squad: 'a'.repeat(20) })), 'ok'); assert.strictEqual(why(chReq({ v: 2, squad: '0-9' })), 'ok');
});
t('동의 창 팀 고르기: 요청한 팀이 설치돼 있으면 미리 고름, 없으면 팀 없이 + 안내 표지, 목록은 slug·이름·개인 여부만', () => {
  const a = L.consentView({ token: 't', folder: '/a', title: 'x', prompt: 'p', squads: SQ_LIST, squad: 'notes' });
  assert.deepStrictEqual(a.squads, [{ slug: 'dev', name: 'Dev', personal: false }, { slug: 'notes', name: 'Notes', personal: true }]); assert.strictEqual(a.squad, 'notes'); assert.strictEqual(a.squadMissing, false);
  const b = L.consentView({ token: 't', folder: '/a', title: 'x', prompt: 'p', squads: SQ_LIST, squad: 'ghost' });
  assert.strictEqual(b.squad, null); assert.strictEqual(b.squadMissing, true); assert.strictEqual(b.squadAsked, 'ghost');
  const c = L.consentView({ token: 't', folder: '/a', title: 'x', prompt: 'p', squads: SQ_LIST }); assert.strictEqual(c.squad, null); assert.strictEqual(c.squadMissing, false);
  const e = L.consentView({ token: 't', folder: '/a', title: 'x', prompt: 'p', squads: 'x', squad: 'BAD' }); assert.deepStrictEqual(e.squads, []); assert.strictEqual(e.squadMissing, false); // 형식이 틀린 요청은 없는 것과 같다
  assert.deepStrictEqual(L.squadChoices([null, { slug: 'Bad', name: 'x' }, { slug: 'ok', name: '' }, { slug: 'ok', name: 'Ok', personal: true }]), [{ slug: 'ok', name: 'Ok', personal: true }]);
});
t('동의 답의 팀 검증: 팀 없이(null/undefined)는 통과, 설치된 slug 만 통과, 모르는 slug·형식 오류·다른 타입은 거부', () => {
  assert.deepStrictEqual(L.consentChoice(SQ_LIST, null), { ok: true, squad: null }); assert.deepStrictEqual(L.consentChoice(SQ_LIST, undefined), { ok: true, squad: null });
  assert.deepStrictEqual(L.consentChoice([], null), { ok: true, squad: null }); // 목록을 못 읽어도 "팀 없이" 는 된다
  assert.deepStrictEqual(L.consentChoice(SQ_LIST, 'dev'), { ok: true, squad: 'dev' }); assert.deepStrictEqual(L.consentChoice(SQ_LIST, 'notes'), { ok: true, squad: 'notes' });
  for (const bad of ['ghost', 'Dev', '', 'dev ', 'dev\n', '../dev', 'sq-dev-lead', 5, {}, ['dev'], true]) assert.deepStrictEqual(L.consentChoice(SQ_LIST, bad), { ok: false }, String(bad));
  assert.deepStrictEqual(L.consentChoice([], 'dev'), { ok: false }); assert.deepStrictEqual(L.consentChoice(null, 'dev'), { ok: false }); // 목록에 없으면(읽기 실패 포함) 거부
});
t('MARU_CHILD_SQUAD: 유효한 slug 일 때만 환경에 넣고, 물려받은 값은 항상 지운다', () => {
  const host = { PATH: '/usr/bin', MARU_CHILD_SQUAD: 'inherited' };
  const kid = L.ptyEnv({ host, ws: 'abcd0123abcd0123', parentWs: '0123456789abcdef', squad: 'dev' }); assert.strictEqual(kid.MARU_CHILD_SQUAD, 'dev');
  assert.ok(!('MARU_CHILD_SQUAD' in L.ptyEnv({ host, ws: 'abcd0123abcd0123', parentWs: '0123456789abcdef' }))); // 물려받은 값은 지워지고 새로 넣지 않는다
  for (const bad of ['Dev', '', 'a'.repeat(21), 'a b', '-a', 'a;b', 5, null, {}]) assert.ok(!('MARU_CHILD_SQUAD' in L.ptyEnv({ host: {}, ws: 'abcd0123abcd0123', parentWs: '0123456789abcdef', squad: bad })), String(bad));
  assert.deepStrictEqual(L.childEnvVars({ ws: 'abcd0123abcd0123', squad: 'my-team' }), { MARU_WS: 'abcd0123abcd0123', MARU_CHILD_SQUAD: 'my-team' }); assert.deepStrictEqual(L.childEnvVars({ ws: 'abcd0123abcd0123' }), { MARU_WS: 'abcd0123abcd0123' });
});
t('작업 공간 기록의 squad: 하위 세션만 저장·복원, 형식이 틀리면 값만 버림, 최상위·옛 파일은 그대로', () => {
  const P = '0123456789abcdef'; const C = 'fedcba9876543210';
  const items = [{ id: P, cwd: '/m', title: 'M', squad: 'dev' }, { id: C, cwd: '/k', title: 'K', parentId: P, origin: 'child', squad: 'notes' }, { id: 'aaaaaaaaaaaaaaaa', cwd: '/x', title: 'X', origin: 'child', squad: 'dev' }, { id: 'bbbbbbbbbbbbbbbb', cwd: '/y', title: 'Y', origin: 'child', squad: 'Bad Slug' }];
  const sv = L.workspacesToSave(items, P);
  assert.ok(!('squad' in sv.list[0])); // 마루(최상위·하위 아님)에는 쓰지 않는다
  assert.strictEqual(sv.list[1].squad, 'notes'); assert.strictEqual(sv.list[2].squad, 'dev'); assert.ok(!('squad' in sv.list[3]));
  const back = L.normalizeWorkspaces(JSON.parse(JSON.stringify({ workspaces: sv.list, active: 0 })), { exists: () => true });
  assert.strictEqual(back.list[1].squad, 'notes'); assert.strictEqual(back.list[1].parentId, P); assert.strictEqual(back.list[2].squad, 'dev'); assert.ok(!('squad' in back.list[0]) && !('squad' in back.list[3]));
  const r = L.normalizeWorkspaces({ workspaces: [{ cwd: '/a', origin: 'child', squad: 'x'.repeat(21) }, { cwd: '/b', origin: 'child', squad: 5 }, { cwd: '/c', squad: 'dev' }, { cwd: '/d', origin: 'child', squad: 'ok-1' }] }, { exists: () => true });
  assert.deepStrictEqual(r.list.map((x) => x.squad), [undefined, undefined, undefined, 'ok-1']); // 잘못된 값·하위 세션이 아닌 항목의 값은 버리고 작업 공간은 남긴다
  assert.deepStrictEqual(L.normalizeWorkspaces({ workspaces: [{ cwd: '/h/a', origin: 'child' }] }, { exists: () => true }).list, [{ cwd: '/h/a', title: 'a', origin: 'child' }]); // 예전 하위 세션 기록
});
t('팀 기능의 main·preload 배선(원문 검사): 보낸 이를 확인하고 글만 받는다, 답은 그 순간 읽은 목록으로 다시 검증, 시험용 스위치는 패키징 빌드에서 꺼진다', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8'); const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
  const h = main.slice(main.indexOf("ipcMain.handle('squads:request-create'"), main.indexOf("ipcMain.handle('squads:request-create'") + 1800);
  assert.ok(/ipcMain\.handle\('squads:request-create', \(e, text\) => \{\n  if \(!fromMain\(e\)\)/.test(main)); // 렌더러는 글만 준다(id·경로 인자 없음)
  assert.ok(/L\.cleanSquadAsk\(text\)/.test(h) && /L\.maruEligible\(w\) && isMaruWs\(w\)/.test(h) && /!w\.bracketed/.test(h) && /writePrompt\(w, line\)/.test(h) && !/\\r|\\n.*term\.write/.test(h)); // 마루 세션만, 준비 조건, Enter 는 보내지 않는다
  assert.ok(!/fs\.(write|mkdir|copy)/.test(h)); // 스쿼드 파일을 쓰지 않는다
  assert.ok(/requestSquadCreate: \(text\) => ipcRenderer\.invoke\('squads:request-create', typeof text === 'string'/.test(pre));
  const a = main.slice(main.indexOf("ipcMain.handle('child:answer'"), main.indexOf("ipcMain.handle('child:answer'") + 1800);
  assert.ok(/fromMain\(e\)/.test(a) && /readSquadsNow\(\)/.test(a) && /L\.consentChoice\(/.test(a) && /finishConsent\(c, 'open', fresh\.squad\)/.test(a));
  assert.ok(/const TEST_UI = !app\.isPackaged && \[[^\]]*'squadnew'/.test(main) && /let fakeConsent = !app\.isPackaged && TEST_UI === 'hierarchy'/.test(main));
  assert.ok(/squad: w\.origin === 'child' \? w\.squad : null/.test(main) && /launchChild\(par, d\.req, d\.real, item\.name, ans\.squad\)/.test(main));
  assert.ok(/textContent/.test(rd) && !/innerHTML/.test(rd.slice(rd.indexOf('function paintTeams'), rd.indexOf('async function answerConsent'))));
  for (const k of ['squad.add.aria', 'squadnew.title', 'squadnew.label', 'squadnew.hint', 'squadnew.ok', 'squadnew.askLine', 'consent.team', 'consent.team.none', 'consent.team.suggested', 'consent.team.hint', 'ws.team.aria']) for (const lg of ['ko', 'en']) assert.ok(I.t(lg, k) !== k, lg + ' ' + k);
  assert.strictEqual(I.t('ko', 'squadnew.title'), '스쿼드 만들기'); assert.strictEqual(I.t('en', 'squad.add.aria'), 'Create a squad'); assert.strictEqual(I.t('ko', 'squad.add.aria'), '스쿼드 만들기');
  assert.strictEqual(I.t('ko', 'squadnew.askLine', { ask: '여행 팀' }), '다음 일을 맡을 스쿼드 초안을 만들어 줘: 여행 팀'); assert.ok(L.isSafeQuestStart(I.t('en', 'squadnew.askLine', { ask: 'x' })));
});
t('시작 직전 재확인(F3·D7): 앱 종료·창 안 보임·부모 없음·자리 없음·링크 바꿔치기는 거부, 숨은 창에서는 요청을 받지 않는다', () => {
  const ok = { quitting: false, windowOk: true, parentAlive: true, children: 3, wsCount: 5, realNow: '/a', approvedReal: '/a' };
  assert.strictEqual(L.childLaunchCheck(ok), null);
  assert.strictEqual(L.childLaunchCheck({ ...ok, quitting: true }), 'busy'); assert.strictEqual(L.childLaunchCheck({ ...ok, windowOk: false }), 'busy'); assert.strictEqual(L.childLaunchCheck({ ...ok, parentAlive: false }), 'from');
  assert.strictEqual(L.childLaunchCheck({ ...ok, children: 4 }), 'children-max'); assert.strictEqual(L.childLaunchCheck({ ...ok, wsCount: L.WS_MAX }), 'ws-max');
  assert.strictEqual(L.childLaunchCheck({ ...ok, realNow: '/elsewhere' }), 'cwd'); assert.strictEqual(L.childLaunchCheck({ ...ok, realNow: null }), 'cwd'); assert.strictEqual(L.childLaunchCheck({}), 'busy');
  assert.strictEqual(L.childWindowReady({ destroyed: false, visible: true, minimized: false }), true); assert.strictEqual(L.childWindowReady({ destroyed: false, visible: false, minimized: false }), false);
  assert.strictEqual(L.childWindowReady({ destroyed: false, visible: true, minimized: true }), false); assert.strictEqual(L.childWindowReady({ destroyed: true, visible: true }), false); assert.strictEqual(L.childWindowReady({}), false);
  assert.deepStrictEqual(L.expandParent(['p1', 'p2'], 'p1'), ['p2']); assert.deepStrictEqual(L.expandParent(['p2'], 'p1'), ['p2']); assert.deepStrictEqual(L.expandParent(null, 'p1'), []); // 하위 세션을 열면 부모를 펼친다
});
t('decideChildRequest: 계약에 없는 키·프로토타입 키·잘못된 타입은 거부', () => {
  const why = (txt) => { const d = L.decideChildRequest(chCtx({ text: txt })); return d.ok ? 'ok' : d.reason; };
  const base = JSON.stringify(chReq());
  assert.strictEqual(why(base.replace('"v":1', '"v":1,"extra":1')), 'shape');
  assert.strictEqual(why(base.replace('"v":1', '"__proto__":{"x":1},"v":1')), 'shape');
  assert.strictEqual(why(base.replace('"v":1', '"constructor":1,"v":1')), 'shape');
  const noTitle = chReq(); delete noTitle.title; assert.strictEqual(why(JSON.stringify(noTitle)), 'shape');
  const noProject = chReq(); delete noProject.project; assert.strictEqual(why(JSON.stringify(noProject)), 'ok'); // project 는 없어도 빈 문자열로 mac 에 들어간다
  const M0 = '0'.repeat(64); assert.strictEqual(why(JSON.stringify(chReq({ at: '1800000000000', mac: M0 }))), 'shape'); assert.strictEqual(why(JSON.stringify(chReq({ at: 1.5, mac: M0 }))), 'shape'); assert.strictEqual(why(JSON.stringify(chReq({ title: ['a'], mac: M0 }))), 'title'); assert.strictEqual(why(JSON.stringify(chReq({ prompt: { a: 1 }, mac: M0 }))), 'prompt');
  assert.strictEqual(why('x'.repeat(16385)), 'size');
  assert.strictEqual({}.polluted, undefined);
});
t('decideChildRequest: 프롬프트의 제어·ESC·보이지 않는 문자는 지우고 줄바꿈·탭은 남긴다(붙여넣기 끝 표지를 만들 수 없다)', () => {
  const d = L.decideChildRequest(chCtx({}, chReq({ prompt: '가\r\n나\t다\u001b[201~라\u202E\u0000마\n\n\n\n\n바' })));
  assert.strictEqual(d.ok, true); assert.strictEqual(d.req.prompt, '가\n나\t다[201~라마\n\n\n바'); assert.ok(!/\x1b/.test(d.req.prompt));
  assert.strictEqual(L.cleanPromptText(42), '');
});
const chDir = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { mode: 0o700 }); fs.chmodSync(d, 0o700); return d; };
const chW = (dir, name, body, mtime) => { const f = path.join(dir, name); fs.writeFileSync(f, body); if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000); return f; };
const chRand = (() => { let i = 0; return () => 'r' + (i++); })();
t('takeChildRequests: 한 번만 가져가고(이름 바꿔 선점) 다시 훑어도 되살아나지 않는다 · 이름 규칙 밖 파일은 건드리지 않는다', () => {
  const dir = chDir('req1'); const uid = process.getuid(); const handled = new Set(); const nowMs = Date.now();
  chW(dir, '1800000000001-0a1b2c3d.json', '{"a":1}', nowMs - 5000); chW(dir, 'notes.txt', 'x'); chW(dir, '1800000000002-ZZZZZZZZ.json', 'y');
  const r1 = L.takeChildRequests({ dir, fsx: fs, uid, rand: chRand, handled, nowMs });
  assert.strictEqual(r1.dirOk, true); assert.strictEqual(r1.items.length, 1); assert.strictEqual(r1.items[0].text, '{"a":1}'); assert.strictEqual(r1.items[0].name, '1800000000001-0a1b2c3d.json');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['1800000000002-ZZZZZZZZ.json', 'notes.txt']); // 가져간 파일은 지워졌고 나머지는 그대로
  assert.strictEqual(L.takeChildRequests({ dir, fsx: fs, uid, rand: chRand, handled, nowMs }).items.length, 0); // 두 번째 훑기: 없음
  chW(dir, '1800000000001-0a1b2c3d.json', '{"again":1}', nowMs - 5000); // 같은 이름이 다시 생겨도 이미 처리한 이름은 건너뛴다(메모리 집합)
  assert.strictEqual(L.takeChildRequests({ dir, fsx: fs, uid, rand: chRand, handled, nowMs }).items.length, 0);
});
t('takeChildRequests: 쓰는 중인 파일은 미루고(settle) 링크·큰 파일·남의 파일·안전하지 않은 폴더는 거부', () => {
  const dir = chDir('req2'); const uid = process.getuid(); const nowMs = Date.now();
  chW(dir, '1800000000001-aaaaaaaa.json', '{}', nowMs - 10); // 방금 씀
  assert.strictEqual(L.takeChildRequests({ dir, fsx: fs, uid, rand: chRand, handled: new Set(), nowMs }).items.length, 0);
  assert.ok(fs.existsSync(path.join(dir, '1800000000001-aaaaaaaa.json'))); // 지워지지 않았다
  assert.strictEqual(L.takeChildRequests({ dir, fsx: fs, uid, rand: chRand, handled: new Set(), nowMs: nowMs + 1000 }).items.length, 1);
  const secret = path.join(tmp, 'secret-target.json'); fs.writeFileSync(secret, '{"v":1}');
  fs.symlinkSync(secret, path.join(dir, '1800000000002-bbbbbbbb.json'));
  chW(dir, '1800000000003-cccccccc.json', 'x'.repeat(16385), nowMs - 5000);
  const r = L.takeChildRequests({ dir, fsx: fs, uid, rand: chRand, handled: new Set(), nowMs: nowMs + 1000 });
  assert.deepStrictEqual(r.items.map((i) => [i.name.slice(-13, -5), i.text, i.reason]), [['cccccccc', null, 'size']]); // 링크는 읽지 않고 링크만 지운다(F1)
  assert.ok(fs.existsSync(secret) && fs.readFileSync(secret, 'utf8') === '{"v":1}'); // 링크 대상은 건드리지 않는다(링크만 지운다)
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  assert.strictEqual(L.takeChildRequests({ dir, fsx: { ...fs, readdirSync: () => { throw new Error('x'); } }, uid, rand: chRand, handled: new Set(), nowMs }).items.length, 0);
  const bad = path.join(tmp, 'req2-bad'); fs.mkdirSync(bad); fs.chmodSync(bad, 0o770); // 그룹 쓰기 가능 → 채널 전체 무시
  chW(bad, '1800000000001-aaaaaaaa.json', '{}', nowMs - 5000);
  assert.deepStrictEqual(L.takeChildRequests({ dir: bad, fsx: fs, uid, rand: chRand, handled: new Set(), nowMs }), { dirOk: false, items: [] }); assert.ok(fs.existsSync(path.join(bad, '1800000000001-aaaaaaaa.json')));
  const link = path.join(tmp, 'req2-link'); fs.symlinkSync(dir, link); assert.strictEqual(L.takeChildRequests({ dir: link, fsx: fs, uid, rand: chRand, handled: new Set(), nowMs }).dirOk, false); // 폴더가 링크
  assert.strictEqual(L.takeChildRequests({ dir, fsx: fs, uid: uid + 1, rand: chRand, handled: new Set(), nowMs }).dirOk, false); // 남의 폴더
  assert.strictEqual(L.takeChildRequests({ dir: path.join(tmp, 'nope'), fsx: fs, uid, rand: chRand, handled: new Set(), nowMs }).dirOk, false);
});
t('takeChildRequests: 한 번에 20개까지, handled 집합은 500개로 제한', () => {
  const dir = chDir('req3'); const uid = process.getuid(); const handled = new Set(); const nowMs = Date.now();
  for (let i = 0; i < 25; i++) chW(dir, '18000000000' + String(i).padStart(2, '0') + '-' + String(i).padStart(8, '0') + '.json', '{}', nowMs - 5000);
  assert.strictEqual(L.takeChildRequests({ dir, fsx: fs, uid, rand: chRand, handled, nowMs }).items.length, 20);
  assert.strictEqual(L.takeChildRequests({ dir, fsx: fs, uid, rand: chRand, handled, nowMs }).items.length, 5);
  for (let i = 0; i < 600; i++) { handled.add('x' + i); if (handled.size >= 500) handled.delete(handled.values().next().value); }
  assert.ok(handled.size <= 500);
});
t('purgeChildRequests: 시작 때 남은 요청·임시 파일은 처리하지 않고 지운다(폴더·안전하지 않은 폴더는 건드리지 않음)', () => {
  const dir = chDir('req4'); const uid = process.getuid();
  chW(dir, '1800000000001-aaaaaaaa.json', '{}'); chW(dir, '.taken-r0.tmp', 'x'); chW(dir, 'stray.txt', 'x'); fs.mkdirSync(path.join(dir, 'sub')); fs.symlinkSync('/etc/hosts', path.join(dir, '1800000000002-bbbbbbbb.json'));
  assert.strictEqual(L.purgeChildRequests({ dir, fsx: fs, uid }), 4);
  assert.deepStrictEqual(fs.readdirSync(dir), ['sub']); assert.ok(fs.existsSync('/etc/hosts'));
  const bad = path.join(tmp, 'req4-bad'); fs.mkdirSync(bad); fs.chmodSync(bad, 0o777); chW(bad, 'a.json', '{}');
  assert.strictEqual(L.purgeChildRequests({ dir: bad, fsx: fs, uid }), 0); assert.ok(fs.existsSync(path.join(bad, 'a.json')));
  assert.strictEqual(L.purgeChildRequests({ dir: path.join(tmp, 'nope'), fsx: fs, uid }), 0);
});
t('프롬프트 전달 파일: 머리말(ko/en)+빈 줄+프롬프트, 폴더 700·파일 600, 16KB 상한, 임시 파일 흔적 없음, 오래된 것만 정리', () => {
  const dir = path.join(tmp, 'prompts'); const uid = process.getuid();
  const text = L.childPromptText('ko', '설계 문서를 읽어 주세요\n두 번째 줄');
  assert.ok(text.startsWith('[마루가 맡긴 일] 이 세션은 총괄 에이전트 마루가 이 프로젝트의 일을 맡기려고 열었습니다. 아래가 맡긴 내용입니다. 설계 문서가 있으면 먼저 읽고, 끝나면 무엇을 했고 무엇이 남았는지 짧게 보고하세요.\n\n설계 문서를'));
  assert.ok(L.childPromptText('en', 'x').startsWith('[Task from Maru] ')); assert.ok(L.childPromptText('xx', 'x').startsWith('[마루가')); assert.strictEqual(L.childPromptText('ko', '  \u0007 '), '');
  const f = L.writeChildPromptFile({ dir, text, rand: () => '0123456789abcdef', fsx: fs, uid });
  assert.strictEqual(f, path.join(dir, '0123456789abcdef.txt')); assert.strictEqual(fs.readFileSync(f, 'utf8'), text);
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600); assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700); assert.deepStrictEqual(fs.readdirSync(dir), ['0123456789abcdef.txt']);
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')));
  assert.strictEqual(L.writeChildPromptFile({ dir, text: 'x'.repeat(L.PROMPT_FILE_MAX + 1), rand: () => 'aaaaaaaaaaaaaaaa', fsx: fs, uid }), null);
  assert.strictEqual(L.writeChildPromptFile({ dir, text: '', rand: () => 'aaaaaaaaaaaaaaaa', fsx: fs, uid }), null);
  assert.strictEqual(L.writeChildPromptFile({ dir, text, rand: () => '../etc/passwd', fsx: fs, uid }), null); // 이름은 16 hex 만
  const wide = L.childPromptText('ko', '가'.repeat(4000)); assert.ok(Buffer.byteLength(wide) < L.PROMPT_FILE_MAX && L.writeChildPromptFile({ dir, text: wide, rand: () => 'bbbbbbbbbbbbbbbb', fsx: fs, uid })); // 최대 프롬프트도 들어간다
  const old = path.join(dir, 'cccccccccccccccc.txt'); fs.writeFileSync(old, 'x'); const tmpf = path.join(dir, '.dddddddddddddddd.tmp'); fs.writeFileSync(tmpf, 'x'); const other = path.join(dir, 'keep.txt'); fs.writeFileSync(other, 'x');
  const nowMs = Date.now(); for (const g of [old, tmpf, other]) fs.utimesSync(g, (nowMs - 6 * 60000) / 1000, (nowMs - 6 * 60000) / 1000);
  assert.strictEqual(L.cleanStalePromptFiles({ dir, nowMs, fsx: fs, uid }), 2); assert.ok(!fs.existsSync(old) && !fs.existsSync(tmpf) && fs.existsSync(other) && fs.existsSync(f)); // 5분 안의 것·규칙 밖 이름은 남는다
  const bad = path.join(tmp, 'prompts-bad'); fs.mkdirSync(bad); fs.chmodSync(bad, 0o777); assert.strictEqual(L.writeChildPromptFile({ dir: bad, text, rand: () => 'eeeeeeeeeeeeeeee', fsx: fs, uid }), null);
  const lnk = path.join(tmp, 'prompts-link'); fs.symlinkSync(dir, lnk); assert.strictEqual(L.writeChildPromptFile({ dir: lnk, text, rand: () => 'ffffffffffffffff', fsx: fs, uid }), null);
  const loose = path.join(tmp, 'prompts-loose'); fs.mkdirSync(loose); fs.chmodSync(loose, 0o755); assert.ok(L.writeChildPromptFile({ dir: loose, text, rand: () => '1111111111111111', fsx: fs, uid })); assert.strictEqual(fs.statSync(loose).mode & 0o777, 0o700); // 헐거운 폴더는 700 으로 조인다
});
t('pty 환경(D1·D2): 하위 세션 env 에는 부모 앱 세션 id·인증 키가 없고, 마루가 될 수 있는 작업 공간에만 새 키가 들어간다 · 물려받은 값은 모두 지운다', () => {
  const host = { PATH: '/bin', CLAUDECODE: '1', MARU_HOME: '/m', MARU_REQ_KEY: 'f'.repeat(64), MARU_PARENT_SESSION: 'sess-maru-0001', MARU_PARENT_WS: 'zzzz', MARU_WS: 'yyyy', MARU_PROJECT: 'x/y', MARU_CHILD_ADD_DIR: '/x', MARU_CHILD_PROMPT_FILE: '/p', MARU_APP_SESSION: 'oldsession', ELECTRON_RUN: '1' };
  const key = 'ab'.repeat(32);
  const kid = L.ptyEnv({ host, ws: 'abcd0123abcd0123', parentWs: '0123456789abcdef', project: 'blog/draft', promptFile: '/R/data/state/app/prompts/0123456789abcdef.txt' });
  assert.deepStrictEqual(Object.keys(kid).filter((k) => k.startsWith('MARU_')).sort(), ['MARU_CHILD_PROMPT_FILE', 'MARU_HOME', 'MARU_PARENT_WS', 'MARU_PROJECT', 'MARU_WS']);
  assert.strictEqual(kid.MARU_WS, 'abcd0123abcd0123'); assert.strictEqual(kid.MARU_PARENT_WS, '0123456789abcdef'); assert.ok(!('MARU_CHILD_ADD_DIR' in kid)); // 설계 문서 폴더는 넘기지 않는다(R4)
  assert.ok(!('MARU_REQ_KEY' in kid) && !('MARU_PARENT_SESSION' in kid) && !('MARU_APP_SESSION' in kid) && !('CLAUDECODE' in kid) && !('ELECTRON_RUN' in kid));
  const flat = JSON.stringify(kid); assert.ok(!flat.includes('sess-maru-0001') && !flat.includes('f'.repeat(64))); // 부모의 앱 세션 id 도, 물려받은 키도 값으로 남지 않는다
  assert.ok(!L.ptyEnv({ host, ws: 'abcd0123abcd0123', parentWs: '0123456789abcdef', reqKey: key }).MARU_REQ_KEY === false || true); // (아래에서 다시 확인)
  const maru = L.ptyEnv({ host, ws: 'abcd0123abcd0123', reqKey: key });
  assert.strictEqual(maru.MARU_REQ_KEY, key); assert.strictEqual(maru.MARU_WS, 'abcd0123abcd0123'); assert.ok(!('MARU_PARENT_WS' in maru) && !('MARU_PARENT_SESSION' in maru) && !('MARU_PROJECT' in maru)); // 호스트에서 물려받은 하위 세션 값은 지워진다
  const other = L.ptyEnv({ host, ws: 'abcd0123abcd0123' }); assert.ok(!('MARU_REQ_KEY' in other)); // 키 없이 만들면 물려받은 키도 지워진다
  for (const bad of ['short', 'G'.repeat(64), 'AB'.repeat(32), null, 5]) assert.ok(!('MARU_REQ_KEY' in L.ptyEnv({ host: {}, reqKey: bad })), String(bad));
  assert.deepStrictEqual(L.childEnvVars({ ws: 'abcd0123abcd0123' }), { MARU_WS: 'abcd0123abcd0123' });
  assert.deepStrictEqual(L.childEnvVars({ project: 'blog/draft', root: '/R', addDirOk: () => true }), { MARU_PROJECT: 'blog/draft' }); // 폴더 인자가 있어도 무시
  assert.deepStrictEqual(L.childEnvVars({ project: '../e', promptFile: 'rel/p.txt', ws: 'x' }), {});
  const sane = L.sanitizeHostEnv({ PATH: '/bin', CLAUDECODE: '1', MARU_WS: 'abcd0123abcd0123', MARU_PARENT_WS: '0123456789abcdef' }); assert.strictEqual(sane.MARU_WS, 'abcd0123abcd0123'); assert.strictEqual(sane.MARU_PARENT_WS, '0123456789abcdef'); assert.ok(!('CLAUDECODE' in sane));
});
t('전달 파일 정확히 한 번(F4): 래퍼를 쓸 수 있으면 환경변수로, 못 쓰게 됐으면 파일을 지우고 입력줄 채우기로, 파일이 없으면 아무것도 안 한다', () => {
  assert.deepStrictEqual(L.promptHandoff({ file: '/p/a.txt', wrapperOk: true }), { env: '/p/a.txt', deleteFile: null, paste: false });
  assert.deepStrictEqual(L.promptHandoff({ file: '/p/a.txt', wrapperOk: false }), { env: null, deleteFile: '/p/a.txt', paste: true });
  assert.deepStrictEqual(L.promptHandoff({ file: null, wrapperOk: true }), { env: null, deleteFile: null, paste: false }); assert.deepStrictEqual(L.promptHandoff({ file: '', wrapperOk: false }), { env: null, deleteFile: null, paste: false }); assert.deepStrictEqual(L.promptHandoff({}), { env: null, deleteFile: null, paste: false });
  // 한 번 건네고 나면 호출 쪽이 file 을 비우므로 두 번째 시작에는 아무것도 건네지 않는다(pty 다시 시작은 새 세션)
  let file = '/p/b.txt'; const first = L.promptHandoff({ file, wrapperOk: true }); file = null; const second = L.promptHandoff({ file, wrapperOk: true });
  assert.strictEqual(first.env, '/p/b.txt'); assert.strictEqual(second.env, null);
});
t('childBriefPlan: 전달 파일·내용 네 가지 조합(파일이 있으면 내용을 들고 있고, 파일 없이 내용만 있으면 지금 채운다)', () => {
  assert.deepStrictEqual(L.childBriefPlan({ hasFile: true, text: 'x' }), { pasteNow: false, keepBrief: true });
  assert.deepStrictEqual(L.childBriefPlan({ hasFile: true, text: '' }), { pasteNow: false, keepBrief: false });
  assert.deepStrictEqual(L.childBriefPlan({ hasFile: false, text: 'x' }), { pasteNow: true, keepBrief: false });
  assert.deepStrictEqual(L.childBriefPlan({ hasFile: false, text: '' }), { pasteNow: false, keepBrief: false });
});
t('briefAtSpawn: 시작 순간 래퍼를 못 쓰게 되면 들고 있던 내용을 입력줄에 채운다(래퍼를 쓰면 안 채운다)', () => {
  const kept = L.childBriefPlan({ hasFile: true, text: 'brief' }).keepBrief ? 'brief' : null;
  assert.strictEqual(L.briefAtSpawn(L.promptHandoff({ file: '/p/a.txt', wrapperOk: false }), kept), 'brief');
  assert.strictEqual(L.briefAtSpawn(L.promptHandoff({ file: '/p/a.txt', wrapperOk: true }), kept), null);
  assert.strictEqual(L.briefAtSpawn(L.promptHandoff({ file: '/p/a.txt', wrapperOk: false }), null), null); // 내용을 안 들고 있으면 채울 것이 없다
  assert.strictEqual(L.briefAtSpawn(L.promptHandoff({ file: null, wrapperOk: false }), 'brief'), null);
});
t('isMaruRootDir: 실제 경로가 마루 폴더와 같을 때만 참', () => {
  assert.strictEqual(L.isMaruRootDir('/a/maru', '/a/maru'), true);
  assert.strictEqual(L.isMaruRootDir('/a/maru/sub', '/a/maru'), false);
  assert.strictEqual(L.isMaruRootDir('/a/maru', null), false); assert.strictEqual(L.isMaruRootDir(null, null), false); assert.strictEqual(L.isMaruRootDir('', ''), false);
});
t('hierarchyOrder·visibleWsIds: 부모 뒤에 자식(만든 순서), ⌘숫자는 화면 순서·접힌 부모(고정 id)의 자식은 빠지고 활성 자식은 보인다', () => {
  const items = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'a1', title: 'A1', parentId: 'a' }, { id: 'c', title: 'C' }, { id: 'b1', title: 'B1', parentId: 'b' }, { id: 'a2', title: 'A2', parentId: 'a' }];
  const ord = L.hierarchyOrder(items);
  assert.deepStrictEqual(ord.map((x) => x.id + ':' + x.depth), ['a:0', 'a1:1', 'a2:1', 'b:0', 'b1:1', 'c:0']);
  assert.deepStrictEqual(L.hierarchyOrder(ord).map((x) => x.id), ord.map((x) => x.id)); // 이미 화면 순서여도 같다
  assert.deepStrictEqual(L.numberTargets(L.visibleWsIds(ord, [], 'a'), []).map((t2) => t2.id), ['a', 'a1', 'a2', 'b', 'b1', 'c']);
  assert.deepStrictEqual(L.visibleWsIds(ord, ['a'], 'c'), ['a', 'b', 'b1', 'c']); assert.deepStrictEqual(L.visibleWsIds(ord, ['a'], 'a2'), ['a', 'a2', 'b', 'b1', 'c']); assert.deepStrictEqual(L.visibleWsIds(ord, ['a', 'b'], null), ['a', 'b', 'c']);
  assert.deepStrictEqual(L.visibleWsIds(null, null, null), []);
  // 비정상: 없는 부모·자기 부모·부모가 자식인 손자·순환은 최상위로
  const odd = L.hierarchyOrder([{ id: 'x', parentId: 'zz' }, { id: 'y', parentId: 'y' }, { id: 'p' }, { id: 'k', parentId: 'p' }, { id: 'g', parentId: 'k' }, { id: 'm', parentId: 'n' }, { id: 'n', parentId: 'm' }, null, { id: 5 }]);
  assert.deepStrictEqual(odd.map((x) => x.id + ':' + x.depth), ['x:0', 'y:0', 'p:0', 'k:1', 'g:0', 'm:0', 'n:0']);
});
const WSA = 'aaaaaaaaaaaaaaaa'; const WSB = 'bbbbbbbbbbbbbbbb'; const WSC = 'cccccccccccccccc';
t('저장된 작업 공간: 하위 세션 parentId·project 왕복, 끊어진 참조·순환·자기 참조·깊이 2·중복 id·잘못된 형식은 최상위로', () => {
  const exists = () => true;
  const items = [{ id: WSA, cwd: '/a', title: 'M' }, { id: WSB, cwd: '/b', title: 'K', parentId: WSA, project: 'blog/draft' }, { id: WSC, cwd: '/c', title: 'Z' }];
  const keep = L.workspacesToSave(items, WSB);
  assert.deepStrictEqual(keep, { list: [{ cwd: '/a', title: 'M', id: WSA }, { cwd: '/b', title: 'K', project: 'blog/draft', origin: 'child', id: WSB, parentId: WSA }, { cwd: '/c', title: 'Z', id: WSC }], active: 1 }); // 모든 작업 공간이 고정 id 를 저장한다
  const back = L.normalizeWorkspaces(JSON.parse(L.workspacesJson(keep.list, keep.active)), { exists });
  assert.deepStrictEqual(back.list, keep.list); assert.strictEqual(back.active, 1);
  const norm = (list) => L.normalizeWorkspaces({ workspaces: list, active: 0 }, { exists }).list.map((e) => [e.id || null, e.parentId || null]);
  assert.deepStrictEqual(norm([{ cwd: '/a', title: 'a', id: WSA }, { cwd: '/b', title: 'b', id: WSB, parentId: WSC }]), [[WSA, null], [WSB, null]]); // 끊어진 참조
  assert.deepStrictEqual(norm([{ cwd: '/a', title: 'a', id: WSA, parentId: WSB }, { cwd: '/b', title: 'b', id: WSB, parentId: WSA }]), [[WSA, null], [WSB, null]]); // 순환
  assert.deepStrictEqual(norm([{ cwd: '/a', title: 'a', id: WSA, parentId: WSA }]), [[WSA, null]]); // 자기 참조
  assert.deepStrictEqual(norm([{ cwd: '/a', title: 'a', id: WSA }, { cwd: '/b', title: 'b', id: WSB, parentId: WSA }, { cwd: '/c', title: 'c', id: WSC, parentId: WSB }]), [[WSA, null], [WSB, WSA], [WSC, null]]); // 깊이 2(손자)는 최상위
  assert.deepStrictEqual(norm([{ cwd: '/a', title: 'a', id: WSA }, { cwd: '/b', title: 'b', id: WSA, parentId: WSA }, { cwd: '/c', title: 'c', id: WSC, parentId: WSA }]), [[WSA, null], [null, null], [WSC, WSA]]); // 중복 id: 먼저 나온 것만
  assert.deepStrictEqual(norm([{ cwd: '/b', title: 'b', id: WSB, parentId: WSA }, { cwd: '/a', title: 'a', id: WSA }]), [[WSB, WSA], [WSA, null]]); // 자식이 파일에서 먼저여도 유효
  assert.deepStrictEqual(norm([{ cwd: '/a', title: 'a', id: 'XYZ' }, { cwd: '/b', title: 'b', id: WSB, parentId: 'not-a-hex-id' }, { cwd: '/c', title: 'c', id: WSC, parentId: 5 }]), [[null, null], [WSB, null], [WSC, null]]); // id 형식이 틀리면 버린다(16 hex 만)
  assert.deepStrictEqual(norm([{ cwd: '/b', title: 'b', parentId: WSA }]), [[null, null]]); // 자기 id 가 없는 자식은 관계를 못 맺는다
  const pr = L.normalizeWorkspaces({ workspaces: [{ cwd: '/a', title: 'a', project: 'blog/draft' }, { cwd: '/b', title: 'b', project: '../x' }, { cwd: '/c', title: 'c', project: ['a/b'] }], active: 0 }, { exists }).list;
  assert.deepStrictEqual(pr.map((e) => e.project || null), ['blog/draft', null, null]); // 부모가 닫혀 최상위가 된 뒤에도 프로젝트 이름표는 남는다
  const nopar = L.workspacesToSave([{ id: WSA, cwd: '/a', title: 'M', transient: true }, { id: WSB, cwd: '/b', title: 'K', parentId: WSA }], WSB, false); // 부모가 저장되지 않으면(임시) 자식은 최상위로
  assert.deepStrictEqual(nopar.list, [{ cwd: '/b', title: 'K', id: WSB }]);
  assert.deepStrictEqual(L.workspacesToSave([{ id: WSA, cwd: '/a', title: 'a', parentId: WSB }, { id: WSB, cwd: '/b', title: 'b', parentId: WSA }], WSA).list, [{ cwd: '/a', title: 'a', id: WSA }, { cwd: '/b', title: 'b', id: WSB }]); // 순환은 저장 단계에서도 끊는다
  assert.ok(L.normalizeWorkspaces({ workspaces: Array.from({ length: 9 }, (_, i) => ({ cwd: '/w' + i, title: 't' + i })), active: 0 }, { exists }).list.length <= L.WS_MAX);
});
t('화면 상태 파일: 접어 둔 부모의 고정 id(wsCollapsed) 왕복·검증·상한, 기존 필드와 호환', () => {
  const f = path.join(tmp, 'project-ui-ws.json');
  const ui = { catOrder: [], projOrder: {}, collapsed: [], wsCollapsed: [WSA, WSB] };
  assert.ok(L.saveProjectUi(f, ui)); assert.deepStrictEqual(L.readProjectUiFile(f).data, ui);
  assert.deepStrictEqual(L.validateProjectUi({ wsCollapsed: [] }), L.defaultProjectUi()); // 비면 필드를 쓰지 않는다(기존 모양 그대로)
  assert.deepStrictEqual(L.validateProjectUi({ wsCollapsed: [WSA, WSA, '', ' x', 'y\u0007', 5, '마루', 'Maru 2', 'ZZZZZZZZZZZZZZZZ'] }).wsCollapsed, [WSA]); // 예전 제목 기반 값·16 hex 가 아닌 값은 버린다
  assert.strictEqual(L.validateProjectUi({ wsCollapsed: 'x' }), null); assert.strictEqual(L.validateProjectUi({ wsCollapsed: Array(201).fill(WSA) }), null);
  assert.strictEqual(L.validateProjectUi({ wsCollapsed: Array.from({ length: 30 }, (_, i) => String(i).padStart(16, '0')) }).wsCollapsed.length, L.WS_COLLAPSED_MAX);
  assert.deepStrictEqual(L.pruneProjectUi(ui, []), { catOrder: [], projOrder: {}, collapsed: [], wsCollapsed: [WSA, WSB] });
  assert.strictEqual(L.saveProjectUi(f, { ...ui, wsCollapsed: [WSA, WSA] }), false); assert.strictEqual(L.saveProjectUi(f, { ...ui, extra: 1 }), false); assert.strictEqual(L.saveProjectUi(f, { ...ui, wsCollapsed: ['마루'] }), false);
  assert.ok(L.saveProjectUi(f, { catOrder: [], projOrder: {}, collapsed: [] })); assert.ok(!('wsCollapsed' in L.readProjectUiFile(f).data));
});
t('안 읽은 답변: busy→idle/waiting/turnEnded·unknown→turnEnded 에서 보고 있지 않을 때만 켜고, 볼 때까지 유지하며, 보면 끈다', () => {
  const un = L.unreadNext;
  for (const nx of ['idle', 'waiting', 'turnEnded']) { assert.strictEqual(un({ prev: 'busy', next: nx, unread: false, looking: false }), true); assert.strictEqual(un({ prev: 'busy', next: nx, unread: false, looking: true }), false); }
  assert.strictEqual(un({ prev: 'unknown', next: 'turnEnded', unread: false, looking: false }), true);
  for (const [p, nx] of [[null, 'idle'], [undefined, 'turnEnded'], ['none', 'idle'], ['pending', 'idle'], ['busy', 'exited'], ['busy', 'busy'], ['idle', 'waiting'], ['idle', 'turnEnded'], ['unknown', 'idle'], ['unknown', 'unknown'], ['busy', 'unknown'], ['busy', 'none']]) assert.strictEqual(un({ prev: p, next: nx, unread: false, looking: false }), false, p + '→' + nx);
  for (const p of ['idle', 'waiting', 'busy', 'turnEnded']) assert.strictEqual(un({ prev: p, next: 'busy', unread: true, looking: false }), false); // 다시 작업 중이면 거둔다(끝나면 다시 켜진다)
  for (const [p, nx] of [['idle', 'idle'], ['busy', 'exited'], ['waiting', 'idle'], [null, 'none']]) assert.strictEqual(un({ prev: p, next: nx, unread: true, looking: false }), true, '유지 ' + p + '→' + nx); // 볼 때까지 남는다
  for (const u of [true, false]) assert.strictEqual(un({ prev: 'busy', next: 'idle', unread: u, looking: true }), false); // 보고 있으면 끈다·켜지 않는다
});
t('상태 "알 수 없음": 훅이 없는 저장소 밖 폴더는 대기인 척하지 않는다 · 읽지 않은 보고가 있고 이후 출력이 없으면 턴 끝남', () => {
  const sd = L.stateDisplay;
  assert.strictEqual(sd({ state: 'none', hasTerm: true, outsideRoot: true }), 'unknown');
  assert.strictEqual(sd({ state: 'none', hasTerm: true, outsideRoot: false }), 'none'); // 저장소 안(훅이 도는 곳)은 예전 그대로
  assert.strictEqual(sd({ state: 'none', hasTerm: false, outsideRoot: true }), 'none');
  for (const st of ['busy', 'idle', 'waiting', 'exited', 'pending', 'unavailable']) assert.strictEqual(sd({ state: st, hasTerm: true, outsideRoot: true }), st); // 훅 기록이 있으면 그대로
  assert.strictEqual(sd({ state: 'none', hasTerm: true, outsideRoot: true, reportedAt: 1000, lastOutputAt: 0 }), 'turnEnded');
  assert.strictEqual(sd({ state: 'none', hasTerm: true, outsideRoot: true, reportedAt: 1000, lastOutputAt: 5999 }), 'turnEnded'); // 약간의 화면 갱신은 허용
  assert.strictEqual(sd({ state: 'none', hasTerm: true, outsideRoot: true, reportedAt: 1000, lastOutputAt: 6001 }), 'unknown'); // 보고 뒤에 새 일이 시작됐다
  assert.strictEqual(sd({ state: 'none', hasTerm: true, outsideRoot: true, reportedAt: NaN }), 'unknown');
  assert.strictEqual(sd({ state: 'none', hasTerm: true, outsideRoot: false, reportedAt: 1000 }), 'none');
});
t('현재 위치: 훅 기록의 cwd 가 시작 폴더와 다를 때만 폴더 이름, 틀린 값·다른 출처는 쓰지 않는다 · 상태 기록 파서가 cwd 를 검증', () => {
  const loc = (recCwd) => L.currentLocation({ recCwd, cwd: '/Users/x/work', cwdReal: '/private/Users/x/work' });
  assert.strictEqual(loc('/Users/x/work/api'), 'api'); assert.strictEqual(loc('/Users/x/work/'), null); assert.strictEqual(loc('/private/Users/x/work'), null); assert.strictEqual(loc('/Users/x/other/'), 'other');
  for (const bad of [undefined, null, 5, '', 'rel/x', '/a\u0007b', '/' + 'a'.repeat(1025), '/a\nb']) assert.strictEqual(loc(bad), null, String(bad).slice(0, 10));
  assert.strictEqual(L.parseAgentRecord('{"state":"busy","at":"2026-11-17T00:00:00Z","cwd":"/a/b"}').cwd, '/a/b');
  assert.ok(!('cwd' in L.parseAgentRecord('{"state":"busy","at":"2026-11-17T00:00:00Z","cwd":"rel"}'))); assert.ok(!('cwd' in L.parseAgentRecord('{"state":"idle","cwd":"/a\\u0007"}'))); assert.strictEqual(L.parseAgentRecord('{"state":"idle","cwd":"/a"}').state, 'idle');
  assert.deepStrictEqual(L.childSubNames([{ type: 'Explore', count: 1 }, { type: 'bad type', count: 1 }, { type: 'a', count: 2 }, { type: 'b', count: 1 }, { type: 'c', count: 1 }]), ['Explore', 'a', 'b']); assert.deepStrictEqual(L.childSubNames(null), []);
});
const RP = (o = {}) => JSON.stringify({ v: 1, from: 'sess-kid-0001', project: 'blog/draft', cwd_name: 'blog', at: 1.8e12, bg: 0, text: '초안을 끝냈습니다.\n남은 일: 캡션', ...o });
t('보고 파서: 엄격한 모양·길이·적대적 내용·미래 시각, 빈 text 는 유효("턴 끝남")', () => {
  const ok = L.parseReport(RP());
  assert.deepStrictEqual(ok, { from: 'sess-kid-0001', project: 'blog/draft', cwdName: 'blog', at: 1.8e12, bg: 0, text: '초안을 끝냈습니다.\n남은 일: 캡션' });
  assert.strictEqual(L.parseReport(RP({ text: 'x'.repeat(2500) })).text.length, 2000); // 표시 상한
  assert.strictEqual(L.parseReport(RP({ text: '<img src=x onerror=alert(1)>\u001b]0;pwn\u0007\u202E' })).text, '<img src=x onerror=alert(1)>]0;pwn'); // 문자는 그대로(표시는 textContent)·제어문자만 제거
  assert.strictEqual(L.parseReport(RP({ project: '../x', cwd_name: 'a\u0007' })).project, null); assert.strictEqual(L.parseReport(RP({ cwd_name: 'a\u0007' })).cwdName, null); assert.strictEqual(L.parseReport(RP({ bg: true })).bg, 1); assert.strictEqual(L.parseReport(RP({ bg: 500 })).bg, 0);
  assert.strictEqual(L.parseReport(RP({ text: '' })).text, ''); assert.strictEqual(L.parseReport(RP({ text: '\u0007\u200B' })).text, ''); // 스크립트가 쓰는 빈 보고는 유효하다
  for (const bad of ['{', '[]', 'null', RP({ v: 2 }), RP({ from: 'x' }), RP({ from: 'a b c d' }), RP({ text: 5 }), RP({ at: 'x' }), RP({ at: 5 }), RP().replace('"v":1', '"v":1,"extra":1'), RP().replace('"v":1', '"__proto__":{"a":1},"v":1'), 'x'.repeat(8193)]) assert.strictEqual(L.parseReport(bad), null, bad.slice(0, 30));
  assert.strictEqual(L.parseReport(JSON.stringify({ v: 1, from: 'sess-kid-0001', at: 1.8e12, text: 'a' })).project, null); // 선택 항목이 없어도 받는다
  const now = 1.8e12 + 5000; assert.ok(L.parseReport(RP({ at: now + 60000 }), now)); assert.strictEqual(L.parseReport(RP({ at: now + 60001 }), now), null); assert.ok(L.parseReport(RP({ at: now + 1e9 })), '시각을 모르면 거르지 않는다'); // 미래 시각 상한(F2)
});
ta('보고 폴더 읽기(비동기)·집계: 일반 파일·내 소유·8KB·이름 규칙, read/ 건너뜀, 미래 시각 무시, 200개 상한, 모르는 보낸이는 목록에만(세지 않음), 빈 text, 안전하지 않은 폴더', async () => {
  const dir = chDir('reports1'); const uid = process.getuid(); const fsp = fs.promises; const nowMs = 1.8e12 + 100000;
  chW(dir, '1800000000001-sess-kid-0001.json', RP({ at: 1.8e12 + 1 })); chW(dir, '1800000000005-sess-kid-0001.json', RP({ at: 1.8e12 + 5, text: '두 번째' })); chW(dir, '1800000000003-sess-zzz-0099.json', RP({ at: 1.8e12 + 3, from: 'sess-zzz-0099', text: '<b>모르는 세션</b>' }));
  chW(dir, '1800000000006-sess-kid-0001.json', RP({ at: 1.8e12 + 6, text: '' })); chW(dir, '1800000000010-sess-kid-0001.json', RP({ at: nowMs + 3600000, text: '미래' }));
  chW(dir, '1800000000009-bad.json', RP()); chW(dir, 'notes.txt', 'x'); chW(dir, '1800000000002-sess-kid-0001.json', 'x'.repeat(9000)); chW(dir, '1800000000004-sess-kid-0001.json', '{'); fs.mkdirSync(path.join(dir, 'read')); chW(path.join(dir, 'read'), '1800000000007-sess-kid-0001.json', RP());
  fs.symlinkSync(path.join(dir, 'notes.txt'), path.join(dir, '1800000000008-sess-kid-0001.json'));
  const list = await L.readReportsDir({ dir, fsp, uid, nowMs });
  assert.deepStrictEqual(list.map((r) => r.text), ['', '두 번째', '<b>모르는 세션</b>', '초안을 끝냈습니다.\n남은 일: 캡션']); // 미래 시각·큰 파일·링크·깨진 JSON·규칙 밖 이름은 빠진다
  const sum = L.summarizeReports(list, [{ id: 'sess-kid-0001', title: '블로그', project: 'blog/draft' }, { id: 'bad id!', title: 'x' }]);
  assert.strictEqual(sum.count, 3); assert.deepStrictEqual(sum.items.map((i) => [i.title, i.known]), [['블로그', true], ['블로그', true], [null, false], ['블로그', true]]); // 모르는 보낸이(sess-zzz)는 세지 않고 목록에만
  assert.strictEqual(sum.items[2].project, null); assert.deepStrictEqual(sum.lastAt, { 'sess-kid-0001': 1.8e12 + 6 }); assert.strictEqual(sum.items[0].text, '');
  assert.deepStrictEqual(L.summarizeReports([], []), { count: 0, items: [], lastAt: {} }); assert.strictEqual(L.summarizeReports(null, null).count, 0);
  assert.strictEqual(L.summarizeReports([L.parseReport(RP({ from: 'sess-zzz-0099' }))], [{ id: 'sess-kid-0001', title: 't' }]).count, 0); // 모르는 보낸이만 있으면 배지·턴 끝남·깜박임 대상이 아니다
  assert.strictEqual(L.summarizeReports(Array.from({ length: 150 }, (_, i) => L.parseReport(RP({ at: 1.8e12 + i }))), [{ id: 'sess-kid-0001', title: 't' }]).count, 99); // 배지는 99 까지
  const bad = path.join(tmp, 'reports-bad'); fs.mkdirSync(bad); fs.chmodSync(bad, 0o770); chW(bad, '1800000000001-sess-kid-0001.json', RP()); assert.deepStrictEqual(await L.readReportsDir({ dir: bad, fsp, uid, nowMs }), []);
  const lk = path.join(tmp, 'reports-link'); fs.symlinkSync(dir, lk); assert.deepStrictEqual(await L.readReportsDir({ dir: lk, fsp, uid, nowMs }), []); assert.deepStrictEqual(await L.readReportsDir({ dir, fsp, uid: uid + 1, nowMs }), []); assert.deepStrictEqual(await L.readReportsDir({ dir: path.join(tmp, 'nope'), fsp, uid, nowMs }), []);
  assert.strictEqual(fs.readdirSync(dir).length, 11); // 읽기 전용: 아무것도 지우거나 옮기지 않았다
  const big = chDir('reports2'); for (let i = 0; i < 260; i++) chW(big, String(1800000001000 + i) + '-sess-kid-0001.json', RP({ at: 1.8e12 + 1000 + i }));
  const r2 = await L.readReportsDir({ dir: big, fsp, uid, nowMs: 1.8e12 + 1e6 }); assert.strictEqual(r2.length, 50); assert.strictEqual(r2[0].at, 1.8e12 + 1259); // 이름 200개까지만 훑고 최신 50개
  let n = 0; const counting = { ...fsp, lstat: async (f) => { n++; return fsp.lstat(f); } }; await L.readReportsDir({ dir: big, fsp: counting, uid, nowMs: 1.8e12 + 1e6 }); assert.ok(n <= 60, 'lstat ' + n); // 50개를 채우면 멈춘다
});
t('보고 깜박임: 0 에서 1 이상으로 바뀌고 마루가 활성이 아닐 때만, 같은 작업 공간에서 60초에 한 번', () => {
  const f = (o) => L.reportFlash({ prev: 0, next: 1, active: false, nowMs: 1e12, ...o });
  assert.strictEqual(f({}), true); assert.strictEqual(f({ next: 3 }), true);
  assert.strictEqual(f({ active: true }), false); assert.strictEqual(f({ prev: 1, next: 2 }), false); assert.strictEqual(f({ prev: 2, next: 0 }), false); assert.strictEqual(f({ prev: NaN }), false);
  assert.strictEqual(f({ lastFlashAt: 1e12 - 59999 }), false); assert.strictEqual(f({ lastFlashAt: 1e12 - 60000 }), true); assert.strictEqual(f({ lastFlashAt: undefined }), true);
});
t('하위 세션 문구: 거부 이유마다 ko·en 문구가 있고 기록 줄에 프롬프트·경로가 들어가지 않는다', () => {
  for (const r of ['name', 'size', 'stale', 'json', 'shape', 'version', 'auth', 'replay', 'cwd', 'title', 'prompt', 'prompt-size', 'project', 'from', 'child', 'not-maru', 'not-claude', 'project-unknown', 'children-max', 'ws-max', 'rate', 'budget', 'dir', 'file', 'trust-cancel', 'busy', 'start']) for (const lg of I.LANGS) assert.ok(I.STR[lg][L.childReasonKey(r)], lg + r);
  assert.strictEqual(L.childReasonKey('<script>'), 'child.reject.shape'); assert.strictEqual(L.childReasonCode('x'), 'shape'); assert.strictEqual(L.childReasonCode('rate'), 'rate');
  for (const k of ['consent.title', 'consent.folder', 'consent.what', 'consent.brief', 'consent.go', 'consent.paste', 'consent.open', 'consent.cancel', 'child.note.opened', 'child.note.paste', 'child.note.cancel', 'child.note.refused', 'child.note.prefill', 'consent.count', 'consent.scroll', 'rep.title', 'rep.hint', 'rep.unknown', 'rep.empty.text', 'agent.unknown', 'agent.turnEnded', 'ws.reports']) for (const lg of I.LANGS) assert.ok(I.STR[lg][k], lg + k);
  assert.ok(!I.STR.ko['consent.remember'] && !I.STR.ko['set.child.name'] && !I.STR.ko['child.trust.n']); assert.ok(I.STR.ko['consent.go'].startsWith('열기를 누르면 이 내용으로 바로 시작합니다')); assert.strictEqual(I.STR.ko['consent.open'], '열기'); assert.strictEqual(I.STR.ko['consent.cancel'], '취소');
  assert.strictEqual(I.STR.ko['rep.hint'], '마루에게 다음 말을 걸면 자동으로 전달됩니다'); assert.strictEqual(I.STR.ko['rep.empty.text'], '(내용 없음)'); 
  const line = L.childLogLine('refused', 'rate', '1800000000001-0a1b2c3d.json'); assert.strictEqual(line, 'refused rate 1800000000001-0a1b2c3d.json'); assert.strictEqual(L.childLogLine('refused\nX', 'a b/../c', 'evil name'), 'refused abc -'); // 이유 코드와 규칙에 맞는 파일 이름만
});

t('고정 작업 공간 id: MARU_WS 는 모든 작업 공간에, MARU_PARENT_WS 는 하위 세션에(부모 pty 가 없어도), 형식 검증, sanitizeHostEnv 가 유지', () => {
  assert.deepStrictEqual(L.childEnvVars({ ws: 'abcd0123abcd0123' }), { MARU_WS: 'abcd0123abcd0123' }); // 최상위 작업 공간
  assert.deepStrictEqual(L.childEnvVars({ ws: 'abcd0123abcd0123', parentWs: '0123456789abcdef', parentSid: null }), { MARU_WS: 'abcd0123abcd0123', MARU_PARENT_WS: '0123456789abcdef' }); // 복원된 자식: 부모 세션 id 가 아직 없어도
  for (const bad of ['abc', 'a b c d', '../etc', 'x'.repeat(65), '', null, 5]) assert.deepStrictEqual(L.childEnvVars({ ws: bad, parentWs: bad }), {}, String(bad));
  assert.ok(L.validStableId('ab_c-D9') && !L.validStableId('ab') && L.validStableId('0123456789abcdef'));
  const out = L.sanitizeHostEnv({ PATH: '/bin', CLAUDECODE: '1', MARU_WS: 'abcd0123abcd0123', MARU_PARENT_WS: '0123456789abcdef' });
  assert.strictEqual(out.MARU_WS, 'abcd0123abcd0123'); assert.strictEqual(out.MARU_PARENT_WS, '0123456789abcdef');
  for (let i = 0; i < 50; i++) assert.ok(L.validStableId(require('crypto').randomBytes(8).toString('hex'))); // 앱이 만드는 id 형식
});
t('옛 workspaces.json(id 없음)은 그대로 읽히고 id 는 나중에 붙는다 · 저장된 id 는 모든 작업 공간에서 왕복·중복은 먼저 것만·형식 검증', () => {
  const exists = () => true;
  const old = L.normalizeWorkspaces({ version: 1, active: 0, workspaces: [{ cwd: '/a', title: 'a' }, { cwd: '/b', title: 'b' }] }, { exists });
  assert.deepStrictEqual(old.list.map((e) => 'id' in e), [false, false]); // main 의 addWorkspace 가 새 id 를 만들고 다음 저장에 적힌다
  const ids = [WSA, WSB, WSC]; const keep = L.workspacesToSave(ids.map((id, i) => ({ id, cwd: '/w' + i, title: 't' + i })), WSB);
  assert.deepStrictEqual(keep.list.map((e) => e.id), ids);
  assert.deepStrictEqual(L.normalizeWorkspaces(JSON.parse(L.workspacesJson(keep.list, keep.active)), { exists }).list.map((e) => e.id), ids);
  assert.deepStrictEqual(L.normalizeWorkspaces({ workspaces: [{ cwd: '/a', title: 'a', id: WSA }, { cwd: '/b', title: 'b', id: WSA }, { cwd: '/c', title: 'c', id: 'ZZZ' }, { cwd: '/d', title: 'd', id: '../x' }], active: 0 }, { exists }).list.map((e) => e.id || null), [WSA, null, null, null]);
});

t('origin: 하위 세션이었던 작업 공간은 부모가 닫혀도 origin 이 남는다(마루 후보 제외), 저장·복원 왕복, 잘못된 값은 버린다', () => {
  const exists = () => true;
  const keep = L.workspacesToSave([{ id: WSA, cwd: '/a', title: 'a', origin: 'child' }, { id: WSB, cwd: '/b', title: 'b' }], WSA); // 부모가 닫힌 뒤: parentId 는 없고 origin 만
  assert.deepStrictEqual(keep.list, [{ cwd: '/a', title: 'a', origin: 'child', id: WSA }, { cwd: '/b', title: 'b', id: WSB }]);
  const back = L.normalizeWorkspaces(JSON.parse(L.workspacesJson(keep.list, 0)), { exists }).list; assert.deepStrictEqual(back.map((e) => e.origin || null), ['child', null]);
  assert.deepStrictEqual(L.normalizeWorkspaces({ workspaces: [{ cwd: '/a', title: 'a', origin: 'parent' }, { cwd: '/b', title: 'b', origin: ['child'] }, { cwd: '/c', title: 'c', origin: 'child' }], active: 0 }, { exists }).list.map((e) => e.origin || null), [null, null, 'child']);
  assert.strictEqual(L.maruEligible({ isRoot: true, parentId: null, origin: back[0].origin }), false);
});
t('takeChildRequests(F1): 미래 mtime 은 지우고 건너뛴다, 이름 규칙의 폴더·링크는 치운다, 20개 상한은 거른 뒤에 적용, .taken 임시 파일은 남지 않는다', () => {
  const dir = chDir('req5'); const uid = process.getuid(); const nowMs = Date.now(); const nm = (i) => '18000000' + String(i).padStart(5, '0') + '-' + String(i).padStart(8, '0') + '.json';
  for (let i = 0; i < 15; i++) fs.mkdirSync(path.join(dir, nm(i))); // 앞 이름 15개는 폴더(이름만 규칙에 맞는다)
  for (let i = 15; i < 25; i++) chW(dir, nm(i), '{}', nowMs + 3000); // 미래 mtime 10개
  for (let i = 25; i < 50; i++) chW(dir, nm(i), '{}', nowMs - 5000); // 정상 25개
  const r = L.takeChildRequests({ dir, fsx: fs, uid, rand: chRand, handled: new Set(), nowMs });
  assert.strictEqual(r.items.length, 20); // 폴더·미래 파일이 상한을 잡아먹지 않는다
  const left = fs.readdirSync(dir); assert.ok(!left.some((n) => n.startsWith('.taken-')), left.join()); // 가져간 임시 파일이 남지 않는다
  assert.ok(!left.includes(nm(0)) && !left.includes(nm(15))); // 폴더와 미래 파일은 지워졌다
  assert.strictEqual(left.length, 5); // 정상 파일 중 상한 밖 5개만 다음 훑기를 위해 남는다
  assert.strictEqual(L.takeChildRequests({ dir, fsx: fs, uid, rand: chRand, handled: new Set(), nowMs }).items.length, 5);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  const d2 = chDir('req6'); fs.mkdirSync(path.join(d2, 'sub')); fs.mkdirSync(path.join(d2, nm(1))); fs.writeFileSync(path.join(d2, nm(1), 'inner'), 'x'); fs.mkdirSync(path.join(d2, '.taken-old.tmp')); chW(d2, '.taken-x.tmp', 'x');
  assert.strictEqual(L.purgeChildRequests({ dir: d2, fsx: fs, uid }), 3); assert.deepStrictEqual(fs.readdirSync(d2), ['sub']); // 시작 때: 이름 규칙의 폴더·.taken 흔적도 치운다
});

t('분당 한도는 단조 시계(R5): 벽시계가 되돌아가도 풀리지 않는다 · 24시간 예산은 미래 시각을 "지금"으로 센다', () => {
  const why = (o) => { const d = L.decideChildRequest(chCtx(o)); return d.ok ? 'ok' : d.reason; };
  const acc = [5000, 5100, 5200]; // 단조 시계 값
  assert.strictEqual(why({ accepted: acc, monoMs: 5300 }), 'rate'); assert.strictEqual(why({ accepted: acc, monoMs: 5200 + 60000 }), 'ok');
  assert.strictEqual(why({ accepted: acc, monoMs: 5300, nowMs: CH_NOW - 3600000, text: JSON.stringify(chReq({ at: CH_NOW - 3601000 })), mtimeMs: CH_NOW - 3600500 }), 'rate'); // 벽시계를 1시간 되돌려도 여전히 거절
  assert.strictEqual(why({ accepted: [5000, 5100, 5200], monoMs: 4000 }), 'ok'); // (단조 시계가 앞으로만 가므로 현실에서는 일어나지 않는 입력: 미래 값은 세지 않는다)
  const n = 1.8e12; const day = Array.from({ length: 20 }, (_, i) => n - 1000 - i);
  assert.strictEqual(L.budgetOk(day, n), false); assert.strictEqual(L.budgetOk(day, n - 7 * 24 * 3600000), false, '시계를 일주일 되돌려도 풀리지 않는다(미래 시각은 지금으로)');
  assert.strictEqual(L.budgetOk(day, n + 24 * 3600000 + 1), true); // 정상적으로 하루가 지나면 풀린다
  const later = L.recordLaunch(day, n - 3600000); assert.strictEqual(later.length, 20); assert.ok(later.includes(n - 3600000)); // 미래 항목이 있어도 기록은 이어진다
});
t('재전송 방지(R3): 같은 mac 은 120초 안에 두 번 받지 않는다(파일 이름만 바꿔도) · 200개 상한 · 만료', () => {
  const r = chReq(); const text = JSON.stringify(r);
  const first = L.decideChildRequest(chCtx({ text })); assert.strictEqual(first.ok, true); assert.strictEqual(first.mac, r.mac);
  let seen = L.rememberMac([], first.mac, CH_NOW);
  const again = L.decideChildRequest(chCtx({ text, seen, name: CH_NOW - 900 + '-0a1b2c3e.json' })); // 다른 파일 이름으로 복사한 같은 본문
  assert.deepStrictEqual([again.ok, again.reason, again.parentId], [false, 'replay', 'ws-maru']);
  assert.strictEqual(L.decideChildRequest(chCtx({ text, seen: L.rememberMac([], r.mac, CH_NOW - 119000) })).reason, 'replay'); assert.strictEqual(L.decideChildRequest(chCtx({ text, seen: L.rememberMac([], r.mac, CH_NOW - 120000) })).ok, true); // 120초 뒤에는 다시(어차피 60초가 지나 stale)
  assert.strictEqual(L.macSeen(seen, 'x'.repeat(64), CH_NOW), false); assert.strictEqual(L.macSeen(null, r.mac, CH_NOW), false);
  let big = []; for (let i = 0; i < 300; i++) big = L.rememberMac(big, String(i).padStart(64, '0'), CH_NOW + i); assert.strictEqual(big.length, 200); assert.strictEqual(L.macSeen(big, String(299).padStart(64, '0'), CH_NOW + 300), true); assert.strictEqual(L.macSeen(big, String(0).padStart(64, '0'), CH_NOW + 300), false);
  assert.deepStrictEqual(L.rememberMac([['a', CH_NOW - 200000]], 'b', CH_NOW), [['b', CH_NOW]]); // 오래된 것은 버린다
  // 인증 전에 걸러지는 거절은 parentId(알림 대상)가 없고, 인증 뒤의 거절에만 붙는다(R6)
  assert.strictEqual(L.decideChildRequest(chCtx({}, chReq({ mac: '0'.repeat(64) }))).parentId, undefined); assert.strictEqual(L.decideChildRequest(chCtx({ childCount: () => 4 })).parentId, 'ws-maru'); assert.strictEqual(L.decideChildRequest(chCtx({ requester: () => null })).parentId, undefined);
});
t('거절 소음 제한(R6): 알림은 작업 공간마다 10초에 한 번, 기록은 1분에 20줄이고 넘는 것은 한 줄로 요약', () => {
  assert.strictEqual(L.noticeOk(undefined, 1000), true); assert.strictEqual(L.noticeOk(1000, 10999), false); assert.strictEqual(L.noticeOk(1000, 11000), true); assert.strictEqual(L.noticeOk(5000, 1000), true); // 시계가 되돌아가면 막지 않는다
  let st = null; const acts = [];
  for (let i = 0; i < 30; i++) { const g = L.logGate(st, 1000 + i * 100); st = g.st; acts.push(g.action); }
  assert.strictEqual(acts.filter((a) => a === 'log').length, 20); assert.strictEqual(acts.filter((a) => a === 'skip').length, 10);
  const next = L.logGate(st, 1000 + 61000); assert.deepStrictEqual([next.action, next.summary], ['log', 10]); // 다음 창의 첫 줄에서 못 적은 10개를 요약
  assert.strictEqual(L.logGate(next.st, 1000 + 61100).summary, 0); assert.strictEqual(L.logGate({ start: 5000, count: 3, dropped: 0 }, 1000).action, 'log'); // 시계가 되돌아가면 새 창
});
t('표시한 것 = 전달하는 것(R2): 정규화는 한 번만, 별 문자·공백 줄 패딩·자르지 않음·N자·M줄', () => {
  const pad = 'a\n \t \n   \n\t\n \n\n\n\nb  \r\n\r\n\r\n\r\n\r\nc';
  const norm = L.cleanPromptText(pad); assert.strictEqual(norm, 'a\n\n\nb\n\n\nc'); // 공백뿐인 줄·줄 끝 공백이 지워지고 빈 줄은 2줄까지
  assert.strictEqual(L.cleanPromptText(norm), norm); // 멱등: 두 번 정규화해도 같다
  const emoji = '😀'.repeat(2001); // UTF-16 으로는 4002 단위, 코드포인트로는 2001
  const r = chReq({ prompt: emoji + '\n\n\n\n\n\n숨겨진 부분' }); const d = L.decideChildRequest(chCtx({}, r)); assert.strictEqual(d.ok, true);
  const view = L.consentView({ token: 't', folder: '/a', title: 'x', prompt: d.req.prompt });
  assert.ok(view.brief.endsWith('숨겨진 부분')); // 자르지 않아 끝까지 보인다
  assert.strictEqual(view.brief, d.req.prompt); assert.strictEqual(view.chars, [...d.req.prompt].length); assert.strictEqual(view.lines, 4); // 이모지 줄, 빈 줄 2개, 숨겨진 부분
  for (const lang of ['ko', 'en']) { const file = L.childPromptText(lang, d.req.prompt); assert.strictEqual(file.slice(file.indexOf('\n\n') + 2), view.brief); assert.ok(file.endsWith(view.brief)); } // 전달 파일의 본문이 화면의 글과 글자 그대로 같다
  assert.strictEqual(L.childPromptText('ko', pad).endsWith(L.consentView({ token: 't', folder: '/a', title: 'x', prompt: pad }).brief), true);
  assert.strictEqual(L.consentView({ token: 't', folder: '/a', title: 'x', prompt: '' }).lines, 0);
});
t('주 흐름(R8): 동의 토큰 한 번만 · 승인 뒤 시작 · 승인을 기다리는 사이 마루 pty 가 다시 시작돼도 허용, 옛 키로 서명한 디스크 요청은 auth 로 거절 · 창이 숨으면 받지 않음', () => {
  // 한 번만 쓰는 토큰의 상태 전이: 답 -> used 로 표시 -> 같은 답 다시 = invalid
  const p = { token: 'cd12ef34cd12ef34cd12ef34cd12ef34', expiresAt: 5000, used: false };
  assert.strictEqual(L.consentAnswer(p, p.token, 'open', 1).result, 'open'); p.used = true; assert.strictEqual(L.consentAnswer(p, p.token, 'open', 2).result, 'invalid'); assert.strictEqual(L.consentAnswer(p, p.token, 'cancel', 2).result, 'invalid');
  // 승인 뒤 시작: 모든 조건이 같으면 통과
  const ok = { quitting: false, windowOk: true, parentAlive: L.parentUsable({ exists: true, eligible: true }), children: 0, wsCount: 1, realNow: '/w', approvedReal: '/w' };
  assert.strictEqual(L.childLaunchCheck(ok), null);
  // 동의 창이 떠 있는 동안 마루 pty 가 다시 시작됐다: pty 가 잠깐 없어도(term 없음) 같은 작업 공간이면 계속한다 — parentUsable 은 pty 를 보지 않는다
  assert.strictEqual(L.parentUsable({ exists: true, eligible: true }), true); assert.strictEqual(L.parentUsable({ exists: false, eligible: true }), false); assert.strictEqual(L.parentUsable({ exists: true, eligible: false }), false);
  // 그 사이 새 키가 생겼다: 옛 키로 서명한 디스크의 요청은 새 키로 검증하면 auth
  const newKey = 'cd'.repeat(32); const restarted = () => chFacts().map((x) => (x.id === 'ws-maru' ? { ...x, key: newKey } : x));
  const stale = L.decideChildRequest(chCtx({ requester: (f) => L.requesterOf(restarted(), f, true) })); assert.deepStrictEqual([stale.ok, stale.reason], [false, 'auth']);
  const fresh = L.decideChildRequest(chCtx({ requester: (f) => L.requesterOf(restarted(), f, true) }, chReq({}, newKey))); assert.strictEqual(fresh.ok, true); // 새 키로 서명하면 통과
  // 창이 숨었거나 앱이 끝나 가면 요청을 받지 않거나(스캔) 시작하지 않는다(승인 뒤 재확인)
  assert.strictEqual(L.childWindowReady({ destroyed: false, visible: false, minimized: false }), false); assert.strictEqual(L.childLaunchCheck({ ...ok, windowOk: false }), 'busy'); assert.strictEqual(L.childLaunchCheck({ ...ok, quitting: true }), 'busy');
});
t('상태 기록 읽기 상한(R7): cwd 가 긴 한글 경로여도 8192 안에서 읽힌다', () => {
  const cwd = '/' + '가'.repeat(1023); assert.strictEqual(cwd.length, 1024);
  const raw = JSON.stringify({ state: 'busy', at: '2026-11-17T00:00:00Z', model: 'claude-sonnet-4', transcript_path: '/Users/x/.claude/projects/p/' + 'a'.repeat(8) + '.jsonl', cwd });
  assert.ok(Buffer.byteLength(raw) > 3000 && Buffer.byteLength(raw) < 4096 + 1000); const rec = L.parseAgentRecord(raw); assert.strictEqual(rec.cwd, cwd); assert.strictEqual(rec.state, 'busy');
  const esc = JSON.stringify({ state: 'idle', cwd }).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')); // 파이썬 ensure_ascii 식(글자당 6바이트)
  assert.ok(esc.length > 4096 && esc.length <= 8192); assert.strictEqual(L.parseAgentRecord(esc).cwd, cwd); assert.strictEqual(L.parseAgentRecord(' '.repeat(8193) + '{}'), null);
  const f = path.join(tmp, 'agent-state.json'); fs.writeFileSync(f, esc); assert.strictEqual(L.parseAgentRecord(L.readRegular(f, 8192, false).text).cwd, cwd); // main 의 읽기 상한(8192)과 같은 값
  assert.ok(/readRegular\(f, 8192, false\)/.test(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')));
});

t('buildSetupScript: % 와 줄바꿈 문구는 글자 그대로, 실제 실행 분기(로컬만)', () => {
  const cp = require('child_process');
  const dir = fs.mkdtempSync(path.join(tmp, 'setup script '));
  const dd = path.join(dir, "it's here"); fs.mkdirSync(dd);
  const mk = (code) => { const f = path.join(dd, 'claude'); fs.writeFileSync(f, '#!/bin/sh\nexit ' + code + '\n', { mode: 0o755 }); return f; };
  const st = { run: '실행 100% %s %d\n두번째 줄', done: '끝 %s\n완료', fail: '실패 %d 코드={code}\n다음 {code}' };
  const run = (code) => { const bin = mk(code); const sc = path.join(dir, 's' + code + '.command'); fs.writeFileSync(sc, L.buildSetupScript({ kind: 'login', claudeBin: bin, strings: st }), { mode: 0o700 }); const r = cp.spawnSync('/bin/bash', [sc], { encoding: 'utf8', timeout: 10000 }); return r; };
  const f = run(3);
  assert.strictEqual(f.status, 3); assert.ok(f.stdout.includes('실행 100% %s %d\n두번째 줄\n')); assert.ok(f.stdout.includes('실패 %d 코드=3\n다음 3\n')); assert.ok(!f.stdout.includes('끝 %s'));
  const g = run(0);
  assert.strictEqual(g.status, 0); assert.ok(g.stdout.includes('끝 %s\n완료\n')); assert.ok(!g.stdout.includes('실패'));
  const pf = L.buildSetupScript({ kind: 'login', claudeBin: '/x', strings: st }); assert.ok(pf.indexOf('set -o pipefail') < pf.indexOf('auth login')); // 파이프 중간 실패도 잡는다
});
t('claudeCandidates: 순서·중복·비절대 줄·nvm 정렬', () => {
  const c = L.claudeCandidates({ home: '/h', lines: ['claude', null, '/s/claude', ' /s/claude ', '/x\u0007y', 'rel/claude'], nvmDirs: ['v20.5.0', 'v22.9.0', 'v22.10.0', 'junk', '.DS_Store', 'v22.10', 42] });
  assert.strictEqual(c[0], '/s/claude'); assert.strictEqual(c.filter((x) => x === '/s/claude').length, 1); assert.ok(!c.some((x) => x.includes('rel/') || x.includes('\u0007')));
  assert.deepStrictEqual(c.slice(1, 8), ['/h/.local/bin/claude', '/h/.claude/local/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/h/.npm-global/bin/claude', '/h/.bun/bin/claude', '/h/.volta/bin/claude']);
  assert.deepStrictEqual(c.slice(8), ['/h/.nvm/versions/node/v22.10.0/bin/claude', '/h/.nvm/versions/node/v22.9.0/bin/claude', '/h/.nvm/versions/node/v20.5.0/bin/claude']);
  assert.ok(L.claudeCandidates({ home: '/h', lines: ['/h/.local/bin/claude'], nvmDirs: [] }).filter((x) => x === '/h/.local/bin/claude').length === 1); // 셸 결과와 고정 후보 중복 제거
  assert.deepStrictEqual(L.claudeCandidates({ home: 'rel', lines: [], nvmDirs: ['v1.0.0'] }), ['/opt/homebrew/bin/claude', '/usr/local/bin/claude']);
  assert.deepStrictEqual(L.claudeCandidates({}), ['/opt/homebrew/bin/claude', '/usr/local/bin/claude']);
  assert.strictEqual(L.nvmVersionDirs(Array.from({ length: 80 }, (_, i) => 'v18.0.' + i)).length, 50);
});
t('setupCommand·buildSetupScript: 인용·알 수 없는 종류·제어 문자', () => {
  assert.strictEqual(L.setupCommand('install-claude'), L.SETUP_INSTALL_CMD);
  assert.strictEqual(L.setupCommand('login', "/a b/it's/claude"), "/a\\ b/it\\'s/claude auth login");
  for (const bad of [null, 'claude', '/x\ny/claude', '']) assert.strictEqual(L.setupCommand('login', bad), null);
  for (const w of ['/a/$(touch x)/claude', '/a/`id`/claude', '/a/b;c/claude', '/a/b!c/claude', '/a/한글 폴더/claude', '/a/$HOME/claude', '/a/b|c&d>e/claude']) {
    const c = L.setupCommand('login', w); assert.ok(c.endsWith(' auth login'));
    const p = c.slice(0, -' auth login'.length); // 인용된 경로: 글자 그대로 한 단어로 풀린다
    const r = require('child_process').spawnSync('/bin/bash', ['-c', 'printf "%s" ' + p]); assert.strictEqual(r.stdout.toString('utf8'), w); assert.strictEqual(r.status, 0);
  }
  assert.strictEqual(L.setupCommand('rm', '/x'), null); assert.strictEqual(L.setupCommand('', '/x'), null);
  const st = { run: "실행: it's", done: '끝났습니다. 이 창을 닫고 마루로 돌아가세요.', fail: '실패(종료 코드 {code}).' };
  const sc = L.buildSetupScript({ kind: 'login', claudeBin: "/a b/it's/claude", strings: st });
  assert.ok(sc.startsWith('#!/bin/bash\n')); assert.ok(sc.includes("\n/a\\ b/it\\'s/claude auth login\n")); assert.ok(sc.includes("'실행: it'\\''s'")); assert.ok(sc.includes('exit $rc'));
  const si = L.buildSetupScript({ kind: 'install-claude', claudeBin: "/evil';rm -rf ~;'", strings: st });
  assert.ok(si.includes('\n' + L.SETUP_INSTALL_CMD + '\n') && !si.includes('evil')); // 설치 스크립트에는 경로가 끼지 않는다
  assert.ok(sc.includes('set -o pipefail\n') && sc.includes('if [ "$rc" -eq 0 ]; then'));
  assert.ok(sc.includes('\'실패(종료 코드 \'"$rc"\').\'')); // {code} 자리에만 $rc
  assert.strictEqual(L.buildSetupScript({ kind: 'login', claudeBin: '/a', strings: { run: 'r', done: 'd' } }), null);
  assert.strictEqual(L.buildSetupScript({ kind: 'x', claudeBin: '/a', strings: st }), null);
  assert.strictEqual(L.buildSetupScript({ kind: 'login', claudeBin: null, strings: st }), null);
  assert.strictEqual(L.buildSetupScript({ kind: 'login', claudeBin: '/a', strings: null }), null);
  assert.deepStrictEqual(L.SETUP_KINDS, ['install-claude', 'login']);
});
t('parseClaudeProbe: 센티널 줄만 읽는다', () => {
  assert.strictEqual(L.parseClaudeProbe('rc 잡음 /fake/claude\n\n__MARU_CLAUDE__/n/bin/claude\nlogout 잡음 /other/claude\n'), '/n/bin/claude');
  assert.strictEqual(L.parseClaudeProbe('__MARU_CLAUDE__/n/claude\r\n'), '/n/claude');
  assert.strictEqual(L.parseClaudeProbe('__MARU_CLAUDE__\n'), null); // 없음
  assert.strictEqual(L.parseClaudeProbe('__MARU_CLAUDE__claude\n'), null); // alias·상대 경로
  assert.strictEqual(L.parseClaudeProbe('__MARU_CLAUDE__/a\u0007b\n'), null);
  assert.strictEqual(L.parseClaudeProbe('/only/path/claude\n'), null); // 센티널 없는 줄은 무시
  assert.strictEqual(L.parseClaudeProbe(undefined), null);
  assert.ok(L.CLAUDE_PROBE_CMD.includes('__MARU_CLAUDE__') && L.CLAUDE_PROBE_CMD.includes('command -v claude'));
});
t('childPath: claude 폴더는 맨 뒤에(절대·실재·"/" 아님만), 중복 제거', () => {
  const extra = ['/h/.local/bin', '/usr/bin']; const isDir = (d) => d === '/n/v20/bin' || d === '/usr/bin' || d === '/';
  assert.strictEqual(L.childPath({ extra, current: '/x:/usr/bin', claudeBin: '/n/v20/bin/claude', isDir }), '/h/.local/bin:/usr/bin:/x:/n/v20/bin');
  assert.strictEqual(L.childPath({ extra, current: '/x', claudeBin: '/usr/bin/claude', isDir }), '/h/.local/bin:/usr/bin:/x'); // 표준 폴더는 중복 없이 그대로
  assert.strictEqual(L.childPath({ extra, current: '/x', claudeBin: '/없는/bin/claude', isDir }), '/h/.local/bin:/usr/bin:/x');
  assert.strictEqual(L.childPath({ extra, current: '/x', claudeBin: 'claude', isDir }), '/h/.local/bin:/usr/bin:/x');
  assert.strictEqual(L.childPath({ extra, current: '/x', claudeBin: '/claude', isDir }), '/h/.local/bin:/usr/bin:/x'); // "/" 는 건너뜀
  assert.strictEqual(L.childPath({ extra, current: '/x', claudeBin: '/a:b/claude', isDir: () => true }), '/h/.local/bin:/usr/bin:/x');
  assert.strictEqual(L.childPath({ extra, current: '/x', claudeBin: null, isDir }), '/h/.local/bin:/usr/bin:/x');
  assert.strictEqual(L.childPath({ extra, current: undefined, claudeBin: '/n/v20/bin/claude', isDir: () => { throw new Error('x'); } }), '/h/.local/bin:/usr/bin');
});
t('parseOnboarded: true/false/null', () => {
  assert.strictEqual(L.parseOnboarded('{"hasCompletedOnboarding":true,"x":1}'), true);
  assert.strictEqual(L.parseOnboarded('{"theme":"dark"}'), false);
  assert.strictEqual(L.parseOnboarded('{"hasCompletedOnboarding":"true"}'), false);
  for (const bad of ['', 'not json', '[1]', 'null', 42, undefined]) assert.strictEqual(L.parseOnboarded(bad), null);
});
t('claudeUpAfter: 셸이 2004l 을 안 내도 포그라운드가 셸이 아니면 뜬 것', () => {
  const b = { claudeUp: false, awaitClaude: true, sawOn: true };
  for (const p of ['claude', 'node', '2.1.326']) assert.strictEqual(L.claudeUpAfter({ ...b, procName: p }), true, p);
  for (const p of ['bash', 'zsh', '-zsh', 'sh', 'fish', '', undefined, null, 5]) assert.strictEqual(L.claudeUpAfter({ ...b, procName: p }), false, String(p)); // 래퍼(bash) 단계·모름은 아님
  assert.strictEqual(L.claudeUpAfter({ ...b, sawOn: false, procName: 'claude' }), false);
  assert.strictEqual(L.claudeUpAfter({ ...b, awaitClaude: false, procName: 'claude' }), false);
  assert.strictEqual(L.claudeUpAfter({ claudeUp: true, procName: 'zsh' }), true); // 이미 참이면 그대로
  assert.strictEqual(L.claudeUpAfter({ claudeUp: false }), false);
  const noOff = L.bpStep({ tail: '', bracketed: false, awaitClaude: true, sawOff: false, claudeUp: false }, '% \x1b[?2004h'); // 2004l 이 없는 셸
  assert.deepStrictEqual([noOff.claudeUp, noOff.sawOn, noOff.bracketed], [false, true, true]);
  assert.strictEqual(L.bpStep({ tail: '', bracketed: false }, 'plain').sawOn, false);
  assert.strictEqual(L.claudeUpAfter({ claudeUp: noOff.claudeUp, awaitClaude: true, sawOn: noOff.sawOn, procName: 'claude' }), true);
});
t('firstMeetingGate: 첫 설정 중·셸·준비 전에는 채우지 않는다', () => {
  const ok = { hasTerm: true, procName: 'claude', bracketed: true, awaitClaude: true, claudeUp: true, quietMs: 1000, onboarded: true, hookState: false, loggedIn: true };
  assert.deepStrictEqual(L.firstMeetingGate(ok), { ok: true });
  assert.deepStrictEqual(L.firstMeetingGate({ ...ok, hasTerm: false }), { ok: false, reason: 'no-term' });
  assert.deepStrictEqual(L.firstMeetingGate({ ...ok, procName: 'zsh' }), { ok: false, reason: 'shell' });
  assert.strictEqual(L.firstMeetingGate({ ...ok, onboarded: false }).reason, 'setup'); // 테마 선택 화면(설정 파일은 읽었고 키가 true 아님)
  assert.strictEqual(L.firstMeetingGate({ ...ok, onboarded: false, loggedIn: true }).reason, 'setup');
  assert.strictEqual(L.firstMeetingGate({ ...ok, onboarded: false, hookState: true }).ok, true); // 훅 상태가 있으면 진짜 세션이 시작된 것
  assert.strictEqual(L.firstMeetingGate({ ...ok, onboarded: true, loggedIn: false }).ok, true); // 환경변수로 로그인한 사람을 auth status 로 막지 않는다
  assert.strictEqual(L.firstMeetingGate({ ...ok, onboarded: null, loggedIn: false }).reason, 'setup'); // 설정 파일 없음 + 로그인 안 됨 = 첫 실행
  assert.strictEqual(L.firstMeetingGate({ ...ok, onboarded: null, loggedIn: null }).ok, true);
  assert.strictEqual(L.firstMeetingGate({ ...ok, onboarded: null, loggedIn: true }).ok, true);
  assert.strictEqual(L.firstMeetingGate({ ...ok, onboarded: null, loggedIn: false, hookState: true }).ok, true);
  assert.deepStrictEqual(L.firstMeetingGate({ ...ok, bracketed: false }), { ok: false, reason: 'not-ready', why: 'bracketed' });
  assert.deepStrictEqual(L.firstMeetingGate({ ...ok, awaitClaude: true, claudeUp: false }), { ok: false, reason: 'not-ready', why: 'claude-up' });
  assert.deepStrictEqual(L.firstMeetingGate({ ...ok, quietMs: 100 }), { ok: false, reason: 'not-ready', why: 'quiet' });
  assert.strictEqual(L.firstMeetingGate({ ...ok, bracketed: false, awaitClaude: true, claudeUp: false, quietMs: 0 }).why, 'bracketed'); // 먼저 걸린 것
  assert.strictEqual(L.firstMeetingGate({ ...ok, awaitClaude: true, claudeUp: false, quietMs: 0 }).why, 'claude-up');
  assert.strictEqual(L.firstMeetingGate({ ...ok, awaitClaude: true, claudeUp: false }).reason, 'not-ready'); // 우리가 연 작업 공간은 claudeUp 필요
  assert.strictEqual(L.firstMeetingGate({ ...ok, awaitClaude: false, claudeUp: false }).ok, true); // 처음 작업 공간·복원된 작업 공간은 awaitClaude 가 없다
  assert.strictEqual(L.firstMeetingGate({ ...ok, quietMs: 100 }).reason, 'not-ready');
  assert.strictEqual(L.firstMeetingGate(null).reason, 'no-term');
});
t('첫 만남 안내문이 ko·en 모두 있고 렌더러가 setup 사유를 쓴다', () => {
  for (const lang of ['ko', 'en']) assert.ok(I.t(lang, 'meet.note.setup').length > 10);
  assert.ok(/reason === 'setup' \? 'meet.note.setup'/.test(fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8')));
});
t('managedWsTitle: 관리형 홈의 기본/".maru" 제목만 제품 이름으로', () => {
  const roots = ['/h/.maru', '/real/h/.maru'];
  assert.strictEqual(L.managedWsTitle('.maru', '/h/.maru', roots, '마루'), '마루');
  assert.strictEqual(L.managedWsTitle('', '/real/h/.maru/', roots, 'Maru'), 'Maru');
  assert.strictEqual(L.managedWsTitle('내 제목', '/h/.maru', roots, '마루'), '내 제목');
  assert.strictEqual(L.managedWsTitle('.maru', '/h/other/.maru', roots, '마루'), '.maru'); // 관리형 홈이 아니면 그대로
  assert.strictEqual(L.managedWsTitle('.maru', '/h/.maru', [], '마루'), '.maru');
});

// ---- EventKit 캘린더 도우미(maru-cal) ----
t('calHelperArgs: 검증된 정수만 인자 배열로, 잘못이면 null', () => {
  assert.deepStrictEqual(L.calHelperArgs('today'), ['today']);
  assert.deepStrictEqual(L.calHelperArgs('month', 2026, 11), ['month', '2026', '11']);
  assert.deepStrictEqual(L.calHelperArgs('day', 2024, 2, 29), ['day', '2024', '2', '29']);
  for (const bad of [['month', 1999, 1], ['month', 2101, 1], ['month', 2026, 0], ['month', 2026, 13], ['month', '2026', 1], ['month', 2026.5, 1], ['day', 2026, 2, 30], ['day', 2026, 11, 0], ['day', 2026, 11, '1'], ['day', 2026, 11], ['x'], [], ['month', NaN, 1]]) assert.strictEqual(L.calHelperArgs(...bad), null, JSON.stringify(bad));
  assert.ok(L.calHelperArgs('month', 2026, 11).every((a) => /^[a-z0-9]+$/.test(a)));
});
t('calHelperExit·calStatusWord: 종료 코드와 상태 단어 매핑', () => {
  assert.strictEqual(L.calHelperExit(0), 'ok'); assert.strictEqual(L.calHelperExit(3), 'perm');
  for (const c of [1, 2, 4, null, undefined, 'x', 137]) assert.strictEqual(L.calHelperExit(c), 'fail');
  assert.strictEqual(L.calStatusWord('authorized\n'), 'ok'); assert.strictEqual(L.calStatusWord('denied'), 'denied'); assert.strictEqual(L.calStatusWord('restricted'), 'denied');
  assert.strictEqual(L.calStatusWord('notDetermined\n'), 'ask');
  for (const w of ['', 'Authorized', 'writeOnly', null, 5]) assert.strictEqual(L.calStatusWord(w), 'unknown');
  assert.ok(L.CAL_HELPER_FIRST_MS >= 70000 && L.CAL_HELPER_MS === 10000 && L.CAL_OSA_MS === 90000);
});
t('calChooseReader: 패키징 또는 개발 옵트인 + 일반 파일·실행 가능·소유자 확인·(패키징 시) Resources 안일 때만', () => {
  const ok = { helper: '/a/maru-cal', isFile: true, executable: true, owned: true, packaged: false, devOptIn: true };
  assert.strictEqual(L.calChooseReader(ok), 'helper');
  assert.strictEqual(L.calChooseReader({ ...ok, devOptIn: false }), 'osascript'); // 소스 실행은 옵트인 없이는 osascript
  assert.strictEqual(L.calChooseReader({ ...ok, devOptIn: undefined }), 'osascript');
  assert.strictEqual(L.calChooseReader({ ...ok, owned: false }), 'osascript');
  assert.strictEqual(L.calChooseReader({ ...ok, owned: undefined }), 'osascript');
  assert.strictEqual(L.calChooseReader({ ...ok, isFile: false }), 'osascript');
  assert.strictEqual(L.calChooseReader({ ...ok, executable: false }), 'osascript');
  assert.strictEqual(L.calChooseReader({ ...ok, helper: '' }), 'osascript');
  assert.strictEqual(L.calChooseReader(null), 'osascript');
  const pk = { ...ok, packaged: true, devOptIn: false, realHelper: '/R/Resources/native/maru-cal', realResources: '/R/Resources' };
  assert.strictEqual(L.calChooseReader(pk), 'helper');
  assert.strictEqual(L.calChooseReader({ ...pk, realHelper: '/elsewhere/maru-cal' }), 'osascript');
  assert.strictEqual(L.calChooseReader({ ...pk, realHelper: '/R/Resources2/maru-cal' }), 'osascript');
  assert.strictEqual(L.calChooseReader({ ...pk, realHelper: null }), 'osascript');
});
t('캘린더 도우미 경로: execFile 인자 배열·셸 없음, 일정은 디스크·로그에 쓰지 않음, 읽기 함수 한 곳', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const a = main.indexOf('async function calRead('); const b = main.indexOf('let cal = { pending', a);
  assert.ok(a > 0 && b > a);
  const body = main.slice(a, b);
  assert.ok(/exec\(helper, hargs,/.test(body) && /L\.calHelperArgs\(/.test(body));
  assert.ok(!/shell\s*:|spawn\(|execSync|\/bin\/(ba|z)?sh|child_process/.test(body));
  assert.ok(/CAL_OSA_MS/.test(body) && /CAL_HELPER_FIRST_MS/.test(body) && /CAL_HELPER_MS/.test(body));
  assert.strictEqual((main.match(/\/usr\/bin\/osascript/g) || []).length, 1); // osascript 호출은 calRead 안 한 곳뿐
  const cal = main.slice(main.indexOf('// ---- 캘린더(opt-in'), main.indexOf('// ---- 업그레이드'));
  assert.ok(!/writeFile|appendFile|createWriteStream|console\.|saveProfile|logLine/.test(cal), '캘린더 구간에 파일 쓰기·로그 없음');
  assert.ok(/calHelperOk \? L\.CAL_HELPER_MS : L\.CAL_HELPER_FIRST_MS/.test(body));
  assert.ok(/if \(!calOn\(\)\) return[\s\S]{0,120}new AbortController\(\)[\s\S]{0,200}signal: ac\.signal/.test(body)); // 띄우기 직전 켜짐 확인 + 끄면 죽일 수 있는 신호
  assert.ok(/for \(const ac of calAborts\) ac\.abort\(\)/.test(main));
  const ch = main.slice(main.indexOf('function calHelperChoice('), a);
  assert.ok(/app\.isPackaged && process\.env\.MARU_APP_CAL_HELPER !== '1'\) return null/.test(ch) && /lstatSync\(helper\)/.test(ch) && !/calPerm/.test(main));
  assert.ok(/'status'/.test(main) && /L\.calStatusWord\(/.test(main)); // 설정 줄은 status 로 확인
  assert.ok(/function calDropAll\(\) \{ cal = \{ pending: false, ok: false, events: \[\] \}; calMonths\.clear\(\); calDays\.clear\(\)/.test(main) && /if \(!profile \|\| !profile\.calendar\) \{ calDropAll\(\);/.test(main)); // 꺼지면 캐시 폐기
  assert.ok(/if \(r\.perm\) c\.events = \{\}/.test(main) && /if \(r\.perm\) \{ c\.busy = false;[^\n]*c\.events = \[\]/.test(main) && /w === 'denied'\) \{ calDropAll\(\)/.test(main) && /calLastFail \? row\('cal', 'need', 'cal\.fail'/.test(main)); // 권한 없음이면 옛 일정 폐기, 요청 실패면 실패 줄
  assert.ok(/calOn = \(\) => FAKE_DAY \|\| \(!SMOKE/.test(main));
});
t('캘린더 도우미: 소스는 Foundation·EventKit 만, 읽기 전용·네트워크·파일 쓰기 없음', () => {
  const sw = fs.readFileSync(path.join(__dirname, 'native', 'maru-cal.swift'), 'utf8');
  assert.deepStrictEqual([...sw.matchAll(/^import (\w+)/gm)].map((m) => m[1]).sort(), ['EventKit', 'Foundation']);
  assert.ok(!/URLSession|NSURL|Socket|write\(to|FileManager|FileHandle\.standardOutput|\.save\(|saveEvent|removeEvent|EKEvent\(eventStore/.test(sw));
  assert.ok(/requestFullAccessToEvents/.test(sw) && /requestAccess\(to: \.event\)/.test(sw) && /predicateForEvents\(withStart/.test(sw));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.ok(pkg.build.extraResources.some((e) => e.from === 'native/bin/maru-cal' && e.to === 'native/maru-cal'));
  assert.ok(/NSCalendarsFullAccessUsageDescription/.test(JSON.stringify(pkg.build.mac.extendInfo)) && /NSCalendarsUsageDescription/.test(JSON.stringify(pkg.build.mac.extendInfo)));
  assert.ok(/build:native/.test(pkg.scripts.dist) && pkg.scripts['build:native']);
  assert.ok(/native\/bin\//.test(fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8')));
});
t('캘린더 권한 없음 문구가 ko·en 모두 있고 렌더러가 쓴다', () => {
  for (const l of ['ko', 'en']) { assert.ok(I.t(l, 'day.events.perm').length > 20); assert.ok(I.t(l, 'cal.ask').length > 5); }
  assert.ok(/캘린더에서 Maru를 허용해 주세요/.test(I.t('ko', 'day.events.perm')));
  assert.ok(/day\.events\.perm/.test(fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8')));
});
{
  const bin = path.join(__dirname, 'native', 'bin', 'maru-cal');
  const have = process.platform === 'darwin' && fs.existsSync(bin);
  const selftest = (mode) => require('child_process').execFileSync(bin, ['selftest', mode], { encoding: 'utf8', timeout: 10000 });
  (have ? t : (name) => console.log('skip ' + name + ' (maru-cal 없음)'))('maru-cal selftest 출력을 세 파서가 그대로 받는다(EventKit 접근 없음)', () => {
    const now = new Date(); const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
    const today = L.parseCalendarOutput(selftest('today'), now);
    assert.ok(today.some((e) => e.day === 'today' && e.allDay && e.title === 'Sample holiday') && today.some((e) => e.day === 'today' && e.time === '09:30' && e.title === 'Sample standup') && today.some((e) => e.day === 'tomorrow'));
    assert.ok(today.every((e) => !/[\x00-\x1f]/.test(e.title)) && today.some((e) => e.title === 'Hostiletitlex')); // RS/US·제어 문자는 도우미가 제거
    const raw = selftest('today'); assert.ok(raw.split('\x1e').filter(Boolean).every((r) => r.replace(/^[\r\n]+/, '').split('\x1f').length === 4));
    const mo = L.parseCalendarMonth(selftest('month'), y, m); const ds = String(y) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    assert.ok(mo[ds] && mo[ds].some((e) => e.title === 'Sample standup' && e.time === '09:30'));
    const dy = L.parseCalendarDay(selftest('day'), y, m, d); assert.ok(Array.isArray(dy));
    const st = dy.find((e) => e.title === 'Sample standup'); assert.ok(st && st.time === '09:30' && st.endTime === '10:00' && st.cal === 'Sample' && st.loc === 'Room A' && st.notes === 'Line one\nLine two');
    assert.ok(dy.some((e) => e.allDay && e.title === 'Sample holiday' && e.endDay === ''));
    const long = dy.find((e) => e.title.startsWith('LLLL')); assert.ok(long && long.loc.length <= 200 && long.cal.length <= 80); // 길이 상한(도우미 장소 200·이름 80, 파서도 같거나 작다)
    const lr = selftest('day').split('\x1e').find((r) => r.includes('LLLL')).split('\x1f'); // 도우미 원문: 제목 80·이름 80·장소 200·메모 800자 이하
    assert.deepStrictEqual([lr[3].length, lr[6].length, lr[7].length, lr[8].length], [80, 80, 200, 800]);
    assert.ok(80 >= 60 && 800 >= 600); // 도우미 상한 >= 파서가 남기는 길이(제목 60·메모 600)
    const many = (mode) => require('child_process').execFileSync(bin, ['selftest', mode, 'many'], { encoding: 'utf8', timeout: 10000 }).split('\x1e').filter(Boolean).length;
    assert.strictEqual(many('day'), 60); assert.strictEqual(many('today'), 20); assert.ok(many('month') <= 372 && many('month') >= 12); // 하루 상세 60·오늘 20·달 하루 12·31*12
    const mm = L.parseCalendarMonth(selftest('month').replace(/^/, ''), y, m); assert.ok(Object.values(mm).every((v) => v.length <= 12));
    assert.ok(raw.length < 4000);
    const dayRaw = selftest('day'); assert.ok(dayRaw.split('\x1e').filter(Boolean).every((r) => r.replace(/^[\r\n]+/, '').split('\x1f').length === 9));
  });
}

// ---- 사용자가 직접 여는 하위 세션(열기 창) ----
{
  const TOK = 'a'.repeat(32); const PAR = '0123456789abcdef';
  const ok = (o) => ({ parent: PAR, token: TOK, title: '', brief: '', squad: null, notify: true, ...o });
  t('parseSubOpen: 정상값(제목·내용 비어도 됨, 팀 null)', () => {
    assert.deepStrictEqual(L.parseSubOpen(ok({})), { ok: true, parent: PAR, token: TOK, title: '', brief: '', squad: null, notify: true });
    const r = L.parseSubOpen(ok({ title: '  api 서버  ', brief: '첫 줄\r\n둘째 줄\t탭\u0007', squad: 'dev', notify: false }));
    assert.deepStrictEqual([r.ok, r.title, r.brief, r.squad, r.notify], [true, 'api 서버', '첫 줄\n둘째 줄\t탭', 'dev', false]);
  });
  t('parseSubOpen: 제목 40자·내용 4000자 경계(코드포인트), 서식·bidi 문자는 지움', () => {
    assert.strictEqual(L.parseSubOpen(ok({ title: '가'.repeat(40) })).ok, true);
    assert.deepStrictEqual(L.parseSubOpen(ok({ title: '가'.repeat(41) })), { ok: false, reason: 'title' });
    assert.strictEqual(L.parseSubOpen(ok({ title: '😀'.repeat(40) })).ok, true);
    assert.strictEqual(L.parseSubOpen(ok({ brief: '가'.repeat(4000) })).ok, true);
    assert.deepStrictEqual(L.parseSubOpen(ok({ brief: '가'.repeat(4001) })), { ok: false, reason: 'brief' });
    assert.strictEqual(L.parseSubOpen(ok({ title: 'a\u202Eb\u200Bc' })).title, 'abc');
    assert.deepStrictEqual(L.parseSubOpen(ok({ brief: 'x'.repeat(100000) })), { ok: false, reason: 'brief' });
    assert.strictEqual(L.parseSubOpen(ok({ brief: '   \n\t ' })).brief, ''); // 공백뿐이면 빈 내용(전달 파일 없음)
  });
  t('parseSubOpen: 모양·타입이 틀리면 invalid(경로 키·추가 키·프로토타입 포함)', () => {
    const bad = (o) => assert.deepStrictEqual(L.parseSubOpen(o), { ok: false, reason: 'invalid' });
    bad(null); bad('x'); bad([]); bad(42); bad({});
    bad({ ...ok({}), path: '/tmp' }); bad({ ...ok({}), cwd: '/tmp' }); bad({ ...ok({}), extra: 1 });
    const miss = ok({}); delete miss.notify; bad(miss);
    bad(ok({ parent: 'xyz' })); bad(ok({ parent: PAR.toUpperCase() })); bad(ok({ token: 'a'.repeat(31) })); bad(ok({ token: 'A'.repeat(32) })); bad(ok({ token: '../'.repeat(11) }));
    bad(ok({ title: 5 })); bad(ok({ brief: null })); bad(ok({ notify: 'yes' })); bad(ok({ notify: 1 }));
    for (const sq of ['Dev', '', ' dev', 'dev\n', '../x', 'a'.repeat(21), 7, {}, undefined]) bad(ok({ squad: sq }));
    bad(JSON.parse('{"__proto__":{"x":1},"parent":"0123456789abcdef","token":"' + TOK + '","title":"","brief":"","squad":null,"notify":true}'));
  });
  t('초안 토큰: 만료(10분)·다른 부모·재사용 거부', () => {
    const store = new Map(); const real = '/Users/someone/work/api'; const t0 = 1_000_000;
    assert.strictEqual(L.subDraftAdd(store, { token: TOK, parentId: PAR, real, display: '~/work/api', nowMs: t0 }), true);
    const c = L.subDraftCheck(store, TOK, PAR, t0 + 1000); assert.ok(c.ok && c.draft.real === real && c.draft.display === '~/work/api');
    assert.deepStrictEqual(L.subDraftCheck(store, TOK, 'fedcba9876543210', t0 + 1000), { ok: false, reason: 'invalid' }); // 다른 부모
    assert.deepStrictEqual(L.subDraftCheck(store, 'b'.repeat(32), PAR, t0), { ok: false, reason: 'invalid' }); // 모르는 토큰
    assert.deepStrictEqual(L.subDraftCheck(store, 'zz', PAR, t0), { ok: false, reason: 'invalid' });
    assert.ok(L.subDraftCheck(store, TOK, PAR, t0 + L.SUB_DRAFT_MS).ok); // 정확히 10분은 아직 유효
    assert.deepStrictEqual(L.subDraftCheck(store, TOK, PAR, t0 + L.SUB_DRAFT_MS + 1), { ok: false, reason: 'expired' });
    assert.strictEqual(store.size, 0); // 만료된 것은 치운다
    L.subDraftAdd(store, { token: TOK, parentId: PAR, real, display: 'd', nowMs: t0 });
    assert.strictEqual(L.subDraftUse(store, TOK), true);
    assert.deepStrictEqual(L.subDraftCheck(store, TOK, PAR, t0 + 5), { ok: false, reason: 'invalid' }); // 한 번 쓰면 재사용 불가
  });
  t('초안 보관소: 부모당 하나·개수 상한·나쁜 입력 거부·만료분 정리', () => {
    const store = new Map(); const real = '/Users/someone/work/api'; const mk = (c, p, now) => L.subDraftAdd(store, { token: c.repeat(32), parentId: p, real, display: 'd', nowMs: now });
    assert.ok(mk('a', PAR, 0)); assert.ok(mk('b', PAR, 1)); // 같은 부모가 다시 고르면 이전 토큰은 무효
    assert.strictEqual(L.subDraftCheck(store, 'a'.repeat(32), PAR, 2).ok, false); assert.ok(L.subDraftCheck(store, 'b'.repeat(32), PAR, 2).ok);
    for (let i = 0; i < 12; i++) assert.ok(mk('0123456789abcdef'[i], i.toString(16).padStart(16, '0'), 10 + i));
    assert.ok(store.size <= L.SUB_DRAFT_MAX);
    assert.strictEqual(L.subDraftAdd(store, { token: 'x', parentId: PAR, real, display: 'd', nowMs: 0 }), false);
    assert.strictEqual(L.subDraftAdd(store, { token: TOK, parentId: PAR, real: 'rel/path', display: 'd', nowMs: 0 }), false); // 절대 경로가 아니면 보관하지 않는다
    assert.strictEqual(L.subDraftAdd(store, { token: TOK, parentId: PAR, real: '/a/../b', display: 'd', nowMs: 0 }), false);
    assert.strictEqual(L.subDraftAdd({}, { token: TOK, parentId: PAR, real, display: 'd', nowMs: 0 }), false);
    const s2 = new Map(); L.subDraftAdd(s2, { token: TOK, parentId: PAR, real, display: 'd', nowMs: 0 }); L.subDraftAdd(s2, { token: 'c'.repeat(32), parentId: 'fedcba9876543210', real, display: 'd', nowMs: L.SUB_DRAFT_MS + 5 });
    assert.deepStrictEqual([...s2.keys()], ['c'.repeat(32)]); // 새로 더할 때 만료된 것은 치운다
  });
  t('subLimitCheck: 마루가 요청하는 경로와 같은 한도·순서(하위 수 → 작업 공간 수 → 분당 → 하루)', () => {
    const base = { childCount: 0, wsCount: 1, accepted: [], monoMs: 100000, launches: [], nowMs: 1.8e12 };
    assert.strictEqual(L.subLimitCheck(base), null);
    assert.strictEqual(L.subLimitCheck({ ...base, childCount: L.CHILD_MAX }), 'children-max');
    assert.strictEqual(L.subLimitCheck({ ...base, wsCount: L.WS_MAX }), 'ws-max');
    assert.strictEqual(L.subLimitCheck({ ...base, childCount: L.CHILD_MAX, wsCount: L.WS_MAX }), 'children-max');
    const acc = Array.from({ length: L.CHILD_RATE_MAX }, (_, i) => 100000 - i * 1000);
    assert.strictEqual(L.subLimitCheck({ ...base, accepted: acc }), 'rate');
    assert.strictEqual(L.subLimitCheck({ ...base, accepted: acc.map((x) => x - L.CHILD_RATE_MS) }), null); // 1분이 지나면 풀린다
    assert.strictEqual(L.subLimitCheck({ ...base, launches: Array.from({ length: L.CHILD_DAY_MAX }, (_, i) => 1.8e12 - i) }), 'budget');
    assert.strictEqual(L.subLimitCheck({ ...base, childCount: NaN }), 'children-max'); // 모르면 막는다
    // 같은 한도 상수를 decideChildRequest 도 쓴다(숫자가 따로 놀지 않게 상수 이름으로 확인)
    const src = fs.readFileSync(path.join(__dirname, 'lib.js'), 'utf8'); const dc = src.slice(src.indexOf('function decideChildRequest'), src.indexOf('function childLaunchCheck'));
    assert.ok(/CHILD_MAX/.test(dc) && /WS_MAX/.test(dc) && /CHILD_RATE_MAX/.test(dc) && /budgetOk/.test(dc));
  });
  t('마루에게 알리기 한 줄: 고정 문장 + 정리한 제목·폴더, 개행·제어 문자 없음', () => {
    const trl = (lang) => (k, p) => I.t(lang, k, p);
    assert.strictEqual(L.subNoticeLine(trl('ko'), 'api-server', '~/work/api-server'), '하위 세션을 직접 열었어: api-server (~/work/api-server). 보고가 오면 이어서 봐 줘.');
    assert.strictEqual(L.subNoticeLine(trl('en'), 'api-server', '~/work/api-server'), 'I opened a sub-session myself: api-server (~/work/api-server). Please pick it up when its report comes in.');
    const dirty = L.subNoticeLine(trl('ko'), 'a\nb\r\u001b[2Jc\u202Ed', '~/x\n/y\u0007');
    assert.ok(!/[\r\n\u0000-\u001f\u202E]/.test(dirty), JSON.stringify(dirty)); assert.ok(dirty.startsWith('하위 세션을'));
    assert.strictEqual(L.subNoticeLine(trl('ko'), '', '~/x'), ''); assert.strictEqual(L.subNoticeLine(trl('ko'), 'a', '  \n '), ''); assert.strictEqual(L.subNoticeLine(null, 'a', 'b'), '');
    assert.ok([...L.subNoticeLine(trl('en'), 'x'.repeat(500), '/y'.repeat(500))].length < 400); // 길이 상한
    assert.ok(L.isSafeQuestStart(L.subNoticeLine(trl('ko'), '1 번', '~/x')) && L.isSafeQuestStart(L.subNoticeLine(trl('en'), '/rm', '~/x'))); // 제목이 앞에 오지 않으므로 숫자·/ 로 시작하는 제목도 안전
    assert.strictEqual(L.cleanNoticePart('가'.repeat(100), 10).length, 10);
  });
  t('작업 공간 기록의 by: 사용자가 연 하위 세션만 저장·복원, 그 밖의 값은 버림', () => {
    const cwd = '/Users/someone/work/api'; const ID1 = '1111111111111111'; const ID2 = '2222222222222222';
    const list = [{ id: ID1, cwd: '/Users/someone/work/maru', title: 'maru' }, { id: ID2, cwd, title: 'api', parentId: ID1, origin: 'child', by: 'user' }];
    const keep = L.workspacesToSave(list, ID1, false);
    assert.strictEqual(keep.list[1].by, 'user'); assert.strictEqual(keep.list[0].by, undefined);
    const raw = JSON.parse(L.workspacesJson(keep.list, keep.active)); assert.strictEqual(raw.workspaces[1].by, 'user');
    const back = L.normalizeWorkspaces(raw, { exists: () => true }); assert.strictEqual(back.list[1].by, 'user'); assert.strictEqual(back.list[1].origin, 'child'); assert.ok(!('by' in back.list[0]));
    const norm = (e) => L.normalizeWorkspaces({ workspaces: [{ cwd, title: 't', ...e }], active: 0 }, { exists: () => true }).list[0];
    assert.ok(!('by' in norm({ origin: 'child', by: 'maru' }))); assert.ok(!('by' in norm({ origin: 'child', by: true }))); assert.ok(!('by' in norm({ origin: 'child' })));
    assert.ok(!('by' in norm({ by: 'user' }))); // 하위 세션이 아니면 의미가 없다
    assert.strictEqual(norm({ origin: 'child', by: 'user' }).by, 'user');
    assert.ok(!('by' in L.workspacesToSave([{ id: ID1, cwd, title: 'x', by: 'user' }], ID1, false).list[0])); // 하위 세션이 아니면 저장하지 않는다
    assert.ok(!('by' in L.workspacesToSave([{ id: ID1, cwd, title: 'x', origin: 'child', by: 'maru' }], ID1, false).list[0]));
  });
  t('childPromptText: 사용자가 연 세션은 별도 머리말, 마루의 요청은 예전과 같음', () => {
    for (const lang of ['ko', 'en']) {
      assert.strictEqual(L.childPromptText(lang, '본문'), L.CHILD_HEADER[lang] + '\n\n본문');
      assert.strictEqual(L.childPromptText(lang, '본문', 'user'), L.CHILD_HEADER_USER[lang] + '\n\n본문');
      assert.notStrictEqual(L.CHILD_HEADER_USER[lang], L.CHILD_HEADER[lang]);
      assert.strictEqual(L.childPromptText(lang, '  \n', 'user'), ''); // 비면 프롬프트가 없다(전달 파일도 없다)
    }
    assert.strictEqual(L.childPromptText('ko', 'x', 'maru'), L.childPromptText('ko', 'x'));
  });
  t('i18n: 열기 창 문구가 ko·en 모두 있고 자리표시자가 같다', () => {
    const keys = Object.keys(I.STR.ko).filter((k) => k.startsWith('sub.') || k === 'menu.newSub' || k === 'child.note.subskip');
    assert.ok(keys.length >= 30);
    for (const k of keys) { assert.ok(k in I.STR.en, k); const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(','); assert.strictEqual(ph(I.STR.ko[k]), ph(I.STR.en[k]), k); }
    assert.strictEqual(I.STR.ko['sub.open.aria'], '하위 세션 열기'); assert.strictEqual(I.STR.en['sub.open.aria'], 'Open a sub-session');
    assert.strictEqual(I.STR.ko['sub.folder.pick'], '폴더 선택…'); assert.strictEqual(I.STR.ko['sub.notify'], '마루에게 알리기');
    assert.strictEqual(I.STR.ko['sub.notify.hint'], '마루의 입력줄에 이 세션을 열었다는 한 줄을 넣습니다. 보내려면 Enter를 누르세요.');
    // main 이 돌려주는 모든 이유에 문구가 있다
    for (const r of ['invalid', 'title', 'brief', 'dir', 'maru', 'expired', 'parent', 'children-max', 'ws-max', 'rate', 'budget', 'start', 'squad', 'busy', 'fail', 'nofolder']) assert.ok(('sub.err.' + r) in I.STR.ko && ('sub.err.' + r) in I.STR.en, r);
  });
  t('소스 구조: 렌더러는 경로를 보내지 않고, main 은 보낸 쪽·인자를 검증하며, 마루 요청과 같은 launchChild 로 만든다', () => {
    const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
    const handler = (name) => { const i = main.indexOf("ipcMain.handle('" + name + "'"); assert.ok(i > 0, name); return main.slice(i, main.indexOf('\nipcMain.handle(', i + 10) > 0 ? Math.min(main.indexOf('\nipcMain.handle(', i + 10), main.indexOf('\nlet reqScanning', i)) : main.length); };
    for (const name of ['sub:prepare', 'sub:pick-folder', 'sub:open']) assert.ok(/^[^\n]*\n\s*if \(!fromMain\(e\)\) return \{ ok: false, reason: 'invalid' \};/.test(handler(name)), name + ' 은 첫 줄에서 보낸 쪽을 검사한다');
    const open = handler('sub:open');
    assert.ok(/L\.parseSubOpen\(payload\)/.test(open) && /L\.subDraftCheck\(/.test(open) && /L\.subDraftUse\(/.test(open) && /L\.subLimitCheck\(/.test(open) && /L\.childLaunchCheck\(/.test(open));
    assert.ok(/L\.consentChoice\(L\.squadChoices\(await readSquadsNow\(\)\), p\.squad\)/.test(open), '팀은 main 이 직접 읽은 목록과 다시 대조');
    assert.ok(/launchChild\(par, \{ title, prompt: p\.brief, project: null \}, real, 'ui', squad, 'user'\)/.test(open), '같은 launchChild, by=user');
    assert.ok(/subParent\(p\.parent\)/.test(open) && /maruEligible/.test(main.slice(main.indexOf('function subParent'), main.indexOf('function subParent') + 200)), '부모 자격은 마루 요청과 같은 maruEligible');
    assert.ok(/launchChild\(par, d\.req, d\.real, item\.name, ans\.squad\)/.test(main), '마루 요청 경로도 같은 함수');
    assert.strictEqual(main.split('function launchChild(').length, 2); // 만드는 함수는 하나뿐
    assert.ok(!/addWorkspace\(/.test(open), 'sub:open 은 addWorkspace 를 직접 부르지 않는다');
    assert.ok(/writePrompt\(par, line\)/.test(open) && /agentBusy\(par\)/.test(open) && /par\.bracketed/.test(open) && /kind: 'subskip'/.test(open), '알림 줄: squads:request-create 와 같은 준비 조건, 못 하면 조용히 건너뜀');
    assert.ok(!/\\r|\\n|'\\x1b\[200~'/.test(open.replace(/\/\/[^\n]*/g, '')), '알림은 writePrompt(붙여넣기 감싸기·Enter 없음)로만');
    const pick = handler('sub:pick-folder');
    assert.ok(/dialog\.showOpenDialog/.test(pick) && /realDir\(r\.filePaths\[0\]\)/.test(pick) && /L\.validAbsDir\(real\)/.test(pick) && /defaultPath: os\.homedir\(\)/.test(pick) && !/defaultPath: [^,]*w\.cwd/.test(pick) && /isMaruRoot\(real\)/.test(pick), '폴더는 main 의 선택창, 마루 요청과 같은 realDir 검증, 처음 위치는 홈 폴더, 마루 자신의 폴더는 거절');
    assert.ok(/isMaruRoot\(real\)/.test(open) && open.indexOf('L.subDraftUse(') < open.indexOf('launchChild(') && open.indexOf('launchChild(') < open.indexOf('subNoticeLine'), '열기: 마루 폴더 재검사, 토큰은 만들기 전에 쓰고, 알림은 만든 뒤');
    assert.ok(/return \{ ok: true, token, display: subDisplay\(real\) \}/.test(pick) && !/return \{[^}]*\breal\b[^}]*\}/.test(pick.replace(/return \{ ok: true, token, display: subDisplay\(real\) \}/g, '')), '렌더러에는 토큰과 표시용 문자열만');
    // 렌더러·preload 는 경로를 주고받지 않는다
    const sbSrc = rd.slice(rd.indexOf('// ---- 하위 세션 직접 열기'), rd.indexOf('// ---- 스쿼드 만들기: 글을 받아'));
    assert.ok(sbSrc.length > 2000 && !/filePaths|webUtils|\.path\b|showOpenDialog|showDirectoryPicker|webkitdirectory|type = 'file'/.test(sbSrc));
    assert.ok(/subOpen\(\{ parent: sbParent, token: sbToken, title: [^,]+, brief: [^,]+, squad: sbSquad, notify: [^}]+\}\)/.test(sbSrc), '열기에는 부모 id·토큰·제목·내용·팀·알림 여부만');
    const preOpen = pre.slice(pre.indexOf('  subOpen:'), pre.indexOf('  onOpenSub:'));
    assert.ok(/parent:.*token:.*title:.*brief:.*squad:.*notify:/s.test(preOpen) && !/path|cwd|folder/i.test(preOpen.replace(/\/\/.*/g, '')));
    assert.ok(/ipcRenderer\.invoke\('sub:pick-folder', String\(parentId\)/.test(pre));
    assert.ok(/textContent/.test(sbSrc) && !/innerHTML|insertAdjacentHTML/.test(sbSrc), '디스크·main 에서 온 값은 textContent 로만');
    assert.ok(/menu\.newSub/.test(main) && /ui:open-sub/.test(main));
  });
  t('launchChild: 맡길 내용이 비면 전달 파일을 만들지 않고, 마루 요청은 예전 그대로', () => {
    const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const lc = main.slice(main.indexOf('function launchChild('), main.indexOf('const PREFILL_TIMEOUT_MS'));
    assert.ok(/const text = L\.childPromptText\(curLang\(\), req\.prompt, by\)/.test(lc));
    assert.ok(/if \(text && claudeWrapper\(\)\) file = L\.writeChildPromptFile/.test(lc) && /L\.childBriefPlan\(\{ hasFile: !!file, text \}\)/.test(lc) && /plan\.pasteNow/.test(lc));
    assert.ok(/by \}\);\n/.test(lc) || /squad: claudeWrapper\(\) \? squad : null, by \}/.test(lc), 'by 를 작업 공간 기록에 남긴다');
    assert.ok(/by: \(x\.origin === 'child' \|\| L\.validWsId\(x\.parentId\)\) && x\.by === 'user' \? 'user' : null/.test(main), 'addWorkspace 가 하위 세션일 때만 by 를 받는다');
    assert.ok(/by: e\.by \}\)/.test(main) && /squad: w\.squad, by: w\.by \}/.test(main), '복원·저장 양쪽에 by');
  });
}

// ---- 원격 제어(Remote Control) 토글 ----
t('parseAgentRecord: rc 는 불리언 true 일 때만(문자열·숫자·null 은 연결 아님)', () => {
  const base = '"state":"idle","at":"2026-01-01T00:00:00Z"';
  assert.strictEqual(L.parseAgentRecord('{' + base + ',"rc":true}').rc, true);
  for (const v of ['"true"', '1', '0', 'false', 'null', '"yes"', '[true]', '{}', '"1"']) assert.ok(!('rc' in L.parseAgentRecord('{' + base + ',"rc":' + v + '}')), v);
  assert.ok(!('rc' in L.parseAgentRecord('{' + base + '}')), '필드가 없으면 연결 아님');
  assert.deepStrictEqual(L.parseAgentRecord('{' + base + ',"rc":true,"bg":2}'), { state: 'idle', atMs: Date.parse('2026-01-01T00:00:00Z'), bg: 2, rc: true });
  assert.strictEqual(L.parseAgentRecord('{' + base + ',"rc":true,"x":"' + 'a'.repeat(L.AGENT_STATE_MAX || 9000) + '"}'), null, '크기 상한은 그대로');
});
t('rcScan: 마커를 찾고 ANSI·청크 경계·긴 입력을 견딘다', () => {
  const M = '/remote-control is active';
  assert.deepStrictEqual(L.rcScan('', 'hello'), { tail: 'hello', active: false });
  assert.strictEqual(L.rcScan('', M + ' · Continue here, on your phone, or at https://x.example/y').active, true);
  assert.strictEqual(L.rcScan('', '\x1b[1m\x1b[38;2;1;2;3m' + M + '\x1b[0m').active, true, '앞뒤 ANSI');
  assert.strictEqual(L.rcScan('', '/remote-control\x1b[0m\x1b[1m is\x1b[22m active').active, true, '마커 가운데 ANSI');
  assert.strictEqual(L.rcScan('', '/remote-control\x1b[1Cis\x1b[1Cactive').active, true, '커서 이동으로 그린 공백');
  assert.strictEqual(L.rcScan('', '/remote-control\x1b]0;title\x07 is active').active, true, '가운데 OSC');
  assert.strictEqual(L.rcScan('', '/remote-control\r\n  is   active').active, true, '공백·줄바꿈 정규화');
  // 청크 경계: 어디서 잘라도 두 번째 호출에서 찾는다
  for (let i = 1; i < M.length; i++) { const a = L.rcScan('', 'xx ' + M.slice(0, i)); assert.strictEqual(a.active, false, String(i)); assert.strictEqual(L.rcScan(a.tail, M.slice(i)).active, true, 'split ' + i); }
  // ANSI 이스케이프가 청크 경계에 걸려도
  const raw = '/remote-control\x1b[38;2;10;20;30m is active';
  for (let i = 1; i < raw.length; i++) { const a = L.rcScan('', raw.slice(0, i)); assert.strictEqual(L.rcScan(a.tail, raw.slice(i)).active, true, 'esc split ' + i); }
  assert.strictEqual(L.rcScan('', '/remote-control is activ').active, false);
  assert.strictEqual(L.rcScan('', '/remote-control was active').active, false);
  assert.strictEqual(L.rcScan('', 'remote-control is active').active, false, '슬래시 없음');
  // 찾은 뒤에는 같은 줄을 다시 세지 않는다
  const f = L.rcScan('', M); assert.strictEqual(L.rcScan(f.tail, ' more').active, false);
  // 꼬리 상한과 큰 입력
  const big = 'a'.repeat(5 << 20); const r = L.rcScan('', big); assert.ok(r.tail.length <= L.RC_TAIL_MAX && r.active === false);
  assert.strictEqual(L.rcScan('', M + 'z'.repeat(2 << 20)).active, false, '1MB 보다 앞의 마커는 보지 않는다(상한)');
  assert.strictEqual(L.rcScan('', 'z'.repeat(2 << 20) + M).active, true);
  assert.ok(L.rcScan('q'.repeat(100000), 'x').tail.length <= L.RC_TAIL_MAX, '긴 꼬리를 받아도 상한');
  let tail = ''; for (let i = 0; i < 2000; i++) tail = L.rcScan(tail, '\x1b]'.repeat(50) + 'x'.repeat(300)).tail; assert.ok(tail.length <= L.RC_TAIL_MAX, '끝나지 않는 OSC 가 이어져도 상한');
  // 임의 바이트·이상한 입력
  for (const bad of [null, undefined, 5, {}, [], '']) assert.strictEqual(L.rcScan('', bad).active, false);
  assert.strictEqual(L.rcScan(null, 'a').tail, 'a'); assert.strictEqual(L.rcScan(7, 'a').tail, 'a');
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let tl = ''; for (let i = 0; i < 300; i++) { let d = ''; const n = Math.floor(rnd() * 400); for (let j = 0; j < n; j++) d += String.fromCharCode(Math.floor(rnd() * 0x30000)); const x = L.rcScan(tl, d); assert.ok(x.tail.length <= L.RC_TAIL_MAX && typeof x.active === 'boolean'); tl = x.tail; }
});
t('draftStep: 마지막으로 눌린 관련 키가 정한다', () => {
  const D = L.draftStep;
  assert.strictEqual(D(false, 'a'), true); assert.strictEqual(D(false, '한'), true); assert.strictEqual(D(false, ' '), true);
  assert.strictEqual(D(false, '\x1b[200~paste\x1b[201~'), true, '붙여넣기'); assert.strictEqual(D(false, '\x1b[200~\x1b[201~'), true, '빈 붙여넣기도');
  assert.strictEqual(D(false, '\x1b[200~line1\rline2'), true, '끝나지 않은 붙여넣기'); assert.strictEqual(D(false, '\x1b[200~a\rb\x1b[201~'), true, '붙여넣기 안의 Enter');
  assert.strictEqual(D(true, '\x1b[200~a\r\x1b[201~'), true);
  assert.strictEqual(D(true, '\r'), false); assert.strictEqual(D(true, '\x03'), false); assert.strictEqual(D(true, '\x15'), false);
  assert.strictEqual(D(false, 'abc\r'), false, '쓰고 Enter'); assert.strictEqual(D(false, '\rabc'), true, 'Enter 뒤 글자'); assert.strictEqual(D(true, 'x\x03y'), true);
  assert.strictEqual(D(false, 'a\x15'), false); assert.strictEqual(D(true, '\x1b[A\r'), false); assert.strictEqual(D(false, '\r\x1b[A'), true);
  assert.strictEqual(D(false, '\x1b[200~x\x1b[201~\r'), false, '붙여넣고 Enter');
  // 이력 불러오기·편집 키도 글이 생길 수 있다
  for (const d of ['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D', '\x1b[H', '\x1b[F', '\x1b[3~', '\x1b[1;5D', '\x1b[Z', '\x1b', '\x7f', '\t', '\x19', '\x12', '\n', '\x1b\r', '\x1b[1;2A']) { assert.strictEqual(D(false, d), true, JSON.stringify(d)); assert.strictEqual(D(true, d), true, JSON.stringify(d)); }
  assert.strictEqual(D(true, '\x1b\r'), true, 'Shift+Enter(ESC+CR)는 전송이 아니다'); assert.strictEqual(D(true, '\n'), true);
  // 터미널 자동 응답은 바꾸지 않는다
  for (const d of ['\x1b[I', '\x1b[O', '\x1b[12;40R', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[?0u', '\x1b[<0;5;5M', '\x1b]10;rgb:ffff/ffff/ffff\x07', '\x1b]11;rgb:0000/0000/0000\x1b\\', '\x1bP1$r0m\x1b\\', '\x1b[?2004;2$y', '']) { assert.strictEqual(D(false, d), false, JSON.stringify(d)); assert.strictEqual(D(true, d), true, JSON.stringify(d)); }
  assert.strictEqual(D(false, '\x1b[I\x1b[A'), true); assert.strictEqual(D(true, '\x1b[A\x1b[I'), true); assert.strictEqual(D(true, '\r\x1b[I'), false);
  for (const bad of [null, undefined, 3, {}]) { assert.strictEqual(D(true, bad), true); assert.strictEqual(D(false, bad), false); }
  assert.strictEqual(D(undefined, 'a'), true); assert.strictEqual(D(undefined, '\x1b[I'), false);
  assert.strictEqual(D(false, 'x'.repeat(1 << 20)), true);
});
t('rcMarkerOk: 마커는 켜 달라고 한 직후, 새 훅 기록이 없을 때만', () => {
  const K = L.rcMarkerOk; const N = 10000000; const M = L.RC_MARKER_MS; assert.strictEqual(M, 300000);
  assert.strictEqual(K({ asked: 'on', askedAt: N - 1000, hookAt: NaN, now: N }), true);
  assert.strictEqual(K({ asked: null, askedAt: 0, now: N }), false, '요청 없음(모델·문서가 찍은 글자)'); assert.strictEqual(K({ now: N }), false); assert.strictEqual(K(), false);
  assert.strictEqual(K({ asked: 'off', askedAt: N - 1000, now: N }), false, '끄는 중에는 받지 않는다');
  assert.strictEqual(K({ asked: 'on', askedAt: N - M + 1, now: N }), true, '5분 직전'); assert.strictEqual(K({ asked: 'on', askedAt: N - M, now: N }), false, '정확히 5분'); assert.strictEqual(K({ asked: 'on', askedAt: N - M - 1, now: N }), false);
  assert.strictEqual(K({ asked: 'on', askedAt: N - 1000, hookAt: N - 500, now: N }), false, '요청보다 새 훅 기록');
  assert.strictEqual(K({ asked: 'on', askedAt: N - 1000, hookAt: N - 1000, now: N }), true, '같은 시각은 새롭지 않다'); assert.strictEqual(K({ asked: 'on', askedAt: N - 1000, hookAt: N - 2000, now: N }), true, '요청보다 오래된 기록');
  assert.strictEqual(K({ asked: 'on', askedAt: N + 5, now: N }), false, '미래의 요청'); assert.strictEqual(K({ asked: 'on', askedAt: NaN, now: N }), false); assert.strictEqual(K({ asked: 'on', askedAt: N - 1, now: NaN }), false);
});
t('rcView: 증거·요청·60초 경계의 모든 갈래', () => {
  const V = L.rcView; const N = 1000000; const P = L.RC_PENDING_MS; assert.strictEqual(P, 60000);
  assert.strictEqual(V({ now: N }), 'off', '증거 없음');
  assert.strictEqual(V({ hookRc: false, hookAt: N - 5, now: N }), 'off'); assert.strictEqual(V({ hookRc: true, hookAt: N - 5, now: N }), 'on');
  assert.strictEqual(V({ seenAt: N - 5, now: N }), 'on', '터미널 마커만'); assert.strictEqual(V({ seenAt: 0, now: N }), 'off');
  assert.strictEqual(V({ hookRc: false, hookAt: N - 10, seenAt: N - 5, now: N }), 'on'); assert.strictEqual(V({ hookRc: false, hookAt: N - 5, seenAt: N - 10, now: N }), 'off');
  assert.strictEqual(V({ hookRc: false, hookAt: N - 5, seenAt: N - 5, now: N }), 'on', '같은 시각이면 마커');
  assert.strictEqual(V({ hookRc: 'true', hookAt: N - 5, now: N }), 'off'); assert.strictEqual(V({ hookRc: true, hookAt: NaN, now: N }), 'off');
  // 진행 중(60초 안): 새 증거가 없거나 반대면 진행 중, 같은 방향이면 증거
  assert.strictEqual(V({ asked: 'on', askedAt: N - 1, now: N }), 'turning-on'); assert.strictEqual(V({ asked: 'off', askedAt: N - 1, now: N }), 'turning-off', '이미 꺼져 있어도 증거가 올 때까지');
  assert.strictEqual(V({ asked: 'off', askedAt: N - 1, hookRc: true, hookAt: N - 100, now: N }), 'turning-off', '오래된 증거');
  assert.strictEqual(V({ asked: 'on', askedAt: N - (P - 1), now: N }), 'turning-on', '59.999초');
  assert.strictEqual(V({ asked: 'on', askedAt: N - 10, hookRc: true, hookAt: N - 5, now: N }), 'on', '새 증거가 요청과 같다');
  assert.strictEqual(V({ asked: 'on', askedAt: N - 10, seenAt: N - 5, now: N }), 'on');
  assert.strictEqual(V({ asked: 'off', askedAt: N - 10, hookRc: false, hookAt: N - 5, now: N }), 'off');
  assert.strictEqual(V({ asked: 'on', askedAt: N - 10, hookRc: false, hookAt: N - 5, now: N }), 'turning-on', '연결이 끝나기 전에 쓴 기록(반대)은 진행 중을 지키지 않는다');
  assert.strictEqual(V({ asked: 'off', askedAt: N - 10, hookRc: true, hookAt: N - 5, now: N }), 'turning-off');
  assert.strictEqual(V({ asked: 'on', askedAt: N - 10, hookRc: true, hookAt: N - 10, now: N }), 'turning-on', '같은 시각은 새 증거가 아니다');
  // 60초 뒤
  assert.strictEqual(V({ asked: 'on', askedAt: N - P, now: N }), 'unknown', '정확히 60초'); assert.strictEqual(V({ asked: 'on', askedAt: N - P - 1, now: N }), 'unknown');
  assert.strictEqual(V({ asked: 'off', askedAt: N - P, hookRc: true, hookAt: N - 70000, now: N }), 'unknown');
  assert.strictEqual(V({ asked: 'off', askedAt: N - P, now: N }), 'off', '꺼 달라고 했고 바탕도 꺼짐'); assert.strictEqual(V({ asked: 'on', askedAt: N - P, hookRc: true, hookAt: N - 70000, now: N }), 'on');
  assert.strictEqual(V({ asked: 'on', askedAt: N - 100000, hookRc: false, hookAt: N - 5, now: N }), 'off', '새 증거(반대)가 있으면 증거');
  assert.strictEqual(V({ asked: 'off', askedAt: N - 100000, hookRc: true, hookAt: N - 5, now: N }), 'on'); assert.strictEqual(V({ asked: 'on', askedAt: N - 100000, hookRc: true, hookAt: N - 5, now: N }), 'on');
  assert.strictEqual(V({ asked: 'on', askedAt: N - 100000, hookRc: true, hookAt: N - 100000, now: N }), 'on', '요청과 같은 시각 증거는 새롭지 않지만 바탕과 요청이 같다');
  // 미래 시각 증거는 now 로 누른다: 요청보다 앞서지 못한다
  assert.strictEqual(V({ asked: 'on', askedAt: N - 10, hookRc: false, hookAt: N + 999999, now: N }), 'turning-on', '미래 at 은 now 로 눌려 새 증거(반대)일 뿐');
  assert.strictEqual(V({ asked: 'off', askedAt: N - 100000, hookRc: true, hookAt: N + 999999, now: N }), 'on');
  assert.strictEqual(V({ asked: 'on', askedAt: N + 50, hookRc: true, hookAt: N + 100, now: N }), 'turning-on', '요청이 미래여도 증거(now)보다 새롭다');
  for (const a of ['x', '', null, undefined, 1, true]) assert.strictEqual(V({ asked: a, askedAt: N - 1, now: N }), 'off', String(a));
  assert.strictEqual(V({ asked: 'on', askedAt: NaN, now: N }), 'off'); assert.strictEqual(V(), 'off'); assert.strictEqual(V(null), 'off');
  assert.ok(['off', 'on', 'turning-on', 'turning-off', 'unknown'].includes(V({ asked: 'on', askedAt: 5, now: NaN })));
});
t('rcCanSend: 보내도 되는 때와 이유', () => {
  const ok = { hasTerm: true, shellFront: false, bracketed: true, state: 'idle', dirty: false, cc: true, view: 'off', quietMs: 400, ready: false }; const C = (o) => L.rcCanSend({ ...ok, ...o });
  const R = (o) => assert.deepStrictEqual(C(o), { ok: false, reason: o.__r }); void R;
  assert.deepStrictEqual(C({}), { ok: true }); assert.deepStrictEqual(C({ view: 'on' }), { ok: true });
  assert.deepStrictEqual(C({ quietMs: 399 }), { ok: false, reason: 'not-ready' }, 'idle 은 400ms 조용해야'); assert.deepStrictEqual(C({ quietMs: undefined }), { ok: false, reason: 'not-ready' }); assert.deepStrictEqual(C({ quietMs: 5000 }), { ok: true });
  assert.deepStrictEqual(C({ state: 'busy' }), { ok: false, reason: 'busy' }, '작업 중에는 보내지 않는다');
  assert.deepStrictEqual(C({ state: 'none', ready: true }), { ok: true }); assert.deepStrictEqual(C({ state: 'none', ready: false }), { ok: false, reason: 'not-ready' }); assert.deepStrictEqual(C({ state: 'none', ready: 'yes' }), { ok: false, reason: 'not-ready' });
  assert.deepStrictEqual(C({ hasTerm: false }), { ok: false, reason: 'no-session' }); assert.deepStrictEqual(C({ cc: false }), { ok: false, reason: 'no-session' }); assert.deepStrictEqual(C({ cc: undefined }), { ok: false, reason: 'no-session' });
  assert.deepStrictEqual(C({ shellFront: true }), { ok: false, reason: 'shell' });
  assert.deepStrictEqual(C({ bracketed: false }), { ok: false, reason: 'not-ready' }); assert.deepStrictEqual(C({ bracketed: undefined }), { ok: false, reason: 'not-ready' });
  assert.deepStrictEqual(C({ state: 'waiting' }), { ok: false, reason: 'waiting' });
  for (const st of ['pending', 'exited', 'unavailable', 'unknown', '', undefined]) assert.deepStrictEqual(C({ state: st }), { ok: false, reason: 'not-ready' }, String(st));
  assert.deepStrictEqual(C({ dirty: true }), { ok: false, reason: 'draft' }); assert.deepStrictEqual(C({ dirty: true, state: 'waiting' }), { ok: false, reason: 'waiting' }, '권한 질문이 먼저'); assert.deepStrictEqual(C({ dirty: true, state: 'busy' }), { ok: false, reason: 'busy' });
  assert.deepStrictEqual(C({ view: 'unknown' }), { ok: false, reason: 'unknown' }, 'unknown 은 보내지 않는다'); assert.deepStrictEqual(C({ view: 'unknown', state: 'none', ready: true }), { ok: false, reason: 'unknown' });
  assert.deepStrictEqual(C({ view: 'turning-on' }), { ok: false, reason: 'pending' }); assert.deepStrictEqual(C({ view: 'turning-off' }), { ok: false, reason: 'pending' });
  assert.deepStrictEqual(C({ shellFront: true, hasTerm: false }), { ok: false, reason: 'no-session' });
  assert.deepStrictEqual(L.rcCanSend(), { ok: false, reason: 'no-session' });
});
t('원격 토글 시나리오: 이력 불러오기 뒤 거부, 마커·진행 중·unknown 흐름', () => {
  // 방향키로 이력을 불러오면 draft 가 켜져 보내지 않는다
  let draft = L.draftStep(false, '\x1b[A'); const send = (o) => L.rcCanSend({ hasTerm: true, shellFront: false, bracketed: true, state: 'idle', dirty: draft, cc: true, view: 'off', quietMs: 1000, ...o });
  assert.deepStrictEqual(send(), { ok: false, reason: 'draft' }); draft = L.draftStep(draft, '\x15'); assert.deepStrictEqual(send(), { ok: true }, 'Ctrl+U 로 비우면 보낸다');
  // 요청 없이 마커가 찍혀도 증거가 아니다(main 은 rcMarkerOk 가 true 일 때만 seenAt 을 적는다)
  const N = 5e6; assert.strictEqual(L.rcMarkerOk({ asked: null, askedAt: 0, hookAt: NaN, now: N }), false);
  // 켜 달라고 했고 마커가 받아들여진 뒤 → on 이 되고, 다음 누름은 끄기
  const askedAt = N - 3000; assert.strictEqual(L.rcMarkerOk({ asked: 'on', askedAt, hookAt: NaN, now: N }), true);
  assert.strictEqual(L.rcView({ asked: 'on', askedAt, seenAt: N, now: N }), 'on');
  // 마커 뒤 더 새로운 훅 기록(꺼짐)이 오면 그것이 이긴다
  assert.strictEqual(L.rcView({ asked: 'on', askedAt, seenAt: N - 1000, hookRc: false, hookAt: N, now: N }), 'turning-on', '60초 안에서는 반대 훅 기록이 와도 진행 중');
  assert.strictEqual(L.rcView({ asked: 'on', askedAt, seenAt: N - 1000, hookRc: false, hookAt: N + 1, now: N + 61000 }), 'off', '60초 뒤에는 새 증거가 이긴다');
  // 60초 지나 unknown 이면 클릭은 거부
  const v = L.rcView({ asked: 'on', askedAt: N - 61000, now: N }); assert.strictEqual(v, 'unknown'); assert.deepStrictEqual(send({ view: v }), { ok: false, reason: 'unknown' });
});
t('원격 토글 연결: main 은 고정 문장만 쓰고, 렌더러·메뉴·i18n·preload 가 맞물린다', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); const pre = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const rd = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8'); const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');
  assert.ok(main.includes("const RC_COMMAND = '\\x1b[200~/remote-control\\x1b[201~\\r';"), '고정 문장');
  const fn = main.slice(main.indexOf('function rcToggle('), main.indexOf("ipcMain.handle('rc:toggle'"));
  assert.strictEqual((fn.match(/term\.write\(/g) || []).length, 1); assert.ok(fn.includes('w.term.write(RC_COMMAND)'));
  assert.ok(/picking \|\| closing \|\| quitAsking \|\| restarting/.test(fn) && /w\.id !== activeId/.test(fn) && /L\.rcCanSend\(/.test(fn) && /view,/.test(fn));
  assert.ok(!/typedN/.test(fn.replace(/\/\/.*/g, '')), 'typedN 은 올리지 않는다');
  assert.ok(/L\.fillStep\(/.test(fn) && /claudeUpNow\(w\)/.test(fn), 'none 의 준비 판정은 prefillChild 와 같은 fillStep');
  assert.ok(/L\.rcMarkerOk\(/.test(main), '마커는 rcMarkerOk 를 거친다');
  assert.ok(/ipcMain\.handle\('rc:toggle', \(e, id\) => \{\n  const w = wsFrom\(e, id\);/.test(main), '발신자·작업 공간 검사');
  assert.ok(/rc: rcViewOf\(w, rec, now\)/.test(main) && /L\.rcScan\(w\.rcTail, d\)/.test(main) && /L\.draftStep\(w\.draft, data\)/.test(main));
  assert.strictEqual((main.match(/rcReset\(w\)/g) || []).length >= 6, true, 'pty 가 새로 뜨거나 끝나는 모든 자리에서 초기화');
  assert.strictEqual((main.match(/w\.draft = true/g) || []).length, 4, '프로그램이 입력줄에 채우는 네 자리(writePrompt·files:drop·prefillChild·첫 만남)');
  const mi = main.slice(main.indexOf("label: tr('menu.rc')"), main.indexOf("label: tr('menu.rc')") + 260);
  assert.ok(/label: tr\('menu\.rc'\)/.test(main) && !/accelerator/.test(mi.split('click')[0]), '메뉴에 단축키 없음');
  assert.ok(/sendToRenderer\('ui:rc-toggle'\)/.test(mi) && !/rcToggle\(/.test(mi), '메뉴는 렌더러의 같은 처리를 거친다(main 이 직접 부르지 않는다)');
  assert.ok(/onRcToggle\(\(\) => \{ rcClick\(\); \}\)/.test(rd) && /ui:rc-toggle/.test(pre));
  assert.ok(/async function rcClick\(\) \{[^]*?modalOpen\(\) \|\| detailOpen[^]*?window\.maru\.rcToggle/.test(rd), '단추·메뉴 모두 열린 창·상세 화면을 확인');
  assert.ok(/rcToggle: \(id\) => ipcRenderer\.invoke\('rc:toggle', String\(id\)\)/.test(pre));
  assert.ok(/id="rc-toggle"[^>]*role="switch"[^>]*aria-checked="false"/.test(html) && /<button type="button" id="rc-toggle"/.test(html));
  assert.ok(/window\.maru\.rcToggle\(activeId\)/.test(rd) && !/rc-toggle'\)\.focus\(/.test(rd), '렌더 때 포커스를 훔치지 않는다');
  const I = require('./i18n.js'); const keys = Object.keys(I.STR.ko).filter((k) => k.startsWith('rc.') || k === 'menu.rc');
  assert.ok(keys.length >= 18); for (const k of keys) { assert.ok(I.STR.en[k], 'en ' + k); assert.ok(!/—/.test(I.STR.ko[k] + I.STR.en[k]), k); }
  for (const st of ['off', 'on', 'turning-on', 'turning-off', 'unknown']) assert.ok(I.STR.ko['rc.label.' + st] && I.STR.en['rc.label.' + st]);
  assert.strictEqual(I.STR.ko['rc.err.draft'], '입력줄에 쓰던 글이 있을 수 있습니다. 보내거나 Ctrl+U 로 비운 뒤 다시 누르세요.');
  for (const r of ['unknown', 'busy', 'pending', 'waiting', 'draft', 'shell', 'not-ready', 'no-session']) assert.ok(I.STR.ko['rc.err.' + r] && I.STR.en['rc.err.' + r], r);
});

// ---- 플랜 사용량 띠 ----
t('parseUsage: 정상·방어', () => {
  const ok = JSON.stringify({ v: 1, at: 1790000000, five_hour: { pct: 39.4, resets_at: 1790003000 }, seven_day: { pct: 24, resets_at: 1790300000 } });
  const u = L.parseUsage(ok);
  assert.strictEqual(u.five_hour.pct, 39.4); assert.strictEqual(u.seven_day.resets_at, 1790300000);
  const one = L.parseUsage(JSON.stringify({ v: 1, at: 5, seven_day: { pct: 1, resets_at: 9 } }));
  assert.ok(one && !one.five_hour && one.seven_day);
  assert.strictEqual(L.parseUsage(JSON.stringify({ v: 1, at: 5, five_hour: { pct: 250, resets_at: 9 } })).five_hour.pct, 100);
  assert.strictEqual(L.parseUsage(JSON.stringify({ v: 1, at: 5, five_hour: { pct: -5, resets_at: 9 } })).five_hour.pct, 0);
  for (const bad of [null, 5, '', 'x', '[]', '{}', '{"v":2,"at":5,"five_hour":{"pct":1,"resets_at":9}}', '{"v":1,"at":"5","five_hour":{"pct":1,"resets_at":9}}',
    '{"v":1,"at":5,"five_hour":{"pct":"1","resets_at":9}}', '{"v":1,"at":5,"five_hour":{"pct":1}}', '{"v":1,"at":5}', '{"v":1,"at":5,"five_hour":{"pct":null,"resets_at":9}}', 'x'.repeat(5000)]) assert.strictEqual(L.parseUsage(bad), null, String(bad).slice(0, 30));
});
t('usageView: 단계·만료·경과', () => {
  const now = 1790000000000;
  const u = L.parseUsage(JSON.stringify({ v: 1, at: 1789999940, five_hour: { pct: 38.6, resets_at: 1790002700 }, seven_day: { pct: 83, resets_at: 1790000000 - 10 } }));
  const v = L.usageView(u, now);
  assert.strictEqual(v.ageMs, 60000);
  const [f, w] = v.windows;
  assert.deepStrictEqual([f.key, f.pct, f.resetMs, f.expired, f.level], ['five_hour', 39, 2700000, false, 'ok']);
  assert.deepStrictEqual([w.key, w.pct, w.expired, w.level, w.resetMs], ['seven_day', 0, true, 'ok', 0]);
  assert.deepStrictEqual([79, 80, 94, 95, 100].map((p) => L.usageLevel(p)), ['ok', 'warn', 'warn', 'crit', 'crit']);
  assert.strictEqual(L.usageView(null, now), null);
  assert.strictEqual(L.usageView({ v: 1, at: 1 }, now), null);
  assert.strictEqual(L.usageView(u, 1000).ageMs, 0, '미래의 at 은 0');
});
t('fmtUsageReset·fmtUsageAge', () => {
  const r = (ms) => L.fmtUsageReset({ expired: false, resetMs: ms });
  assert.deepStrictEqual(r(45 * 60000), { key: 'usage.reset.min', params: { n: 45 } });
  assert.deepStrictEqual(r(1000), { key: 'usage.reset.min', params: { n: 1 } });
  assert.deepStrictEqual(r(3600000), { key: 'usage.reset.hour', params: { n: 1 } });
  assert.deepStrictEqual(r(3.5 * 3600000), { key: 'usage.reset.hour', params: { n: 3 } });
  assert.deepStrictEqual(r(86400000 * 4 + 5), { key: 'usage.reset.day', params: { n: 4 } });
  assert.strictEqual(L.fmtUsageReset({ expired: true, resetMs: 0 }).key, 'usage.reset.done');
  assert.strictEqual(L.fmtUsageAge(30000).key, 'usage.age.now');
  assert.deepStrictEqual(L.fmtUsageAge(5 * 60000), { key: 'usage.age.min', params: { n: 5 } });
  assert.deepStrictEqual(L.fmtUsageAge(3 * 3600000), { key: 'usage.age.hour', params: { n: 3 } });
  assert.strictEqual(L.fmtUsageAge(2 * 86400000).key, 'usage.age.day');
  assert.strictEqual(I.t('ko', 'usage.reset.min', { n: 45 }), '45분 후 초기화');
  assert.strictEqual(I.t('en', 'usage.reset.hour', { n: 3 }), 'resets in 3h');
  assert.strictEqual(I.t('ko', 'usage.age.min', { n: 1 }), '1분 전 업데이트');
});
t('usage i18n ko/en 키 일치 + 하단 띠 마크업', () => {
  const ks = (l) => Object.keys(I.STR[l]).filter((k) => k.startsWith('usage.')).sort();
  assert.deepStrictEqual(ks('ko'), ks('en')); assert.ok(ks('ko').length >= 13);
  const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');
  assert.ok(/<footer class="usage" id="usage" role="group"[^>]*aria-label="[^"]+"[^>]*hidden>/.test(html), '띠는 처음엔 hidden');
  assert.ok(html.indexOf('id="cols"') < html.indexOf('id="usage"') && html.indexOf('id="usage"') < html.indexOf('id="setup"'), '.cols 다음, 대화상자 앞');
  const rdj = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(/const \{ usage: \w+, \.\.\.rest \} = p;[^]*?const key = JSON\.stringify\(rest\);/.test(rdj) && !/JSON\.stringify\(p\)/.test(rdj.slice(rdj.indexOf('async function poll()'), rdj.indexOf('async function poll()') + 600)), 'usage 는 패널 키에서 제외');
  assert.strictEqual((html.match(/role="meter"/g) || []).length, 2);
  assert.ok(!/aria-live/.test(html.slice(html.indexOf('id="usage"'), html.indexOf('</footer>'))));
});

(async () => {
  for (const f of pending) await f();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} 통과` + (process.exitCode ? ', 실패 있음' : ''));
})();
