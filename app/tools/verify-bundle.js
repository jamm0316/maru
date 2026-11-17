'use strict';
// 빌드 게이트: 최종 dist 번들이 codesign 검증을 통과해야 하고, 실린 payload 가 package.json 의 extraResources 와 맞아야 한다.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const bundle = path.join(__dirname, '..', 'dist', 'mac-arm64', 'Maru.app');
const payload = path.join(bundle, 'Contents', 'Resources', 'payload');
const res = path.join(bundle, 'Contents', 'Resources');
const fail = (m) => { console.error('bundle check FAILED: ' + m); process.exit(1); };

// 1) extraResources 의 모든 목적지가 있어야 한다
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
for (const e of pkg.build.extraResources) if (!fs.existsSync(path.join(res, e.to))) fail('missing ' + e.to);
// 2) 꼭 있어야 하는 파일 + VERSION
for (const f of ['VERSION', 'CLAUDE.md', 'CLAUDE.en.md', 'squads-en/dev/squad.md', 'prompts/reflect-prompt.en.md', '.claude/skills/first-meeting/SKILL.md', 'scripts/maru-status.sh']) {
  if (!fs.existsSync(path.join(payload, f))) fail('payload missing ' + f);
}
// 3) 실행 비트
for (const f of ['install.sh', 'bin/maru', 'scripts/reflect.sh']) {
  let st; try { st = fs.statSync(path.join(payload, f)); } catch { fail('payload missing ' + f); }
  if (!(st.mode & 0o100)) fail('not executable: ' + f);
}
// 4) 싣지 말아야 할 것: data/, .git, settings.local.json, test-*.sh, __pycache__, 심볼릭 링크
(function walk(d, rel) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n); const r = rel ? rel + '/' + n : n; const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) fail('symlink in payload: ' + r);
    const low = n.toLowerCase();
    if ((!rel && (low === 'data' || low === '.git')) || low === 'settings.local.json' || low === '__pycache__' || /^test-.*\.sh$/.test(n)) fail('forbidden in payload: ' + r);
    if (st.isDirectory()) walk(p, r);
  }
})(payload, '');
// 5) 빌더의 홈 경로/사용자명이 번들 어디에도 남아 있으면 안 된다(공개 배포물 프라이버시)
{
  const home = require('os').homedir();
  const needles = [home, path.dirname(home) + '/' + path.basename(home)].map((s) => Buffer.from(s));
  const hits = [];
  (function scan(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) scan(p);
      else if (e.isFile()) {
        const b = fs.readFileSync(p);
        if (needles.some((n) => b.includes(n))) hits.push(path.relative(bundle, p));
      }
    }
  })(bundle);
  if (hits.length) fail('builder home path found in:\n  ' + hits.join('\n  '));
  console.log('home-path guard OK');
}
try {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle], { stdio: 'inherit' });
  console.log('codesign verify OK:', bundle);
} catch {
  console.error('codesign verify FAILED:', bundle);
  process.exit(1);
}
