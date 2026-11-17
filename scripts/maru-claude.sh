#!/bin/bash
# 마루 세션 실행기: 스쿼드(scripts/squads.py json)가 있으면 `claude --agents <JSON>` 으로, 아니면 그냥 `claude` 로 exec 한다.
# 스쿼드 문제(python3 없음·검증 실패·JSON 이상)로 마루가 못 뜨는 일은 없어야 한다: 어떤 실패든 스쿼드 없이 실행한다.
# 받은 인자는 그대로 claude 에 넘긴다(앱이 할 일의 원래 세션을 이어 열 때 `--resume <uuid>` 가 여기로 온다). 스쿼드 유무와 무관하다.
# 시험용: MARU_NO_SQUADS=1 이면 스쿼드를 붙이지 않는다.
SCRIPTS=$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null && pwd -P) || SCRIPTS=""
json=""
if [ -n "$SCRIPTS" ] && [ -z "${MARU_NO_SQUADS:-}" ]; then
  # lib.sh 가 python3 를 실제로 실행해 보고(필요하면 폴백 경로를 PATH 앞에 둠) 판정한다. 실패하면 스쿼드 없이 간다.
  if MARU_LIB_SOFT=1 . "$SCRIPTS/lib.sh" 2>/dev/null; then
    export MARU_HOME MARU_DATA
    json=$(python3 -I "$SCRIPTS/squads.py" json </dev/null) || json=""
  fi
fi
case "$json" in
  "{\"sq-"*) exec claude --agents "$json" "$@" ;;
esac
exec claude "$@"
