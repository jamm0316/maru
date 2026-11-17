#!/bin/bash
# site/install.sh(웹 한 줄 설치) 회귀 시험. 0=통과 1=실패.
# 네트워크·실제 /Applications·실제 HOME 은 쓰지 않는다: 가짜 dmg 를 file:// 로 내려받고, 모든 경로는 mktemp 폴더 아래다.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd -P)
SCRIPT=$REPO/site/install.sh
T=$(mktemp -d 2>/dev/null) || { echo "mktemp 실패" >&2; exit 1; }
T=$(cd "$T" && pwd -P)
REAL_HOME=${HOME:-}
case "$T" in ""|/|"$REAL_HOME"|"$REPO"|"$REPO"/*) echo "임시 경로가 아님: $T — 종료" >&2; exit 1;; esac
cleanup() { hdiutil info 2>/dev/null | grep -q "$T" && hdiutil detach -force "$T/mnt-leak" >/dev/null 2>&1; case "$T" in /*/*) rm -rf "$T";; esac; }
trap cleanup EXIT

FAIL=0; N=0
ok()   { N=$((N+1)); echo "  ok   $*"; }
bad()  { N=$((N+1)); FAIL=$((FAIL+1)); echo "  FAIL $*"; }
check() { local name=$1; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }

# 가짜 dmg: Maru.app 폴더 하나(안에 표지 파일)
mkdir -p "$T/src/Maru.app/Contents/MacOS" "$T/home"
echo "new-build" > "$T/src/Maru.app/Contents/MacOS/marker"
hdiutil create -quiet -srcfolder "$T/src" -volname MaruTest -format UDZO "$T/fake.dmg" >/dev/null 2>&1 || { echo "hdiutil create 실패 — 시험 불가" >&2; exit 1; }
SHA=$(shasum -a 256 "$T/fake.dmg" | awk '{print $1}')
BAD=0000000000000000000000000000000000000000000000000000000000000000
NOTTY=$T/no-such-tty

# 환경을 전부 임시 경로로 고정해 설치 스크립트를 돌린다. 인자: 추가 환경변수들. 출력은 $T/out 에 모은다.
run() { env -i PATH="$PATH" HOME="$T/home" TMPDIR="$T/tmp" LANG=en_US.UTF-8 MARU_LANG=en \
  MARU_DMG_URL="file://$T/fake.dmg" MARU_DMG_SHA256="$SHA" MARU_INSTALL_DIR="$T/apps" \
  MARU_NO_OPEN=1 MARU_SKIP_OS_CHECK=1 MARU_TTY="$NOTTY" "$@" /bin/bash "$SCRIPT" > "$T/out" 2>&1 < /dev/null; }
reset() { rm -rf "$T/apps" "$T/home/.Trash" "$T/tmp"; mkdir -p "$T/tmp"; }
nomount() { ! hdiutil info | grep -q "$T"; }
notmp() { [ -z "$(ls -A "$T/tmp" 2>/dev/null)" ]; }

echo "== 정적 검사"
check "bash -n 통과" bash -n "$SCRIPT"
check "sudo 를 쓰지 않음" sh -c '! grep -v "^ *#" "$1" | grep -q "sudo"' _ "$SCRIPT"
check "마지막 줄이 main \"\$@\"" [ "$(tail -n 1 "$SCRIPT")" = 'main "$@"' ]
check "고정 상수 4개" [ "$(grep -c '^\(VERSION\|DMG_NAME\|DMG_URL\|DMG_SHA256\)=' "$SCRIPT")" = 4 ]

echo "== 새 설치"
reset; run; rc=$?
check "새 설치 성공(종료 0)" [ $rc = 0 ]
check "앱 폴더가 생김" [ "$(cat "$T/apps/Maru.app/Contents/MacOS/marker" 2>/dev/null)" = new-build ]
check "마운트가 남지 않음" nomount
check "임시 파일이 남지 않음" notmp
check "숨김 임시 앱이 남지 않음" [ "$(ls -A "$T/apps" | wc -l | tr -d ' ')" = 1 ]

echo "== 잘못된 SHA"
reset; run MARU_DMG_SHA256=$BAD; rc=$?
check "SHA 불일치는 실패" [ $rc != 0 ]
check "기대값/실제값을 출력" sh -c 'grep -q "expected: '$BAD'" "$1" && grep -q "actual:   '$SHA'" "$1"' _ "$T/out"
check "아무것도 설치되지 않음" [ ! -e "$T/apps/Maru.app" ]
check "마운트·임시 파일 없음" sh -c '! hdiutil info | grep -q "$1" && [ -z "$(ls -A "$2/tmp")" ]' _ "$T" "$T"

echo "== 기존 앱"
reset; mkdir -p "$T/apps/Maru.app"; echo old-build > "$T/apps/Maru.app/marker"
run; rc=$?
check "tty 도 MARU_YES 도 없으면 중단" [ $rc != 0 ]
check "MARU_YES 안내 메시지" grep -q MARU_YES "$T/out"
check "기존 앱 유지" [ "$(cat "$T/apps/Maru.app/marker")" = old-build ]
check "중단 시 임시 파일 없음" notmp

run MARU_YES=1; rc=$?
check "MARU_YES=1 로 교체 성공" [ $rc = 0 ]
check "새 앱으로 교체됨" [ "$(cat "$T/apps/Maru.app/Contents/MacOS/marker" 2>/dev/null)" = new-build ]
check "옛 앱이 임시 HOME 휴지통에 있음" [ "$(cat "$T"/home/.Trash/Maru-*.app/marker 2>/dev/null)" = old-build ]
check "교체 뒤 마운트·임시 파일 없음" sh -c '! hdiutil info | grep -q "$1" && [ -z "$(ls -A "$2/tmp")" ]' _ "$T" "$T"

echo "== tty 질문(MARU_TTY 로 대신 입력)"
reset; mkdir -p "$T/apps/Maru.app"; echo old-build > "$T/apps/Maru.app/marker"
echo n > "$T/answer"; run MARU_TTY="$T/answer"; rc=$?
kept_old() { [ "$(cat "$T/apps/Maru.app/marker" 2>/dev/null)" = old-build ]; }
check "n 이면 중단하고 기존 앱 유지" sh -c '[ "$1" != 0 ]' _ $rc; check "n 이면 기존 앱 그대로" kept_old
echo y > "$T/answer"; run MARU_TTY="$T/answer"; rc=$?
replaced() { [ -f "$T/apps/Maru.app/Contents/MacOS/marker" ] && [ "$(cat "$T"/home/.Trash/Maru-*.app/marker 2>/dev/null)" = old-build ]; }
check "y 이면 성공" [ $rc = 0 ]; check "y 이면 교체하고 옛 앱은 휴지통" replaced

echo "== 실행 중이면 중단"
reset; mkdir -p "$T/apps/Maru.app/Contents/MacOS"; echo old-build > "$T/apps/Maru.app/marker"
printf '#!/bin/sh\nsleep 30\n' > "$T/apps/Maru.app/Contents/MacOS/Maru"; chmod +x "$T/apps/Maru.app/Contents/MacOS/Maru"; "$T/apps/Maru.app/Contents/MacOS/Maru" & SPID=$!
sleep 0.3; run MARU_YES=1; rc=$?; kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null
check "실행 중이면 실패" [ $rc != 0 ]; check "실행 중이면 앱 유지" kept_old; check "종료 안내 메시지" grep -qi quit "$T/out"

echo "== 한국어 메시지"
reset; run MARU_LANG=ko; rc=$?
check "MARU_LANG=ko 이면 한국어(설치했습니다)" grep -q "설치했습니다" "$T/out"

echo
if [ $FAIL = 0 ]; then echo "OK $N checks"; exit 0; else echo "FAIL $FAIL of $N checks"; exit 1; fi
