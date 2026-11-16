#!/bin/bash
# install.sh 가 한 일만 되돌린다: SessionEnd 훅, launchd 작업, ~/.claude/CLAUDE.md 블록, 전역 recall 복사본.
# data/(개인 데이터·변경 이력)와 기억 폴더는 지우지 않는다. 사용: ./uninstall.sh [--dry-run] [--with-cli] [--with-cmux]
#   --with-cli: 이 저장소 bin/maru 를 가리키는 $MARU_BIN_DIR(기본 ~/.local/bin)/maru 링크만 제거
#   --with-cmux: maru 가 만든 cmux dock.json 과 동일할 때만 제거(data/backups 에 백업 후)
set -u
# T <한국어> <영어>: MARU_LANG 이 en 이면 영어, 아니면 한국어 문구(호출 시점에 읽는다)
T() { if [ "${MARU_LANG:-ko}" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
ORIG_PATH=$PATH
DRY=""; CLI=""; CMUX=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY="--dry-run";;
    --with-cli) CLI=1;;
    --with-cmux) CMUX=1;;
    *) echo "알 수 없는 옵션: $a (사용: ./uninstall.sh [--dry-run] [--with-cli] [--with-cmux])" >&2; exit 2;;
  esac
done
ROOT=$(cd "$(dirname "$0")" && pwd -P)
# python3/git 를 실제로 실행해 판정하고(폴백 포함) 기억 폴더를 검증한다. 실패하면 아무것도 건드리기 전에 중단한다.
MARU_LIB_SOFT=1
. "$ROOT/scripts/lib.sh" || { echo "필요한 도구/기억 폴더 확인에 실패해 아무것도 변경하지 않고 중단합니다." >&2; exit 1; }
unset MARU_LIB_SOFT
CFG=(python3 -I "$MARU_HOME/scripts/maru_config.py")
DRYARG=(); [ -n "$DRY" ] && DRYARG=(--dry-run)
LABEL=com.maru.dream
PLIST=$HOME/Library/LaunchAgents/$LABEL.plist
say() { printf '\n== %s\n' "$*"; }
die() { echo "$(T "  실패: $*" "  Failed: $*")" >&2; echo "$(T "  여기서 중단합니다(이후 단계는 실행하지 않음)." "  Stopping here (later steps are not run).")" >&2; exit 1; }

say "$(T "SessionEnd·SessionStart·Stop·PreCompact 훅 제거" "Removing the SessionEnd, SessionStart, Stop and PreCompact hooks")"
"${CFG[@]}" hook-remove --settings "$CLAUDE_DIR/settings.json" --match "$MARU_HOME/scripts/reflect.sh" --backup-dir "$MARU_DATA/backups" ${DRYARG[@]+"${DRYARG[@]}"} || die "$(T "SessionEnd 훅 제거 실패" "SessionEnd hook removal failed")"
for spec in "SessionStart:session-context.sh" "Stop:journal-tick.sh" "PreCompact:journal-tick.sh"; do
  "${CFG[@]}" hook-remove --settings "$CLAUDE_DIR/settings.json" --event "${spec%%:*}" --match "$MARU_HOME/scripts/${spec#*:}" --backup-dir "$MARU_DATA/backups" ${DRYARG[@]+"${DRYARG[@]}"} || die "$(T "${spec%%:*} 훅 제거 실패" "${spec%%:*} hook removal failed")"
done

say "$(T "launchd 작업 $LABEL 제거" "Removing launchd job $LABEL")"
if [ -n "$DRY" ]; then echo "$(T "  (dry-run) launchctl bootout, $PLIST 삭제" "  (dry-run) launchctl bootout, delete $PLIST")"
else
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && echo "$(T "  bootout 완료" "  bootout done")" || echo "$(T "  로드되어 있지 않음" "  Not loaded")"
  if [ -f "$PLIST" ]; then rm -f "$PLIST" && echo "$(T "  삭제: $PLIST" "  Deleted: $PLIST")" || die "$(T "$PLIST 삭제 실패" "deleting $PLIST failed")"; fi
fi

say "$(T "텔레그램 세션 중지 + launchd 작업 com.maru.telegram 제거(있을 때만)" "Stopping the Telegram session and removing launchd job com.maru.telegram (if present)")"
TGPLIST=$HOME/Library/LaunchAgents/com.maru.telegram.plist
if [ -n "$DRY" ]; then echo "$(T "  (dry-run) scripts/telegram.sh stop(실행 중이면 세션과 하위 프로세스 종료), launchctl bootout, $TGPLIST 삭제(있으면)" "  (dry-run) scripts/telegram.sh stop (ends the session and child processes if running), launchctl bootout, delete $TGPLIST (if present)")"
else
  bash "$MARU_HOME/scripts/telegram.sh" stop || die "$(T "텔레그램 세션 중지 실패" "stopping the Telegram session failed")"
  launchctl bootout "gui/$(id -u)/com.maru.telegram" >/dev/null 2>&1 && echo "$(T "  bootout 완료" "  bootout done")" || echo "$(T "  로드되어 있지 않음" "  Not loaded")"
  if [ -f "$TGPLIST" ]; then rm -f "$TGPLIST" && echo "$(T "  삭제: $TGPLIST" "  Deleted: $TGPLIST")" || die "$(T "$TGPLIST 삭제 실패" "deleting $TGPLIST failed")"; fi
fi

say "$(T "~/.claude/CLAUDE.md 의 maru 블록 제거" "Removing the maru block from ~/.claude/CLAUDE.md")"
"${CFG[@]}" claude-md-remove --file "$CLAUDE_DIR/CLAUDE.md" --backup-dir "$MARU_DATA/backups" ${DRYARG[@]+"${DRYARG[@]}"} || die "$(T "CLAUDE.md 블록 제거 실패" "CLAUDE.md block removal failed")"

say "$(T "전역 recall 스킬 제거" "Removing the global recall skill")"
if [ -f "$SKILLS/recall/.maru" ]; then
  if [ -n "$DRY" ]; then echo "  (dry-run) rm -rf $SKILLS/recall"; else rm -rf "$SKILLS/recall" && echo "$(T "  삭제: $SKILLS/recall" "  Deleted: $SKILLS/recall")" || die "$(T "recall 삭제 실패" "recall removal failed")"; fi
else echo "$(T "  .maru 표식이 없거나 recall 이 없음 — 건드리지 않음" "  No .maru marker or no recall skill — left alone")"; fi

say "$(T "저장소용 홈 접근 허용(.claude/settings.local.json) 제거" "Removing the repository home-access setting (.claude/settings.local.json)")"
"${CFG[@]}" local-settings-remove --file "$MARU_HOME/.claude/settings.local.json" --dir "$HOME" ${DRYARG[@]+"${DRYARG[@]}"} || die "$(T "settings.local.json 정리 실패" "settings.local.json cleanup failed")"

say "$(T "헤드리스 작업 폴더 제거" "Removing the headless work folder")"
if [ -n "$DRY" ]; then echo "  (dry-run) rmdir $MARU_WORK"
elif [ -d "$MARU_WORK" ]; then rmdir "$MARU_WORK" 2>/dev/null && echo "$(T "  삭제: $MARU_WORK" "  Deleted: $MARU_WORK")" || echo "$(T "  비어 있지 않아 남김: $MARU_WORK" "  Not empty, kept: $MARU_WORK")"; fi

if [ -n "$CLI" ] || [ -n "$CMUX" ]; then
  . "$ROOT/scripts/optional.sh"; BACKUPS=$MARU_DATA/backups
  [ -z "$CLI" ] || { say "$(T "maru 명령 링크 제거 (--with-cli)" "Removing the maru command link (--with-cli)")"; uninstall_cli || die "$(T "maru 명령 링크 제거 실패" "maru command link removal failed")"; }
  [ -z "$CMUX" ] || { say "$(T "cmux Dock 설정 제거 (--with-cmux)" "Removing cmux Dock settings (--with-cmux)")"; uninstall_cmux || die "$(T "cmux Dock 설정 제거 실패" "cmux Dock settings removal failed")"; }
fi

say "$(T "남겨 둔 것" "Left in place")"
echo "$(T "  $MARU_DATA (개인 데이터·변경 이력·백업), 기억 폴더($MEM)" "  $MARU_DATA (personal data, change history, backups), memory folder ($MEM)")"
echo "$(T "  필요하면 직접 지우세요. 이 저장소 폴더 자체도 그대로입니다." "  Delete them yourself if you want. The maru folder itself is also left as it is.")"
