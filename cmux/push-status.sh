#!/bin/bash
# maru-status.sh 출력을 cmux 로 밀어 넣는다: 현재 워크스페이스에 set-status 필 1개 + (선택) maru 워크스페이스 description.
# cmux 터미널 안에서 실행해야 소켓이 열린다. 사용: cmux/push-status.sh [--description <workspace ref>]
set -u
_here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
CMUX=${CMUX:-$(command -v cmux || echo /Applications/cmux.app/Contents/Resources/bin/cmux)}
S="$_here/../scripts/maru-status.sh"
J=$("$S" --json --no-auth) || exit 1
n=$(printf '%s' "$J" | jq -r '.memoryFiles // "?"'); p=$(printf '%s' "$J" | jq -r '.pendingSkillProposals // 0')
"$CMUX" set-status maru "기억 ${n} · 제안 ${p}" --icon sparkle --priority 10 || exit 1
if [ "${1:-}" = --description ] && [ -n "${2:-}" ]; then
  "$CMUX" workspace-action --workspace "$2" --action set-description --description "$("$S" --no-auth)"
fi
