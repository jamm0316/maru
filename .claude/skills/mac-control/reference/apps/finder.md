# Finder (com.apple.finder)
- 스크립트: 예 — `/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.sdef`. 권한: 자동화(실행 주체 → Finder).
## 빠른 방법
- 읽기: `osascript -e 'tell application "Finder" to get name of every disk'`
- 휴지통으로: `trash 경로...`(내장 CLI) 또는 `tell application "Finder" to delete POSIX file "/절대/경로"`(후자는 되돌리기 가능, 미검증)
- 파일 선택해 보이기: `open -R 경로`(미검증)
- 파일 검색은 Finder 보다 `mdfind`/`mdls`(권한 불필요)가 빠르다.
## 함정
- Finder 는 항상 실행 중이라 호출해도 앱이 새로 뜨지 않는다.
- 경로는 절대 경로 + `POSIX file`. 상대 경로·`~`는 풀리지 않는다.
- 숨김 파일 표시 토글은 `defaults write com.apple.finder AppleShowAllFiles` + `killall Finder`(미검증). 읽기는 키가 없으면 rc=1이 정상.
## 검증: 2026-11 macOS 26 — 읽기 호출 확인
