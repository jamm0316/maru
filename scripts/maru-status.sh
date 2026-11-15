#!/bin/bash
# 마루 상태를 한 번 출력한다(읽기 전용: 파일을 쓰거나 지우지 않는다. 네트워크 요청도 하지 않는다).
# 항목: 기억 파일 수, 마지막 회고(시각·결과), 마지막 새벽 정리(시각·결과), 대기 중 스킬 제안 수, Claude 로그인 상태.
# 알 수 없는 항목은 텍스트 출력에서 생략하고 JSON 에서는 null 로 낸다.
# 사용: scripts/maru-status.sh [--json] [--no-auth]
#   --json     JSON 한 덩어리로 출력
#   --no-auth  `claude auth status` 호출을 건너뜀(느리거나 막힌 환경용)
set -u
JSON=0; AUTH=1
for a in "$@"; do
  case "$a" in
    --json) JSON=1 ;;
    --no-auth) AUTH=0 ;;
    -h|--help) sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "알 수 없는 옵션: $a (--json, --no-auth)" >&2; exit 2 ;;
  esac
done

_here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# lib.sh 가 python3/git 를 실제로 실행해 보고(폴백 포함) 기억 폴더 경로를 검증한다. 실패하면 원인을 출력하고 종료한다(exit 69).
# shellcheck disable=SC1091
. "$_here/lib.sh" || exit 1
MARU_HOME=${MARU_HOME:-$(dirname "$_here")}
LOGS=${LOGS:-$MARU_HOME/data/logs}
PROPOSALS=${PROPOSALS:-$MARU_HOME/data/skill-proposals}

# 로그에서 마지막 "시작" 줄을 찾아 (시각, 결과)를 낸다: last_run <로그> <시작 패턴(ERE)>
# 결과 우선순위: 되돌림 > 실패(rc≠0) > 커밋 완료 > 변경 없음 > 진행 중/불명
last_run() {
  local log=$1 pat=$2 n
  [ -f "$log" ] || return 0
  n=$(grep -n -E "$pat" "$log" | tail -1 | cut -d: -f1)
  [ -n "$n" ] || return 0
  tail -n +"$n" "$log" | awk '
    NR==1 { ts=substr($0,1,19); next }
    /회고 시작|\[dream\] 시작/ { exit }
    /되돌림/ { rb=1 }
    /rc=[1-9][0-9]*|환경 오류|스냅샷 실패/ { fail=1 }
    /커밋 완료/ { done=1 }
    /변경 없음/ { none=1 }
    END {
      r = rb ? "되돌림(변경 폐기)" : fail ? "실패" : done ? "커밋 완료(기억 갱신)" : none ? "변경 없음" : "진행 중/불명"
      print ts "\t" r
    }'
}

# 기억 파일 수(MEMORY.md 제외)
if [ -d "$MEM" ]; then
  mem_count=$(find "$MEM" -maxdepth 1 -type f -name '*.md' ! -name MEMORY.md | wc -l | tr -d ' ')
else
  mem_count=""
fi

r=$(last_run "$LOGS/reflect.log" '회고 시작'); r_ts=${r%%$'\t'*}; r_res=${r#*$'\t'}
[ -n "$r" ] || { r_ts=""; r_res=""; }
d=$(last_run "$LOGS/dream.log" '\[dream\] 시작'); d_ts=${d%%$'\t'*}; d_res=${d#*$'\t'}
[ -n "$d" ] || { d_ts=""; d_res=""; }

# 대기 중 스킬 제안 수: 숨김 파일을 뺀 최상위 항목 수
if [ -d "$PROPOSALS" ]; then
  prop_count=$(find "$PROPOSALS" -mindepth 1 -maxdepth 1 ! -name '.*' | wc -l | tr -d ' ')
else
  prop_count=""
fi

# 로그인 상태(계정 정보는 쓰지 않는다: loggedIn 과 인증 방식만)
login=""; login_method=""
if [ "$AUTH" = 1 ] && command -v claude >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  a=$(perl -e 'alarm 10; exec @ARGV' claude auth status 2>/dev/null </dev/null)
  if [ -n "$a" ] && [ "$(printf '%s' "$a" | jq -r 'type' 2>/dev/null)" = object ]; then
    login=$(printf '%s' "$a" | jq -r 'if .loggedIn == true then "true" elif .loggedIn == false then "false" else "" end')
    login_method=$(printf '%s' "$a" | jq -r '.authMethod // ""')
  fi
fi

now=$(date '+%F %T')

if [ "$JSON" = 1 ]; then
  jq -n \
    --arg now "$now" --arg mc "$mem_count" --arg pc "$prop_count" \
    --arg rts "$r_ts" --arg rres "$r_res" --arg dts "$d_ts" --arg dres "$d_res" \
    --arg login "$login" --arg lm "$login_method" '
    def nn: if . == "" then null else . end;
    { generatedAt: $now,
      memoryFiles: ($mc | nn | if . == null then null else tonumber end),
      lastReflect: { at: ($rts | nn), result: ($rres | nn) },
      lastDream:   { at: ($dts | nn), result: ($dres | nn) },
      pendingSkillProposals: ($pc | nn | if . == null then null else tonumber end),
      login: { loggedIn: ($login | nn | if . == null then null else (. == "true") end), method: ($lm | nn) } }'
  exit 0
fi

echo "마루 상태 ($now)"
[ -n "$mem_count" ] && echo "기억: ${mem_count}개"
[ -n "$r_ts" ] && echo "마지막 회고: $r_ts · $r_res"
[ -n "$d_ts" ] && echo "마지막 새벽 정리: $d_ts · $d_res"
[ -n "$prop_count" ] && echo "대기 중 스킬 제안: ${prop_count}개"
if [ "$login" = true ]; then echo "로그인: 예${login_method:+ ($login_method)}"
elif [ "$login" = false ]; then echo "로그인: 아니오 — claude auth login 필요"
fi
exit 0
