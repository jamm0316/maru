#!/bin/bash
# scripts/optional.sh(--with-cli, --with-cmux)와 maru_config.py dock-check 회귀 시험. 0=통과 1=실패.
# 실제 홈은 쓰지 않는다: 시작 시 HOME/XDG_CONFIG_HOME/MARU_* 를 mktemp 폴더로 강제하고, 임시 경로가 아니면 즉시 종료한다.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd -P)
REAL_HOME=${HOME:-}
T=$(mktemp -d 2>/dev/null) || { echo "mktemp 실패" >&2; exit 1; }
T=$(cd "$T" && pwd -P)
case "$T" in ""|/|"$REAL_HOME"|"$REAL_HOME"/*|"$REPO"|"$REPO"/*) echo "임시 경로가 아님: $T — 종료" >&2; exit 1;; esac
[ -d "$T" ] && [ -w "$T" ] || { echo "임시 폴더 이상 — 종료" >&2; exit 1; }
trap 'case "$T" in /*/*) rm -rf "$T";; esac' EXIT
export HOME=$T/home XDG_CONFIG_HOME=$T/home/.config MARU_DATA=$T/data MARU_BIN_DIR=$T/bin MARU_CMUX_APP=$T/cmux.app
unset MARU_HOME CLAUDE_CONFIG_DIR
mkdir -p "$HOME" "$MARU_DATA" "$T/cmux.app"
ROOT=$REPO; DRY=""; BACKUPS=$MARU_DATA/backups; ORIG_PATH=$PATH
# shellcheck disable=SC1091
. "$REPO/scripts/optional.sh"

FAIL=0; N=0
ok()   { N=$((N+1)); echo "  ok   $*"; }
bad()  { N=$((N+1)); FAIL=$((FAIL+1)); echo "  FAIL $*"; }
check() { local name=$1; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
DOCK=$XDG_CONFIG_HOME/cmux/dock.json
reset() { chmod -R u+w "$T/home" "$T/data" "$T/bin" "$T/x" 2>/dev/null; rm -rf "$T/home/.config" "$T/data/backups" "$T/bin" "$T/x" "$T/victim"*; ROOT=$REPO; DRY=""; export MARU_BIN_DIR=$T/bin; }
gen() { _opt_py dock-gen --dir "$REPO"; }
cnt() { find "$1" -mindepth 1 2>/dev/null | wc -l | tr -d ' '; }

echo "== cmux: 새 설치 / 재실행 / 사용자 파일 / dry-run"
reset
out=$(install_cmux 2>&1); check "새 설치로 dock.json 생성" [ "$(cat "$DOCK" 2>/dev/null)" = "$(gen)" ]
check "임시 파일 잔여 없음" [ "$(ls -A "$(dirname "$DOCK")" | wc -l | tr -d ' ')" = 1 ]
out=$(install_cmux 2>&1); check "재실행은 이미 설치됨" sh -c 'echo "$1" | grep -q "이미 설치됨"' _ "$out"
echo '{"controls":[{"id":"mine"}]}' > "$DOCK"; before=$(cat "$DOCK")
install_cmux >/dev/null 2>&1; check "사용자 파일 보존" [ "$(cat "$DOCK")" = "$before" ]
reset; DRY=--dry-run; install_cmux >/dev/null 2>&1; check "dry-run 은 파일을 만들지 않음" [ ! -e "$DOCK" ]
DRY=""; install_cmux >/dev/null 2>&1; DRY=--dry-run; uninstall_cmux >/dev/null 2>&1
check "uninstall dry-run 은 파일 유지" [ -f "$DOCK" ]; check "uninstall dry-run 은 백업 안 만듦" [ ! -e "$BACKUPS" ]
DRY=""; uninstall_cmux >/dev/null 2>&1
check "uninstall 이 삭제" [ ! -e "$DOCK" ]; check "uninstall 백업 생성" [ "$(cnt "$BACKUPS")" = 1 ]
echo '{"controls":[{"id":"mine"}]}' > "$DOCK"; uninstall_cmux >/dev/null 2>&1; check "uninstall 은 사용자 파일 보존" [ -f "$DOCK" ]
reset; ln -sfn "$REPO" "$HOME/maru"; mkdir -p "$(dirname "$DOCK")"
printf '{"controls":[{"id":"maru-ui","title":"maru","command":"\\"$HOME/maru/bin/maru\\" ui"}]}' > "$DOCK"
install_cmux >/dev/null 2>&1; check "legacy 형식은 갱신 + 백업" [ "$(cat "$DOCK")" = "$(gen)" ] && [ "$(cnt "$BACKUPS")" = 1 ]

echo "== cmux: tmp 링크 공격 / 링크 dock.json / 백업 실패"
reset; mkdir -p "$(dirname "$DOCK")"; echo victim > "$T/victim"; ln -s "$T/victim" "$(dirname "$DOCK")/dock.json.maru-tmp"
install_cmux >/dev/null 2>&1
check "tmp 링크 공격: victim 불변" [ "$(cat "$T/victim")" = victim ]; check "dock.json 이 일반 파일" [ -f "$DOCK" ] && [ ! -L "$DOCK" ]
reset; mkdir -p "$(dirname "$DOCK")"; ln -s "$T/nonexistent" "$DOCK"
install_cmux >/dev/null 2>&1; uninstall_cmux >/dev/null 2>&1
check "끊어진 링크 유지" [ -L "$DOCK" ] && [ "$(readlink "$DOCK")" = "$T/nonexistent" ] && [ ! -e "$T/nonexistent" ]
reset; mkdir -p "$(dirname "$DOCK")"; gen > "$T/real.json"; ln -s "$T/real.json" "$DOCK"
install_cmux >/dev/null 2>&1; uninstall_cmux >/dev/null 2>&1
check "유효한 링크(same 내용)도 그대로" [ -L "$DOCK" ] && [ -f "$T/real.json" ] && [ ! -e "$BACKUPS" ]
rm -f "$T/real.json"
reset; mkdir -p "$T/dot/cmux" "$HOME/.config"; ln -s "$T/dot/cmux" "$HOME/.config/cmux"
install_cmux >/dev/null 2>&1; check "설정 폴더가 링크여도 설치 허용" [ -f "$T/dot/cmux/dock.json" ] && [ ! -L "$T/dot/cmux/dock.json" ]
uninstall_cmux >/dev/null 2>&1; check "설정 폴더 링크: uninstall 도 동작" [ ! -e "$T/dot/cmux/dock.json" ]
rm -rf "$T/dot"
reset; mkdir -p "$(dirname "$DOCK")" "$MARU_DATA"; gen > "$DOCK"; : > "$MARU_DATA/backups"   # 백업 경로가 파일 -> mkdir 실패
before=$(cat "$DOCK"); uninstall_cmux >/dev/null 2>&1; rc=$?
check "백업 실패면 uninstall 삭제 안 함(return 1)" [ -f "$DOCK" ] && [ "$(cat "$DOCK")" = "$before" ] && [ "$rc" = 1 ]
printf '{"controls":[{"id":"maru-ui","title":"maru","command":"\\"$HOME/maru/bin/maru\\" ui"}]}' > "$DOCK"; ln -sfn "$REPO" "$HOME/maru"; before=$(cat "$DOCK")
install_cmux >/dev/null 2>&1; rc=$?
check "백업 실패면 install 갱신 안 함(return 1)" [ "$(cat "$DOCK")" = "$before" ] && [ "$rc" = 1 ]
rm -f "$MARU_DATA/backups" "$HOME/maru"
reset; mkdir -p "$(dirname "$DOCK")" "$MARU_DATA/backups"; gen > "$DOCK"; chmod 500 "$MARU_DATA/backups"
if [ -w "$MARU_DATA/backups" ]; then ok "(읽기 전용 폴더 시험 생략: root)"; else
  before=$(cat "$DOCK"); uninstall_cmux >/dev/null 2>&1; rc=$?
  check "백업 폴더 읽기 전용이면 삭제 안 됨" [ -f "$DOCK" ] && [ "$rc" = 1 ]
  printf '{"controls":[{"id":"maru-ui","title":"maru","command":"\\"$HOME/maru/bin/maru\\" ui"}]}' > "$DOCK"; ln -sfn "$REPO" "$HOME/maru"; before=$(cat "$DOCK")
  install_cmux >/dev/null 2>&1; check "백업 폴더 읽기 전용이면 갱신 안 됨" [ "$(cat "$DOCK")" = "$before" ]
  rm -f "$HOME/maru"
fi
chmod -R u+w "$MARU_DATA" 2>/dev/null

echo "== cli: 새 설치 / 재실행 / 보존 / dry-run / uninstall"
reset; out=$(install_cli 2>&1)
check "링크 생성" [ -L "$T/bin/maru" ] && [ "$(readlink "$T/bin/maru")" = "$REPO/bin/maru" ]
out=$(install_cli 2>&1); check "재실행은 이미 설치됨" sh -c 'echo "$1" | grep -q "이미 설치됨"' _ "$out"
uninstall_cli >/dev/null 2>&1; check "uninstall 이 링크 제거" [ ! -e "$T/bin/maru" ] && [ ! -L "$T/bin/maru" ]
reset; mkdir -p "$T/bin"; echo mine > "$T/bin/maru"; install_cli >/dev/null 2>&1; uninstall_cli >/dev/null 2>&1
check "사용자 파일 보존" [ "$(cat "$T/bin/maru")" = mine ]
reset; mkdir -p "$T/bin2"; ln -s /bin/ls "$T/bin2/maru"; MARU_BIN_DIR=$T/bin2 install_cli >/dev/null 2>&1; MARU_BIN_DIR=$T/bin2 uninstall_cli >/dev/null 2>&1
check "다른 대상 링크는 보존" [ "$(readlink "$T/bin2/maru")" = /bin/ls ]; rm -rf "$T/bin2"
reset; DRY=--dry-run; install_cli >/dev/null 2>&1; check "dry-run 은 폴더도 링크도 안 만듦" [ ! -e "$T/bin" ]
DRY=""; install_cli >/dev/null 2>&1; DRY=--dry-run; uninstall_cli >/dev/null 2>&1; check "uninstall dry-run 은 링크 유지" [ -L "$T/bin/maru" ]; DRY=""

echo "== cli: MARU_BIN_DIR 정규화/거부"
reset
for d in "//usr/local/bin" "/tmp/../usr/local/bin" "/usr/local/bin/" "/Applications/x" "$T/../usr/bin" "$T/a/../b"; do
  MARU_BIN_DIR=$d install_cli >/dev/null 2>&1; MARU_BIN_DIR=$d install_cli >/dev/null 2>&1
done
check "시스템/.. 경로는 아무것도 안 만듦" [ ! -e "$T/a" ] && [ ! -e "$T/b" ] && [ ! -e /usr/local/bin/maru ]
mkdir -p "$T/real"; ln -s /usr "$T/sysln"; ln -s /usr/bin "$T/sysln2"
MARU_BIN_DIR=$T/sysln/bin install_cli >/dev/null 2>&1; MARU_BIN_DIR=$T/sysln2 install_cli >/dev/null 2>&1
check "시스템 폴더 링크 폴더는 거부" [ ! -e /usr/bin/maru ]
err=$(MARU_BIN_DIR=//usr/local/bin install_cli 2>&1 >/dev/null); check "//usr/local/bin 거부 메시지" sh -c 'echo "$1" | grep -q "시스템 폴더"' _ "$err"
err=$(MARU_BIN_DIR=/tmp/../usr/local/bin install_cli 2>&1 >/dev/null); check "'..' 경로 거부 메시지" sh -c 'echo "$1" | grep -q "\.\."' _ "$err"
err=$(MARU_BIN_DIR=$T/sysln/local/bin install_cli 2>&1 >/dev/null); check "없는 하위 폴더도 상위 실경로로 검사해 거부" sh -c 'echo "$1" | grep -q "시스템 폴더"' _ "$err"
[ ! -e /usr/local/bin/maru ] || bad "/usr/local/bin/maru 가 생김"
MARU_BIN_DIR=$T/new/deep/bin install_cli >/dev/null 2>&1; check "없는 사용자 폴더는 만들어 설치" [ -L "$T/new/deep/bin/maru" ]
MARU_BIN_DIR=//$T/dbl//bin/ install_cli >/dev/null 2>&1; check "중복·끝 슬래시 정리" [ -L "$T/dbl/bin/maru" ]
rm -rf "$T/real" "$T/sysln" "$T/sysln2" "$T/new" "$T/dbl"

echo "== cli: 끝 슬래시 PATH 안내"
reset; mkdir -p "$T/bin"
ORIG_PATH="/usr/bin:$T/bin"; out=$(MARU_BIN_DIR=$T/bin/ install_cli 2>&1); check "PATH 에 있으면(끝 슬래시 입력) 안내 없음" sh -c '! echo "$1" | grep -q "PATH 에 없습니다"' _ "$out"
reset; ORIG_PATH="/usr/bin"; out=$(MARU_BIN_DIR=$T/bin/ install_cli 2>&1); check "PATH 에 없으면 안내(슬래시 없이 표시)" sh -c 'echo "$1" | grep -q "PATH 에 없습니다" && ! echo "$1" | grep -q "bin//\|bin/ "' _ "$out"
ORIG_PATH=$PATH

echo "== 빈 루트/잘못된 루트"
reset; mkdir -p "$T/emptyroot/bin"; : > "$T/emptyroot/bin/maru"   # 실행 권한 없음
for R in "" "$T/nonexist" "$T/emptyroot" relative; do
  ROOT=$R; rc=0
  install_cli >/dev/null 2>&1 || rc=$?; r1=$rc
  uninstall_cli >/dev/null 2>&1; r2=$?
  install_cmux >/dev/null 2>&1; r3=$?
  uninstall_cmux >/dev/null 2>&1; r4=$?
  check "ROOT='$R' 4개 함수 모두 return 1" [ "$r1$r2$r3$r4" = 1111 ]
done
ROOT=; install_cli >/dev/null 2>&1
check "빈 루트면 아무것도 안 만듦" [ ! -e "$T/bin" ] && [ ! -e "$DOCK" ] && [ ! -e /bin/maru ]
rm -rf "$T/emptyroot"; ROOT=$REPO

echo "== 정적 검사"
check "py_compile" python3 -I -c 'import ast,sys;ast.parse(open(sys.argv[1]).read())' "$REPO/scripts/maru_config.py"
echo
if [ "$FAIL" = 0 ]; then echo "통과: $N 건"; exit 0; else echo "실패: $FAIL / $N"; exit 1; fi
