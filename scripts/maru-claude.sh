#!/bin/bash
# 마루 세션 실행기: 스쿼드(scripts/squads.py json)가 있으면 `claude --agents <JSON>` 으로, 아니면 그냥 `claude` 로 exec 한다.
# 스쿼드 문제(python3 없음·검증 실패·JSON 이상)로 마루가 못 뜨는 일은 없어야 한다: 어떤 실패든 스쿼드 없이 실행한다.
# 받은 인자는 그대로 claude 에 넘긴다(앱이 할 일의 원래 세션을 이어 열 때 `--resume <uuid>` 가 여기로 온다). 스쿼드 유무와 무관하다.
# 시험용: MARU_NO_SQUADS=1 이면 스쿼드를 붙이지 않는다.
# 하위 세션(앱이 마루의 요청으로 연 작업 공간): MARU_CHILD_PROMPT_FILE(앱이 $MARU_DATA/state/app/prompts/ 에 둔 초기 프롬프트 파일)이 검증을 통과하면
# 내용을 읽고 파일을 지운 뒤 `claude … -- <프롬프트>` 로 넘긴다(프롬프트는 셸 명령줄이 아니라 argv 한 개로만 간다).
# 잘못된 파일이면 stderr 한 줄을 남기고, 빈 세션으로 조용히 뜨지 않게 고정 안내문을 첫 입력으로 넣는다. 이 환경변수는 claude 와 그 자식에게 넘기지 않는다.
# 하위 세션의 팀(MARU_CHILD_SQUAD=<slug>, 앱이 사용자 확인을 거쳐 정한다): slug 형식이 맞고 `squads.py session-agent <slug>` 가 sq-<slug>-session 을 내줄 때만(그 스쿼드가 JSON 에 실제로 담길 때) `--agent sq-<slug>-session` 을 붙여
# 세션의 메인 스레드가 그 스쿼드 총괄로 돌게 한다(사용자와 직접 대화하는 메인 세션용 에이전트). 아니면 무시하고 stderr 한 줄만 남긴다(세션은 그대로 뜬다). 이 환경변수도 claude 와 그 자식에게 넘기지 않는다.
# (MARU_CHILD_ADD_DIR 는 더 이상 쓰지 않는다: 하위 세션은 설계 문서를 세션 시작 컨텍스트로만 받는다. 값이 있어도 무시한다.)
SCRIPTS=$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null && pwd -P) || SCRIPTS=""
pfile=${MARU_CHILD_PROMPT_FILE:-}
unset MARU_CHILD_PROMPT_FILE
csq=${MARU_CHILD_SQUAD:-}
unset MARU_CHILD_SQUAD
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
agent=()
if [ -n "$csq" ]; then
  # slug 검사: 문자 범위(a-z)는 로캘에 따라 달라질 수 있어 허용 문자를 그대로 적는다. 1~20자, 첫 글자는 하이픈이 아님
  case "$csq" in
    ''|-*|*[!abcdefghijklmnopqrstuvwxyz0123456789-]*) csq_ok="" ;;
    *) csq_ok=1; [ ${#csq} -le 20 ] || csq_ok="" ;;
  esac
  sess=""
  # 어떤 에이전트를 쓸지는 squads.py 가 정한다: 그 slug 가 JSON 에 실제로 담기는 스쿼드일 때만 sq-<slug>-session(메인 스레드용)을 출력한다(아니면 출력 없이 실패).
  # 래퍼가 JSON 키를 접두로 짐작하지 않는다(다른 스쿼드의 팀원 이름과 겹칠 수 있다). 값은 argv 배열로만 넘긴다.
  if [ -n "$csq_ok" ] && [ -n "$json" ] && [ -n "$lib_ok" ]; then
    sess=$(python3 -I "$SCRIPTS/squads.py" session-agent "$csq" </dev/null 2>/dev/null) || sess=""
    [ "$sess" = "sq-$csq-session" ] || sess=""
    case "$json" in *"\"$sess\":{"*) ;; *) sess="" ;; esac   # 두 번 읽는 사이에 바뀌었을 때를 대비해 지금 쓰는 JSON 에도 그 키가 있는지 확인
  fi
  if [ -n "$sess" ]; then agent=(--agent "$sess")
  else echo "마루: 요청된 팀을 쓸 수 없어 팀 없이 시작합니다. / Maru: the requested team is not available; starting without a team." >&2; fi
fi
# 앱 세션용 `--settings <JSON>`(전역 설정은 건드리지 않는다. 그 폴더의 자체 설정·훅과는 합쳐진다). 두 부분이 있고 둘 다 python3 가 없거나 JSON 을 못 만들면 붙이지 않고 그대로 실행한다.
#  1) 상태 훅(마루 폴더 밖 세션): 앱이 띄운 세션(MARU_APP_SESSION)이 마루 저장소 밖 폴더에서 돌면 저장소의 프로젝트 설정(.claude/settings.json)이 실리지 않아
#     앱이 상태를 알 수 없다. 그 세션에 agent-state.sh 훅을 붙인다(PreToolUse·PostToolUse·UserPromptSubmit 은 busy: 권한 확인 창은 도구 호출 때 뜨므로, Claude 가 스스로 시작한 턴에서도 창이 뜨기 전에 busy 가 된다). 저장소 루트 폴더에서는 프로젝트 설정의 훅이 이미 돌므로 붙이지 않는다. 그 밖의 모든 폴더(저장소의 하위 폴더 포함:
#     Claude Code 는 시작한 폴더의 .claude/settings.json 만 읽는다)에 붙인다. 붙였으면 data/state/app/<id>.hooked 표지를 남겨 앱이 훅이 붙은 세션임을 알게 한다(표지가 없으면 앱은 예전처럼 상태 알 수 없음으로 본다).
#     같은 조건에서 UserPromptSubmit·Stop 에 talk-log.sh 훅(timeout 5)도 붙여 질문·최종 답변을 data/state/app/<id>.talk.jsonl 에 남긴다(앱 읽기 화면용). MARU_NO_TALK_LOG=1 이면 붙이지 않는다.
#     화면 블록 지시문: talk-log 훅이 실제로 `--settings` 에 들어갔을 때만(surf_want=1) prompts/read-surface.md 를 `--append-system-prompt` 로 더한다. MARU_NO_SURFACE=1 이거나, prompts 폴더나 파일이 링크이거나·파일이 보통 파일이 아니거나·비었거나·4096바이트 초과이거나,
#     사용자 인자에 이미 --append-system-prompt/--system-prompt(-file 포함)가 있으면 붙이지 않고 지금과 똑같이 실행한다.
#  2) 플랜 사용량(어느 폴더든): statusLine 으로 usage-status.sh 를 붙인다(앱 하단 띠용 data/usage.json; 사용자의 기존 statusLine 은 그 스크립트가 통과시킨다). MARU_NO_USAGE_STATUS=1 이면 붙이지 않는다.
sset=()
sysp=()
surf_want=""; tk_arg=""   # 환경변수로 들어온 값이 쓰이지 않게 앱 세션 분기 밖에서 비워 둔다
if [ -n "${MARU_APP_SESSION:-}" ] && [ -n "$SCRIPTS" ]; then
  sroot=${SCRIPTS%/*}; shere=$(pwd -P 2>/dev/null) || shere=""
  sh_arg=""; su_arg=""; tk_arg=""
  if [ -f "$SCRIPTS/agent-state.sh" ] && [ ! -L "$SCRIPTS/agent-state.sh" ] && [ -x "$SCRIPTS/agent-state.sh" ] && [ -z "${MARU_NO_STATE_HOOKS:-}" ]; then
    case "$shere" in ""|"$sroot") ;; *) sh_arg="$SCRIPTS/agent-state.sh" ;; esac
    # 읽기 화면 기록 훅은 상태 훅과 같은 조건에서만 붙인다(MARU_NO_TALK_LOG=1 이면 붙이지 않는다)
    if [ -n "$sh_arg" ] && [ -f "$SCRIPTS/talk-log.sh" ] && [ ! -L "$SCRIPTS/talk-log.sh" ] && [ -x "$SCRIPTS/talk-log.sh" ] && [ "${MARU_NO_TALK_LOG:-}" != 1 ]; then tk_arg="$SCRIPTS/talk-log.sh"; fi
  fi
  if [ -f "$SCRIPTS/usage-status.sh" ] && [ ! -L "$SCRIPTS/usage-status.sh" ] && [ -x "$SCRIPTS/usage-status.sh" ] && [ -z "${MARU_NO_USAGE_STATUS:-}" ]; then su_arg="$SCRIPTS/usage-status.sh"; fi
  if [ -n "$sh_arg$su_arg" ]; then
    spy=$(find_py)
    [ -n "$spy" ] && ! "$spy" -I -c pass >/dev/null 2>&1 </dev/null && spy=""   # 실제로 돌아가는 python3 만 쓴다(안 돌면 붙이지 않는다: 사용자의 statusLine 을 가리지 않게)
    sj=""
    [ -n "$spy" ] && sj=$("$spy" -I -c '
import json, shlex, sys
d = {}
if sys.argv[1]:
    p = shlex.quote(sys.argv[1])
    def h(a, m=None):
        e = {"hooks": [{"type": "command", "command": p + " " + a}]}
        if m:
            e["matcher"] = m
        return [e]
    d["hooks"] = {
        "UserPromptSubmit": h("busy"), "PreToolUse": h("busy"), "PostToolUse": h("busy"), "Stop": h("idle"), "StopFailure": h("idle"),
        "Notification": h("waiting", "permission_prompt|elicitation_dialog"),
        "SubagentStart": h("sub-start"), "SubagentStop": h("sub-stop")}
    if sys.argv[3]:   # 읽기 화면 기록 훅: 상태 훅 뒤에 같은 항목으로 붙인다(timeout 5초)
        q = shlex.quote(sys.argv[3])
        for ev, a in (("UserPromptSubmit", "user"), ("Stop", "assistant")):
            d["hooks"][ev][0]["hooks"].append({"type": "command", "command": q + " " + a, "timeout": 5})
if sys.argv[2]:
    d["statusLine"] = {"type": "command", "command": shlex.quote(sys.argv[2])}
    # padding: usage-status.sh 가 통과시킬 사용자 statusLine 과 같은 파일(현재 폴더의 .claude/settings.local.json, settings.json, 사용자 설정 순)에서, 숫자(0~20 정수)일 때만 가져온다
    import os
    cd = os.environ.get("CLAUDE_CONFIG_DIR", "")
    cd = cd if cd.startswith("/") else os.path.join(os.path.expanduser("~"), ".claude")
    here = os.getcwd()
    for f in (os.path.join(here, ".claude", "settings.local.json"), os.path.join(here, ".claude", "settings.json"), os.path.join(cd, "settings.json")):
        try:
            with open(f, "rb") as fh:
                u = json.loads(fh.read(1048576)).get("statusLine")
        except Exception:
            continue
        if isinstance(u, dict) and u.get("type") == "command" and isinstance(u.get("command"), str):
            pd = u.get("padding")
            if isinstance(pd, int) and not isinstance(pd, bool) and 0 <= pd <= 20:
                d["statusLine"]["padding"] = pd
            break
print(json.dumps(d, separators=(",", ":")))
' "$sh_arg" "$su_arg" "$tk_arg" 2>/dev/null) || sj=""
    case "$sj" in
      '{"hooks":{'*|'{"statusLine":{'*)
        sset=(--settings "$sj")
        # talk-log 훅이 실제로 이 JSON 에 들어갔을 때만 화면 블록 지시문을 붙인다
        case "$sj" in '{"hooks":{'*) [ -n "$tk_arg" ] && surf_want=1 ;; esac
        # 표지(훅을 붙였을 때만): id 형식(agent-state.sh 와 같은 규칙)이 맞고 폴더가 링크가 아닐 때만. 실패해도 세션은 그대로 뜬다
        sid=$MARU_APP_SESSION; sdir=$sroot/data/state/app
        case "$sid" in *[!A-Za-z0-9-]*) sid="" ;; esac
        if [ -n "$sh_arg" ] && [ -n "$sid" ] && [ "${#sid}" -ge 8 ] && [ "${#sid}" -le 64 ] && [ ! -L "$sdir" ] && mkdir -p "$sdir" 2>/dev/null && [ ! -L "$sdir" ] && [ ! -L "$sdir/$sid.hooked" ]; then
          : > "$sdir/$sid.hooked" 2>/dev/null || :
        fi
        ;;
    esac
  fi
fi
# 화면 블록 지시문: talk-log 훅이 실제로 --settings 에 들어갔을 때(surf_want=1)만, MARU_NO_SURFACE=1 이 아니고 사용자 인자에 시스템 프롬프트 옵션이 없을 때만
# prompts/read-surface.md(prompts 폴더와 파일이 링크가 아닌 보통 파일, 1~4096바이트)를 `--append-system-prompt` 로 붙인다. 하나라도 어긋나면 붙이지 않는다.
if [ "$surf_want" = 1 ] && [ "${MARU_NO_SURFACE:-}" != 1 ]; then
  sdirp=${SCRIPTS%/*}/prompts; sfile=$sdirp/read-surface.md; surf_ok=1
  for a in "$@"; do
    case "$a" in --system-prompt|--system-prompt=*|--system-prompt-file|--system-prompt-file=*|--append-system-prompt|--append-system-prompt=*|--append-system-prompt-file|--append-system-prompt-file=*) surf_ok="" ;; esac
  done
  if [ -n "$surf_ok" ] && [ -d "$sdirp" ] && [ ! -L "$sdirp" ] && [ -f "$sfile" ] && [ ! -L "$sfile" ]; then
    # 한 번만 읽는다(끝 x 로 개행 보존). 4097바이트까지 읽어 읽은 바이트 수가 1~4096 인지 다시 확인한다
    stext=$(LC_ALL=C head -c 4097 "$sfile" 2>/dev/null; printf x); stext=${stext%x}
    ssz=$(export LC_ALL=C; printf '%s' "${#stext}")
    case "$ssz" in ''|*[!0-9]*) ;; *)
      if [ "$ssz" -ge 1 ] && [ "$ssz" -le 4096 ]; then
        stext=$(printf '%s' "$stext"); [ -n "$stext" ] && sysp=(--append-system-prompt "$stext")
      fi ;;
    esac
  fi
fi
case "$json" in
  "{\"sq-"*) exec claude --agents "$json" ${agent[@]+"${agent[@]}"} ${sset[@]+"${sset[@]}"} ${sysp[@]+"${sysp[@]}"} "$@" ${post[@]+"${post[@]}"} ;;
esac
exec claude ${sset[@]+"${sset[@]}"} ${sysp[@]+"${sysp[@]}"} "$@" ${post[@]+"${post[@]}"}
