#!/bin/bash
# 플랜 사용량 띠 시험: usage-status.sh(statusLine 명령: data/usage.json 쓰기·통과·재귀 방지)와 maru-claude.sh 의 --settings(statusLine) 배선. 0=통과 1=실패.
# 저장소를 임시 폴더로 복사해 거기서만 돈다(실제 data/ 는 건드리지 않는다). HOME·CLAUDE_CONFIG_DIR 도 임시 폴더로 강제한다(~/.claude 는 읽지도 쓰지도 않는다).
# 진짜 claude 는 부르지 않는다(가짜 claude 가 argv 만 기록). 네트워크 접속 없음.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd -P)
REAL_HOME=${HOME:-}
T=$(mktemp -d 2>/dev/null) || { echo "mktemp 실패" >&2; exit 1; }
T=$(cd "$T" && pwd -P)
case "$T" in ""|/|"$REAL_HOME"|"$REAL_HOME"/*|"$REPO"|"$REPO"/*) echo "임시 경로가 아님: $T — 종료" >&2; exit 1;; esac
[ -d "$T" ] && [ -w "$T" ] || { echo "임시 폴더 이상 — 종료" >&2; exit 1; }
trap 'case "$T" in /*/*) rm -rf "$T";; esac' EXIT

FAIL=0; N=0
ok()   { N=$((N+1)); echo "  ok   $*"; }
bad()  { N=$((N+1)); FAIL=$((FAIL+1)); echo "  FAIL $*"; }
check() { local name=$1; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }

find_py() {
  local d
  for d in /Library/Developer/CommandLineTools/usr/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$d/python3" ] && "$d/python3" -c 'pass' >/dev/null 2>&1 </dev/null && { printf '%s' "$d/python3"; return 0; }
  done
  return 1
}
REAL_PY=$(find_py) || { echo "동작하는 python3 없음 — 시험 불가" >&2; exit 1; }
PYDIR=$(dirname "$REAL_PY")

R=$T/repo; mkdir -p "$R" "$T/home" "$T/cfg" "$T/stub" "$T/out side"
cp -R "$REPO/scripts" "$R/scripts"
US=$R/scripts/usage-status.sh; UJ=$R/data/usage.json
[ -x "$US" ] || { echo "usage-status.sh 없음/실행 불가" >&2; exit 1; }
BASEPATH=/usr/bin:/bin
# 스크립트 실행: 환경을 비우고 임시 HOME·CLAUDE_CONFIG_DIR 만 준다
us() { local input=$1; shift; printf '%s' "$input" | env -i HOME="$T/home" CLAUDE_CONFIG_DIR="$T/cfg" PATH="$BASEPATH" MARU_TOOL_DIRS="$PYDIR" "$@" bash "$US" 2>/dev/null; }
now=$(date +%s)
GOOD='{"model":{"id":"x"},"rate_limits":{"five_hour":{"used_percentage":39.4,"resets_at":'$((now+2700))'},"seven_day":{"used_percentage":24,"resets_at":'$((now+345600))'}}}'
pyj() { "$REAL_PY" -I -c "import json,sys;d=json.load(open(sys.argv[1]));print(eval(sys.argv[2]))" "$1" "$2"; }

echo "== usage-status.sh: 쓰기"
out=$(us "$GOOD"); rc=$?
check "정상 입력: exit 0, 출력 없음(사용자 statusLine 없음)" [ $rc = 0 ] && [ -z "$out" ]
check "usage.json 이 유효한 JSON, v=1" [ "$(pyj "$UJ" 'd["v"]')" = 1 ]
check "five_hour pct·resets_at" [ "$(pyj "$UJ" '" ".join(map(str,[d["five_hour"]["pct"],d["five_hour"]["resets_at"]]))')" = "39.4 $((now+2700))" ]
check "seven_day pct" [ "$(pyj "$UJ" 'd["seven_day"]["pct"]')" = 24 ]
check "at 이 지금 근처" [ "$(pyj "$UJ" 'abs(d["at"]-'"$now"')<=5')" = True ]
check "임시 파일이 남지 않음" [ -z "$(ls -A "$R/data" | grep -v '^usage.json$')" ]
check "복사본은 자기 위치 기준 <복사본>/data 에만 씀(실제 저장소 경로는 보지 않음)" sh -c '[ "$(find "$1" -name usage.json | sort)" = "$2" ] && grep -q "\"pct\":39.4" "$2"' _ "$T" "$UJ"
echo "== 덮어쓰기 규칙"
cp "$UJ" "$T/before.json"
us '{"model":{"id":"x"}}' >/dev/null; check "rate_limits 없음: 기존 파일 유지" cmp -s "$UJ" "$T/before.json"
us '{"rate_limits":{}}' >/dev/null; check "rate_limits 비어 있음: 기존 파일 유지" cmp -s "$UJ" "$T/before.json"
us 'garbage {{{' >/dev/null; rc=$?; check "쓰레기 입력: exit 0, 기존 파일 유지" [ $rc = 0 ] && cmp -s "$UJ" "$T/before.json"
us '' >/dev/null; rc=$?; check "빈 입력: exit 0" [ $rc = 0 ]
us '{"rate_limits":{"five_hour":{"used_percentage":"abc","resets_at":5}}}' >/dev/null; check "숫자가 아닌 값: 기존 파일 유지" cmp -s "$UJ" "$T/before.json"
rm -rf "$R/data"; us '{"rate_limits":{"five_hour":{"used_percentage":250,"resets_at":'$((now+60))'}}}' >/dev/null
check "pct 는 100 으로 제한, 없는 창은 키 없음" [ "$(pyj "$UJ" '" ".join(map(str,[d["five_hour"]["pct"],"seven_day" in d]))')" = "100.0 False" ]
rm -rf "$R/data"; us "$GOOD" >/dev/null; check "data 폴더가 없어도 만든다" [ -f "$UJ" ]
echo "== 통과(사용자 statusLine)"
printf '%s\n' '{"statusLine":{"type":"command","command":"cat >/dev/null; echo user-line"}}' > "$T/cfg/settings.json"
cp "$T/cfg/settings.json" "$T/settings.before"
out=$(us "$GOOD"); check "사용자 statusLine 의 출력을 그대로 낸다" [ "$out" = "user-line" ]
printf '%s\n' '{"statusLine":{"type":"command","command":"cat"}}' > "$T/cfg/settings.json"
out=$(us "$GOOD"); check "같은 표준입력을 그 명령에 넘긴다" [ "$out" = "$GOOD" ]
printf '%s\n' '{"statusLine":{"type":"static","text":"hi"}}' > "$T/cfg/settings.json"
out=$(us "$GOOD"); check "command 형이 아니면 출력 없음" [ -z "$out" ]
printf '%s\n' '{bad json' > "$T/cfg/settings.json"
out=$(us "$GOOD"); rc=$?; check "settings.json 이 깨져도 exit 0, 출력 없음" [ $rc = 0 ] && [ -z "$out" ]
printf '%s\n' '{"statusLine":{"type":"command","command":"cat >/dev/null; echo user-line"}}' > "$T/cfg/settings.json"
out=$(us 'not json'); check "쓸 수 없는 입력이어도 통과는 한다" [ "$out" = "user-line" ]
check "settings.json 은 읽기만 한다(변경 없음)" cmp -s "$T/cfg/settings.json" "$T/settings.before"
check "CLAUDE_CONFIG_DIR 에 다른 파일이 생기지 않음" [ "$(ls -A "$T/cfg")" = "settings.json" ]
check "HOME 에 아무것도 생기지 않음" [ -z "$(ls -A "$T/home")" ]
echo "== 재귀 방지"
printf '%s\n' '{"statusLine":{"type":"command","command":"'"$US"'"}}' > "$T/cfg/settings.json"
out=$(us "$GOOD"); rc=$?; check "사용자 명령이 이 스크립트면 건너뜀(출력 없음, 종료됨)" [ $rc = 0 ] && [ -z "$out" ]
printf '%s\n' '{"statusLine":{"type":"command","command":"echo should-not-run"}}' > "$T/cfg/settings.json"
out=$(us "$GOOD" MARU_USAGE_PASS=1); check "통과 중 표지(MARU_USAGE_PASS)가 있으면 건너뜀" [ -z "$out" ]

echo "== 병합(여러 세션이 한 파일을 공유)"
mk() { local sd=""; [ -n "${3:-}" ] && sd=',"seven_day":{"used_percentage":'$3',"resets_at":'$4'}'; printf '{"rate_limits":{"five_hour":{"used_percentage":%s,"resets_at":%s}%s}}' "$1" "$2" "$sd"; }
rm -rf "$R/data"; us "$(mk 50 $((now+3000)) 30 $((now+300000)))" >/dev/null
AT0=$(pyj "$UJ" 'd["at"]'); sleep 1.1
cp "$UJ" "$T/m0.json"
us "$(mk 10 $((now+1000)) 5 $((now+200000)))" >/dev/null
check "더 이른 resets_at(낡은 세션): 파일을 건드리지 않음(at 도 그대로)" cmp -s "$UJ" "$T/m0.json"
us "$(mk 40 $((now+3000)))" >/dev/null
check "같은 resets_at 에 낮은 pct: 변화 없음" cmp -s "$UJ" "$T/m0.json"
us "$(mk 60 $((now+3000)))" >/dev/null
check "같은 resets_at 에 높은 pct: 갱신, at 갱신" [ "$(pyj "$UJ" '" ".join(map(str,[d["five_hour"]["pct"],d["at"]>'"$AT0"']))')" = "60 True" ]
check "들어온 창이 없으면 기존 창(seven_day)을 둔다" [ "$(pyj "$UJ" 'd["seven_day"]["pct"]')" = 30 ]
us "$(mk 5 $((now+20000)) 7 $((now+400000)))" >/dev/null
check "더 늦은 resets_at(새 창)이 이긴다: 낮은 pct 여도" [ "$(pyj "$UJ" '" ".join(map(str,[d["five_hour"]["pct"],d["seven_day"]["pct"]]))')" = "5 7" ]
rm -rf "$R/data"; us "$(mk 99 $((now-100)) 88 $((now-50)))" >/dev/null
us "$(mk 3 $((now+18000)) 2 $((now+600000)))" >/dev/null
check "이미 지난 기존 창은 더 새로운 들어온 창을 이기지 못한다" [ "$(pyj "$UJ" '" ".join(map(str,[d["five_hour"]["pct"],d["seven_day"]["pct"]]))')" = "3 2" ]

echo "== 통과 순서(프로젝트 → 사용자)"
PR=$T/proj; mkdir -p "$PR/.claude"
usp() { local input=$1; shift; ( cd "$PR" && printf '%s' "$input" | env -i HOME="$T/home" CLAUDE_CONFIG_DIR="$T/cfg" PATH="$BASEPATH" MARU_TOOL_DIRS="$PYDIR" "$@" bash "$US" 2>/dev/null ); }
printf '%s\n' '{"statusLine":{"type":"command","command":"cat >/dev/null; echo user-level"}}' > "$T/cfg/settings.json"
out=$(usp "$GOOD"); check "프로젝트 설정이 없으면 사용자 설정" [ "$out" = "user-level" ]
printf '%s\n' '{"statusLine":{"type":"command","command":"cat >/dev/null; echo proj-shared"}}' > "$PR/.claude/settings.json"
out=$(usp "$GOOD"); check "프로젝트 settings.json 이 사용자 설정보다 먼저" [ "$out" = "proj-shared" ]
printf '%s\n' '{"statusLine":{"type":"command","command":"cat >/dev/null; echo proj-local"}}' > "$PR/.claude/settings.local.json"
out=$(usp "$GOOD"); check "settings.local.json 이 가장 먼저" [ "$out" = "proj-local" ]
printf '%s\n' '{"permissions":{}}' > "$PR/.claude/settings.local.json"
out=$(usp "$GOOD"); check "statusLine 이 없는 파일은 건너뛰고 다음 파일" [ "$out" = "proj-shared" ]
printf '%s\n' '{"statusLine":{"type":"command","command":"'"$US"' x"}}' > "$PR/.claude/settings.json"
out=$(usp "$GOOD"); check "프로젝트 쪽이 이 스크립트를 가리켜도 재귀하지 않음" [ -z "$out" ]
rm -rf "$PR/.claude"
printf '%s\n' '{"statusLine":{"type":"command","command":"sleep 30"}}' > "$T/cfg/settings.json"
( printf '%s' "$GOOD" | env -i HOME="$T/home" CLAUDE_CONFIG_DIR="$T/cfg" PATH="$BASEPATH" MARU_TOOL_DIRS="$PYDIR" bash "$US" >/dev/null 2>&1 ) & BG=$!
sleep 1.5; kill -0 $BG 2>/dev/null && alive=1 || alive=0
check "멈춰 있는 사용자 명령은 스크립트 프로세스 자체(exec)여서 하나만 남는다" [ $alive = 1 ] && [ "$(ps -o command= -p $BG | grep -c 'usage-status')" = 0 ]
SL=$(pgrep -f 'sleep 30' | head -1); kill "$BG" 2>/dev/null; { wait "$BG"; } 2>/dev/null; sleep 0.3
check "그 프로세스를 죽이면 sleep 도 사라진다(고아 없음)" [ -z "$(pgrep -f 'sh -c sleep 30')" ]
pkill -f 'sleep 30' 2>/dev/null
printf '%s\n' '{"statusLine":{"type":"command","command":"cat >/dev/null; echo user-line"}}' > "$T/cfg/settings.json"
mkdir -p "$T/badpy"; printf '%s\n' '#!/bin/sh' 'exit 1' > "$T/badpy/python3"; chmod +x "$T/badpy/python3"
out=$(us "$GOOD" MARU_TOOL_DIRS="$T/badpy" PATH="$T/badpy:$BASEPATH"); rc=$?
check "고장난 python3: exit 0, 오류 출력 없음(통과는 못 한다)" [ $rc = 0 ] && [ -z "$out" ]

echo "== maru-claude.sh: --settings 의 statusLine"
cat > "$T/stub/claude" <<'EOS'
#!/bin/bash
: > "$STUB_OUT"; for a in "$@"; do printf '%s\0' "$a" >> "$STUB_OUT"; done
exit 0
EOS
chmod +x "$T/stub/claude"
WR=$R/scripts/maru-claude.sh; SO=$T/argv.out
wrap_in() { local d=$1; shift; rm -f "$SO"; ( cd "$d" && env -i HOME="$T/home" PATH="$T/stub:$BASEPATH" MARU_PATH_PREFIX= MARU_TOOL_DIRS="$PYDIR" MARU_DATA="$R/data" MARU_HOME="$R" MARU_NO_SQUADS=1 STUB_OUT="$SO" "$@" bash "$WR" ) >/dev/null 2>&1; }
settings_check() { "$REAL_PY" -I -c '
import json, shlex, sys
a = [x.decode() for x in open(sys.argv[1], "rb").read().split(b"\0")[:-1]]
assert a[0] == "--settings" and len(a) == 2, a
d = json.loads(a[1])
sl = d["statusLine"]
assert sl["type"] == "command" and shlex.split(sl["command"]) == [sys.argv[2]], sl
assert (sys.argv[3] == "hooks") == ("hooks" in d), sorted(d)
if "hooks" in d: assert len(d["hooks"]) == 10
' "$SO" "$R/scripts/usage-status.sh" "$1"; }
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; check "저장소 밖(공백 폴더): 유효한 JSON, statusLine + 훅 10종" settings_check hooks
wrap_in "$R" MARU_APP_SESSION=inroot-12345; check "저장소 루트: 유효한 JSON, statusLine 만(훅 없음)" settings_check none
mkdir -p "$R/sub"; wrap_in "$R/sub" MARU_APP_SESSION=insub-12345; check "저장소 하위 폴더: statusLine + 훅" settings_check hooks
wrap_in "$R" ; check "MARU_APP_SESSION 없음: 인자 없음" [ ! -s "$SO" ]
wrap_in "$R" MARU_APP_SESSION=inroot-12345 MARU_NO_USAGE_STATUS=1; check "MARU_NO_USAGE_STATUS=1: 붙이지 않음" [ ! -s "$SO" ]
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_TOOL_DIRS= PATH="$T/stub:/bin"; check "python3 가 없으면 붙이지 않고 그대로 실행" [ ! -s "$SO" ]

# padding: 현재 폴더의 설정(없으면 사용자 설정)의 statusLine.padding 이 정수일 때만 옮긴다
pad_is() { "$REAL_PY" -I -c '
import json, sys
a = [x.decode() for x in open(sys.argv[1], "rb").read().split(b"\0")[:-1]]
d = json.loads(a[1])["statusLine"]
sys.exit(0 if d.get("padding") == (None if sys.argv[2] == "none" else int(sys.argv[2])) else 1)' "$SO" "$1"; }
mkdir -p "$T/out side/.claude"
printf '%s\n' '{"statusLine":{"type":"command","command":"echo x","padding":3}}' > "$T/out side/.claude/settings.json"
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 CLAUDE_CONFIG_DIR="$T/cfg"; check "padding: 프로젝트 statusLine 의 숫자를 복사" pad_is 3
printf '%s\n' '{"statusLine":{"type":"command","command":"echo x","padding":"3"}}' > "$T/out side/.claude/settings.json"
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 CLAUDE_CONFIG_DIR="$T/cfg"; check "padding: 숫자가 아니면 복사하지 않음" pad_is none
printf '%s\n' '{"statusLine":{"type":"command","command":"echo x","padding":999}}' > "$T/out side/.claude/settings.json"
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 CLAUDE_CONFIG_DIR="$T/cfg"; check "padding: 범위(0~20) 밖이면 복사하지 않음" pad_is none
rm -rf "$T/out side/.claude"
printf '%s\n' '{"statusLine":{"type":"command","command":"echo x","padding":0}}' > "$T/cfg/settings.json"
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 CLAUDE_CONFIG_DIR="$T/cfg"; check "padding: 사용자 설정에서도 복사(0 포함)" pad_is 0
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_TOOL_DIRS="$T/badpy" PATH="$T/badpy:$BASEPATH"; check "고장난 python3: statusLine 도 훅도 붙이지 않음" [ ! -s "$SO" ]
rm -f "$R/data/state/app/"*.hooked

# ---- 컨텍스트 사용량(.ctx): 앱 세션만, 숫자만, 앱이 만든 폴더에만 ----
CD=$R/data/state/app; rm -rf "$R/data/state"; mkdir -p "$CD"
us '{"context_window":{"used_percentage":42.56,"context_window_size":1000000,"total_input_tokens":5}}' MARU_APP_SESSION=ctxsess-0001 >/dev/null
check "ctx: 사용 비율과 창 크기를 한 줄로 씀" "$REAL_PY" -I -c 'import json,sys; d=json.load(open(sys.argv[1])); assert set(d)=={"v","at","pct","size"} and d["pct"]==42.6 and d["size"]==1000000 and d["at"]>1e12, d' "$CD/ctxsess-0001.ctx"
us '{"context_window":{"used_percentage":null,"total_input_tokens":0,"context_window_size":200000}}' MARU_APP_SESSION=ctxsess-0001 >/dev/null
check "ctx: 새 세션(값 없음·토큰 0)은 0으로 바꿔 씀" "$REAL_PY" -I -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["pct"]==0 and d["size"]==200000, d' "$CD/ctxsess-0001.ctx"
cp "$CD/ctxsess-0001.ctx" "$T/ctx.before"
us '{"context_window":{"used_percentage":"9"}}' MARU_APP_SESSION=ctxsess-0001 >/dev/null; us '{"x":1}' MARU_APP_SESSION=ctxsess-0001 >/dev/null
check "ctx: 숫자가 아니거나 항목이 없으면 기존 파일 유지" cmp -s "$CD/ctxsess-0001.ctx" "$T/ctx.before"
us '{"context_window":{"used_percentage":250}}' MARU_APP_SESSION=ctxsess-0002 >/dev/null
check "ctx: 범위를 넘는 값은 100으로 자르고 창 크기가 없으면 뺌" "$REAL_PY" -I -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["pct"]==100 and "size" not in d, d' "$CD/ctxsess-0002.ctx"
n0=$(ls -A "$CD" | wc -l)
us '{"context_window":{"used_percentage":50}}' >/dev/null; us '{"context_window":{"used_percentage":50}}' MARU_APP_SESSION=../evil123 >/dev/null; us '{"context_window":{"used_percentage":50}}' MARU_APP_SESSION=short >/dev/null
check "ctx: 앱 세션 값이 없거나 형식이 틀리면 쓰지 않음" [ "$(ls -A "$CD" | wc -l)" = "$n0" ]
rm -rf "$R/data/state"; us '{"context_window":{"used_percentage":50}}' MARU_APP_SESSION=ctxsess-0003 >/dev/null
check "ctx: 폴더가 없으면 만들지 않음" [ ! -e "$R/data/state" ]
mkdir -p "$R/data/state/app"; ln -s "$T/ctx.before" "$CD/ctxsess-0004.ctx"; us '{"context_window":{"used_percentage":77}}' MARU_APP_SESSION=ctxsess-0004 >/dev/null
check "ctx: 대상이 링크면 쓰지 않음" sh -c '[ -L "$1" ] && ! grep -q 77 "$2"' _ "$CD/ctxsess-0004.ctx" "$T/ctx.before"
rm -rf "$R/data/state"

echo; if [ $FAIL = 0 ]; then echo "test-usage: OK ($N 항목)"; exit 0; else echo "test-usage: 실패 $FAIL / $N"; exit 1; fi
