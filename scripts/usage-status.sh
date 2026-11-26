#!/bin/bash
# Claude Code statusLine 명령: 마루 앱이 띄운 세션에서 플랜 사용량(rate_limits)을 data/usage.json 에 원자적으로 쓴다(앱 하단 띠가 읽는다).
#   표준입력(statusLine JSON)의 rate_limits.five_hour / seven_day 의 used_percentage(0~100)·resets_at(epoch 초)만 뽑는다. 숫자만 받고 나머지는 저장하지 않는다.
#   저장 형식: {"v":1,"at":<지금 epoch 초>,"five_hour":{"pct":39,"resets_at":1790000000},"seven_day":{...}}  (창이 없으면 그 키는 없다)
#   rate_limits 가 없거나 형식이 틀리면 기존 파일을 덮어쓰지 않는다. 토큰·키체인·네트워크는 쓰지 않는다.
#   앱이 띄운 세션이면 context_window 의 사용 비율과 창 크기도 data/state/app/<MARU_APP_SESSION>.ctx 에 쓴다(아래 "컨텍스트 사용량").
# 병합: 쓰기 전에 기존 usage.json 과 창별로 합친다(여러 세션이 한 파일을 공유한다). resets_at 이 더 늦은 쪽이 이기고, 같으면 pct 가 높은 쪽, 들어온 창이 없으면 기존 창을 둔다.
#   이미 지난 resets_at 을 가진 기존 창은 더 새로운 들어온 창을 이기지 못한다. 합친 결과가 기존과 같으면(들어온 값이 아무것도 앞서지 못하면) 파일을 건드리지 않는다(at 도 그대로).
#   한계: 모든 세션이 data/usage.json 하나를 공유하므로, 작업 공간마다 다른 계정으로 로그인해 있으면 수치가 섞인다.
# 통과: 사용자의 statusLine 을 읽기만 해서(순서: $PWD/.claude/settings.local.json, $PWD/.claude/settings.json, 사용자 설정 $CLAUDE_CONFIG_DIR 또는 ~/.claude 의 settings.json)
#   처음 나오는 command 형을 같은 입력으로 실행해 그 출력을 그대로 내보낸다(마지막에 exec 해서 대기하는 셸이 남지 않는다). 없으면 아무것도 출력하지 않는다.
#   이 스크립트 자신을 가리키면(재귀) 건너뛴다. ~/.claude 아래에는 절대 쓰지 않는다.
#   한계: 사용자 명령을 찾는 데도 python3 를 쓰므로, 동작하는 python3 가 없으면 통과도 못 한다(마루는 그 경우 statusLine 자체를 붙이지 않는다).
# 항상 exit 0, 오류는 출력하지 않는다. JSON 파싱에는 python3 를 쓴다(/usr/bin 의 고장난 셔임을 피해 폴백 디렉터리를 먼저 본다). 없으면 쓰기만 건너뛴다.
input=""
if [ ! -t 0 ]; then { input=$(head -c 262144 2>/dev/null); cat >/dev/null 2>&1; } 2>/dev/null; fi
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P) || exit 0
dir=$here/../data

# python3 찾기: 폴백 후보 디렉터리 먼저, 없으면 PATH. 못 찾으면 비움.
py=""
IFS=: read -r -a _dirs <<< "${MARU_TOOL_DIRS-/Library/Developer/CommandLineTools/usr/bin:/opt/homebrew/bin:/usr/local/bin}"
for _d in ${_dirs[@]+"${_dirs[@]}"}; do
  # /usr/bin/python3 는 CLT 가 없는 맥에서 설치 창을 띄우는 셔임이라 후보에서 뺀다
  [ -n "$_d" ] && [ "$_d" != /usr/bin ] && [ -x "$_d/python3" ] && { py=$_d/python3; break; }
done
if [ -z "$py" ]; then py=$(command -v python3 2>/dev/null); [ "$py" != /usr/bin/python3 ] || py=""; fi
[ -n "$py" ] && "$py" -I -c pass >/dev/null 2>&1 </dev/null || exit 0   # 실제로 돌아가는지 확인(고장난 셔임이면 건너뜀)

# 1행: 쓸 본문(없으면 빈 줄), 2행: 통과시킬 사용자 명령(없으면 빈 줄)
out=$(printf '%s' "$input" | "$py" -I -c '
import json, math, os, sys, time
def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
def ok(w):
    return isinstance(w, dict) and num(w.get("pct")) and num(w.get("resets_at")) and 0 < w["resets_at"] < 4102444800
body = ""
try:
    o = json.loads(sys.stdin.read())
    rl = o.get("rate_limits") if isinstance(o, dict) else None
    inc = {}
    if isinstance(rl, dict):
        for k in ("five_hour", "seven_day"):
            w = rl.get(k)
            if isinstance(w, dict) and num(w.get("used_percentage")) and num(w.get("resets_at")) and 0 < w["resets_at"] < 4102444800:
                inc[k] = {"pct": round(min(100.0, max(0.0, w["used_percentage"])), 1), "resets_at": int(w["resets_at"])}
    if inc:
        old = {}
        try:
            with open(os.path.join(sys.argv[1], "usage.json"), "rb") as f:
                ox = json.loads(f.read(4096))
            if isinstance(ox, dict) and ox.get("v") == 1:
                old = {k: ox[k] for k in ("five_hour", "seven_day") if ok(ox.get(k))}
        except Exception:
            old = {}
        merged = {}
        for k in ("five_hour", "seven_day"):
            a, b = old.get(k), inc.get(k)
            if a and b:
                if b["resets_at"] > a["resets_at"] or (b["resets_at"] == a["resets_at"] and b["pct"] > a["pct"]):
                    merged[k] = b
                else:
                    merged[k] = {"pct": a["pct"], "resets_at": int(a["resets_at"])}
            elif b:
                merged[k] = b
            elif a:
                merged[k] = {"pct": a["pct"], "resets_at": int(a["resets_at"])}
        before = {k: {"pct": v["pct"], "resets_at": int(v["resets_at"])} for k, v in old.items()}
        if merged != before:
            rec = {"v": 1, "at": int(time.time())}
            rec.update(merged)
            body = json.dumps(rec, separators=(",", ":"))
except Exception:
    pass
cmd = ""
try:
    cd = os.environ.get("CLAUDE_CONFIG_DIR", "")
    cd = cd if cd.startswith("/") else os.path.join(os.path.expanduser("~"), ".claude")
    here = os.getcwd()
    for f in (os.path.join(here, ".claude", "settings.local.json"), os.path.join(here, ".claude", "settings.json"), os.path.join(cd, "settings.json")):
        try:
            with open(f, "rb") as fh:
                s = json.loads(fh.read(1048576)).get("statusLine")
        except Exception:
            continue
        if isinstance(s, dict) and s.get("type") == "command" and isinstance(s.get("command"), str):
            c = s["command"].strip()
            if c and "\n" not in c and "usage-status.sh" not in c:
                cmd = c
            break
except Exception:
    pass
ctx = ""
try:
    cw = o.get("context_window") if isinstance(o, dict) else None
    if isinstance(cw, dict):
        p, sz = cw.get("used_percentage"), cw.get("context_window_size")
        if p is None and "used_percentage" in cw and cw.get("total_input_tokens") == 0:
            p = 0
        if num(p):
            r = {"v": 1, "at": int(time.time() * 1000), "pct": round(min(100.0, max(0.0, p)), 1)}
            if num(sz) and 0 < sz <= 100000000:
                r["size"] = int(sz)
            ctx = json.dumps(r, separators=(",", ":"))
except Exception:
    ctx = ""
print(body)
print(cmd)
print(ctx)
' "$dir" 2>/dev/null) || out=""
body=$(printf '%s\n' "$out" | sed -n 1p); cmd=$(printf '%s\n' "$out" | sed -n 2p); ctx=$(printf '%s\n' "$out" | sed -n 3p)

# 컨텍스트 사용량: 앱이 띄운 세션(MARU_APP_SESSION 이 형식에 맞을 때)만 data/state/app/<그 값>.ctx 에 한 줄로 바꿔 쓴다(읽기 화면의 입력창 아래 표시용).
#   담는 값은 숫자뿐이다: 쓴 시각(ms), 사용 비율(0~100), 창 크기(토큰). 대화 내용·경로·세션 id 는 쓰지 않는다. 폴더는 만들지 않는다(앱이 만든 것만 쓴다).
sid=${MARU_APP_SESSION:-}
case "$sid" in ''|*[!A-Za-z0-9-]*) sid="" ;; esac
if [ -n "$sid" ] && { [ "${#sid}" -lt 8 ] || [ "${#sid}" -gt 64 ]; }; then sid=""; fi
sdir=$dir/state/app
if [ -n "$ctx" ] && [ -n "$sid" ] && [ ! -L "$dir" ] && [ ! -L "$dir/state" ] && [ -d "$sdir" ] && [ ! -L "$sdir" ] && [ ! -L "$sdir/$sid.ctx" ]; then
  tmp=$(mktemp "$sdir/.ctx.XXXXXX" 2>/dev/null)
  if [ -n "$tmp" ]; then
    if printf '%s\n' "$ctx" >"$tmp" 2>/dev/null; then mv -f "$tmp" "$sdir/$sid.ctx" 2>/dev/null; fi
    rm -f "$tmp" 2>/dev/null
  fi
fi

if [ -n "$body" ] && [ ! -L "$dir" ] && mkdir -p "$dir" 2>/dev/null && [ ! -L "$dir" ] && [ ! -L "$dir/usage.json" ]; then
  tmp=$(mktemp "$dir/.usage.XXXXXX" 2>/dev/null)
  if [ -n "$tmp" ]; then
    if printf '%s\n' "$body" >"$tmp" 2>/dev/null; then mv -f "$tmp" "$dir/usage.json" 2>/dev/null; fi
    rm -f "$tmp" 2>/dev/null
  fi
fi

# 통과: 재귀 방지(환경 표지 + 명령에 이 스크립트 이름이 있으면 위에서 이미 뺐다). exec 로 바꿔 끼워, 명령이 멈춰도 이 프로세스를 죽이면 같이 죽는다.
if [ -n "$cmd" ] && [ -z "${MARU_USAGE_PASS:-}" ]; then
  exec env MARU_USAGE_PASS=1 /bin/sh -c "$cmd" <<<"$input" 2>/dev/null
fi
exit 0
