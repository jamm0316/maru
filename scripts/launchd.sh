#!/bin/bash
# T <한국어> <영어>: MARU_LANG 이 en 이면 영어, 아니면 한국어 문구(호출 시점에 읽는다)
type T >/dev/null 2>&1 || T() { if [ "${MARU_LANG:-ko}" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
# install.sh 가 쓰는 launchd plist 렌더·검증·교체 함수 (source 전용). 호출 전에 lib.sh 로 python3 가 동작하는 PATH 를 만들어 둔다.
# 시험용 주입: MARU_PLIST_RENDER(렌더 함수 이름), MARU_LAUNCHCTL(launchctl 대체 명령), MARU_PLUTIL.
MARU_PLIST_RENDER=${MARU_PLIST_RENDER:-render_plist}
MARU_LAUNCHCTL=${MARU_LAUNCHCTL:-launchctl}
MARU_PLUTIL=${MARU_PLUTIL:-plutil}

# 템플릿의 {{MARU_HOME}} {{MARU_DATA}} {{HOME}} {{CLAUDE_CONFIG_ENV}} {{CLAUDE_BIN_DIR}} 를 채워 stdout 으로 낸다: render_plist <템플릿>
# 값은 환경(MARU_HOME, MARU_DATA, HOME, CLAUDE_CONFIG_DIR)에서 읽는다. {{CLAUDE_BIN_DIR}} 는 지금 PATH 의 claude 가 있는 폴더(절대 경로·실재·":" 없음·표준 폴더가 아님)를 ":폴더" 로 PATH 맨 뒤에 덧붙인다(비면 빈 문자열; 버전 관리자 shim 이 git·python3 를 가리지 않게) — launchd 의 최소 PATH 로는 버전 관리자·npm 전역 폴더의 claude 를 못 찾아 새벽 정리가 조용히 실패하기 때문. 실패하면 0 이 아닌 코드.
render_plist() {
  python3 -I - "$1" "$MARU_HOME" "$MARU_DATA" "$HOME" "${CLAUDE_CONFIG_DIR:-}" "$(command -v claude 2>/dev/null)" <<'PY'
import os, sys
from xml.sax.saxutils import escape
t = open(sys.argv[1], encoding="utf-8").read()
for k, v in zip(("{{MARU_HOME}}", "{{MARU_DATA}}", "{{HOME}}"), sys.argv[2:5]):
    t = t.replace(k, escape(v))
cfg = sys.argv[5]
env = f"    <key>CLAUDE_CONFIG_DIR</key><string>{escape(cfg)}</string>\n" if cfg else ""
cb = os.path.dirname(sys.argv[6]) if sys.argv[6].startswith("/") else ""
std = (sys.argv[4] + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin")
pre = ":" + escape(cb) if cb and ":" not in cb and os.path.isdir(cb) and cb != "/" and cb not in std else ""
sys.stdout.write(t.replace("{{CLAUDE_BIN_DIR}}", pre).replace("{{CLAUDE_CONFIG_ENV}}", env).rstrip("\n") + "\n")
PY
}

# 야간 작업 PATH 안내 한 줄(render_plist 와 같은 판정): claude 폴더가 표준 밖이면 덧붙였다고, claude 를 못 찾으면 표준 위치에 기댄다고 알린다.
claude_path_note() {
  local c d
  c=$(command -v claude 2>/dev/null)
  case "$c" in
    /*) d=$(dirname "$c")
      case "$d" in
        /|*:*) ;;
        "$HOME/.local/bin"|/opt/homebrew/bin|/usr/local/bin|/usr/bin|/bin|/usr/sbin|/sbin) return 0;;
        *) [ -d "$d" ] && { echo "$(T "  참고: claude 폴더($d)를 야간 작업의 PATH 끝에 추가했습니다" "  Note: the claude folder ($d) was added to the end of the nightly job's PATH")"; return 0; };;
      esac;;
  esac
  echo "$(T "  참고: claude 위치를 찾지 못해 야간 작업은 표준 위치(~/.local/bin, /opt/homebrew/bin, /usr/local/bin)에 기댑니다" "  Note: claude was not found here, so the nightly job relies on the standard locations (~/.local/bin, /opt/homebrew/bin, /usr/local/bin)")"
}

# 렌더 결과 검증: 비어 있지 않음 + 치환 안 된 자리표시자 없음 + plutil -lint. 실패하면 이유를 출력하고 1.
plist_validate() {
  [ -s "$1" ] || { echo "$(T "렌더 결과가 비어 있음" "Rendered output is empty")"; return 1; }
  if grep -q '{{[A-Z_]*}}' "$1"; then echo "$(T "치환되지 않은 자리표시자가 남음" "Unreplaced placeholders remain")"; return 1; fi
  "$MARU_PLUTIL" -lint "$1" >/dev/null 2>&1 || { echo "$(T "plutil -lint 실패" "plutil -lint failed")"; return 1; }
  return 0
}

# 사전 검증(아무것도 바꾸지 않음): 템플릿이 렌더되고 검증을 통과하는지 임시 파일로만 본다: plist_preflight <템플릿>
plist_preflight() {
  local tmp why
  tmp=$(mktemp "${TMPDIR:-/tmp}/maru-plist.XXXXXX") || { echo "$(T "임시 파일을 만들 수 없음" "Cannot create a temporary file")"; return 1; }
  if ! "$MARU_PLIST_RENDER" "$1" > "$tmp" 2>/dev/null; then rm -f "$tmp"; echo "$(T "렌더 실패: $1" "Render failed: $1")"; return 1; fi
  if ! why=$(plist_validate "$tmp"); then rm -f "$tmp"; echo "$why: $1"; return 1; fi
  rm -f "$tmp"; return 0
}

# install_launchd <label> <템플릿> <plist 경로> <dry: 빈 값 또는 1> [백업 폴더]
# 순서: 임시 파일에 렌더 → 검증 → (통과한 뒤에만) 기존 작업 bootout → plist 교체 → bootstrap.
# 검증 전에는 기존 plist 와 로드된 작업을 건드리지 않는다. bootstrap 이 끝내 실패하면 이전 plist 로 되돌려 다시 올린다.
install_launchd() {
  local label=$1 tpl=$2 plist=$3 dry=${4:-} bdir=${5:-} tmp new prev="" why uid i ok=""
  uid=$(id -u)
  tmp=$(mktemp "${TMPDIR:-/tmp}/maru-plist.XXXXXX") || { echo "$(T "  임시 파일을 만들 수 없음" "  Cannot create a temporary file")"; return 1; }
  if ! "$MARU_PLIST_RENDER" "$tpl" > "$tmp" 2>/dev/null; then
    rm -f "$tmp"; echo "$(T "  plist 렌더 실패: 기존 plist 와 launchd 작업은 그대로 둡니다" "  plist render failed: the existing plist and launchd job are left as they are")"; return 1
  fi
  if ! why=$(plist_validate "$tmp"); then
    rm -f "$tmp"; echo "$(T "  plist 검증 실패($why): 기존 plist 와 launchd 작업은 그대로 둡니다" "  plist validation failed ($why): the existing plist and launchd job are left as they are")"; return 1
  fi
  if [ -f "$plist" ] && cmp -s "$tmp" "$plist" && "$MARU_LAUNCHCTL" print "gui/$uid/$label" >/dev/null 2>&1; then
    rm -f "$tmp"; echo "$(T "  이미 최신으로 로드됨(변경 없음)" "  Already loaded and up to date (no change)")"; return 0
  fi
  if [ -n "$dry" ]; then
    rm -f "$tmp"; echo "$(T "  (dry-run) 렌더·검증 통과. 실제 실행 시 $plist 작성 후 launchctl bootstrap" "  (dry-run) Render and validation passed. A real run writes $plist and runs launchctl bootstrap")"; return 0
  fi
  mkdir -p "$(dirname "$plist")" || { rm -f "$tmp"; echo "$(T "  plist 폴더를 만들 수 없음" "  Cannot create the plist folder")"; return 1; }
  new=$plist.new.$$
  if ! cp "$tmp" "$new" || ! plist_validate "$new" >/dev/null; then
    rm -f "$tmp" "$new"; echo "$(T "  plist 임시 사본 작성 실패: 기존 것은 그대로 둡니다" "  Writing the temporary plist copy failed: the existing one is left as it is")"; return 1
  fi
  rm -f "$tmp"
  if [ -f "$plist" ]; then
    prev=$plist.prev.$$
    cp -p "$plist" "$prev" || { rm -f "$new"; echo "$(T "  기존 plist 백업 실패: 중단" "  Backing up the existing plist failed: aborting")"; return 1; }
    if [ -n "$bdir" ] && mkdir -p "$bdir" 2>/dev/null; then cp -p "$plist" "$bdir/$label.plist.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true; fi
  fi
  "$MARU_LAUNCHCTL" bootout "gui/$uid/$label" >/dev/null 2>&1 || true
  if mv -f "$new" "$plist"; then
    for i in 1 2 3 4 5; do   # bootout 직후에는 잠깐 bootstrap 이 실패할 수 있어 재시도한다
      if "$MARU_LAUNCHCTL" bootstrap "gui/$uid" "$plist" 2>/dev/null; then ok=1; break; fi
      sleep "${MARU_BOOTSTRAP_WAIT:-2}"
    done
  else
    rm -f "$new"
  fi
  if [ -n "$ok" ]; then
    [ -z "$prev" ] || rm -f "$prev"
    echo "$(T "  등록: $plist" "  Registered: $plist")"; return 0
  fi
  echo "$(T "  launchctl bootstrap 실패(5회 시도): $plist" "  launchctl bootstrap failed (5 attempts): $plist")"
  if [ -n "$prev" ] && mv -f "$prev" "$plist"; then
    if "$MARU_LAUNCHCTL" bootstrap "gui/$uid" "$plist" 2>/dev/null; then echo "$(T "  이전 plist 로 되돌려 다시 올림" "  Rolled back to the previous plist and reloaded")"
    else echo "$(T "  이전 plist 로 되돌렸지만 다시 올리지 못함: launchctl bootstrap gui/$uid $plist" "  Rolled back to the previous plist but could not reload it: launchctl bootstrap gui/$uid $plist")"; fi
  fi
  return 1
}
