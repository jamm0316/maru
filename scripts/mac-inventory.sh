#!/bin/bash
# 이 맥의 "무엇이 설치돼 있고 무엇을 스크립트로 다룰 수 있나"를 조사해 data/mac-inventory.md 에 덮어쓴다.
# 읽기 전용: 앱을 실행하지 않고, 권한 프롬프트를 띄울 만한 일(자동화·손쉬운 사용·화면 기록)은 하지 않는다.
# 담지 않는 것: 파일 내용, 계정명, 시리얼 번호, 네트워크 식별자(MAC·IP·SSID·호스트명).
# 사용: scripts/mac-inventory.sh        (결과: $MARU_DATA/mac-inventory.md)
set -u
_here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
MARU_HOME=${MARU_HOME:-$(dirname "$_here")}
MARU_DATA=${MARU_DATA:-$MARU_HOME/data}
[ -f "$MARU_DATA/maru.conf" ] && . "$MARU_DATA/maru.conf"
OUT=${MAC_INVENTORY_OUT:-$MARU_DATA/mac-inventory.md}
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ANALYTICS=1 HOMEBREW_NO_ENV_HINTS=1

mkdir -p "$(dirname "$OUT")"
TMP=$(mktemp "${TMPDIR:-/tmp}/mac-inventory.XXXXXX") || exit 1
trap 'rm -f "$TMP"' EXIT

# 시간 제한 실행: tlimit <초> <명령...> (macOS 에는 timeout 이 없어 perl alarm 사용)
tlimit() { local s=$1; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

plist_get() { plutil -extract "$2" raw -o - "$1" 2>/dev/null; }

# 앱 번들 하나를 "이름|번들ID|스크립트지원" 한 줄로 낸다. 앱을 실행하지 않고 번들 파일만 읽는다.
app_row() {
  local app=$1 info="$1/Contents/Info.plist" bid osa nse scr="아니오" name
  [ -f "$info" ] || return 0
  name=$(basename "$app" .app)
  bid=$(plist_get "$info" CFBundleIdentifier); [ -n "$bid" ] || bid="?"
  osa=$(plist_get "$info" OSAScriptingDefinition)
  nse=$(plist_get "$info" NSAppleScriptEnabled)
  if compgen -G "$app/Contents/Resources/*.sdef" >/dev/null || [ -n "$osa" ] || [ "$nse" = "true" ]; then scr="예"; fi
  printf '%s|%s|%s\n' "$name" "$bid" "$scr"
}

APPS=$TMP.apps; : > "$APPS"
scan_root() { # scan_root <폴더> <표시 접두어> : 1~2단계 깊이의 .app (Utilities 같은 하위 폴더 포함)
  local root=$1 label=$2 a
  [ -d "$root" ] || return 0
  while IFS= read -r a; do
    app_row "$a" | sed "s|\$|\|$label|"
  done < <(find "$root" -maxdepth 2 -name '*.app' -not -path '*.app/*' 2>/dev/null | sort)
}
scan_root /Applications "/Applications" >> "$APPS"
scan_root "$HOME/Applications" "~/Applications" >> "$APPS"
scan_root /System/Applications "시스템" >> "$APPS"

n_apps=$(grep -c . "$APPS"); n_script=$(grep -c '|예|' "$APPS")

{
  echo "# 맥 현황 (mac-inventory)"
  echo
  echo "- 생성: $(date '+%Y-%m-%d %H:%M') · 생성 스크립트: scripts/mac-inventory.sh (읽기 전용, 앱 실행·권한 요청 없음)"
  echo "- macOS: $(sw_vers -productVersion) (빌드 $(sw_vers -buildVersion))"
  echo "- 하드웨어 모델: $(sysctl -n hw.model 2>/dev/null) · 칩: $(sysctl -n machdep.cpu.brand_string 2>/dev/null) · 메모리: $(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 ))GB"
  if tlimit 10 sdef /System/Applications/Calendar.app >/dev/null 2>&1; then
    echo "- \`sdef\` 명령: 사용 가능"
  else
    echo "- \`sdef\` 명령: 사용 불가 (Xcode 필요) → 앱 번들의 \`Contents/Resources/*.sdef\` 파일을 직접 읽는다"
  fi
  echo
  echo "## 앱 ($n_apps개, 스크립트 지원 ${n_script}개)"
  echo "\"스크립트 지원\" = 번들에 \`.sdef\` 파일이 있거나 Info.plist 에 \`OSAScriptingDefinition\`/\`NSAppleScriptEnabled\`가 있음. 표시만으로 AppleScript 가 충분히 쓸 만하다는 뜻은 아니다."
  echo
  echo "| 앱 | 번들 ID | 스크립트 지원 | 위치 |"
  echo "|---|---|---|---|"
  awk -F'|' '{printf "| %s | %s | %s | %s |\n",$1,$2,$3,$4}' "$APPS"
  echo

  echo "## Homebrew"
  if command -v brew >/dev/null 2>&1; then
    n_formula=$(tlimit 20 brew list --formula 2>/dev/null | grep -c .)
    echo "- 설치한 formula: 전체 ${n_formula}개. 직접 설치한 것(brew leaves):"
    tlimit 20 brew leaves 2>/dev/null | sed 's/^/  - /'
    n_cask=$(tlimit 20 brew list --cask 2>/dev/null | grep -c .)
    echo "- cask ${n_cask}개:"
    tlimit 20 brew list --cask 2>/dev/null | sed 's/^/  - /'
  else
    echo "- brew 없음"
  fi
  echo

  echo "## 단축어 (shortcuts list)"
  if command -v shortcuts >/dev/null 2>&1 && SC=$(tlimit 10 shortcuts list 2>/dev/null); then
    n_sc=$(printf '%s\n' "$SC" | grep -c .)
    echo "- ${n_sc}개"
    printf '%s\n' "$SC" | grep . | sed 's/^/  - /'
  else
    echo "- 조회하지 못함(명령 없음, 시간 초과 또는 오류) — 건너뜀"
  fi
  echo

  echo "## CLI 도구 유무"
  for c in brew mas jq trash shortcuts osascript sdef lsappinfo mdfind duti dockutil cliclick python3 node git gh rg fd ffmpeg tmux; do
    p=$(command -v "$c" 2>/dev/null) && echo "- $c: 있음" || echo "- $c: 없음"
  done
} > "$TMP.md"

mv -f "$TMP.md" "$OUT"
echo "wrote $OUT (앱 $n_apps, 스크립트 지원 $n_script)"
