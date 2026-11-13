#!/bin/bash
# install.sh / uninstall.sh 의 선택 옵션(--with-cli, --with-cmux) 함수 모음 (source 전용, bash 3.2 호환).
# 호출 전에 ROOT(저장소), DRY(빈 값 또는 --dry-run), BACKUPS(백업 폴더), ORIG_PATH(lib.sh 가 PATH 를 바꾸기 전 값)가 있어야 한다.
# 시험용 주입: MARU_BIN_DIR(링크 폴더), XDG_CONFIG_HOME, MARU_CMUX_APP(기본 /Applications/cmux.app).

_opt_py() { python3 -I "$ROOT/scripts/maru_config.py" "$@"; }

# 링크가 가리키는 최종 대상 경로(한 단계만 풀고 그 폴더는 실경로로). 없으면 빈 문자열.
_opt_link_target() {
  local l=$1 t
  t=$(readlink "$l") || return 0
  case "$t" in /*) ;; *) t=$(dirname "$l")/$t ;; esac
  (cd "$(dirname "$t")" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "$(basename "$t")")
}

_opt_bin_dir() { printf '%s' "${MARU_BIN_DIR:-$HOME/.local/bin}"; }

_opt_system_dir() {   # 시스템 폴더면 0
  case "$1" in
    /bin|/bin/*|/sbin|/sbin/*|/usr|/usr/*|/System|/System/*|/Library|/Library/*|/etc|/etc/*|/private/etc|/private/etc/*|/opt|/opt/*) return 0;;
  esac
  return 1
}

install_cli() {
  local dir link want cur
  dir=$(_opt_bin_dir); link=$dir/maru; want=$ROOT/bin/maru
  case "$dir" in /*) ;; *) echo "  MARU_BIN_DIR 는 절대 경로여야 합니다: $dir (건너뜀)" >&2; return 0;; esac
  if _opt_system_dir "$dir"; then echo "  시스템 폴더에는 설치하지 않습니다: $dir (건너뜀. MARU_BIN_DIR 로 사용자 폴더를 지정하세요)" >&2; return 0; fi
  if [ -e "$link" ] || [ -L "$link" ]; then
    if [ -L "$link" ]; then cur=$(_opt_link_target "$link"); else cur=""; fi
    if [ -n "$cur" ] && [ "$cur" = "$want" ]; then echo "  이미 설치됨: $link -> $want"; _opt_path_hint "$dir"; return 0; fi
    echo "  경고: $link 가 이미 있고 이 저장소의 bin/maru 를 가리키지 않아 덮어쓰지 않고 건너뜀" >&2
    return 0
  fi
  if [ -n "$DRY" ]; then
    [ -d "$dir" ] || echo "  (dry-run) mkdir -p $dir"
    echo "  (dry-run) ln -s $want $link"
  else
    mkdir -p "$dir" 2>/dev/null && [ -w "$dir" ] || { echo "  경고: $dir 에 쓸 수 없어 건너뜀(sudo 는 쓰지 않습니다)" >&2; return 0; }
    ln -s "$want" "$link" && echo "  링크: $link -> $want"
  fi
  _opt_path_hint "$dir"
}

_opt_path_hint() {
  case ":$ORIG_PATH:" in *":$1:"*) return 0;; esac
  echo "  $1 가 PATH 에 없습니다. 셸 설정 파일은 수정하지 않으니 직접 한 줄을 추가하세요(예: ~/.zshrc):"
  echo "    export PATH=\"$1:\$PATH\""
}

uninstall_cli() {
  local dir link want cur
  dir=$(_opt_bin_dir); link=$dir/maru; want=$ROOT/bin/maru
  if [ ! -L "$link" ]; then
    if [ -e "$link" ]; then echo "  $link 는 링크가 아니라 maru 가 설치한 것이 아님 — 건드리지 않음"; else echo "  $link 없음"; fi
    return 0
  fi
  cur=$(_opt_link_target "$link")
  if [ "$cur" != "$want" ]; then echo "  $link 가 이 저장소의 bin/maru 를 가리키지 않음 — 건드리지 않음"; return 0; fi
  if [ -n "$DRY" ]; then echo "  (dry-run) rm $link"; else rm -f "$link" && echo "  삭제: $link"; fi
}

_opt_cmux_found() {
  [ -e "${MARU_CMUX_APP:-/Applications/cmux.app}" ] || command -v cmux >/dev/null 2>&1
}
_opt_dock_file() { printf '%s/cmux/dock.json' "${XDG_CONFIG_HOME:-$HOME/.config}"; }

_opt_dock_snippet() {
  echo "  직접 합치려면 dock.json 의 controls 배열에 아래 항목을 추가하세요(자동 병합은 하지 않습니다):"
  _opt_py dock-gen --dir "$ROOT" | sed -n '/^    {/,/^    }/p' | sed 's/^/    /'
}

install_cmux() {
  local f st
  if ! _opt_cmux_found; then echo "  cmux 를 찾지 못함(${MARU_CMUX_APP:-/Applications/cmux.app} 도, cmux 명령도 없음) — 건너뜀"; return 0; fi
  f=$(_opt_dock_file); st=$(_opt_py dock-check --file "$f" --dir "$ROOT") || { echo "  dock 판정 실패 — 건너뜀" >&2; return 0; }
  case "$st" in
    same) echo "  이미 설치됨(내용 동일): $f";;
    missing|legacy)
      if [ "$st" = legacy ]; then echo "  maru 가 만든 기존 설정(저장소 경로 하드코딩 형식)을 현재 저장소 경로로 갱신: $f"; fi
      if [ -n "$DRY" ]; then echo "  (dry-run) $f 작성(command 는 $ROOT/bin/maru 기준)"
      else
        if [ "$st" = legacy ]; then mkdir -p "$BACKUPS" && cp -p "$f" "$BACKUPS/dock.json.bak-$(date +%Y%m%d-%H%M%S)" && echo "  백업: $BACKUPS/"; fi
        mkdir -p "$(dirname "$f")" && _opt_py dock-gen --dir "$ROOT" > "$f.maru-tmp" && mv -f "$f.maru-tmp" "$f" && echo "  작성: $f"
      fi;;
    *) echo "  $f 가 이미 있고 maru 가 만든 것이 아니어서 수정하지 않음"; _opt_dock_snippet;;
  esac
}

uninstall_cmux() {
  local f st
  f=$(_opt_dock_file); st=$(_opt_py dock-check --file "$f" --dir "$ROOT") || { echo "  dock 판정 실패 — 건드리지 않음" >&2; return 0; }
  case "$st" in
    missing) echo "  $f 없음";;
    same|legacy)
      if [ -n "$DRY" ]; then echo "  (dry-run) $f 를 $BACKUPS/ 에 백업 후 삭제"
      else mkdir -p "$BACKUPS" && cp -p "$f" "$BACKUPS/dock.json.bak-$(date +%Y%m%d-%H%M%S)" && rm -f "$f" && echo "  삭제(백업: $BACKUPS/): $f"; fi;;
    *) echo "  $f 는 maru 가 만든 것과 다름 — 건드리지 않음. maru 항목(id maru-ui)이 있으면 직접 지우세요.";;
  esac
}
