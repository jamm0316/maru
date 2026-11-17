#!/bin/bash
# UserPromptSubmit 훅(마루 세션용): 마루가 연 자식 세션들이 남긴 보고(state/app/reports/<내 MARU_WS>/)를 읽지 않은 것만 컨텍스트로 낸다.
# stdout 이 그대로 컨텍스트에 붙는다. 읽은 보고는 reports/<id>/read/ 로 옮긴다. 항상 exit 0, 보고가 없으면 아무것도 쓰지 않는다.
# 보고가 없을 때는 python 을 띄우지 않고 셸만으로 끝낸다(목표 < 150ms). 훅 JSON 은 쓰지 않는다.
[ -n "${AGENT_REFLECTING:-}" ] && exit 0
exec 2>/dev/null
[[ "${MARU_WS:-}" =~ ^[A-Za-z0-9_-]{4,64}$ ]] || exit 0   # 앱의 안정적인 작업 공간 id(앱 세션 id 는 pty 재시작 때 바뀐다)
SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P) || exit 0
DATA=$(dirname "$SCRIPTS")/data   # 앱이 <ROOT>/data 로 고정해 쓰므로 agent-state.sh 와 같이 스크립트 기준으로 구한다(MARU_DATA 를 쓰지 않음)
D=$DATA/state/app/reports/$MARU_WS
[ -d "$D" ] && [ ! -L "$D" ] || exit 0
any=""
for f in "$D"/*.json; do [ -f "$f" ] && { any=1; break; }; done
[ -n "$any" ] || exit 0
# python3 는 agent-state.sh 와 같은 방식으로 찾는다(폴백 후보 디렉터리 먼저, /usr/bin 셔임은 쓰지 않음). 없으면 조용히 끝낸다.
py=""
IFS=: read -r -a _dirs <<< "${MARU_TOOL_DIRS-/Library/Developer/CommandLineTools/usr/bin:/opt/homebrew/bin:/usr/local/bin}"
for _d in ${_dirs[@]+"${_dirs[@]}"}; do
  [ -n "$_d" ] && [ "$_d" != /usr/bin ] && [ -x "$_d/python3" ] && { py=$_d/python3; break; }
done
if [ -z "$py" ]; then py=$(command -v python3 2>/dev/null); [ "$py" != /usr/bin/python3 ] || py=""; fi
[ -n "$py" ] || exit 0
MARU_DATA="$DATA" "$py" -I "$SCRIPTS/child.py" reports-read || true
exit 0
