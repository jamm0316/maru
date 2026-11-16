'use strict';
// updater 테스트: 127.0.0.1 로컬 서버 + temp 디렉터리만 사용한다(실제 GitHub/ /Applications 접근 없음).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const net = require('net');
const U = require('./updater');
const SR = require('./tools/sign-release');

const CLT_GIT = '/Library/Developer/CommandLineTools/usr/bin/git';
const SCRATCH = '/private/tmp/claude-501/-Users-evan/6054e0aa-03e5-4050-b22e-c186ad026154/scratchpad';
fs.mkdirSync(SCRATCH, { recursive: true });
const TMP = fs.mkdtempSync(path.join(SCRATCH, 'updater-test-'));

// 네트워크 가드: 루프백 외 연결 시도를 기록하고 막는다
const violations = [];
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = args[0];
  let host = null;
  if (a && typeof a === 'object' && !Array.isArray(a)) host = a.path ? null : (a.host || 'localhost');
  else if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) host = typeof args[1] === 'string' ? args[1] : 'localhost';
  if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) { violations.push(host); throw new Error('non-loopback connection blocked: ' + host); }
  return origConnect.apply(this, args);
};

// 시험용 키 쌍(임시 디렉터리)
const PRIV = path.join(TMP, 'test.key');
const PUB = SR.keygen(PRIV);
const OTHER_PUB = SR.keygen(path.join(TMP, 'other.key'));
const signB64 = (text, priv = PRIV) => { const f = path.join(TMP, 'tmp-sums'); fs.writeFileSync(f, text); const o = SR.sign(priv, f, f + '.sig'); return fs.readFileSync(o, 'utf8').trim(); };
const PKG = path.join(TMP, 'pkg-key.json'); fs.writeFileSync(PKG, JSON.stringify({ maru: { updatePublicKey: PUB } }));

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const rejects = async (p, re, m) => { try { await p; } catch (e) { if (re && !re.test(e.message)) throw new Error(`${m || ''} wrong error: ${e.message}`); return; } throw new Error((m || '') + ' should reject'); };

// ---- 가짜 서버 ----
const DMG = crypto.randomBytes(300 * 1024);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const S = { release: null, sums: null, sigOverride: null, status: 200, bigApi: false, hits: 0 };
let base = '';
const server = http.createServer((req, res) => {
  const u = req.url; S.hits++;
  if (u === '/dl/sig') { res.writeHead(200); return res.end(S.sigOverride != null ? S.sigOverride : signB64(S.sums)); }
  if (u === '/repos/o/n/releases/latest') {
    if (S.bigApi) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(Buffer.alloc(2 * 1024 * 1024, 32)); }
    if (S.status !== 200) { res.writeHead(S.status); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(S.release));
  }
  if (u === '/dl/dmg') { res.writeHead(200, { 'content-length': DMG.length }); return res.end(DMG); }
  if (u === '/dl/sums') { res.writeHead(200); return res.end(S.sums); }
  if (u === '/hop1') { res.writeHead(302, { location: '/dl/dmg' }); return res.end(); }
  if (u === '/evil') { res.writeHead(302, { location: base.replace('127.0.0.1', 'localhost') + '/dl/dmg' }); return res.end(); }
  const m = /^\/loop\/(\d+)$/.exec(u);
  if (m) { res.writeHead(302, { location: '/loop/' + (+m[1] + 1) }); return res.end(); }
  res.writeHead(404); res.end();
});

const rel = (tag, over = {}) => ({
  tag_name: tag, body: ' notes ', assets: [
    { name: `Maru-${tag.replace(/^v/, '')}-arm64.dmg`, browser_download_url: base + '/dl/dmg', size: DMG.length },
    { name: 'SHA256SUMS', browser_download_url: base + '/dl/sums', size: 100 },
    { name: 'SHA256SUMS.sig', browser_download_url: base + '/dl/sig', size: 90 },
  ], ...over,
});
const mk = (extra = {}) => U._create({ apiBase: base, allowHosts: ['127.0.0.1'], allowHttp: true, gitCandidates: [CLT_GIT], pkgPath: PKG, tmpDir: TMP, stateDir: path.join(TMP, 'state'), trashDir: path.join(TMP, 'trash'), ...extra });
const setSlug = (s) => { if (s == null) delete process.env.MARU_UPDATE_REPO; else process.env.MARU_UPDATE_REPO = s; };
const goodSums = () => `${sha(DMG)}  Maru-1.2.3-arm64.dmg\n`;

// ---- git 헬퍼 ----
const GENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (dir, ...a) => execFileSync(CLT_GIT, ['-C', dir, ...a], { env: GENV, encoding: 'utf8' });
function commit(dir, file, text) { fs.writeFileSync(path.join(dir, file), text); g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', 'c ' + text); }
function gitFixture(name) {
  const root = path.join(TMP, name); fs.mkdirSync(root);
  const bare = path.join(root, 'up.git'); fs.mkdirSync(bare);
  g(bare, 'init', '-q', '--bare'); g(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const seed = path.join(root, 'seed'); execFileSync(CLT_GIT, ['clone', '-q', bare, seed], { env: GENV, stdio: 'ignore' });
  g(seed, 'checkout', '-q', '-b', 'main'); commit(seed, 'a.txt', '0'); g(seed, 'push', '-q', '-u', 'origin', 'main');
  const work = path.join(root, 'work'); execFileSync(CLT_GIT, ['clone', '-q', bare, work], { env: GENV, stdio: 'ignore' });
  return { root, bare, seed, work };
}

// ---- 확인 ----
test('unconfigured: 슬러그도 업스트림도 없음', async () => {
  setSlug(null);
  const r = await mk().checkForUpdates({ currentVersion: '0.1.0', repoRoot: TMP });
  eq(r.status, 'unconfigured'); eq(r.current, '0.1.0');
});
test('package.json maru.updateRepo 폴백', async () => {
  setSlug(null);
  const pk = path.join(TMP, 'pkg.json'); fs.writeFileSync(pk, JSON.stringify({ maru: { updateRepo: 'o/n', updatePublicKey: PUB } }));
  S.release = rel('v0.2.0'); S.status = 200;
  const r = await mk({ pkgPath: pk }).checkForUpdates({ currentVersion: '0.1.0' });
  eq(r.status, 'available');
});
test('잘못된 슬러그 → error', async () => {
  for (const s of ['evil', 'a/b/c', 'a b/c', '../x', 'o/..', '-o/n', 'o/n;rm']) {
    setSlug(s);
    const r = await mk().checkForUpdates({ currentVersion: '0.1.0' });
    eq(r.status, 'error', s);
  }
});
test('버전 비교: 새것/같음/오래됨', async () => {
  setSlug('o/n'); S.status = 200;
  S.release = rel('v0.2.0'); const a = await mk().checkForUpdates({ currentVersion: '0.1.0' });
  eq(a.status, 'available'); eq(a.latest, '0.2.0'); eq(a.notes, 'notes');
  S.release = rel('0.1.0'); eq((await mk().checkForUpdates({ currentVersion: '0.1.0' })).status, 'none');
  S.release = rel('0.0.9'); eq((await mk().checkForUpdates({ currentVersion: '0.1.0' })).status, 'none');
  S.release = rel('0.10.0'); eq((await mk().checkForUpdates({ currentVersion: '0.9.0' })).status, 'available', '숫자 비교');
});
test('notes 600자 제한', async () => {
  setSlug('o/n'); S.release = rel('0.2.0', { body: 'x'.repeat(2000) });
  eq((await mk().checkForUpdates({ currentVersion: '0.1.0' })).notes.length, 600);
});
test('semver 아닌 태그 → error', async () => {
  setSlug('o/n');
  for (const t of ['v1.2', '1.2.3-beta', 'latest', '1.2.3.4']) {
    S.release = rel(t); eq((await mk().checkForUpdates({ currentVersion: '0.1.0' })).status, 'error', t);
  }
});
test('자산 누락 → error', async () => {
  setSlug('o/n');
  S.release = rel('0.2.0'); S.release.assets.pop();
  const r = await mk().checkForUpdates({ currentVersion: '0.1.0' }); eq(r.status, 'error'); ok(/SHA256SUMS/.test(r.message));
  S.release = rel('0.2.0'); S.release.assets[0].name = 'Maru-0.2.0-x64.dmg';
  eq((await mk().checkForUpdates({ currentVersion: '0.1.0' })).status, 'error');
});
test('404(릴리스 없음) → none', async () => {
  setSlug('o/n'); S.status = 404;
  eq((await mk().checkForUpdates({ currentVersion: '0.1.0' })).status, 'none'); S.status = 200;
});
test('API 응답 1MB 초과 거부', async () => {
  setSlug('o/n'); S.bigApi = true;
  const r = await mk().checkForUpdates({ currentVersion: '0.1.0' }); S.bigApi = false;
  eq(r.status, 'error'); ok(/너무 큼/.test(r.message));
});
test('기본 설정은 하드코딩 GitHub 값(네트워크 호출 없이 상수만 확인)', async () => {
  const D = U._DEFAULTS;
  eq(D.apiBase, 'https://api.github.com'); eq(D.allowHttp, false);
  eq(D.allowHosts, ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
  eq(D.maxRedirects, 5); eq(D.maxDmgBytes, 400 * 1024 * 1024); eq(D.maxSumsBytes, 64 * 1024);
  eq(path.isAbsolute(D.gitCandidates[0]) && D.gitCandidates[0], '/Library/Developer/CommandLineTools/usr/bin/git');
  ok(D.gitCandidates.every((c) => path.isAbsolute(c)), 'bare git 금지');
});
test('서명 키 없음/잘못된 키 → unconfigured, 네트워크 요청 없음', async () => {
  setSlug('o/n'); S.release = rel('0.2.0');
  const bad = path.join(TMP, 'pkg-bad.json');
  for (const pj of [{}, { maru: { updatePublicKey: '' } }, { maru: { updatePublicKey: Buffer.alloc(16).toString('base64') } }, { maru: { updatePublicKey: 'not base64!' } }]) {
    fs.writeFileSync(bad, JSON.stringify(pj));
    const h = S.hits;
    const r = await mk({ pkgPath: bad }).checkForUpdates({ currentVersion: '0.1.0' });
    eq(r.status, 'unconfigured'); ok(/키/.test(r.message)); eq(S.hits, h);
    await rejects(mk({ pkgPath: bad }).downloadAndVerify({ _release: { version: '0.2.0', dmgName: 'Maru-0.2.0-arm64.dmg', dmgUrl: base + '/dl/dmg', sumsUrl: base + '/dl/sums', sigUrl: base + '/dl/sig', dmgSize: 0 } }, () => {}), /키/);
  }
});
test('서명 자산 누락 → error', async () => {
  setSlug('o/n'); S.release = rel('0.2.0'); S.release.assets.pop();
  const r = await mk().checkForUpdates({ currentVersion: '0.1.0' }); eq(r.status, 'error'); ok(/sig/.test(r.message));
});
test('패키징된 앱은 MARU_UPDATE_REPO 무시', async () => {
  setSlug('o/n'); S.release = rel('0.2.0');
  const h = S.hits;
  const r = await mk({ execPath: '/Applications/Maru.app/Contents/MacOS/Maru' }).checkForUpdates({ currentVersion: '0.1.0' });
  eq(r.status, 'unconfigured'); eq(S.hits, h);
  const pk = path.join(TMP, 'pkg-both.json'); fs.writeFileSync(pk, JSON.stringify({ maru: { updateRepo: 'o/n', updatePublicKey: PUB } }));
  eq((await mk({ pkgPath: pk, execPath: '/Applications/Maru.app/Contents/MacOS/Maru' }).checkForUpdates({ currentVersion: '0.1.0' })).status, 'available');
});
test('sign-release: 개인키 0600, 덮어쓰기 거부, 서명 검증 가능', async () => {
  eq(fs.statSync(PRIV).mode & 0o777, 0o600);
  let threw = false; try { SR.keygen(PRIV); } catch { threw = true; } ok(threw, '덮어쓰기 거부');
  const f = path.join(TMP, 'sums-x'); fs.writeFileSync(f, 'hello'); const o = SR.sign(PRIV, f);
  eq(o, f + '.sig'); eq(Buffer.from(fs.readFileSync(o, 'utf8').trim(), 'base64').length, 64);
  fs.chmodSync(PRIV, 0o644); let t2 = false; try { SR.sign(PRIV, f); } catch { t2 = true; } fs.chmodSync(PRIV, 0o600); ok(t2, '넓은 권한 거부');
});

// ---- 다운로드 ----
async function info(tag = '1.2.3') { setSlug('o/n'); S.release = rel(tag); S.sums = goodSums(); return mk().checkForUpdates({ currentVersion: '0.1.0' }).then((i) => i); }
test('체크섬 일치 + progress 1 + 0700 디렉터리', async () => {
  const u = mk(); setSlug('o/n'); S.release = rel('1.2.3'); S.sums = goodSums();
  const i = await u.checkForUpdates({ currentVersion: '0.1.0' }); eq(i.status, 'available');
  const prog = []; const { dmgPath } = await u.downloadAndVerify(i, (p) => prog.push(p));
  eq(sha(fs.readFileSync(dmgPath)), sha(DMG)); eq(prog[prog.length - 1], 1); ok(prog.every((p, k) => k === 0 || p >= prog[k - 1]), '단조');
  eq(fs.statSync(path.dirname(dmgPath)).mode & 0o777, 0o700); eq(path.basename(dmgPath), 'Maru.dmg');
});
test('체크섬 불일치 → 파일 삭제', async () => {
  const u = mk(); setSlug('o/n'); S.release = rel('1.2.3');
  const i2 = await u.checkForUpdates({ currentVersion: '0.1.0' });
  S.sums = `${'0'.repeat(64)}  Maru-1.2.3-arm64.dmg\n`;
  const before = fs.readdirSync(TMP).filter((n) => n.startsWith('maru-update-'));
  await rejects(u.downloadAndVerify(i2, () => {}), /체크섬/);
  eq(fs.readdirSync(TMP).filter((n) => n.startsWith('maru-update-')), before, '새 temp 디렉터리 없음');
});
test('SHA256SUMS 형식 오류 거부', async () => {
  const u = mk(); setSlug('o/n'); S.release = rel('1.2.3'); const i = await u.checkForUpdates({ currentVersion: '0.1.0' });
  const h = sha(DMG);
  for (const bad of ['garbage\n', `${h} Maru-1.2.3-arm64.dmg\n`, `${h}  other.dmg\n`, `${h.slice(1)}  Maru-1.2.3-arm64.dmg\n`, `${h}  Maru-1.2.3-arm64.dmg\n${'1'.repeat(64)}  Maru-1.2.3-arm64.dmg\n`, `${h}  Maru-1.2.3-arm64.dmg\nnot a line\n`, `${h}  Maru-1.2.3-arm64.dmg.evil\n`]) {
    S.sums = bad; await rejects(u.downloadAndVerify(i, () => {}), /SHA256SUMS/, JSON.stringify(bad));
  }
  S.sums = `${h.toUpperCase()} *Maru-1.2.3-arm64.dmg\r\n`; await u.downloadAndVerify(i, () => {}); // 대문자·별표·CRLF 허용
});
test('서명 검증이 SHA256SUMS 파싱보다 먼저: 위조/다른 키/깨진 서명 거부', async () => {
  const u = mk(); setSlug('o/n'); S.release = rel('1.2.3'); const i = await u.checkForUpdates({ currentVersion: '0.1.0' });
  S.sums = goodSums();
  S.sigOverride = signB64(goodSums().replace('a', 'b') + 'x'); await rejects(u.downloadAndVerify(i, () => {}), /서명/, '다른 내용에 대한 서명');
  S.sigOverride = signB64(goodSums(), path.join(TMP, 'other.key')); await rejects(u.downloadAndVerify(i, () => {}), /서명/, '다른 키');
  S.sigOverride = 'AAAA'; await rejects(u.downloadAndVerify(i, () => {}), /서명/, '깨진 형식');
  S.sigOverride = ''; await rejects(u.downloadAndVerify(i, () => {}), /서명/, '빈 서명');
  S.sums = 'garbage\n'; S.sigOverride = signB64('other\n'); await rejects(u.downloadAndVerify(i, () => {}), /서명/, '서명 불일치 시 파싱 오류가 아니라 서명 오류');
  S.sigOverride = null; S.sums = 'garbage\n'; await rejects(u.downloadAndVerify(i, () => {}), /SHA256SUMS 형식/, '서명이 맞으면 그 다음 파싱');
  S.sums = goodSums(); await u.downloadAndVerify(i, () => {});
});
test('dmg/sums 크기 상한', async () => {
  setSlug('o/n'); S.release = rel('1.2.3'); S.sums = goodSums();
  const i = await mk().checkForUpdates({ currentVersion: '0.1.0' });
  await rejects(mk({ maxDmgBytes: 1000 }).downloadAndVerify(i, () => {}), /너무 큼/);
  await rejects(mk({ maxSumsBytes: 10 }).downloadAndVerify(i, () => {}), /너무 큼/);
});
test('릴리스 정보와 다른 크기 거부', async () => {
  setSlug('o/n'); S.release = rel('1.2.3'); S.release.assets[0].size = 5; S.sums = goodSums();
  const i = await mk().checkForUpdates({ currentVersion: '0.1.0' });
  await rejects(mk().downloadAndVerify(i, () => {}), /크기/);
});
test('리다이렉트: 허용 호스트 내 1회는 통과, 비허용 호스트·6회 초과 거부', async () => {
  setSlug('o/n'); S.sums = goodSums();
  S.release = rel('1.2.3'); S.release.assets[0].browser_download_url = base + '/hop1';
  let i = await mk().checkForUpdates({ currentVersion: '0.1.0' });
  await mk().downloadAndVerify(i, () => {});
  S.release.assets[0].browser_download_url = base + '/evil';
  i = await mk().checkForUpdates({ currentVersion: '0.1.0' });
  await rejects(mk().downloadAndVerify(i, () => {}), /허용되지 않은 호스트/);
  S.release.assets[0].browser_download_url = base + '/loop/0';
  i = await mk().checkForUpdates({ currentVersion: '0.1.0' });
  await rejects(mk().downloadAndVerify(i, () => {}), /리다이렉트가 너무 많음/);
});
test('https 외·비허용 호스트 URL 거부(기본 export 설정)', async () => {
  const D = U._create({ pkgPath: PKG, tmpDir: TMP }); // 기본 호스트/https 설정
  const bad = (url) => ({ _release: { version: '1.2.3', dmgName: 'Maru-1.2.3-arm64.dmg', dmgUrl: url, sumsUrl: url, sigUrl: url, dmgSize: 0 } });
  await rejects(D.downloadAndVerify(bad('http://github.com/x'), () => {}), /프로토콜/);
  await rejects(D.downloadAndVerify(bad('https://evil.example.com/x'), () => {}), /호스트/);
  await rejects(D.downloadAndVerify(bad('https://user:pw@github.com/x'), () => {}), /인증/);
  await rejects(D.downloadAndVerify({}, () => {}), /정보가 없음/);
});

// ---- 저장소 ----
test('repo: behind N, ff pull, 이후 0', async () => {
  setSlug(null); const f = gitFixture('g1');
  commit(f.seed, 'a.txt', '1'); commit(f.seed, 'a.txt', '2'); g(f.seed, 'push', '-q');
  const u = mk();
  let r = await u.checkForUpdates({ currentVersion: '0.1.0', repoRoot: f.work });
  eq(r.repoBehind, 0, 'fetchRepo 없으면 fetch 하지 않음'); eq(r.status, 'none');
  r = await u.checkForUpdates({ currentVersion: '0.1.0', repoRoot: f.work, fetchRepo: true });
  eq(r.status, 'available'); eq(r.repoBehind, 2);
  const p = await u.pullRepo(f.work); eq(p.ok, true, p.message); ok(/2/.test(p.message));
  eq(fs.readFileSync(path.join(f.work, 'a.txt'), 'utf8'), '2');
  r = await u.checkForUpdates({ currentVersion: '0.1.0', repoRoot: f.work, fetchRepo: true }); eq(r.status, 'none'); eq(r.repoBehind, 0);
  eq((await u.pullRepo(f.work)).message, '이미 최신');
});
test('repo: 더러운 작업 트리 거부(수정/untracked)', async () => {
  const f = gitFixture('g2'); commit(f.seed, 'a.txt', '1'); g(f.seed, 'push', '-q');
  const u = mk();
  fs.writeFileSync(path.join(f.work, 'a.txt'), 'dirty');
  let p = await u.pullRepo(f.work); eq(p.ok, false); ok(/변경/.test(p.message));
  g(f.work, 'checkout', '--', 'a.txt'); fs.writeFileSync(path.join(f.work, 'new.txt'), 'x');
  p = await u.pullRepo(f.work); eq(p.ok, false);
  eq(fs.readFileSync(path.join(f.work, 'a.txt'), 'utf8'), '0', '변경 없음');
});
test('repo: diverged 거부, HEAD 불변', async () => {
  const f = gitFixture('g3'); commit(f.seed, 'b.txt', 'up'); g(f.seed, 'push', '-q');
  commit(f.work, 'c.txt', 'local'); const head = g(f.work, 'rev-parse', 'HEAD');
  const p = await mk().pullRepo(f.work); eq(p.ok, false); ok(/diverged/.test(p.message), p.message);
  eq(g(f.work, 'rev-parse', 'HEAD'), head);
});
test('repo: 업스트림 없음/저장소 아님/하위 디렉터리 → undefined, ok:false', async () => {
  setSlug(null); const d = path.join(TMP, 'noup'); fs.mkdirSync(d); g(d, 'init', '-q'); commit(d, 'a', '1');
  const u = mk();
  let r = await u.checkForUpdates({ currentVersion: '0.1.0', repoRoot: d }); eq(r.repoBehind, undefined); eq(r.status, 'unconfigured');
  eq((await u.pullRepo(d)).ok, false);
  const plain = path.join(TMP, 'plain'); fs.mkdirSync(plain);
  eq((await u.checkForUpdates({ currentVersion: '0.1.0', repoRoot: plain })).repoBehind, undefined);
  eq((await u.pullRepo(plain)).ok, false);
  const sub = path.join(d, 'sub'); fs.mkdirSync(sub); eq((await u.pullRepo(sub)).ok, false, '최상위가 아니면 거부');
  eq((await mk({ gitCandidates: ['/nonexistent/git'] }).pullRepo(d)).ok, false, 'git 없음');
});
test('repo: 앱 설정 + repo 동시(앱 최신, repo behind → available)', async () => {
  setSlug('o/n'); S.release = rel('0.1.0'); S.status = 200;
  const f = gitFixture('g4'); commit(f.seed, 'a.txt', '9'); g(f.seed, 'push', '-q');
  const r = await mk().checkForUpdates({ currentVersion: '0.1.0', repoRoot: f.work, fetchRepo: true });
  eq(r.status, 'available'); eq(r.repoBehind, 1);
});

// ---- 설치 ----
test('installAndRelaunch: 모르는 경로/비패키징 거부', async () => {
  const u = mk(); setSlug('o/n'); S.release = rel('1.2.3'); S.sums = goodSums();
  await rejects(u.installAndRelaunch('/tmp/evil.dmg'), /검증해 받은/);
  await rejects(u.installAndRelaunch(undefined), /검증해 받은/);
  const i = await u.checkForUpdates({ currentVersion: '0.1.0' }); const { dmgPath } = await u.downloadAndVerify(i, () => {});
  await rejects(u.installAndRelaunch(dmgPath), /패키징/); // 이 테스트는 node 로 실행 중
  await rejects(u.installAndRelaunch(dmgPath + '/../Maru.dmg'), /검증해 받은/);
  await rejects(mk({ execPath: '/Applications/Other.app/Contents/MacOS/Other' }).installAndRelaunch(dmgPath), /검증해 받은|패키징/);
});

// 가짜 번들 + 실제 hdiutil/ditto 로 마운트·검증·복사·헬퍼 spawn 인자까지(교체는 헬퍼 테스트에서 별도)
const PLIST = (id, v) => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${v}</string></dict></plist>`;
function fakeApp(dir, id, v, marker) {
  fs.mkdirSync(path.join(dir, 'Maru.app', 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Maru.app', 'Contents', 'Info.plist'), PLIST(id, v));
  fs.writeFileSync(path.join(dir, 'Maru.app', 'Contents', 'MacOS', 'Maru'), marker);
}
async function installScenario(name, dmgId, dmgVer) {
  const vol = path.join(TMP, name + '-vol'); fakeApp(vol, dmgId, dmgVer, 'new');
  const dmg = path.join(TMP, name + '.dmg');
  const hr = spawnSync('/usr/bin/hdiutil', ['create', '-quiet', '-srcfolder', vol, '-format', 'UDZO', '-fs', 'HFS+', '-volname', 'Maru', dmg], { encoding: 'utf8' });
  if (hr.status !== 0) return null;
  const apps = path.join(TMP, name + '-apps'); fakeApp(apps, 'com.maru.app', '0.1.0', 'old');
  const bytes = fs.readFileSync(dmg);
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-length': bytes.length }); s.end(q.url === '/sums' ? undefined : bytes); });
  return { apps, bytes, dmg, srv };
}
for (const [name, id, ver, expectOk] of [['inst-ok', 'com.maru.app', '1.2.3', true], ['inst-badid', 'com.evil.app', '1.2.3', false], ['inst-badver', 'com.maru.app', '9.9.9', false]]) {
  test('installAndRelaunch: ' + name, async () => {
    if (process.env.UPDATER_TEST_NO_HDIUTIL === '1') { console.log('  (SKIP: hdiutil 시나리오 생략)'); return; }
    const sc = await installScenario(name, id, ver);
    if (!sc) { console.log('  (SKIP: hdiutil create 불가)'); return; }
    // 이 시나리오 전용 서버: dmg 와 sums 를 직접 서빙
    const h = sha(sc.bytes); let quit = 0, spawned = null, bq = []; const order = [];
    const sumsText = `${h}  Maru-1.2.3-arm64.dmg\n`;
    const srv = http.createServer((q, s) => { if (q.url === '/sig') { s.writeHead(200); s.end(signB64(sumsText)); } else if (q.url === '/sums') { s.writeHead(200); s.end(sumsText); } else { s.writeHead(200, { 'content-length': sc.bytes.length }); s.end(sc.bytes); } });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${srv.address().port}`;
    try {
      const fakeSpawn = (cmd, args, opts) => { spawned = { cmd, args, opts }; order.push('spawn'); const { EventEmitter } = require('events'); const e = new EventEmitter(); e.unref = () => {}; setImmediate(() => e.emit('spawn')); return e; };
      const u = mk({ execPath: path.join(sc.apps, 'Maru.app', 'Contents', 'MacOS', 'Maru'), electron: { app: { quit: () => { quit++; order.push('quit'); } } }, spawn: fakeSpawn, skipCodesign: true, stateDir: path.join(sc.apps, '..', name + '-state'), trashDir: path.join(sc.apps, '..', name + '-trash') });
      const inf = { _release: { version: '1.2.3', dmgName: 'Maru-1.2.3-arm64.dmg', dmgUrl: b + '/dmg', sumsUrl: b + '/sums', sigUrl: b + '/sig', dmgSize: sc.bytes.length } };
      const { dmgPath } = await u.downloadAndVerify(inf, () => {});
      if (!expectOk) {
        await rejects(u.installAndRelaunch(dmgPath, { beforeQuit: () => bq.push(1) }), /번들 ID|버전/);
        eq(quit, 0); eq(spawned, null); eq(bq, [], '실패 경로에서는 beforeQuit 호출 안 함');
        eq(fs.readdirSync(sc.apps).filter((n) => n.startsWith('.Maru.app.new-')), [], '스테이징 정리');
        return;
      }
      await u.installAndRelaunch(dmgPath, { beforeQuit: () => { bq.push(1); order.push('beforeQuit'); } });
      eq(order, ['spawn', 'beforeQuit', 'quit'], 'spawn 뒤, quit 직전에 beforeQuit'); eq(bq, [1]);
      eq(quit, 1); eq(spawned.cmd, '/bin/sh'); eq(spawned.opts.detached, true); eq(spawned.opts.stdio, 'ignore');
      const [helper, pid, cur, stg, old, o, t] = spawned.args;
      eq(cur, path.join(sc.apps, 'Maru.app')); ok(path.basename(stg).startsWith('.Maru.app.new-')); ok(path.basename(old).startsWith('.Maru.app.old-'));
      eq(path.dirname(stg), sc.apps); eq(fs.readFileSync(path.join(stg, 'Contents', 'MacOS', 'Maru'), 'utf8'), 'new');
      eq(fs.readFileSync(path.join(cur, 'Contents', 'MacOS', 'Maru'), 'utf8'), 'old', '현재 번들은 아직 그대로');
      eq(fs.statSync(helper).mode & 0o777, 0o700);
      eq([o, t, pid], ['1', '1', String(process.pid)]);
      // 마운트 해제 확인
      ok(!execFileSync('/sbin/mount', { encoding: 'utf8' }).includes('maru-mnt-'), '마운트 남음');
      // 모듈이 만든 실제 argv 로 헬퍼 실행(pid 는 끝난 프로세스로, open/trash 만 생략)
      const a = spawned.args.slice(); a[1] = String(spawnSync('/usr/bin/true').pid); a[5] = '0'; a[6] = '0';
      const hr = spawnSync('/bin/sh', a, { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: sc.apps } });
      eq(hr.status, 0, hr.stderr);
      eq(fs.readFileSync(path.join(cur, 'Contents', 'MacOS', 'Maru'), 'utf8'), 'new', '교체됨');
      eq(fs.readFileSync(path.join(old, 'Contents', 'MacOS', 'Maru'), 'utf8'), 'old');
      ok(!fs.existsSync(stg), '스테이징 소비됨'); ok(!fs.existsSync(helper) && !fs.existsSync(a[8]), '헬퍼 자기 삭제');
      eq(fs.readFileSync(a[10], 'utf8'), 'installed\n1.2.3\n\n');
      // 시작 시 정리: 결과 읽고 삭제, 남은 .old 는 휴지통으로 이동
      const fin = u.finishPendingInstall();
      eq(fin, { status: 'installed', version: '1.2.3', message: '' }); ok(!fs.existsSync(a[10]), '결과 파일 삭제');
      ok(!fs.existsSync(old), 'old 이동됨'); eq(fs.readdirSync(path.join(sc.apps, '..', name + '-trash')).length, 1);
      eq(u.finishPendingInstall(), null);
    } finally { srv.close(); }
  });
}

// ---- 교체 헬퍼(가짜 트리) ----
function helperRun(dir, { openCmd = '', doOpen = '0', doTrash = '0', pid, mutate } = {}) {
  const apps = path.join(dir, 'apps'); fs.mkdirSync(apps, { recursive: true });
  const cur = path.join(apps, 'Maru.app'), nw = path.join(apps, '.Maru.app.new-aa'), old = path.join(apps, '.Maru.app.old-bb');
  for (const [p, m] of [[cur, 'old'], [nw, 'new']]) { fs.mkdirSync(path.join(p, 'Contents'), { recursive: true }); fs.writeFileSync(path.join(p, 'Contents', 'Info.plist'), m); }
  if (mutate) mutate({ cur, nw, old });
  const sh = path.join(dir, 'swap.sh'); fs.writeFileSync(sh, U._HELPER_SH, { mode: 0o700 });
  const home = path.join(dir, 'home'); fs.mkdirSync(home);
  const dead = spawnSync('/usr/bin/true'); // 이미 끝난 프로세스의 pid
  const r = spawnSync('/bin/sh', [sh, String(pid || dead.pid), cur, nw, old, doOpen, doTrash, '5', '', openCmd], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home } });
  const rd = (p) => { try { return fs.readFileSync(path.join(p, 'Contents', 'Info.plist'), 'utf8'); } catch { return null; } };
  return { r, cur, nw, old, home, rd };
}
test('helper: 정상 교체(open/trash 생략)', async () => {
  const h = helperRun(path.join(TMP, 'h1')); eq(h.r.status, 0, h.r.stderr);
  eq(h.rd(h.cur), 'new'); eq(h.rd(h.old), 'old'); ok(!fs.existsSync(h.nw));
});
test('helper: 모든 종료 경로에서 결과 파일 작성', async () => {
  const res = (d) => path.join(d, 'result');
  const run = (name, opts, expectCode, expectStatus) => {
    const dir = path.join(TMP, name); fs.mkdirSync(dir);
    const apps = path.join(dir, 'apps'); fs.mkdirSync(apps);
    const cur = path.join(apps, 'Maru.app'), nw = path.join(apps, '.Maru.app.new-aa'), old = path.join(apps, '.Maru.app.old-bb');
    for (const p of [cur, nw]) { fs.mkdirSync(path.join(p, 'Contents'), { recursive: true }); fs.writeFileSync(path.join(p, 'Contents', 'Info.plist'), 'x'); }
    if (opts.noNew) fs.rmSync(nw, { recursive: true });
    const sh = path.join(dir, 's.sh'); fs.writeFileSync(sh, U._HELPER_SH);
    const dead = spawnSync('/usr/bin/true').pid;
    const r = spawnSync('/bin/sh', [sh, String(dead), cur, nw, old, opts.open || '0', '0', '5', '', opts.openCmd || '', res(dir), '2.0.0'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: dir } });
    eq(r.status, expectCode); eq(fs.readFileSync(res(dir), 'utf8').split('\n').slice(0, 2), [expectStatus, '2.0.0']);
  };
  run('r1', {}, 0, 'installed'); run('r2', { noNew: true }, 4, 'failed'); run('r3', { open: '1', openCmd: '/usr/bin/false' }, 7, 'rolledBack');
});
test('finishPendingInstall: 결과 없음/오염된 결과/휴지통 이동', async () => {
  const sd = path.join(TMP, 'fp-state'); fs.mkdirSync(sd, { mode: 0o700 });
  const apps = path.join(TMP, 'fp-apps'); fakeApp(apps, 'com.maru.app', '1.0.0', 'x');
  for (const n of ['.Maru.app.new-0123456789ab', '.Maru.app.old-ba9876543210', '.Maru.app.new-zzz', 'other']) fs.mkdirSync(path.join(apps, n));
  const u = mk({ stateDir: sd, trashDir: path.join(TMP, 'fp-trash'), execPath: path.join(apps, 'Maru.app', 'Contents', 'MacOS', 'Maru') });
  eq(u.finishPendingInstall(), null);
  fs.writeFileSync(path.join(sd, 'install-result'), 'bogus\nnot-a-version\nmsg\n');
  eq(u.finishPendingInstall(), { status: 'failed', version: '', message: 'msg' });
  eq(fs.readdirSync(apps).sort(), ['.Maru.app.new-zzz', 'Maru.app', 'other'], '정확한 이름만 이동');
  eq(fs.readdirSync(path.join(TMP, 'fp-trash')).length, 2);
});
test('helper: trash 는 ~/.Trash 로 이동(삭제 아님)', async () => {
  const h = helperRun(path.join(TMP, 'h2'), { doTrash: '1' }); eq(h.r.status, 0, h.r.stderr);
  eq(h.rd(h.cur), 'new'); ok(!fs.existsSync(h.old));
  const t = fs.readdirSync(path.join(h.home, '.Trash')); eq(t.length, 1); ok(t[0].startsWith('.Maru.app.old-bb'));
});
test('helper: open 실패 → 롤백(현재=옛것 복구, 새것은 스테이징 복귀)', async () => {
  const h = helperRun(path.join(TMP, 'h3'), { doOpen: '1', openCmd: '/usr/bin/false' }); eq(h.r.status, 7);
  eq(h.rd(h.cur), 'old'); eq(h.rd(h.nw), 'new'); ok(!fs.existsSync(h.old));
});
test('helper: open 성공(/usr/bin/true) 후 옛것 정리', async () => {
  const h = helperRun(path.join(TMP, 'h4'), { doOpen: '1', doTrash: '1', openCmd: '/usr/bin/true' }); eq(h.r.status, 0, h.r.stderr);
  eq(h.rd(h.cur), 'new');
});
test('helper: 스테이징 불완전/옛 경로 존재 → 현재 건드리지 않음', async () => {
  let h = helperRun(path.join(TMP, 'h5'), { mutate: ({ nw }) => fs.rmSync(path.join(nw, 'Contents', 'Info.plist')) }); eq(h.r.status, 4); eq(h.rd(h.cur), 'old');
  h = helperRun(path.join(TMP, 'h6'), { mutate: ({ old }) => fs.mkdirSync(old) }); eq(h.r.status, 4); eq(h.rd(h.cur), 'old');
});
test('helper: 앱이 안 끝나면 대기 후 포기(교체 안 함)', async () => {
  const sleeper = require('child_process').spawn('/bin/sleep', ['20']);
  const dir = path.join(TMP, 'h7'); fs.mkdirSync(dir);
  const apps = path.join(dir, 'apps'); const cur = path.join(apps, 'Maru.app'), nw = path.join(apps, '.Maru.app.new-aa'), old = path.join(apps, '.Maru.app.old-bb');
  for (const p of [cur, nw]) { fs.mkdirSync(path.join(p, 'Contents'), { recursive: true }); fs.writeFileSync(path.join(p, 'Contents', 'Info.plist'), 'x'); }
  fs.writeFileSync(path.join(dir, 's.sh'), U._HELPER_SH);
  const r = spawnSync('/bin/sh', [path.join(dir, 's.sh'), String(sleeper.pid), cur, nw, old, '0', '0', '1', '', ''], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: dir } });
  sleeper.kill(); eq(r.status, 3); ok(fs.existsSync(cur) && !fs.existsSync(old));
});
test('helper: 잘못된 인자(상대경로/이름/pid) 거부', async () => {
  const sh = path.join(TMP, 'bad.sh'); fs.writeFileSync(sh, U._HELPER_SH);
  const run = (...a) => spawnSync('/bin/sh', [sh, ...a], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: TMP } }).status;
  eq(run('1; rm', '/a/Maru.app', '/a/.n', '/a/.o', '0', '0', '1', '', ''), 2);
  eq(run('999999', 'a/Maru.app', '/a/.n', '/a/.o', '0', '0', '1', '', ''), 2);
  eq(run('999999', '/a/Other.app', '/a/.n', '/a/.o', '0', '0', '1', '', ''), 2);
  eq(run('999999', '/a/Maru.app', '/b/.n', '/a/.o', '0', '0', '1', '', ''), 2);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); }
  }
  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  if (violations.length) { fail++; console.log('FAIL 네트워크 가드: 루프백 외 연결 시도 ' + violations.join(',')); }
  else { pass++; console.log('ok   네트워크 가드: 루프백 외 연결 시도 없음'); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
