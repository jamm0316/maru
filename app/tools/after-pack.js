'use strict';
// 패키징 후: node-pty 네이티브 바이너리에서 디버그 심볼을 제거(strip -S)해 빌드 경로 문자열을 없애고 ad-hoc 재서명한다.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const CLT = '/Library/Developer/CommandLineTools/usr/bin';

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'pty.node' || e.name === 'spawn-helper') out.push(p);
  }
  return out;
}

exports.default = async function afterPack(ctx) {
  const unpacked = path.join(ctx.appOutDir, 'Maru.app', 'Contents', 'Resources', 'app.asar.unpacked');
  if (!fs.existsSync(unpacked)) return;
  for (const f of walk(unpacked, [])) {
    execFileSync(path.join(CLT, 'strip'), ['-S', f], { stdio: 'inherit' });
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', f], { stdio: 'inherit' });
    console.log('  • stripped+resigned', path.relative(unpacked, f));
  }
};
