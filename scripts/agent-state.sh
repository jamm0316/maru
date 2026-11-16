#!/bin/bash
# Claude Code 훅에서 호출: 마루 앱이 띄운 세션의 상태를 data/state/app 아래에 원자적으로 쓴다.
#   busy|idle|waiting : <id>.json  {"state","at"[,"transcript_path"][,"model"]}
#   sub-start|sub-stop: <id>.subs/<agent_id> 파일(내용: agent_type 한 줄)을 만들고 지운다(동시 실행 경쟁을 피하려고 파일 하나씩)
# 표준입력(훅 JSON)에서는 위 필드(transcript_path, model, agent_id, agent_type)만 형식 검증 뒤에 뽑고 나머지는 저장하지 않는다.
# MARU_APP_SESSION 이 없거나 형식이 틀리면 아무것도 하지 않는다(앱 밖 세션·cmux 영향 없음). 항상 exit 0.
# JSON 파싱에는 python3 를 쓴다(/usr/bin 의 고장난 셔임을 피해 폴백 디렉터리를 먼저 본다). 없으면 추가 필드 없이 건너뛴다.
state=${1:-}
id=${MARU_APP_SESSION:-}
[ -n "$id" ] || exit 0
input=""
if [ ! -t 0 ]; then { input=$(head -c 262144 2>/dev/null); cat >/dev/null 2>&1; } 2>/dev/null; fi
case "$state" in busy|idle|waiting|sub-start|sub-stop) ;; *) exit 0 ;; esac
case "$id" in *[!A-Za-z0-9-]*) exit 0 ;; esac
[ "${#id}" -ge 8 ] && [ "${#id}" -le 64 ] || exit 0
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P) || exit 0
dir=$here/../data/state/app
[ -L "$dir" ] && exit 0
mkdir -p "$dir" 2>/dev/null || exit 0
[ -L "$dir" ] && exit 0

# python3 찾기: 폴백 후보 디렉터리 먼저, 없으면 PATH. 못 찾으면 비움.
py=""
IFS=: read -r -a _dirs <<< "${MARU_TOOL_DIRS-/Library/Developer/CommandLineTools/usr/bin:/opt/homebrew/bin:/usr/local/bin}"
for _d in ${_dirs[@]+"${_dirs[@]}"}; do
  # /usr/bin/python3 는 CLT 가 없는 맥에서 설치 창을 띄우는 셔임이라 후보에서 뺀다
  [ -n "$_d" ] && [ "$_d" != /usr/bin ] && [ -x "$_d/python3" ] && { py=$_d/python3; break; }
done
if [ -z "$py" ]; then py=$(command -v python3 2>/dev/null); [ "$py" != /usr/bin/python3 ] || py=""; fi

case "$state" in
  sub-start|sub-stop)
    [ -n "$py" ] && [ -n "$input" ] || exit 0
    # 출력: 1행 agent_id, 2행 agent_type(검증 통과분만; stop 은 agent_type 없이도 됨)
    out=$(printf '%s' "$input" | "$py" -I -c '
import json, re, sys
try:
    o = json.loads(sys.stdin.read())
except Exception:
    sys.exit(0)
if not isinstance(o, dict):
    sys.exit(0)
a = o.get("agent_id")
t = o.get("agent_type")
if not isinstance(t, str):
    t = o.get("subagent_type")
if not (isinstance(a, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", a)):
    sys.exit(0)
print(a)
if isinstance(t, str) and re.fullmatch(r"[A-Za-z0-9_:.-]{1,64}", t):
    print(t)
' 2>/dev/null) || exit 0
    aid=$(printf '%s\n' "$out" | sed -n 1p)
    atype=$(printf '%s\n' "$out" | sed -n 2p)
    [ -n "$aid" ] || exit 0
    sdir=$dir/$id.subs
    [ -L "$sdir" ] && exit 0
    if [ "$state" = sub-start ]; then
      [ -n "$atype" ] || exit 0
      mkdir -p "$sdir" 2>/dev/null || exit 0
      [ -L "$sdir" ] && exit 0
      if [ -e "$sdir/$aid" ] || [ -L "$sdir/$aid" ]; then [ -f "$sdir/$aid" ] && [ ! -L "$sdir/$aid" ] || exit 0; fi # 정규 파일이 아닌 것은 건드리지 않는다
      tmp=$(mktemp "$sdir/.new.XXXXXX" 2>/dev/null) || exit 0
      if printf '%s\n' "$atype" >"$tmp" 2>/dev/null; then mv -f "$tmp" "$sdir/$aid" 2>/dev/null; fi
      rm -f "$tmp" 2>/dev/null
    else
      [ -d "$sdir" ] || exit 0
      [ -L "$sdir/$aid" ] || rm -f "$sdir/$aid" 2>/dev/null
    fi
    exit 0
    ;;
esac

at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
body=""
if [ -n "$py" ] && [ -n "$input" ]; then
  # 상태 JSON 한 줄을 python 이 직접 만든다(경로의 따옴표·역슬래시 등을 안전하게 이스케이프). 실패하면 비움.
  body=$(printf '%s' "$input" | "$py" -I -c '
import json, re, sys
state, at = sys.argv[1], sys.argv[2]
rec = {"state": state, "at": at}
try:
    o = json.loads(sys.stdin.read())
except Exception:
    o = None
if isinstance(o, dict):
    p = o.get("transcript_path")
    if (isinstance(p, str) and p.startswith("/") and p.endswith(".jsonl") and len(p) <= 1024
            and not re.search(r"[\x00-\x1f\x7f-\x9f  ]", p)):
        rec["transcript_path"] = p
    m = o.get("model")
    if isinstance(m, dict):
        m = m.get("id")
    if isinstance(m, str) and re.fullmatch(r"[A-Za-z0-9._:\[\]-]{1,64}", m):
        rec["model"] = m
print(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
' "$state" "$at" 2>/dev/null) || body=""
fi
[ -n "$body" ] || body=$(printf '{"state":"%s","at":"%s"}' "$state" "$at")
tmp=$(mktemp "$dir/.$id.XXXXXX" 2>/dev/null) || exit 0
if printf '%s\n' "$body" >"$tmp" 2>/dev/null; then
  mv -f "$tmp" "$dir/$id.json" 2>/dev/null
fi
rm -f "$tmp" 2>/dev/null
# Stop(idle) 이면 이 세션의 서브에이전트 표시를 비운다(끝나지 않은 채 남은 파일 방지). 폴더가 링크면 아무것도 안 하고 정규 파일만 지운다.
if [ "$state" = idle ]; then
  sdir=$dir/$id.subs
  if [ -d "$sdir" ] && [ ! -L "$sdir" ]; then
    for _f in "$sdir"/*; do [ -f "$_f" ] && [ ! -L "$_f" ] && rm -f "$_f" 2>/dev/null; done
  fi
fi
exit 0
