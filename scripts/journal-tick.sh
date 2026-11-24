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
# 자식 세션 보고(아래)에는 lib.sh 의 MARU_DATA·PROJECTS·PATH 가 필요하다. 그 경우가 아니면 lib.sh(약 0.2초)를 부르기 전에
# 30분 간격 검사를 먼저 한다(Stop 마다 도는 흔한 경로). 간격 파일 경로는 lib.sh 가 계산하는 것과 정확히 같아야 하므로,
# data/maru.conf 가 있으면(그 안에서 MARU_DATA·MARU_STATE·PATH 접두사가 바뀔 수 있다) 계산하지 않고 lib.sh 를 부른다.
sid=""; event=""; tp=""; parsed=""
if ! { [[ "${MARU_PARENT_WS:-}" =~ ^[A-Za-z0-9_-]{4,64}$ ]] && [[ "${MARU_WS:-}" =~ ^[A-Za-z0-9_-]{4,64}$ ]]; }; then
  _home=${MARU_HOME:-$(dirname "$SCRIPTS")}
  _data=${MARU_DATA:-$_home/data}
  if [ ! -e "$_data/maru.conf" ] && [ ! -L "$_data/maru.conf" ]; then
    _pp=${MARU_PATH_PREFIX-/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.bun/bin}   # lib.sh 와 같은 PATH 접두사(jq 를 찾으려면 필요)
    [ -z "$_pp" ] || PATH="$_pp:$PATH"
    { IFS= read -r sid; IFS= read -r event; IFS= read -r tp; } < <(printf '%s' "$input" \
      | jq -r '(.session_id // ""), (.hook_event_name // ""), (.transcript_path // "") | tostring | gsub("[\n\r]"; " ")')
    parsed=1
    [[ "$sid" =~ ^[A-Za-z0-9-]{8,64}$ ]] || exit 0
    [ -n "$tp" ] || exit 0
    if [ "$event" != PreCompact ]; then
      last=$(cat "${MARU_STATE:-$_data/state}/tick.$sid" 2>/dev/null)
      if [[ "$last" =~ ^[0-9]+$ ]] && [ $(( $(date +%s) - last )) -lt "$INTERVAL" ]; then exit 0; fi
    fi
  fi
fi
MARU_LIB_SOFT=1 . "$SCRIPTS/lib.sh" >/dev/null || exit 0
unset MARU_LIB_SOFT
# 자식 세션(앱이 마루의 요청으로 연 작업 공간)이면 이 턴의 마지막 어시스턴트 텍스트를 부모(마루)용 보고 파일로 남긴다. 모델 호출 없음, 실패해도 훅은 계속된다.
# 아래 간격 검사·sid 검사보다 앞에 둔다(보고는 30분 간격과 무관하게 매 Stop 마다). MARU_PARENT_WS·MARU_WS 가 형식에 맞을 때만 python 을 띄운다.
# 키는 앱의 안정적인 작업 공간 id(MARU_PARENT_WS = 부모, MARU_WS = 자기 자신; 앱 세션 id 는 pty 재시작 때 바뀌므로 쓰지 않는다).
if [[ "${MARU_PARENT_WS:-}" =~ ^[A-Za-z0-9_-]{4,64}$ ]] && [[ "${MARU_WS:-}" =~ ^[A-Za-z0-9_-]{4,64}$ ]]; then
  printf '%s' "$input" | MARU_DATA="$MARU_DATA" python3 -I "$SCRIPTS/child.py" report-write "$PROJECTS" "$PWD" >/dev/null 2>&1 || true
fi
if [ -z "$parsed" ]; then
  { IFS= read -r sid; IFS= read -r event; IFS= read -r tp; } < <(printf '%s' "$input" \
    | jq -r '(.session_id // ""), (.hook_event_name // ""), (.transcript_path // "") | tostring | gsub("[\n\r]"; " ")')
fi
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
# PreCompact 는 백오프·사용량 게이트를 건너뛴다(압축되면 원문이 사라진다): reflect.sh 가 MARU_TICK_PRECOMPACT 를 본다.
tickpc=""; [ "$event" = PreCompact ] && tickpc=1
MARU_TICK_PRECOMPACT=$tickpc MARU_TICK_RUN=1 nohup bash "$reflect" <<< "$input" >/dev/null 2>&1 &
disown 2>/dev/null
exit 0
