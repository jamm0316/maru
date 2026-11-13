#!/bin/bash
# install.sh / uninstall.sh 의 선택 옵션(--with-cli, --with-cmux) 함수 모음 (source 전용, bash 3.2 호환).
# 호출 전에 ROOT(저장소, bin/maru 가 실행 가능해야 함), DRY(빈 값 또는 --dry-run), BACKUPS(백업 폴더), ORIG_PATH(lib.sh 가 PATH 를 바꾸기 전 값)가 있어야 한다.
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

# 저장소 위치(ROOT)가 비었거나 bin/maru 가 실행 가능한 일반 파일이 아니면 1(아무것도 하지 않게 호출부가 중단).
_opt_root_ok() {
  case "${ROOT:-}" in /*) ;; *) echo "  저장소 위치(ROOT)가 비었거나 절대 경로가 아님 — 아무것도 하지 않음" >&2; return 1;; esac
  if [ ! -f "$ROOT/bin/maru" ] || [ ! -x "$ROOT/bin/maru" ]; then
    echo "  $ROOT/bin/maru 가 실행 가능한 일반 파일이 아님 — 아무것도 하지 않음" >&2; return 1
  fi
  return 0
}

# 경로 정규화: 연속 슬래시·끝 슬래시 정리, '..' 포함 시 거부, 있는 가장 가까운 상위 폴더는 실경로(pwd -P)로. 실패 시 1.
_opt_norm_dir() {
  local d=$1 rest="" base up
  case "$d" in /*) ;; *) return 1;; esac
  while :; do case "$d" in *//*) d=${d//\/\//\/};; *) break;; esac; done
  while [ "${#d}" -gt 1 ]; do case "$d" in */) d=${d%/};; *) break;; esac; done
  case "/$d/" in */../*) return 1;; esac
  base=$d
  while [ ! -d "$base" ]; do
    [ "$base" = / ] && return 1
    rest=/$(basename "$base")$rest
    base=$(dirname "$base")
  done
  up=$(cd "$base" 2>/dev/null && pwd -P) || return 1
  [ "$up" = / ] && up=""
  [ -n "$up$rest" ] || { printf '/'; return 0; }
  printf '%s%s' "$up" "$rest"
}

_opt_system_dir() {   # 시스템 폴더면 0 (정규화된 경로를 받는다)
  case "$1" in
    /bin|/bin/*|/sbin|/sbin/*|/usr|/usr/*|/System|/System/*|/Library|/Library/*|/etc|/etc/*|/private/etc|/private/etc/*|/opt|/opt/*|/Applications|/Applications/*) return 0;;
  esac
  return 1
}

# 백업 폴더에 f 를 복사. 실패하면 경고 후 1.
_opt_backup() {
  local f=$1
  if mkdir -p "$BACKUPS" 2>/dev/null && cp -p "$f" "$BACKUPS/dock.json.bak-$(date +%Y%m%d-%H%M%S)" 2>/dev/null; then
    echo "  백업: $BACKUPS/"; return 0
  fi
  echo "  경고: 백업에 실패해 $f 를 수정·삭제하지 않고 중단(백업 폴더: ${BACKUPS:-})" >&2
  return 1
}

install_cli() {
  local dir raw link want cur
  _opt_root_ok || return 1
  raw=$(_opt_bin_dir); want=$ROOT/bin/maru
  case "$raw" in /*) ;; *) echo "  MARU_BIN_DIR 는 절대 경로여야 합니다: $raw (건너뜀)" >&2; return 0;; esac
  dir=$(_opt_norm_dir "$raw") || { echo "  MARU_BIN_DIR 를 확인할 수 없거나 '..' 가 들어 있습니다: $raw (건너뜀)" >&2; return 0; }
  if _opt_system_dir "$dir"; then echo "  시스템 폴더에는 설치하지 않습니다: $raw (건너뜀. MARU_BIN_DIR 로 사용자 폴더를 지정하세요)" >&2; return 0; fi
  link=$dir/maru
  if [ -e "$link" ] || [ -L "$link" ]; then
    if [ -L "$link" ]; then cur=$(_opt_link_target "$link"); else cur=""; fi
    if [ -n "$cur" ] && [ "$cur" = "$want" ]; then echo "  이미 설치됨: $link -> $want"; _opt_path_hint "$raw"; return 0; fi
    echo "  경고: $link 가 이미 있고 이 저장소의 bin/maru 를 가리키지 않아 덮어쓰지 않고 건너뜀" >&2
    return 0
  fi
  if [ -n "${DRY:-}" ]; then
    [ -d "$dir" ] || echo "  (dry-run) mkdir -p $dir"
    echo "  (dry-run) ln -s $want $link"
  else
    mkdir -p "$dir" 2>/dev/null && [ -w "$dir" ] || { echo "  경고: $dir 에 쓸 수 없어 건너뜀(sudo 는 쓰지 않습니다)" >&2; return 0; }
    ln -s "$want" "$link" && echo "  링크: $link -> $want"
  fi
  _opt_path_hint "$raw"
}

_opt_path_hint() {   # 끝 슬래시를 떼고 PATH 와 비교
  local d=$1
  while [ "${#d}" -gt 1 ]; do case "$d" in */) d=${d%/};; *) break;; esac; done
  case ":${ORIG_PATH:-}:" in *":$d:"*) return 0;; esac
  echo "  $d 가 PATH 에 없습니다. 셸 설정 파일은 수정하지 않으니 직접 한 줄을 추가하세요(예: ~/.zshrc):"
  echo "    export PATH=\"$d:\$PATH\""
}

uninstall_cli() {
  local dir link want cur
  _opt_root_ok || return 1
  want=$ROOT/bin/maru
  dir=$(_opt_norm_dir "$(_opt_bin_dir)") || { echo "  MARU_BIN_DIR 를 확인할 수 없거나 '..' 가 들어 있습니다 — 건드리지 않음" >&2; return 0; }
  link=$dir/maru
  if [ ! -L "$link" ]; then
    if [ -e "$link" ]; then echo "  $link 는 링크가 아니라 maru 가 설치한 것이 아님 — 건드리지 않음"; else echo "  $link 없음"; fi
    return 0
  fi
  cur=$(_opt_link_target "$link")
  if [ "$cur" != "$want" ]; then echo "  $link 가 이 저장소의 bin/maru 를 가리키지 않음 — 건드리지 않음"; return 0; fi
  if [ -n "${DRY:-}" ]; then echo "  (dry-run) rm $link"; else rm -f "$link" && echo "  삭제: $link"; fi
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
  local f st st2 tmp
  _opt_root_ok || return 1
  if ! _opt_cmux_found; then echo "  cmux 를 찾지 못함(${MARU_CMUX_APP:-/Applications/cmux.app} 도, cmux 명령도 없음) — 건너뜀"; return 0; fi
  f=$(_opt_dock_file); st=$(_opt_py dock-check --file "$f" --dir "$ROOT") || { echo "  dock 판정 실패 — 건너뜀" >&2; return 0; }
  case "$st" in
    same) echo "  이미 설치됨(내용 동일): $f";;
    missing|legacy)
      if [ "$st" = legacy ]; then echo "  maru 가 만든 기존 설정(저장소 경로 하드코딩 형식)을 현재 저장소 경로로 갱신: $f"; fi
      if [ -n "${DRY:-}" ]; then echo "  (dry-run) $f 작성(command 는 $ROOT/bin/maru 기준)"; return 0; fi
      if [ "$st" = legacy ]; then _opt_backup "$f" || return 1; fi
      mkdir -p "$(dirname "$f")" 2>/dev/null || { echo "  경고: $(dirname "$f") 를 만들 수 없어 중단" >&2; return 1; }
      tmp=$(mktemp "$(dirname "$f")/.dock.XXXXXX" 2>/dev/null) || { echo "  경고: 임시 파일을 만들 수 없어 중단" >&2; return 1; }
      if ! _opt_py dock-gen --dir "$ROOT" > "$tmp" || ! chmod 644 "$tmp"; then rm -f "$tmp"; echo "  경고: 내용 생성 실패 — 중단" >&2; return 1; fi
      st2=$(_opt_py dock-check --file "$f" --dir "$ROOT") || st2=""
      if [ "$st2" != "$st" ]; then rm -f "$tmp"; echo "  경고: 검사 후 $f 가 바뀌어 중단" >&2; return 1; fi
      if mv -f "$tmp" "$f"; then echo "  작성: $f"; else rm -f "$tmp"; echo "  경고: $f 작성 실패" >&2; return 1; fi;;
    *)
      if [ -L "$f" ]; then echo "  $f 가 심볼릭 링크(dotfiles 관리 등)라 수정하지 않음"
      else echo "  $f 가 이미 있고 maru 가 만든 것이 아니어서 수정하지 않음"; fi
      _opt_dock_snippet;;
  esac
}

uninstall_cmux() {
  local f st st2
  _opt_root_ok || return 1
  f=$(_opt_dock_file); st=$(_opt_py dock-check --file "$f" --dir "$ROOT") || { echo "  dock 판정 실패 — 건드리지 않음" >&2; return 0; }
  case "$st" in
    missing) echo "  $f 없음";;
    same|legacy)
      if [ -n "${DRY:-}" ]; then echo "  (dry-run) $f 를 $BACKUPS/ 에 백업 후 삭제"; return 0; fi
      _opt_backup "$f" || return 1
      st2=$(_opt_py dock-check --file "$f" --dir "$ROOT") || st2=""
      if [ "$st2" != "$st" ]; then echo "  경고: 검사 후 $f 가 바뀌어 삭제 중단" >&2; return 1; fi
      rm -f "$f" && echo "  삭제(백업: $BACKUPS/): $f";;
    *)
      if [ -L "$f" ]; then echo "  $f 는 심볼릭 링크라 건드리지 않음"
      else echo "  $f 는 maru 가 만든 것과 다름 — 건드리지 않음. maru 항목(id maru-ui)이 있으면 직접 지우세요."; fi;;
  esac
}
