#!/bin/bash
# 마루 세션 실행기: 스쿼드(scripts/squads.py json)가 있으면 `claude --agents <JSON>` 으로, 아니면 그냥 `claude` 로 exec 한다.
# 스쿼드 문제(python3 없음·검증 실패·JSON 이상)로 마루가 못 뜨는 일은 없어야 한다: 어떤 실패든 스쿼드 없이 실행한다.
# 받은 인자는 그대로 claude 에 넘긴다(앱이 할 일의 원래 세션을 이어 열 때 `--resume <uuid>` 가 여기로 온다). 스쿼드 유무와 무관하다.
# 시험용: MARU_NO_SQUADS=1 이면 스쿼드를 붙이지 않는다.
# 하위 세션(앱이 마루의 요청으로 연 작업 공간): MARU_CHILD_PROMPT_FILE(앱이 $MARU_DATA/state/app/prompts/ 에 둔 초기 프롬프트 파일)이 검증을 통과하면
# 내용을 읽고 파일을 지운 뒤 `claude … -- <프롬프트>` 로 넘긴다(프롬프트는 셸 명령줄이 아니라 argv 한 개로만 간다).
# 잘못된 파일이면 stderr 한 줄을 남기고, 빈 세션으로 조용히 뜨지 않게 고정 안내문을 첫 입력으로 넣는다. 이 환경변수는 claude 와 그 자식에게 넘기지 않는다.
# (MARU_CHILD_ADD_DIR 는 더 이상 쓰지 않는다: 하위 세션은 설계 문서를 세션 시작 컨텍스트로만 받는다. 값이 있어도 무시한다.)
SCRIPTS=$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null && pwd -P) || SCRIPTS=""
pfile=${MARU_CHILD_PROMPT_FILE:-}
unset MARU_CHILD_PROMPT_FILE
json=""; lib_ok=""
if [ -n "$SCRIPTS" ] && [ -z "${MARU_NO_SQUADS:-}" ]; then
  # lib.sh 가 python3 를 실제로 실행해 보고(필요하면 폴백 경로를 PATH 앞에 둠) 판정한다. 실패하면 스쿼드 없이 간다.
  if MARU_LIB_SOFT=1 . "$SCRIPTS/lib.sh" 2>/dev/null; then
    lib_ok=1
    export MARU_HOME MARU_DATA
    json=$(python3 -I "$SCRIPTS/squads.py" json </dev/null) || json=""
  fi
fi
# 초기 프롬프트는 기억 폴더 검증(lib.sh)과 무관하게 처리한다: 쓸 python3 는 agent-state.sh 와 같은 방식으로 따로 찾는다(/usr/bin 셔임은 쓰지 않음).
find_py() {
  local d dirs
  IFS=: read -r -a dirs <<< "${MARU_TOOL_DIRS-/Library/Developer/CommandLineTools/usr/bin:/opt/homebrew/bin:/usr/local/bin}"
  for d in ${dirs[@]+"${dirs[@]}"}; do
    [ -n "$d" ] && [ "$d" != /usr/bin ] && [ -x "$d/python3" ] && { printf '%s' "$d/python3"; return 0; }
  done
  d=$(command -v python3 2>/dev/null); [ -n "$d" ] && [ "$d" != /usr/bin/python3 ] && printf '%s' "$d"
}
post=()
if [ -n "$pfile" ]; then
  py=""; [ -n "$SCRIPTS" ] && py=$(find_py)
  dd=${MARU_DATA:-$(dirname "$SCRIPTS")/data}
  if [ -n "$pfile" ]; then
    # 끝에 x 를 붙여 받아 $(...) 가 끝 개행을 지우지 못하게 한다(프롬프트는 바이트 그대로)
    if [ -n "$py" ] && p=$(MARU_DATA="$dd" "$py" -I "$SCRIPTS/child.py" take-prompt "$pfile" && printf x); then post=(-- "${p%x}")
    else
      # 쓸 수 없으면 빈 세션으로 조용히 뜨지 않게, 고정된 안내를 첫 입력으로 넣는다(파일은 앱이 정리하도록 그대로 둔다).
      [ -n "$py" ] || echo "마루: 초기 프롬프트 파일을 무시합니다(python3 없음). / Maru: ignoring the initial prompt file (no python3)." >&2
      # 안내문 언어: MARU_LANG 이 ko|en 이면 그대로, 아니면 lib.sh 와 같은 순서(profile.json 의 lang → ko)로 child.py 가 정한다(lib.sh 를 부르지 않는다).
      nl=${MARU_LANG:-}
      case "$nl" in ko|en) ;; *) nl=""; [ -n "$py" ] && nl=$(MARU_DATA="$dd" "$py" -I "$SCRIPTS/child.py" lang 2>/dev/null) ;; esac
      if [ "$nl" = en ]; then post=(-- "Maru could not read the instructions it handed over. Please tell the user.")
      else post=(-- "마루가 맡긴 지시를 읽지 못했습니다. 사용자에게 알려 주세요."); fi
    fi
  fi
fi
case "$json" in
  "{\"sq-"*) exec claude --agents "$json" "$@" ${post[@]+"${post[@]}"} ;;
esac
exec claude "$@" ${post[@]+"${post[@]}"}
