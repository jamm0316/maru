#!/bin/bash
# Stop / PreCompact 훅: 세션 도중에도 일지가 쌓이게 reflect.sh 를 백그라운드로 띄운다. 훅 JSON 을 stdin 으로 받는다.
# 빨리 끝나야 하므로(모델 호출 없음) 판단만 하고, 실제 회고는 떼어 낸 프로세스가 한다. 항상 exit 0, stdout 에는 아무것도 쓰지 않는다
# (이 훅들의 stdout 은 Claude Code 가 해석할 수 있다).
# 재귀 방지: 회고·정리의 헤드리스 `claude -p` 는 AGENT_REFLECTING=1 로 실행된다(reflect.sh/dream.sh). 그 안에서 다시 이 훅이 울려도 즉시 종료한다.
[ -n "${AGENT_REFLECTING:-}" ] && exit 0
exec 2>/dev/null
INTERVAL=1800   # Stop 은 세션당 이 초(30분)보다 자주 띄우지 않는다. PreCompact 는 제한 없음(압축되면 원문이 사라지므로)
SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P) || exit 0
input=$(cat)
MARU_LIB_SOFT=1 . "$SCRIPTS/lib.sh" >/dev/null || exit 0
unset MARU_LIB_SOFT
{ IFS= read -r sid; IFS= read -r event; IFS= read -r tp; } < <(printf '%s' "$input" \
  | jq -r '(.session_id // ""), (.hook_event_name // ""), (.transcript_path // "") | tostring | gsub("[\n\r]"; " ")')
[[ "$sid" =~ ^[A-Za-z0-9-]{8,64}$ ]] || exit 0   # 상태 파일 이름에 쓰므로 엄격히 검증
[ -n "$tp" ] || exit 0
mkdir -p "$STATE" "$LOGS" || exit 0
STAMP=$STATE/tick.$sid
now=$(date +%s)
if [ "$event" != PreCompact ]; then
  last=$(cat "$STAMP" 2>/dev/null)
  if [[ "$last" =~ ^[0-9]+$ ]] && [ $((now - last)) -lt "$INTERVAL" ]; then exit 0; fi
fi
# 테스트용: 둘 다 있을 때만 reflect.sh 대신 다른 스크립트를 부른다(훅 환경엔 없음)
reflect=$SCRIPTS/reflect.sh
if [ -n "${JOURNAL_TICK_REFLECT:-}" ] && [ "${REFLECT_ALLOW_FAKE:-}" = "yes-i-am-testing" ]; then reflect=$JOURNAL_TICK_REFLECT; fi
echo "$now" > "$STAMP" || exit 0
echo "$(date '+%F %T') [tick] ${sid:0:8} ${event:-Stop} — reflect.sh 실행" >> "$LOGS/reflect.log"
# reflect.sh 의 훅 모드(SessionEnd 와 같은 입력)가 transcript 경로를 검증하고 스스로 백그라운드로 넘어간다. 여기서는 떼어 내서 기다리지 않는다.
MARU_TICK_RUN=1 nohup bash "$reflect" <<< "$input" >/dev/null 2>&1 &
disown 2>/dev/null
exit 0
