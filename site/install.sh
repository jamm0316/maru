#!/bin/bash
# Maru installer.  Usage:  curl -fsSL https://jamm0316.github.io/maru/install.sh | bash
#
# What it does: downloads the pinned release dmg, checks its SHA-256, copies Maru.app
# to /Applications (or ~/Applications if that is not writable), then opens it.
# It never uses sudo. Files fetched with curl carry no macOS "quarantine" mark, so
# Gatekeeper's download check is skipped; the SHA-256 below is the only integrity check.
# Maru is not signed or notarized. By running this you trust this repository.
#
# The four constants below are rewritten for each release by site/set-release.sh.
VERSION="0.1.0"
DMG_NAME="Maru-0.1.0-arm64.dmg"
DMG_URL="https://github.com/jamm0316/maru/releases/download/v0.1.0/Maru-0.1.0-arm64.dmg"
DMG_SHA256="053f120a8386e68d718d3d74859f5401ffdfda6ef165b07c160414cf2a2341ad"

# Test-only environment overrides (not for normal use):
#   MARU_INSTALL_DIR, MARU_DMG_URL, MARU_DMG_SHA256, MARU_NO_OPEN=1, MARU_YES=1,
#   MARU_SKIP_OS_CHECK=1, MARU_TTY (terminal device to ask on; default /dev/tty),
#   MARU_LANG=en|ko (force the message language)
# MARU_YES=1 is also the way to confirm replacing an existing install without a terminal.

set -euo pipefail

# Everything lives in main(), called on the last line, so a cut-off download runs nothing.
TMP=""; MNT=""; STAGED=""

# T "한국어" "English": pick the message language.
T() { if [ "$LANG_KO" = 1 ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
say() { printf '%s\n' "$*"; }
die() { printf 'maru: %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [ -n "$MNT" ]; then
    hdiutil detach -quiet "$MNT" 2>/dev/null || hdiutil detach -quiet -force "$MNT" 2>/dev/null || true
  fi
  [ -n "$STAGED" ] && rm -rf "$STAGED"
  [ -n "$TMP" ] && [ -d "$TMP" ] && rm -rf "$TMP"
  return 0
}

main() {
  LANG_KO=0
  case "$(defaults read -g AppleLocale 2>/dev/null || true)" in ko*) LANG_KO=1 ;; esac
  case "${LANG:-}" in ko*) LANG_KO=1 ;; esac
  if [ -n "${MARU_LANG:-}" ]; then case "$MARU_LANG" in ko*) LANG_KO=1 ;; *) LANG_KO=0 ;; esac; fi

  local url="${MARU_DMG_URL:-$DMG_URL}" want="${MARU_DMG_SHA256:-$DMG_SHA256}"

  # 1. Checks. Each failure changes nothing.
  if [ "${MARU_SKIP_OS_CHECK:-}" != 1 ]; then
    [ "$(uname -s)" = Darwin ] || die "$(T 'macOS에서만 설치할 수 있습니다.' 'Maru installs on macOS only.')"
    [ "$(uname -m)" = arm64 ] || die "$(T 'Apple Silicon(arm64) Mac이 필요합니다. Intel 빌드는 없습니다.' 'Maru needs an Apple Silicon (arm64) Mac. There is no Intel build.')"
    local major; major=$(sw_vers -productVersion | cut -d. -f1)
    [ "${major:-0}" -ge 15 ] 2>/dev/null || die "$(T 'macOS 15 이상이 필요합니다.' 'Maru needs macOS 15 or later.')"
  fi
  local tool
  for tool in curl shasum hdiutil ditto; do
    command -v "$tool" >/dev/null 2>&1 || die "$(T "필요한 도구가 없습니다: $tool" "Required tool not found: $tool")"
  done

  # 2. Where to install. Never sudo: fall back to ~/Applications when /Applications is not writable.
  local dir="${MARU_INSTALL_DIR:-}"
  if [ -z "$dir" ]; then
    if [ -w /Applications ]; then dir=/Applications
    else
      dir="$HOME/Applications"
      say "$(T "/Applications에 쓸 수 없어 $dir 에 설치합니다." "/Applications is not writable, so installing to $dir instead.")"
    fi
  fi
  mkdir -p "$dir" && [ -w "$dir" ] || die "$(T "설치 폴더에 쓸 수 없습니다: $dir" "Cannot write to the install folder: $dir")"
  local app="$dir/Maru.app"

  # 3. Existing install: never kill it, never delete it. The old one goes to the Trash.
  if [ -e "$app" ]; then
    if pgrep -f "$app/Contents/MacOS/" >/dev/null 2>&1; then
      die "$(T 'Maru가 실행 중입니다. 먼저 종료한 뒤 다시 실행하세요.' 'Maru is running. Quit it first, then run this again.')"
    fi
    if [ "${MARU_YES:-}" != 1 ]; then
      local tty="${MARU_TTY:-/dev/tty}" ans=""   # stdin is the pipe, so ask on the terminal
      if ! { : < "$tty"; } 2>/dev/null; then
        die "$(T "$app 이(가) 이미 있습니다. 터미널을 쓸 수 없으니 MARU_YES=1 을 붙여 다시 실행하세요." "$app already exists and there is no terminal to ask on. Re-run with MARU_YES=1 to replace it.")"
      fi
      printf '%s' "$(T "$app 을(를) 교체할까요? 기존 앱은 휴지통으로 옮깁니다. [y/N] " "Replace $app? The old one goes to the Trash. [y/N] ")" >&2
      read -r ans < "$tty" || true
      case "$ans" in y|Y|yes|YES) ;; *) die "$(T '취소했습니다. 아무것도 바꾸지 않았습니다.' 'Cancelled. Nothing was changed.')" ;; esac
    fi
  fi

  # 4. Download and verify. Cleanup of the temp folder and the mount is handled by the EXIT trap.
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/maru-install.XXXXXX")
  trap cleanup EXIT
  say "$(T "Maru $VERSION 을(를) 내려받는 중..." "Downloading Maru $VERSION ...")"
  curl -fL --progress-bar --proto '=https,file' --proto-redir '=https' -o "$TMP/$DMG_NAME" "$url" \
    || die "$(T '내려받지 못했습니다.' 'Download failed.')"
  local got; got=$(shasum -a 256 "$TMP/$DMG_NAME" | awk '{print $1}')
  if [ "$got" != "$want" ]; then
    printf 'maru: %s\n  expected: %s\n  actual:   %s\n' "$(T 'SHA-256이 맞지 않아 중단합니다. 아무것도 설치하지 않았습니다.' 'SHA-256 mismatch, aborting. Nothing was installed.')" "$want" "$got" >&2
    exit 1
  fi
  say "$(T 'SHA-256 확인 완료.' 'SHA-256 checks out.')"

  # 5. Mount read-only, copy to a temp name in the same folder, then rename into place.
  mkdir "$TMP/mnt"
  hdiutil attach -nobrowse -readonly -quiet -mountpoint "$TMP/mnt" "$TMP/$DMG_NAME" >/dev/null || die "$(T 'dmg를 열지 못했습니다.' 'Could not mount the dmg.')"
  MNT="$TMP/mnt"
  [ -d "$MNT/Maru.app" ] || die "$(T 'dmg 안에 Maru.app이 없습니다.' 'Maru.app not found inside the dmg.')"
  STAGED="$dir/.Maru-install-$$.app"
  ditto "$MNT/Maru.app" "$STAGED"
  if [ -e "$app" ]; then
    mkdir -p "$HOME/.Trash"
    mv "$app" "$HOME/.Trash/Maru-$(date +%Y%m%d-%H%M%S).app"
    say "$(T '기존 Maru를 휴지통으로 옮겼습니다.' 'Moved the old Maru to the Trash.')"
  fi
  mv "$STAGED" "$app"
  STAGED=""

  say "$(T "설치했습니다: $app" "Installed: $app")"
  say "$(T '처음 실행하면 Maru가 필요한 것을 확인하고, 무엇을 바꾸는지 보여 준 뒤 단계마다 확인을 받습니다.' 'On first run Maru checks what it needs, shows what it will change, and asks before each step.')"
  [ "${MARU_NO_OPEN:-}" = 1 ] || open "$app" || true
}

main "$@"
