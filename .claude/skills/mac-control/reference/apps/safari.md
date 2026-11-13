# Safari (com.apple.Safari)
- 스크립트: 예 — 번들 Info.plist 의 `OSAScriptingDefinition` = `Safari.sdef`(확인됨). 권한: 자동화(실행 주체 → Safari). 실행하지 않고 확인한 노트다.
## 빠른 방법
- 앱 존재: `open -Ra Safari`(rc 0)
- 탭 URL: `tell application "Safari" to get URL of every tab of every window`(미검증)
- URL 열기: `open -a Safari <url>`(미검증)
## 함정
- 앱이 꺼져 있을 때 `tell`하면 Safari 가 켜진다. 먼저 `lsappinfo list | grep com.apple.Safari`.
- `~/Library/Safari` 의 기록·북마크 파일은 전체 디스크 접근이 없으면 `Operation not permitted`. 직접 읽지 말고 AppleScript 로 본다.
- 페이지 JS 실행은 Safari 개발자 설정에서 사용자가 허용해야 한다(미검증).
## 검증: 2026-11 macOS 26 — sdef 존재만 확인, 호출은 미검증
