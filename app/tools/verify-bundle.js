'use strict';
// 빌드 게이트: 최종 dist 번들이 codesign 검증을 통과해야 한다(dmg 를 만든 뒤에도 한 번 더 확인).
const { execFileSync } = require('child_process');
const path = require('path');
const bundle = path.join(__dirname, '..', 'dist', 'mac-arm64', 'Maru.app');
try {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle], { stdio: 'inherit' });
  console.log('codesign verify OK:', bundle);
} catch {
  console.error('codesign verify FAILED:', bundle);
  process.exit(1);
}
