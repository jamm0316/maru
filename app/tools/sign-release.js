#!/usr/bin/env node
'use strict';
// 릴리스 서명 도구(소유자용). Ed25519 분리 서명.
//   node sign-release.js keygen <개인키경로>          키 쌍 생성: 공개키(base64 32바이트)를 출력, 개인키는 0600 으로 저장(덮어쓰기 거부)
//   node sign-release.js sign <개인키경로> <SHA256SUMS> [출력경로]   기본 출력은 <SHA256SUMS>.sig (서명의 base64)
// 공개키는 app/package.json 의 maru.updatePublicKey 에 넣는다. 개인키는 저장소·릴리스에 올리지 않는다.
const fs = require('fs');
const crypto = require('crypto');

function keygen(privPath) {
  if (!privPath) throw new Error('개인키 경로가 필요함');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  // wx: 이미 있으면 실패(덮어쓰기 거부), 0600
  fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  return publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
}

function sign(privPath, sumsPath, outPath) {
  if (!privPath || !sumsPath) throw new Error('개인키와 SHA256SUMS 경로가 필요함');
  const st = fs.statSync(privPath);
  if (st.mode & 0o077) throw new Error('개인키 권한이 너무 넓음(chmod 600 필요)');
  const key = crypto.createPrivateKey(fs.readFileSync(privPath));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 키가 아님');
  const sig = crypto.sign(null, fs.readFileSync(sumsPath), key).toString('base64');
  const out = outPath || sumsPath + '.sig';
  fs.writeFileSync(out, sig + '\n');
  return out;
}

module.exports = { keygen, sign };

if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    if (cmd === 'keygen') {
      const pub = keygen(a[0]);
      console.log('공개키(package.json 의 maru.updatePublicKey):\n' + pub + '\n개인키 저장: ' + a[0]);
    } else if (cmd === 'sign') console.log('서명 저장: ' + sign(a[0], a[1], a[2]));
    else { console.error('사용법: keygen <개인키경로> | sign <개인키경로> <SHA256SUMS> [출력]'); process.exit(2); }
  } catch (e) { console.error('오류: ' + e.message); process.exit(1); }
}
