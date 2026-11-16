'use strict';
// 앱 아이콘(1024px PNG)과 메뉴 막대 트레이 아이콘 생성: `npx electron tools/make-icon.js` (Electron 오프스크린 캡처, 외부 다운로드 없음)
//   --tray-only : build/trayTemplate.png(18x18)·trayTemplate@2x.png(36x36)만 만든다(앱 아이콘 icon.png 는 건드리지 않음)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// 로고 도안은 lib.js 의 LOGO·logoShapesSvg 하나에만 있다(앱 아이콘·헤더·트레이 공용). 로고를 바꿀 때는 거기만 고친다.
const { LOGO, logoShapesSvg } = require('../lib');
// 앱 아이콘: 1024 정사각형 전체를 타일 색으로 꽉 채운다(여백·둥근 모서리·테두리 없음; macOS 가 자기 마스크를 씌운다).
// 도안은 예전과 같은 절대 크기(896px 안에 135 단위 → 배율 896/135)로 가운데에 둔다.
const appIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<rect width="1024" height="1024" fill="${LOGO.tileColor}"/>
<g transform="translate(64 64) scale(${896 / LOGO.tile})">${logoShapesSvg(LOGO.color, 'mark')}</g></svg>`;
// 트레이 템플릿 이미지: 검정 도형 + 투명 배경(macOS 가 메뉴 막대 색에 맞춰 칠한다). 144px 로 그린 뒤 줄인다.
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 ${LOGO.tile} ${LOGO.tile}">${logoShapesSvg('#000000', 'tray')}</svg>`;

// icon.png -> icon.icns: sips 로 크기별 PNG 를 만들고 iconutil 로 묶는다(macOS 기본 도구). 도구가 없으면 기존 icns 를 그대로 둔다.
function makeIcns(png, icns) {
  const { execFileSync } = require('child_process'); const os = require('os');
  const set = fs.mkdtempSync(path.join(os.tmpdir(), 'maru-icon-')) + '/icon.iconset';
  try {
    fs.mkdirSync(set);
    for (const [n, px] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]]) {
      execFileSync('/usr/bin/sips', ['-z', String(px), String(px), png, '--out', path.join(set, 'icon_' + n + '.png')], { stdio: 'ignore' });
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', icns], { stdio: 'ignore' });
    console.log('icns regenerated');
  } catch (e) { console.log('icns NOT regenerated (' + e.message.split('\n')[0] + '); kept the old icon.icns'); }
  finally { fs.rmSync(path.dirname(set), { recursive: true, force: true }); }
}

async function render(svg, size, transparent, bg) {
  const win = new BrowserWindow({ show: false, width: size, height: size, useContentSize: true, transparent: !!transparent, frame: false, webPreferences: { offscreen: true, sandbox: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:' + (bg || 'transparent') + ';overflow:hidden">' + svg + '</body>'));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.close();
  return img;
}

app.whenReady().then(async () => {
  const out = path.join(__dirname, '..', 'build');
  if (!process.argv.includes('--tray-only')) fs.writeFileSync(path.join(out, 'icon.png'), (await render(appIconSvg, 1024, false, LOGO.tileColor)).toPNG());
  if (!process.argv.includes('--tray-only')) makeIcns(path.join(out, 'icon.png'), path.join(out, 'icon.icns'));
  const big = await render(traySvg, 144, true);
  for (const [name, px] of [['trayTemplate.png', 18], ['trayTemplate@2x.png', 36]]) {
    const img = big.resize({ width: px, height: px, quality: 'best' });
    fs.writeFileSync(path.join(out, name), img.toPNG());
  }
  app.exit(0);
});
