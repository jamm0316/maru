# CLI 모음

표기: 표시 없는 명령은 macOS 26 에서 읽기 전용 형태로 실행해 성공을 확인했다. `(미검증)`은 실행하지 않았거나(부작용이 있어서) 확인하지 못한 것, `(권한 필요: …)`는 해당 권한이 있어야 동작하는 것이다. 값을 바꾸는 명령은 모두 실행 전 현재 값을 읽어 두고, 끝나면 다시 읽어 확인한다.

## 앱
```
open -Ra "Safari"; echo $?                  # 앱 존재 확인(실행 안 함). 없으면 1과 메시지
open -a "Safari"                            # (미검증) 앱 실행 — GUI가 뜬다
open -a "Safari" https://example.com        # (미검증) 특정 앱으로 URL 열기
open -a "TextEdit" ~/경로/파일.txt           # (미검증) 특정 앱으로 파일 열기
open -b com.apple.Safari                    # (미검증) 번들 ID로 실행
osascript -e 'quit app "Safari"'            # (미검증)(권한 필요: 자동화) 정상 종료(저장 확인 창이 뜰 수 있음)
lsappinfo list                              # 실행 중 앱(번들 ID·경로·PID)
lsappinfo front                             # 맨 앞 앱의 ASN
lsappinfo info -only name -only bundleid "$(lsappinfo front)"   # 맨 앞 앱 이름·번들 ID
mdfind "kMDItemCFBundleIdentifier == 'com.apple.Safari'"        # 번들 ID → 앱 경로
mdfind -name "Safari.app" -onlyin /Applications                 # 이름 → 경로 (로캘 로그 한 줄이 섞여 나올 수 있음)
plutil -extract CFBundleIdentifier raw /Applications/Safari.app/Contents/Info.plist   # 경로 → 번들 ID
```
- 강제 종료(`kill`, `killall`)는 저장 안 된 작업을 날린다. 정상 종료가 안 될 때만, 사용자에게 알리고 한다.

## 파일
```
mdfind -onlyin ~/Documents -name 보고서                       # 파일명 검색
mdfind -onlyin ~/Documents "kMDItemFSName == '*.pdf'c"        # 이름 패턴(c=대소문자 무시)
mdfind "kMDItemKind == 'PDF 문서'" -onlyin ~/Downloads        # 종류 조건(종류 이름은 시스템 언어를 따른다)
mdls -name kMDItemKind -name kMDItemFSSize 파일               # 메타데이터 조회
open -R ~/경로/파일                                           # (미검증) Finder에서 해당 파일 선택해 보이기
open ~/경로/폴더                                              # (미검증) Finder로 폴더 열기
trash 파일1 파일2                                             # 휴지통으로 이동(macOS 내장 /usr/bin/trash, --help 확인. 실제 이동은 미검증)
osascript -e 'tell application "Finder" to delete POSIX file "/절대/경로"'   # (미검증)(권한 필요: 자동화) 휴지통으로 이동, "되돌리기" 가능
```
- `rm`, `rm -rf`, 휴지통 비우기는 쓰지 않는다. 이동·이름 변경은 `mv -n`(덮어쓰기 방지) 후 목록으로 확인.
- `mdfind`는 Spotlight 색인이 대상이라 방금 만든 파일·제외된 폴더는 안 나올 수 있다. 그때는 `find 폴더 -name ...`.
- `~/Library` 일부(Safari, Messages, Mail)는 (권한 필요: 전체 디스크 접근) — 이 맥에서 `ls ~/Library/Safari` 가 `Operation not permitted`.

## 시스템 상태
```
sw_vers                                    # macOS 버전·빌드
sysctl -n hw.model; sysctl -n hw.memsize; sysctl -n hw.ncpu
pmset -g batt                              # 배터리 %·충전 여부
pmset -g assertions                        # 잠자기를 막고 있는 것
pmset -g therm                             # 열 제한 상태
uptime
df -h /                                    # 디스크 사용량(APFS는 볼륨 합계가 아니라 이 줄을 본다)
diskutil list                              # 디스크·파티션
vm_stat                                    # 메모리 페이지 통계(페이지 크기 16384)
top -l 1 -n 5 -o cpu -stats pid,command,cpu,mem    # CPU 상위 프로세스(1회 샘플, ~2초)
ps -Ao pid,pcpu,pmem,comm -r               # CPU 순 프로세스 목록
ps -axo pid,ppid,pcpu,pmem,etime,comm -r   # 부모 PID·경과 시간 포함
lsof -iTCP -sTCP:LISTEN -nP                # 열린 TCP 포트(내 프로세스 위주)
system_profiler SPHardwareDataType -detailLevel mini    # 하드웨어(시리얼 번호가 나오니 결과를 저장·공유하지 않는다)
system_profiler SPDisplaysDataType SPPowerDataType SPStorageDataType SPSoftwareDataType SPBluetoothDataType
networksetup -listallnetworkservices       # 네트워크 서비스 이름
networksetup -getinfo Wi-Fi                # IP·라우터(식별자이므로 저장하지 않는다)
networksetup -getairportpower en0          # Wi-Fi 전원
scutil --nwi                               # 현재 네트워크 상태 요약
scutil --dns | head -20                    # DNS 설정
scutil --get ComputerName                  # 컴퓨터 이름(개인 이름일 수 있음)
ifconfig -l                                # 인터페이스 이름만
mdutil -s /                                # Spotlight 색인 상태
tmutil latestbackup                        # 최근 백업 경로
networksetup -setairportpower en0 off      # (미검증) 변경 — 사용자 요청이 있을 때만
```
- `system_profiler` 는 전체를 돌리면 느리다. 데이터 타입을 하나씩 지정한다.

## 설정(defaults)
```
defaults read com.apple.dock tilesize          # 독 아이콘 크기
defaults read -g AppleInterfaceStyle           # Dark 이면 다크 모드, 키 없음(rc=1)이면 라이트
defaults domains | tr ',' '\n' | grep -i finder
defaults read com.apple.finder AppleShowAllFiles   # 키가 없으면 rc=1 = 기본값 사용 중
defaults write com.apple.dock autohide -bool true && killall Dock   # (미검증) 변경 예시
```
- `write` 전에 `read`로 원래 값을 기록하고, 되돌리는 명령을 사용자에게 알린다. `defaults delete`는 기본값 복귀.
- 대부분 해당 앱 재시작(`killall Dock` 등)이나 로그아웃 후 반영된다. 앱이 실행 중 값을 덮어쓸 수도 있어 쓴 뒤 다시 읽어 확인한다.
- **보안·개인정보 설정(방화벽, Gatekeeper, SIP, 개인정보 권한, 로그인 암호 관련)은 건드리지 않는다.** 사용자에게 시스템 설정에서 하라고 안내한다.
- 시스템 설정 창 열기: `open "x-apple.systempreferences:com.apple.preference.security"` (미검증, 창만 연다).

## 소프트웨어
```
brew list --versions; brew list --cask         # 설치 목록
brew leaves                                    # 직접 설치한 formula만
brew outdated                                  # 업데이트 가능 목록
brew info bun                                  # 패키지 정보
brew install <이름>                            # (미검증) 설치 — 먼저 사용자에게 확인
brew uninstall <이름>                          # (미검증) 제거 — 먼저 사용자에게 확인
softwareupdate -l                              # 읽기 전용이지만 25초 넘게 걸려 중단됐다 → 느림(시간 제한을 넉넉히, 결과는 미검증)
mas list                                       # (미검증) mas 설치 시. 이 맥에는 없을 수 있다(`command -v mas`)
```
- `softwareupdate -i`, `brew upgrade`, `mas install`은 시스템을 바꾸므로 확인 후에만. 앱 설치 확인은 `data/mac-inventory.md`.

## 클립보드·알림·소리·화면 유지
```
printf '%s' "텍스트" | pbcopy                  # 클립보드에 쓰기(기존 내용을 덮어쓴다 — 사용자 것을 덮기 전에 알린다) (쓰기는 미검증)
pbpaste                                        # 클립보드 읽기(내용이 민감할 수 있으니 필요할 때만, 기록에 남기지 않는다)
osascript -e 'display notification "본문" with title "제목"'   # 알림 센터에 알림(오류 없이 실행됨. 표시 여부는 알림 설정에 따름)
say "안녕하세요"                               # (미검증) 소리 출력. 목록은 say -v '?'(확인됨)
caffeinate -t 1                                # 1초 동안 잠자기 방지(확인됨). 오래 켜려면 caffeinate -di -t 3600 & (미검증)
osascript -e 'output volume of (get volume settings)'   # 현재 볼륨 읽기
```

## 스크린샷
```
screencapture -x ~/Desktop/shot.png            # (미검증)(권한 필요: 화면 기록) 소리 없이 전체 화면 저장
screencapture -x -R x,y,w,h out.png            # (미검증)(권한 필요: 화면 기록) 영역 캡처
```
- 권한이 없으면 배경화면만 찍힌 이미지가 나올 수 있다. 사진에 개인정보가 담길 수 있으니 필요한 만큼만 찍고 쓴 뒤 정리한다.

## 단축어
```
shortcuts list                                 # 단축어 이름 목록(프롬프트 없이 동작 확인)
shortcuts list --folders                       # 폴더 목록
shortcuts run "이름" < 입력파일                # (미검증) 실행. 단축어 안의 동작이 권한 창을 띄울 수 있다
shortcuts view "이름"                          # (미검증) 편집기 창을 연다
```

## 열기·예약·기타
```
open https://example.com                       # (미검증) 기본 브라우저로 URL 열기
open -a "Google Chrome" https://example.com    # (미검증)
launchctl list | head                          # 사용자 launchd 작업 목록(읽기 전용)
launchctl list com.apple.Finder                # 특정 작업 상세
launchctl print gui/$(id -u)                   # 사용자 도메인 전체 상세(길다)
launchctl print-disabled user/$(id -u)         # 비활성화된 서비스
crontab -l                                     # (미검증) 예약된 cron
```
- `launchctl load/unload/bootout`, plist 생성·삭제는 시스템 설정 변경에 준하므로 사용자 확인 없이 하지 않는다.
- 한 번만 늦게 실행하는 일은 `sleep N; 명령` 대신 Claude Code의 예약 기능이나 사용자 단축어를 우선 고려한다.
