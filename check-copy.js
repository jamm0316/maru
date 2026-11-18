// node check-copy.js — every data-i18n key used in index.html exists in en and ko, and no copy key is unused.
const fs = require('fs'), vm = require('vm');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/copy.js', 'utf8'), ctx);
const C = ctx.window.MARU_COPY, html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const used = new Set();
for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(';').forEach(p => used.add(p.slice(p.indexOf(':') + 1).trim()));
for (const m of html.matchAll(/data-link="[^"]+"[^>]*data-i18n="([^"]+)"/g)) used.add(m[1] + '.soon');
// The by-role demo is built in main.js from structured copy: every quoted 'demo.…' key in main.js counts as used.
for (const m of fs.readFileSync(__dirname + '/main.js', 'utf8').matchAll(/'(demo\.[\w.]+)'/g)) used.add(m[1]);
['try.p1', 'try.p2', 'try.p3', 'meta.title', 'meta.description', 'soon', 'video.play', 'video.pause', 'install.copied'].forEach(k => used.add(k));
let bad = 0;
for (const l of ['en', 'ko']) {
  for (const k of used) if (!C[l][k]) { console.log('missing', l, k); bad++; }
  for (const k of Object.keys(C[l])) if (!used.has(k)) { console.log('unused', l, k); bad++; }
}
const a = Object.keys(C.en).sort().join(), b = Object.keys(C.ko).sort().join();
if (a !== b) { console.log('en/ko key sets differ'); bad++; }
console.log(bad ? 'FAIL' : 'OK', used.size, 'keys');
process.exit(bad ? 1 : 0);
