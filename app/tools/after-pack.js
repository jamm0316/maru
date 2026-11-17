'use strict';
// 패키징 후: (1) app.asar.unpacked 의 모든 *.node 와 spawn-helper에서 디버그 심볼을 제거(strip -S)해 빌드 경로 문자열을 없애고 개별 재서명한다.
// (2) 마지막에 번들 전체를 ad-hoc 서명한다(--deep, 하드닝 런타임 없음). mac.identity=null 이면 electron-builder 가 서명을 건너뛰고
//     afterSign 훅도 실행하지 않으므로(macPackager: "skipping afterSign hook as no signing occurred") 서명은 afterPack 의 맨 끝에서 한다.
// (3) 게이트: codesign --verify --deep --strict 가 통과하지 않으면 빌드를 실패시킨다.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const STRIP = ['/Library/Developer/CommandLineTools/usr/bin/strip', '/usr/bin/strip'].find((p) => fs.existsSync(p));

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.node') || e.name === 'spawn-helper') out.push(p);
  }
  return out;
}

exports.default = async function afterPack(ctx) {
  if (!STRIP) throw new Error('strip 을 찾을 수 없음');
  const bundle = path.join(ctx.appOutDir, 'Maru.app');
  // payload/VERSION: 앱 버전(관리형 홈의 마커와 비교한다). 서명 전에 쓴다.
  const pdir = path.join(bundle, 'Contents', 'Resources', 'payload');
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, 'VERSION'), require('../package.json').version + '\n');
  const unpacked = path.join(bundle, 'Contents', 'Resources', 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) {
    for (const f of walk(unpacked, [])) {
      execFileSync(STRIP, ['-S', f], { stdio: 'inherit' });
      console.log('  • stripped', path.relative(unpacked, f));
    }
  }
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' }); // 실패하면 예외 -> 빌드 실패
  console.log('  • ad-hoc signed and verified', bundle);
};
