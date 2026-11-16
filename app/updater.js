'use strict';
// 업데이트 모듈: 앱(dmg, GitHub 릴리스)과 저장소(git ff-only)를 각각 확인·갱신한다. 외부 의존성 없음.
// electron 은 installAndRelaunch 안에서만 지연 로드한다(순수 node 에서 테스트 가능).
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const SEMVER_RE = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;
const CLT_GIT = '/Library/Developer/CommandLineTools/usr/bin/git';
// git 후보는 절대 경로만(PATH 의 bare git 은 쓰지 않는다). /usr/bin/git 은 설치 안내 셈이 아닐 때만.
const GIT_CANDIDATES = [CLT_GIT, '/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'];
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DEFAULTS = {
  apiBase: 'https://api.github.com',
  allowHosts: ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
  allowHttp: false,
  maxApiBytes: 1024 * 1024,
  maxDmgBytes: 400 * 1024 * 1024,
  maxSumsBytes: 64 * 1024,
  apiTimeoutMs: 10000,
  sumsTimeoutMs: 30000,
  dmgTimeoutMs: 15 * 60 * 1000,
  maxRedirects: 5,
};

// 설치 교체 헬퍼(sh). 모든 경로를 인자로 받는다. 인자: pid 현재 새것 옛것 open(0|1) trash(0|1) 대기초 정리디렉터리 open명령
// 주의: 템플릿 리터럴이므로 sh 쪽에 "${" 와 백틱을 쓰지 않는다.
const HELPER_SH = `#!/bin/sh
PID=$1; CUR=$2; NEW=$3; OLD=$4; DO_OPEN=$5; DO_TRASH=$6; WAIT=$7; CLEAN=$8; OPEN=$9
shift 9
RES=$1; VER=$2
[ -n "$OPEN" ] || OPEN=/usr/bin/open
ST=failed; MSG=""
finish() {
  case "$RES" in /*) printf '%s\n%s\n%s\n' "$ST" "$VER" "$MSG" > "$RES.tmp" 2>/dev/null && mv "$RES.tmp" "$RES";; esac
  if [ -n "$CLEAN" ]; then rm -f -- "$0"; rmdir "$CLEAN" 2>/dev/null; fi
}
trap finish EXIT
fail() { MSG="$2"; case "$1" in 6|7) ST=rolledBack;; *) ST=failed;; esac; echo "maru-update: $2" >&2; exit "$1"; }
trash() {
  [ "$DO_TRASH" = 1 ] || return 0
  [ -e "$1" ] || return 0
  T="$HOME/.Trash"; mkdir -p "$T" 2>/dev/null
  mv "$1" "$T/$(basename "$1")-$$" 2>/dev/null
}
case "$PID" in ''|*[!0-9]*) fail 2 "bad pid";; esac
for p in "$CUR" "$NEW" "$OLD"; do case "$p" in /*) ;; *) fail 2 "relative path";; esac; done
[ "$(basename "$CUR")" = "Maru.app" ] || fail 2 "bad bundle name"
D=$(dirname "$CUR")
[ "$(dirname "$NEW")" = "$D" ] && [ "$(dirname "$OLD")" = "$D" ] || fail 2 "dir mismatch"
case "$WAIT" in ''|*[!0-9]*) WAIT=30;; esac
n=0; max=$((WAIT*10))
while kill -0 "$PID" 2>/dev/null; do
  n=$((n+1))
  if [ "$n" -gt "$max" ]; then trash "$NEW"; fail 3 "app did not exit"; fi
  sleep 0.1
done
[ -d "$CUR/Contents" ] && [ -f "$NEW/Contents/Info.plist" ] || fail 4 "missing bundle"
[ ! -e "$OLD" ] || fail 4 "old path exists"
mv "$CUR" "$OLD" || fail 5 "rename current failed"
if ! mv "$NEW" "$CUR"; then mv "$OLD" "$CUR"; fail 6 "rename new failed, rolled back"; fi
if [ "$DO_OPEN" = 1 ]; then
  if ! "$OPEN" "$CUR"; then
    if mv "$CUR" "$NEW" && mv "$OLD" "$CUR"; then "$OPEN" "$CUR"; fi
    fail 7 "open failed, rolled back"
  fi
fi
trash "$OLD"
ST=installed
exit 0
`;

const parseSemver = (s) => { const m = SEMVER_RE.exec(String(s)); return m ? [+m[1], +m[2], +m[3]] : null; };
function cmpSemver(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; }
const firstLine = (s) => String(s || '').trim().split('\n')[0].slice(0, 300);

// execFile 래퍼: argv 배열만, 타임아웃 필수
function run(cmd, args, o = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: o.timeout || 30000, maxBuffer: 1024 * 1024, env: o.env || process.env, cwd: o.cwd, stdio: 'ignore' }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || ''); err.stdout = String(stdout || ''); return reject(err); }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function create(userOpts = {}) {
  const O = { ...DEFAULTS, ...userOpts };
  const allowHosts = new Set(O.allowHosts.map((h) => h.toLowerCase()));
  const gitCandidates = O.gitCandidates || GIT_CANDIDATES;
  const produced = new Map(); // 이 프로세스가 검증해 만든 dmg 경로 → { version }
  let gitPath = null;

  // ---- 설정 ----
  const bundleFromExec = () => { const m = /^(\/.+\/Maru\.app)\/Contents\/MacOS\/[^/]+$/.exec(O.execPath || process.execPath); return m ? m[1] : null; };
  function parseKey(b64) {
    if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(b64.trim())) return null;
    const raw = Buffer.from(b64.trim(), 'base64');
    if (raw.length !== 32) return null;
    try { return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' }); } catch { return null; }
  }
  function readConfig() {
    let pj = null;
    try { pj = JSON.parse(fs.readFileSync(O.pkgPath || path.join(__dirname, 'package.json'), 'utf8')); } catch { /* 없으면 미설정 */ }
    const m = (pj && typeof pj.maru === 'object' && pj.maru) || {};
    let s = null;
    const env = process.env.MARU_UPDATE_REPO;
    if (!bundleFromExec() && env && env.trim()) s = env; // 패키징된 앱은 환경변수를 무시
    else if (typeof m.updateRepo === 'string') s = m.updateRepo;
    const key = parseKey(m.updatePublicKey);
    if (s == null || !String(s).trim()) return { slug: null, key };
    s = String(s).trim();
    const [, name] = s.split('/');
    if (!SLUG_RE.test(s) || name === '.' || name === '..') return { bad: true, key };
    return { slug: s, key };
  }

  // ---- https ----
  function checkUrl(u) {
    const url = new URL(u);
    const okProto = url.protocol === 'https:' || (O.allowHttp && url.protocol === 'http:');
    if (!okProto) throw new Error('허용되지 않은 프로토콜: ' + url.protocol);
    if (url.username || url.password) throw new Error('URL 에 인증 정보 불가');
    if (!allowHosts.has(url.hostname.toLowerCase())) throw new Error('허용되지 않은 호스트: ' + url.hostname);
    if (url.protocol === 'https:' && url.port && !O.allowHttp) throw new Error('허용되지 않은 포트');
    return url;
  }

  // 리다이렉트를 허용 호스트 안에서만 따라가며 handle(res) 를 실행. timeoutMs 는 전체 시간.
  function request(startUrl, { headers, timeoutMs, handle }) {
    return new Promise((resolve, reject) => {
      let req = null, done = false, redirects = 0;
      const fail = (e) => { if (done) return; done = true; clearTimeout(timer); try { req && req.destroy(); } catch {} reject(e); };
      const timer = setTimeout(() => fail(new Error('시간 초과')), timeoutMs);
      const go = (u) => {
        let url;
        try { url = checkUrl(u); } catch (e) { return fail(e); }
        req = (url.protocol === 'https:' ? https : http).get(url, { headers, agent: false }, (res) => {
          const st = res.statusCode;
          if (st >= 300 && st < 400 && st !== 304) {
            res.resume();
            if (++redirects > O.maxRedirects) return fail(new Error('리다이렉트가 너무 많음'));
            if (!res.headers.location) return fail(new Error('리다이렉트 위치 없음'));
            let next;
            try { next = new URL(res.headers.location, url).href; } catch (e) { return fail(e); }
            return go(next);
          }
          if (st !== 200) { res.resume(); const e = new Error('HTTP ' + st); e.status = st; return fail(e); }
          Promise.resolve(handle(res)).then((v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } }, fail);
        });
        req.on('error', fail);
      };
      go(startUrl);
    });
  }

  function collect(res, max) {
    return new Promise((resolve, reject) => {
      const cl = Number(res.headers['content-length']);
      if (cl > max) { res.destroy(); return reject(new Error('응답이 너무 큼')); }
      let n = 0; const bufs = [];
      res.on('data', (c) => { n += c.length; if (n > max) { res.destroy(); reject(new Error('응답이 너무 큼')); } else bufs.push(c); });
      res.on('end', () => resolve(Buffer.concat(bufs)));
      res.on('error', reject);
      res.on('close', () => reject(new Error('연결이 끊김')));
    });
  }

  const getBuffer = (url, max, timeoutMs, accept) =>
    request(url, { timeoutMs, headers: { 'User-Agent': 'maru-updater', Accept: accept }, handle: (res) => collect(res, max) });

  // 스트리밍으로 파일에 쓰면서 sha256 계산
  function getToFile(url, file, { max, timeoutMs, expectSize, onProgress }) {
    return request(url, {
      timeoutMs, headers: { 'User-Agent': 'maru-updater', Accept: 'application/octet-stream' },
      handle: (res) => new Promise((resolve, reject) => {
        const cl = Number(res.headers['content-length']);
        if (cl > max) { res.destroy(); return reject(new Error('파일이 너무 큼')); }
        const total = cl > 0 ? cl : expectSize || 0;
        const hash = crypto.createHash('sha256');
        const ws = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
        let n = 0, ended = false, lastPct = 0;
        const bail = (e) => { res.destroy(); ws.destroy(); reject(e); };
        res.on('data', (c) => {
          n += c.length;
          if (n > max) return bail(new Error('파일이 너무 큼'));
          hash.update(c);
          if (onProgress && total) {
            const p = Math.min(1, n / total);
            if (p - lastPct >= 0.01) { lastPct = p; try { onProgress(p); } catch {} }
          }
        });
        res.on('end', () => { ended = true; });
        res.on('error', bail);
        res.on('close', () => { if (!ended) bail(new Error('연결이 끊김')); });
        ws.on('error', bail);
        ws.on('finish', () => resolve({ sha256: hash.digest('hex'), size: n }));
        res.pipe(ws);
      }),
    });
  }

  // ---- git ----
  function gitEnv(cmd) {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
    if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
    if (!env.DEVELOPER_DIR && fs.existsSync('/Library/Developer/CommandLineTools')) env.DEVELOPER_DIR = '/Library/Developer/CommandLineTools';
    return env;
  }
  async function findGit() {
    if (gitPath) return gitPath;
    for (const c of gitCandidates) {
      if (!path.isAbsolute(c) || !fs.existsSync(c)) continue;
      // /usr/bin/git 은 CLT/Xcode 가 있을 때만(없으면 설치 안내 창이 뜰 수 있음), 출력 없이 실행돼야 함
      if (c === '/usr/bin/git' && !O.gitCandidates && !fs.existsSync('/Library/Developer/CommandLineTools') && !fs.existsSync('/Applications/Xcode.app')) continue;
      try {
        const r = await run(c, ['--version'], { timeout: 5000, env: gitEnv() });
        if (!/^git version/.test(r.stdout)) continue;
        if (c === '/usr/bin/git' && r.stderr.trim()) continue;
        gitPath = c; return c;
      } catch { /* 다음 후보 */ }
    }
    return null;
  }
  const git = (root, args, timeout) => run(gitPath, ['-C', root, ...args], { timeout, env: gitEnv() });

  // 저장소 상태: { usable, upstream } — repoRoot 가 work tree 의 최상위일 때만 usable
  async function repoState(repoRoot) {
    if (!repoRoot || typeof repoRoot !== 'string') return { usable: false };
    let real;
    try { real = fs.realpathSync(repoRoot); if (!fs.statSync(real).isDirectory()) return { usable: false }; } catch { return { usable: false }; }
    if (!(await findGit())) return { usable: false };
    try {
      const top = (await git(real, ['rev-parse', '--show-toplevel'], 10000)).stdout.trim();
      if (fs.realpathSync(top) !== real) return { usable: false };
    } catch { return { usable: false }; }
    let upstream = null;
    try { upstream = (await git(real, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 10000)).stdout.trim() || null; } catch { /* 업스트림 없음 */ }
    return { usable: true, root: real, upstream };
  }
  const count = async (root, range) => parseInt((await git(root, ['rev-list', '--count', range], 15000)).stdout.trim(), 10);

  async function repoCheck(repoRoot, doFetch) {
    const st = await repoState(repoRoot);
    if (!st.usable || !st.upstream) return { upstream: false };
    if (doFetch) try { await git(st.root, ['fetch', '--quiet'], 20000); } catch (e) { return { upstream: true, error: 'git fetch 실패: ' + firstLine(e.stderr || e.message) }; }
    try { return { upstream: true, behind: await count(st.root, 'HEAD..@{u}') }; } catch (e) { return { upstream: true, error: 'git 비교 실패: ' + firstLine(e.stderr || e.message) }; }
  }

  // ---- 앱 확인 ----
  async function appCheck(currentVersion) {
    const cfg = readConfig();
    if (cfg.bad) return { status: 'error', message: '업데이트 저장소 지정이 올바르지 않음(owner/name 형식)' };
    if (!cfg.slug) return { status: 'unconfigured' };
    if (!cfg.key) return { status: 'unconfigured', message: '업데이트 서명 키(maru.updatePublicKey)가 설정되지 않아 앱 업데이트를 받을 수 없음' };
    const cur = parseSemver(currentVersion);
    if (!cur) return { status: 'error', message: '현재 버전 형식이 올바르지 않음: ' + String(currentVersion).slice(0, 40) };
    let rel;
    try {
      const buf = await getBuffer(`${O.apiBase}/repos/${cfg.slug}/releases/latest`, O.maxApiBytes, O.apiTimeoutMs, 'application/vnd.github+json');
      rel = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      if (e.status === 404) return { status: 'none', message: '게시된 릴리스가 없음' };
      return { status: 'error', message: '릴리스 확인 실패: ' + firstLine(e.message) };
    }
    if (!rel || typeof rel.tag_name !== 'string') return { status: 'error', message: '릴리스 응답 형식이 올바르지 않음' };
    const ver = rel.tag_name.replace(/^v/, '');
    const lat = parseSemver(ver);
    if (!lat) return { status: 'error', message: '릴리스 태그가 x.y.z 형식이 아님: ' + rel.tag_name.slice(0, 40) };
    if (cmpSemver(lat, cur) <= 0) return { status: 'none', latest: ver };
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const dmgName = `Maru-${ver}-arm64.dmg`;
    const dmg = assets.find((a) => a && a.name === dmgName);
    const sums = assets.find((a) => a && a.name === 'SHA256SUMS');
    const sig = assets.find((a) => a && a.name === 'SHA256SUMS.sig');
    if (!dmg || !sums || !sig || [dmg, sums, sig].some((a) => typeof a.browser_download_url !== 'string')) {
      return { status: 'error', latest: ver, message: `릴리스 ${ver} 에 ${dmgName}, SHA256SUMS, SHA256SUMS.sig 중 빠진 것이 있음` };
    }
    return {
      status: 'available', latest: ver, notes: String(rel.body || '').trim().slice(0, 600),
      _release: { version: ver, dmgName, dmgUrl: dmg.browser_download_url, sumsUrl: sums.browser_download_url, sigUrl: sig.browser_download_url, dmgSize: Number.isFinite(dmg.size) ? dmg.size : 0 },
    };
  }

  async function checkForUpdates({ currentVersion, repoRoot, fetchRepo = false } = {}) {
    const [app, repo] = await Promise.all([appCheck(currentVersion), repoCheck(repoRoot, fetchRepo === true).catch((e) => ({ upstream: false, error: firstLine(e.message) }))]);
    const out = { status: 'none', current: currentVersion };
    if (app.latest) out.latest = app.latest;
    if (app.notes) out.notes = app.notes;
    if (repo.behind !== undefined) out.repoBehind = repo.behind;
    if (app._release) out._release = app._release;
    const errs = [app.status === 'error' && app.message, repo.error].filter(Boolean);
    if (app.status === 'available' || repo.behind > 0) out.status = 'available';
    else if (errs.length) out.status = 'error';
    else if (app.status === 'unconfigured' && !repo.upstream) out.status = 'unconfigured';
    if (errs.length) out.message = errs.join(' / ');
    else if (app.message) out.message = app.message;
    return out;
  }

  // ---- 다운로드 + 검증 ----
  // 엄격 파싱: 빈 줄 외에는 모두 "<64hex>(두 칸|공백*)<이름>" 이어야 하고, dmg 항목은 정확히 하나(또는 동일 해시 중복)
  function parseSums(text, name) {
    let found = null;
    for (const line of text.split('\n')) {
      const l = line.replace(/\r$/, '');
      if (l === '') continue;
      const m = /^([0-9a-fA-F]{64})(?: {2}| \*)([^\0\n]+)$/.exec(l);
      if (!m) throw new Error('SHA256SUMS 형식이 올바르지 않음');
      if (m[2] === name) {
        const h = m[1].toLowerCase();
        if (found && found !== h) throw new Error('SHA256SUMS 에 상충하는 항목이 있음');
        found = h;
      }
    }
    if (!found) throw new Error('SHA256SUMS 에 ' + name + ' 항목이 없음');
    return found;
  }

  async function downloadAndVerify(info, onProgress) {
    const r = info && info._release;
    if (!r || typeof r !== 'object' || !parseSemver(r.version) || r.dmgName !== `Maru-${r.version}-arm64.dmg`
      || typeof r.dmgUrl !== 'string' || typeof r.sumsUrl !== 'string' || typeof r.sigUrl !== 'string') throw new Error('받을 앱 업데이트 정보가 없음');
    const key = readConfig().key;
    if (!key) throw new Error('업데이트 서명 키(maru.updatePublicKey)가 설정되지 않음');
    const dir = fs.mkdtempSync(path.join(O.tmpDir || os.tmpdir(), 'maru-update-'));
    fs.chmodSync(dir, 0o700);
    const file = path.join(dir, 'Maru.dmg');
    try {
      const sumsBuf = await getBuffer(r.sumsUrl, O.maxSumsBytes, O.sumsTimeoutMs, 'application/octet-stream');
      const sigBuf = await getBuffer(r.sigUrl, 1024, O.sumsTimeoutMs, 'application/octet-stream');
      const sigTxt = sigBuf.toString('utf8').trim();
      const sig = /^[A-Za-z0-9+/]{86}==$/.test(sigTxt) ? Buffer.from(sigTxt, 'base64') : null;
      // 서명을 먼저 검증한다: 통과하기 전에는 SHA256SUMS 의 어떤 줄도 믿지 않는다
      if (!sig || sig.length !== 64 || !crypto.verify(null, sumsBuf, key, sig)) throw new Error('SHA256SUMS 서명이 올바르지 않음');
      const want = parseSums(sumsBuf.toString('utf8'), r.dmgName);
      const got = await getToFile(r.dmgUrl, file, { max: O.maxDmgBytes, timeoutMs: O.dmgTimeoutMs, expectSize: r.dmgSize, onProgress });
      if (r.dmgSize && got.size !== r.dmgSize) throw new Error('다운로드 크기가 릴리스 정보와 다름');
      if (got.sha256 !== want) throw new Error('체크섬 불일치: 파일을 삭제함');
      produced.set(file, { version: r.version });
      if (onProgress) { try { onProgress(1); } catch {} }
      return { dmgPath: file };
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} // 우리가 만든 비공개 temp 디렉터리
      throw e;
    }
  }

  // ---- 설치 ----
  const plistGet = async (plist, key) => (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { timeout: 10000 })).stdout.trim();

  function runningBundle() {
    const b = bundleFromExec();
    if (!b) throw new Error('패키징된 Maru.app 에서만 설치할 수 있음');
    return b;
  }

  const RESULT_NAME = 'install-result';
  const stateDirPath = () => O.stateDir || path.join(os.homedir(), 'Library', 'Application Support', 'Maru', 'update-state');
  function ensureStateDir() { const d = stateDirPath(); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700); return d; }
  const trashDir = () => O.trashDir || path.join(os.homedir(), '.Trash');

  // 시작 시 호출: 헬퍼 결과 파일을 읽고 지우고, 남은 .Maru.app.new-*/.old-* 를 휴지통으로 옮긴다(삭제 아님)
  function finishPendingInstall() {
    let out = null;
    const f = path.join(stateDirPath(), RESULT_NAME);
    try {
      const st = fs.lstatSync(f);
      if (st.isFile() && st.uid === process.getuid() && st.size < 2048) {
        const [s, v, ...msg] = fs.readFileSync(f, 'utf8').split('\n');
        out = { status: ['installed', 'rolledBack', 'failed'].includes(s) ? s : 'failed', version: SEMVER_RE.test(v) ? v : '', message: msg.join(' ').trim().slice(0, 200) };
      }
      fs.unlinkSync(f);
    } catch { /* 결과 파일 없음 */ }
    const bundle = bundleFromExec();
    if (bundle) {
      const parent = path.dirname(bundle);
      try {
        for (const n of fs.readdirSync(parent)) {
          if (!/^\.Maru\.app\.(new|old)-[0-9a-f]{12}$/.test(n)) continue;
          const p = path.join(parent, n);
          try {
            if (!fs.lstatSync(p).isDirectory()) continue;
            fs.mkdirSync(trashDir(), { recursive: true });
            fs.renameSync(p, path.join(trashDir(), `${n}-${crypto.randomBytes(3).toString('hex')}`));
          } catch { /* 헬퍼와 경합하거나 다른 볼륨이면 그대로 둔다 */ }
        }
      } catch {}
    }
    return out;
  }

  async function installAndRelaunch(dmgPath, opts) {
    const rec = produced.get(dmgPath);
    if (typeof dmgPath !== 'string' || !rec) throw new Error('이 프로세스가 검증해 받은 dmg 가 아님');
    if (process.platform !== 'darwin') throw new Error('macOS 에서만 설치할 수 있음');
    const bundle = runningBundle();
    const parent = path.dirname(bundle);
    if (fs.lstatSync(bundle).isSymbolicLink() || !fs.statSync(bundle).isDirectory()) throw new Error('앱 번들 경로가 올바르지 않음');
    try { fs.accessSync(parent, fs.constants.W_OK | fs.constants.X_OK); } catch { throw new Error('앱이 있는 폴더에 쓸 권한이 없음: ' + parent); }
    const electron = O.electron || require('electron');
    if (!electron || !electron.app || (O.electron == null && !electron.app.isPackaged)) throw new Error('패키징된 앱에서만 설치할 수 있음');
    const myId = await plistGet(path.join(bundle, 'Contents', 'Info.plist'), 'CFBundleIdentifier');
    const rnd = () => crypto.randomBytes(6).toString('hex');
    const staging = path.join(parent, `.Maru.app.new-${rnd()}`);
    const oldPath = path.join(parent, `.Maru.app.old-${rnd()}`);
    const mnt = fs.mkdtempSync(path.join(O.tmpDir || os.tmpdir(), 'maru-mnt-'));
    let mounted = false, helperDir = null, ok = false;
    const check = async (app) => {
      const pl = path.join(app, 'Contents', 'Info.plist');
      if (await plistGet(pl, 'CFBundleIdentifier') !== myId) throw new Error('번들 ID 가 실행 중인 앱과 다름');
      if (await plistGet(pl, 'CFBundleShortVersionString') !== rec.version) throw new Error('앱 버전이 릴리스와 다름');
    };
    try {
      await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt, dmgPath], { timeout: 120000 });
      mounted = true;
      const src = path.join(mnt, 'Maru.app');
      if (fs.lstatSync(src).isSymbolicLink() || !fs.statSync(src).isDirectory()) throw new Error('dmg 안에 Maru.app 이 없음');
      await check(src);
      await run('/usr/bin/ditto', [src, staging], { timeout: 300000 });
      await check(staging); // 복사본 재검증
      if (!O.skipCodesign) {
        try { await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staging], { timeout: 120000 }); }
        catch (e) { throw new Error('새 번들의 서명이 올바르지 않음(bundle signature is invalid): ' + firstLine(e.stderr || e.message)); }
      }
      helperDir = fs.mkdtempSync(path.join(O.tmpDir || os.tmpdir(), 'maru-swap-'));
      fs.chmodSync(helperDir, 0o700);
      const helper = path.join(helperDir, 'swap.sh');
      fs.writeFileSync(helper, HELPER_SH, { mode: 0o700 });
      const stateDir = ensureStateDir();
      const resultFile = path.join(stateDir, RESULT_NAME);
      try { fs.unlinkSync(resultFile); } catch {}
      const args = [helper, String(process.pid), bundle, staging, oldPath, '1', '1', '60', helperDir, '', resultFile, rec.version];
      const sp = O.spawn || spawn;
      const child = sp('/bin/sh', args, { detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir() } });
      await new Promise((res, rej) => { child.once('error', rej); child.once('spawn', res); if (child.spawned) res(); });
      if (child.unref) child.unref();
      ok = true;
    } finally {
      if (mounted) { try { await run('/usr/bin/hdiutil', ['detach', mnt], { timeout: 60000 }); } catch { try { await run('/usr/bin/hdiutil', ['detach', '-force', mnt], { timeout: 60000 }); } catch {} } }
      try { fs.rmdirSync(mnt); } catch {}
      if (!ok) {
        try { fs.rmSync(staging, { recursive: true, force: true }); } catch {} // 실패한 복사본(우리가 만든 것)
        if (helperDir) { try { fs.rmSync(helperDir, { recursive: true, force: true }); } catch {} }
      }
    }
    // 헬퍼가 정상 spawn 된 뒤에만, quit 직전에 호출한다(호출 쪽이 종료 확인을 건너뛰게 하는 용도)
    if (opts && typeof opts.beforeQuit === 'function') { try { opts.beforeQuit(); } catch { /* 무시 */ } }
    electron.app.quit();
  }

  // ---- 저장소 갱신 ----
  async function pullRepo(repoRoot) {
    const st = await repoState(repoRoot);
    if (!st.usable) return { ok: false, message: 'git 저장소(또는 git 실행 파일)를 찾을 수 없음' };
    if (!st.upstream) return { ok: false, message: '업스트림이 설정되어 있지 않음' };
    try {
      if ((await git(st.root, ['status', '--porcelain'], 15000)).stdout.trim() !== '') return { ok: false, message: '작업 트리에 변경이 있어 갱신하지 않음(커밋하거나 정리한 뒤 다시)' };
      const before = (await git(st.root, ['rev-parse', 'HEAD'], 10000)).stdout.trim();
      try {
        await run(gitPath, ['-C', st.root, 'pull', '--ff-only'], { timeout: 60000, env: gitEnv() });
      } catch (e) {
        let diverged = false;
        try { diverged = (await count(st.root, 'HEAD..@{u}')) > 0 && (await count(st.root, '@{u}..HEAD')) > 0; } catch {}
        return { ok: false, message: diverged ? '로컬과 업스트림이 갈라져 있어 갱신하지 않음(diverged)' : 'git pull 실패: ' + firstLine(e.stderr || e.message) };
      }
      const after = (await git(st.root, ['rev-parse', 'HEAD'], 10000)).stdout.trim();
      if (before === after) return { ok: true, message: '이미 최신' };
      const n = await count(st.root, `${before}..${after}`);
      return { ok: true, message: `커밋 ${n}개 반영` };
    } catch (e) {
      return { ok: false, message: 'git 실행 실패: ' + firstLine(e.stderr || e.message) };
    }
  }

  return { checkForUpdates, downloadAndVerify, installAndRelaunch, pullRepo, finishPendingInstall };
}

module.exports = { ...create(), _create: create, _HELPER_SH: HELPER_SH, _DEFAULTS: { ...DEFAULTS, gitCandidates: GIT_CANDIDATES } };
