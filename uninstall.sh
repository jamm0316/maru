#!/bin/bash
# install.sh 가 한 일만 되돌린다: SessionEnd 훅, launchd 작업, ~/.claude/CLAUDE.md 블록, 전역 recall 복사본.
# data/(개인 데이터·변경 이력)와 기억 폴더는 지우지 않는다. 사용: ./uninstall.sh [--dry-run]
set -u
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY="--dry-run"
ROOT=$(cd "$(dirname "$0")" && pwd -P)
. "$ROOT/scripts/lib.sh"
CFG=(python3 -I "$MARU_HOME/scripts/maru_config.py")
DRYARG=(); [ -n "$DRY" ] && DRYARG=(--dry-run)
LABEL=com.maru.dream
PLIST=$HOME/Library/LaunchAgents/$LABEL.plist
say() { printf '\n== %s\n' "$*"; }

say "SessionEnd 훅 제거"
"${CFG[@]}" hook-remove --settings "$CLAUDE_DIR/settings.json" --match "$MARU_HOME/scripts/reflect.sh" --backup-dir "$MARU_DATA/backups" ${DRYARG[@]+"${DRYARG[@]}"}

say "launchd 작업 $LABEL 제거"
if [ -n "$DRY" ]; then echo "  (dry-run) launchctl bootout, $PLIST 삭제"
else
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && echo "  bootout 완료" || echo "  로드되어 있지 않음"
  [ -f "$PLIST" ] && rm -f "$PLIST" && echo "  삭제: $PLIST"
fi

say "~/.claude/CLAUDE.md 의 maru 블록 제거"
"${CFG[@]}" claude-md-remove --file "$CLAUDE_DIR/CLAUDE.md" --backup-dir "$MARU_DATA/backups" ${DRYARG[@]+"${DRYARG[@]}"}

say "전역 recall 스킬 제거"
if [ -f "$SKILLS/recall/.maru" ]; then
  if [ -n "$DRY" ]; then echo "  (dry-run) rm -rf $SKILLS/recall"; else rm -rf "$SKILLS/recall" && echo "  삭제: $SKILLS/recall"; fi
else echo "  .maru 표식이 없거나 recall 이 없음 — 건드리지 않음"; fi

say "저장소용 홈 접근 허용(.claude/settings.local.json) 제거"
"${CFG[@]}" local-settings-remove --file "$MARU_HOME/.claude/settings.local.json" --dir "$HOME" ${DRYARG[@]+"${DRYARG[@]}"}

say "헤드리스 작업 폴더 제거"
if [ -n "$DRY" ]; then echo "  (dry-run) rmdir $MARU_WORK"
elif [ -d "$MARU_WORK" ]; then rmdir "$MARU_WORK" 2>/dev/null && echo "  삭제: $MARU_WORK" || echo "  비어 있지 않아 남김: $MARU_WORK"; fi

say "남겨 둔 것"
echo "  $MARU_DATA (개인 데이터·변경 이력·백업), 기억 폴더($MEM)"
echo "  필요하면 직접 지우세요. 이 저장소 폴더 자체도 그대로입니다."
