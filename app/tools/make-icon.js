'use strict';
// 앱 아이콘(1024px PNG) 생성: `npx electron tools/make-icon.js` (Electron 오프스크린 캡처, 외부 다운로드 없음)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<rect x="64" y="64" width="896" height="896" rx="200" fill="#0B0907"/>
<rect x="64" y="64" width="896" height="896" rx="200" fill="none" stroke="#2B2119" stroke-width="6"/>
<g transform="translate(512 512) scale(21.5) translate(-17 -17)">
<circle cx="17" cy="17" r="15" fill="none" stroke="#FF8A2A" stroke-width="2"/>
<circle cx="17" cy="17" r="9" fill="none" stroke="#FF8A2A" stroke-width="1.5" stroke-dasharray="4 3"/>
<circle cx="17" cy="17" r="4" fill="#FF8A2A"/></g></svg>`;
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, webPreferences: { offscreen: true, sandbox: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:transparent">' + svg + '</body>'));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), img.toPNG());
  app.exit(0);
});
