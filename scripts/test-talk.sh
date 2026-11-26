#!/bin/bash
# 읽기 화면 기록 훅 시험: talk-log.sh(질문·최종 답변을 data/state/app/<session_id>.talk.jsonl 에 덧붙임; 이름은 훅 입력의 session_id)와 maru-claude.sh 의 --settings 배선, .claude/settings.json 의 훅 항목. 0=통과 1=실패.
# 저장소를 임시 폴더로 복사해 거기서만 돈다(실제 data/ 는 건드리지 않는다). HOME·CLAUDE_CONFIG_DIR 도 임시 폴더로 강제한다.
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
# checkall "이름" [ 조건1 ] '&&' [ 조건2 ] …  : '&&' 로 이은 모든 조건을 각각 판정하고 하나라도 거짓이면 FAIL 로 센다.
# (check "이름" [ a ] && [ b ] 는 셸이 && 를 먼저 해석해 check 가 첫 조건만 보므로 뒤쪽 조건의 거짓을 놓친다.)
checkall() { local name=$1 a okk=1; shift; local cur=(); for a in "$@" "&&"; do if [ "$a" = "&&" ]; then if [ ${#cur[@]} -gt 0 ]; then "${cur[@]}" || okk=0; fi; cur=(); else cur+=("$a"); fi; done; if [ $okk = 1 ]; then ok "$name"; else bad "$name"; fi; }

# checkall 자체 시험: 일부러 거짓 조건을 넣어 FAIL 로 세어지는지 보고, 그 집계는 되돌린다(최종 집계를 오염시키지 않는다).
_n0=$N; _f0=$FAIL
checkall "일부러 거짓(뒤쪽)" [ 1 = 1 ] '&&' [ 1 = 2 ] >/dev/null
checkall "일부러 거짓(앞쪽)" [ 1 = 2 ] '&&' [ 1 = 1 ] >/dev/null
checkall "일부러 거짓(가운데)" [ 1 = 1 ] '&&' [ 1 = 2 ] '&&' [ 1 = 1 ] >/dev/null
checkall "모두 참" [ 1 = 1 ] '&&' [ 2 = 2 ] >/dev/null
_selfok=0; [ $((N-_n0)) = 4 ] && [ $((FAIL-_f0)) = 3 ] && _selfok=1
N=$_n0; FAIL=$_f0
if [ $_selfok = 1 ]; then ok "checkall 이 뒤쪽·가운데 조건의 거짓도 FAIL 로 셈(집계는 되돌림)"; else bad "checkall 이 거짓 조건을 FAIL 로 세지 못함"; fi

find_py() {
  local d
  for d in /Library/Developer/CommandLineTools/usr/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$d/python3" ] && "$d/python3" -c 'pass' >/dev/null 2>&1 </dev/null && { printf '%s' "$d/python3"; return 0; }
  done
  return 1
}
REAL_PY=$(find_py) || { echo "동작하는 python3 없음 — 시험 불가" >&2; exit 1; }
PYDIR=$(dirname "$REAL_PY")
[ -d "$REPO/data" ] && touch "$T/stamp" && sleep 1 && touch "$T/stamp2"

R=$T/repo; mkdir -p "$R" "$T/home" "$T/cfg" "$T/stub" "$T/out side"
cp -R "$REPO/scripts" "$R/scripts"
TL=$R/scripts/talk-log.sh
[ -x "$TL" ] || { echo "talk-log.sh 없음/실행 불가" >&2; exit 1; }
APP=$R/data/state/app
SID=sess-12345678
F=$APP/$SID.talk.jsonl
BASEPATH=/usr/bin:/bin
# 스크립트 실행: 환경을 비우고 임시 HOME 만 준다. 표준출력·표준오류는 $T/so, $T/se 에 남기고 종료 코드를 돌려준다.
tl() { local role=$1 input=$2; shift 2; printf '%s' "$input" | env -i HOME="$T/home" PATH="$BASEPATH" MARU_TOOL_DIRS="$PYDIR" MARU_APP_SESSION="$SID" "$@" bash "$TL" "$role" >"$T/so" 2>"$T/se"; }
tlf() { local role=$1 file=$2; shift 2; env -i HOME="$T/home" PATH="$BASEPATH" MARU_TOOL_DIRS="$PYDIR" MARU_APP_SESSION="$SID" "$@" bash "$TL" "$role" <"$file" >"$T/so" 2>"$T/se"; }
pj() { "$REAL_PY" -I -c 'import json,sys;o=json.dumps(eval(sys.argv[1]),ensure_ascii=False);sys.stdout.write(o)' "$1"; }
mkin() { "$REAL_PY" -I -c 'import json,sys;import os;d={"transcript_path":"/x/y.jsonl","cwd":"/work/dir","hook_event_name":sys.argv[1],sys.argv[2]:(json.loads(sys.argv[3][1:]) if sys.argv[3][:1]=="\x01" else sys.argv[3])};sid=os.environ.get("TSID","sess-12345678")
if sid!="-":d={"session_id":sid,**d}
sys.stdout.write(json.dumps(d,ensure_ascii=False))' "$@"; }
UIN() { mkin UserPromptSubmit prompt "$1"; }
UINS() { TSID=$1 mkin UserPromptSubmit prompt "$2"; }   # UINS <session_id> <글>: 훅 입력의 session_id 를 지정("-" 는 필드 없음)
AIN() { mkin Stop last_assistant_message "$1"; }
# 기록 파일 질의: $1 = 파이썬 식(lines = 줄별 dict 목록)
q() { "$REAL_PY" -I -c 'import json,sys;lines=[json.loads(l) for l in open(sys.argv[1],encoding="utf-8")];print(eval(sys.argv[2]))' "$F" "$1"; }
nlines() { wc -l < "$F" | tr -d ' '; }
clean() { rm -rf "$APP"; }
mode_of() { stat -f %Lp "$1"; }

echo "== 쓰기와 형식"
clean
tl user "$(UIN '첫 질문입니다')"; rc=$?
checkall "user: exit 0, 표준출력·표준오류 비어 있음" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ]
check "파일이 <복사본>/data/state/app/<session_id>.talk.jsonl 에 생김" [ -f "$F" ]
tl assistant "$(AIN '첫 답변입니다')"; rc=$?
checkall "assistant: exit 0, 출력 없음" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ]
check "두 줄" [ "$(nlines)" = 2 ]
check "줄 형식: 키는 v, at, role, text 뿐(순서 포함)" [ "$(q '[list(l) for l in lines]')" = "[['v', 'at', 'role', 'text'], ['v', 'at', 'role', 'text']]" ]
check "1행: v=1 role=user text, 2행: role=assistant text" [ "$(q '[(l["v"],l["role"],l["text"]) for l in lines]')" = "[(1, 'user', '첫 질문입니다'), (1, 'assistant', '첫 답변입니다')]" ]
now=$(date +%s)
check "at 이 정수이고 지금 근처" [ "$(q 'all(type(l["at"]) is int and abs(l["at"]-'"$now"')<=10 for l in lines)')" = True ]
check "파일 모드 600" [ "$(mode_of "$F")" = 600 ]
check "저장하지 않는 값(session_id·cwd·경로)이 파일에 없음" sh -c '! grep -q -e "/work/dir" -e "/x/y.jsonl" -e "transcript" -e "session" -e "$2" "$1"' _ "$F" "$SID"
check "임시 파일이 남지 않음" [ "$(ls -A "$APP")" = "$SID.talk.jsonl" ]
check "각 줄이 한 줄 JSON(ensure_ascii=False: 한글이 그대로)" grep -q '첫 질문입니다' "$F"

echo "== 글 왕복(한글·따옴표·줄바꿈·역슬래시)"
clean
TXT=$'한글 "큰따옴표" \'작은\' \\ 역슬래시 \\n 글자\n둘째 줄\t탭\n\n넷째 줄 \U0001F600 {"a":1}'
tl user "$(UIN "$TXT")"
check "user 글이 그대로 돌아옴" [ "$("$REAL_PY" -I -c 'import json,sys;print(json.loads(open(sys.argv[1],encoding="utf-8").readline())["text"]==sys.argv[2])' "$F" "$TXT")" = True ]
check "여러 줄 글도 파일에서는 한 줄" [ "$(nlines)" = 1 ]
clean; tl assistant "$(AIN "$TXT")"
check "assistant 글이 그대로 돌아옴" [ "$("$REAL_PY" -I -c 'import json,sys;print(json.loads(open(sys.argv[1],encoding="utf-8").readline())["text"]==sys.argv[2])' "$F" "$TXT")" = True ]
clean; tl user '{"session_id":"sess-12345678","prompt":"\ud800 쌍 없음"}'; rc=$?
checkall "짝 없는 서로게이트가 든 JSON: exit 0, 유효한 UTF-8 한 줄이 남음" [ $rc = 0 ] '&&' [ "$(nlines)" = 1 ] '&&' [ "$(q 'lines[0]["text"]')" = "? 쌍 없음" ]

echo "== 아무것도 안 하는 경우"
clean
tl user "$(UIN 'x')" MARU_APP_SESSION=; rc=$?
checkall "MARU_APP_SESSION 비어 있음" [ $rc = 0 ] '&&' [ ! -e "$APP" ]
for bad_id in "short" "has_underscore1" 'a b c d e f g h' "../escape-12345" "$(printf 'x%.0s' $(seq 1 65))"; do
  tl user "$(UIN 'x')" MARU_APP_SESSION="$bad_id"; rc=$?
  checkall "형식이 틀린 세션 값($bad_id): 아무것도 안 씀" [ $rc = 0 ] '&&' [ -z "$(find "$R/data" "$R/scripts" -name '*.talk.jsonl' 2>/dev/null)" ] '&&' [ ! -e "$R/data/state/escape-12345.talk.jsonl" ]
done
env -i HOME="$T/home" PATH="$BASEPATH" MARU_TOOL_DIRS="$PYDIR" bash "$TL" user <<<"$(UIN x)" >"$T/so" 2>"$T/se"; rc=$?
checkall "MARU_APP_SESSION 환경변수 자체가 없음: exit 0, 파일 없음" [ $rc = 0 ] '&&' [ ! -e "$APP" ]
clean
tl bogus "$(UIN 'x')"; rc=$?; checkall "모르는 인자: 아무것도 안 함" [ $rc = 0 ] '&&' [ ! -e "$F" ]
tl "" "$(UIN 'x')"; rc=$?; checkall "인자 없음: 아무것도 안 함" [ $rc = 0 ] '&&' [ ! -e "$F" ]
tl user "$(UIN 'x')" MARU_NO_TALK_LOG=1; rc=$?; checkall "MARU_NO_TALK_LOG=1: 아무것도 안 함" [ $rc = 0 ] '&&' [ ! -e "$F" ]
tl user "$(UIN 'x')" MARU_NO_TALK_LOG=0; check "MARU_NO_TALK_LOG=0 은 끄지 않음" [ -f "$F" ]
clean
tl user "$(UIN 'x')" CLAUDE_CODE_ENTRYPOINT=sdk-cli; rc=$?; checkall "CLAUDE_CODE_ENTRYPOINT=sdk-cli(화면 없는 중첩 실행): 아무것도 안 함" [ $rc = 0 ] '&&' [ ! -e "$F" ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ]
tl assistant "$(AIN 'x')" CLAUDE_CODE_ENTRYPOINT=sdk-cli; check "sdk-cli: assistant 도 안 함" [ ! -e "$F" ]
tl user "$(UIN '진입점 cli')" CLAUDE_CODE_ENTRYPOINT=cli; check "CLAUDE_CODE_ENTRYPOINT=cli: 기록함" [ -f "$F" ]
clean; tl user "$(UIN '진입점 다른 값')" CLAUDE_CODE_ENTRYPOINT=sdk-cli2; check "sdk-cli2(정확히 sdk-cli 가 아님): 기록함" [ -f "$F" ]
clean; tl user "$(UIN '진입점 빈 값')" CLAUDE_CODE_ENTRYPOINT=; check "CLAUDE_CODE_ENTRYPOINT 가 빈 값: 기록함" [ -f "$F" ]
clean; tl user "$(UIN '진입점 없음')"; check "CLAUDE_CODE_ENTRYPOINT 없음: 기록함(위 모든 시험이 이미 환경을 비우고 돎)" [ -f "$F" ]
clean
tl user "$(UIN 'x')" AGENT_REFLECTING=1; rc=$?; checkall "AGENT_REFLECTING=1(회고 헤드리스): 아무것도 안 함" [ $rc = 0 ] '&&' [ ! -e "$F" ]
tl assistant "$(AIN 'x')" AGENT_REFLECTING=1; check "AGENT_REFLECTING: assistant 도 안 함" [ ! -e "$F" ]
tl user "$(UIN '   '$'\n\t ')"; rc=$?; checkall "공백뿐인 질문: 안 씀" [ $rc = 0 ] '&&' [ ! -e "$F" ]
tl assistant "$(AIN '')"; check "빈 답변: 안 씀" [ ! -e "$F" ]
for v in '123' 'null' '["a"]' '{"a":1}' 'true'; do
  tl user "$(UIN $'\x01'"$v")"; rc=$?; checkall "문자열이 아닌 prompt($v): 안 씀" [ $rc = 0 ] '&&' [ ! -e "$F" ]
done
tl assistant '{"hook_event_name":"Stop","prompt":"질문 필드"}'; check "assistant 에 last_assistant_message 가 없으면 안 씀(prompt 는 안 봄)" [ ! -e "$F" ]
tl user '{"hook_event_name":"UserPromptSubmit","last_assistant_message":"답변 필드"}'; check "user 에 prompt 가 없으면 안 씀" [ ! -e "$F" ]
tl user '[1,2]'; check "JSON 이 객체가 아니면 안 씀" [ ! -e "$F" ]
tl user '{"prompt": "끊긴'; rc=$?; checkall "깨진 JSON: exit 0, 안 씀, 출력 없음" [ $rc = 0 ] '&&' [ ! -e "$F" ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ]
tl user ''; rc=$?; checkall "빈 입력: exit 0, 안 씀" [ $rc = 0 ] '&&' [ ! -e "$F" ]
tl user 'garbage {{{'; check "쓰레기 입력: 안 씀" [ ! -e "$F" ]

echo "== 파일 이름은 훅 입력의 session_id"
clean
NOFILES() { [ -z "$(find "$T" -name '*.talk.jsonl' ! -path "$T/elsewhere/*" 2>/dev/null | head -1)" ] && [ -z "$(ls -A "$APP" 2>/dev/null)" ]; }
tl user "$(UINS - x)"; rc=$?
checkall "입력에 session_id 가 없음: exit 0, 아무것도 안 씀(출력 없음)" [ $rc = 0 ] '&&' NOFILES '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ]
for badsid in "short" "has_under12345" "a b c d e f g h" "../x" "a/b" "../../etc-12345678" "sess-1234567/../x" "$(printf 'x%.0s' $(seq 1 65))" $'sess-12345678\nx'; do
  tl user "$(UINS "$badsid" x)"; rc=$?
  checkall "형식이 틀린 session_id($badsid): 아무것도 안 씀" [ $rc = 0 ] '&&' NOFILES '&&' [ ! -e "$R/data/state/x.talk.jsonl" ] '&&' [ ! -e "$R/data/x.talk.jsonl" ] '&&' [ ! -e "$T/x.talk.jsonl" ]
done
for rawv in '123' 'null' '["sess-12345678"]' '{"a":1}' 'true' '""'; do
  tl user "{\"session_id\":$rawv,\"prompt\":\"x\"}"; rc=$?
  checkall "문자열이 아닌 session_id($rawv): 안 씀" [ $rc = 0 ] '&&' NOFILES
done
tl assistant "{\"session_id\":\"sess-12345678\",\"last_assistant_message\":\"\"}"; check "session_id 가 맞아도 글이 비면 안 씀" NOFILES
tl user "$(UINS sess-aaaaaaaa 'A 질문')"; tl user "$(UINS sess-bbbbbbbb 'B 질문')"
checkall "같은 MARU_APP_SESSION 에 session_id 가 다르면 파일이 따로 생김" [ "$(ls "$APP" | sort | tr '\n' ' ')" = "sess-aaaaaaaa.talk.jsonl sess-bbbbbbbb.talk.jsonl " ] '&&' [ "$(wc -l < "$APP/sess-aaaaaaaa.talk.jsonl" | tr -d ' ')" = 1 ] '&&' [ "$(wc -l < "$APP/sess-bbbbbbbb.talk.jsonl" | tr -d ' ')" = 1 ] '&&' grep -q 'A 질문' "$APP/sess-aaaaaaaa.talk.jsonl" '&&' grep -q 'B 질문' "$APP/sess-bbbbbbbb.talk.jsonl"
check "MARU_APP_SESSION 이름의 파일은 만들지 않음" [ ! -e "$APP/$SID.talk.jsonl" ]
clean
tl user "$(UIN '이어 쓰기 1')" MARU_APP_SESSION=app1-aaaaaaaa; tl assistant "$(AIN '이어 쓰기 2')" MARU_APP_SESSION=app2-bbbbbbbb; tl user "$(UIN '이어 쓰기 3')" MARU_APP_SESSION=app3-cccccccc
checkall "MARU_APP_SESSION 이 바뀌어도 session_id 가 같으면 같은 파일에 이어 씀(3줄, 파일 하나)" [ "$(ls "$APP")" = "$SID.talk.jsonl" ] '&&' [ "$(nlines)" = 3 ] '&&' [ "$(q '[l["text"] for l in lines]')" = "['이어 쓰기 1', '이어 쓰기 2', '이어 쓰기 3']" ]
clean
"$REAL_PY" -I -c 'import json,sys;sys.stdout.write(json.dumps({"session_id":"sess-trunc0001","hook_event_name":"UserPromptSubmit","prompt":"가"*400000},ensure_ascii=False))' > "$T/t1.json"
tlf user "$T/t1.json"
checkall "잘린 입력에서 정규식으로 session_id 를 찾음: 그 이름의 파일에 lost 줄" [ "$(ls "$APP")" = "sess-trunc0001.talk.jsonl" ] '&&' [ "$(wc -l < "$APP/sess-trunc0001.talk.jsonl" | tr -d ' ')" = 1 ] '&&' grep -q '"lost":true' "$APP/sess-trunc0001.talk.jsonl"
clean
"$REAL_PY" -I -c 'import sys;sys.stdout.write("{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\"  :\n \"sess-trunc0002\",\"prompt\":\""+"가"*400000+"\"}")' > "$T/t1b.json"
tlf user "$T/t1b.json"
check "잘린 입력: 키·값 사이 공백·줄바꿈이 있어도 찾음" [ "$(ls "$APP")" = "sess-trunc0002.talk.jsonl" ]
clean
"$REAL_PY" -I -c 'import json,sys;sys.stdout.write(json.dumps({"hook_event_name":"UserPromptSubmit","prompt":"가"*400000,"session_id":"sess-trunc0003"},ensure_ascii=False))' > "$T/t2.json"
tlf user "$T/t2.json"; rc=$?
checkall "잘린 입력에서 session_id 가 상한 밖에 있어 못 찾음: exit 0, 안 씀" [ $rc = 0 ] '&&' NOFILES
for badraw in '../x' 'short' 'a/b-12345678'; do
  "$REAL_PY" -I -c 'import sys,json;sys.stdout.write("{\"session_id\":"+json.dumps(sys.argv[1])+",\"prompt\":\""+"가"*400000+"\"}")' "$badraw" > "$T/t3.json"
  tlf user "$T/t3.json"; rc=$?
  checkall "잘린 입력에서 형식이 틀린 session_id($badraw): 안 씀" [ $rc = 0 ] '&&' NOFILES
done
"$REAL_PY" -I -c 'import sys;sys.stdout.write("{\"prompt\":\""+"가"*400000+"\"}")' > "$T/t4.json"
tlf user "$T/t4.json"; check "잘린 입력에 session_id 가 아예 없음: 안 씀" NOFILES
"$REAL_PY" -I -c 'import sys;sys.stdout.write("{\"session_id\":\"../../x-12345678\",\"note\":\"\\\"session_id\\\":\\\"sess-trick0001\\\"\",\"prompt\":\""+"가"*400000+"\"}")' > "$T/t5.json"
tlf user "$T/t5.json"
check "잘린 입력: 틀린 값 뒤에 따옴표를 이스케이프한 가짜 session_id 문자열이 있어도 속지 않음" sh -c '[ ! -e "$1/sess-trick0001.talk.jsonl" ]' _ "$APP"
clean

echo "== 입력 상한(1048576바이트)"
clean
"$REAL_PY" -I -c 'import json,sys;sys.stdout.write(json.dumps({"session_id":"sess-12345678","hook_event_name":"UserPromptSubmit","prompt":"가"*100000,"x":"y"}, ensure_ascii=False))' > "$T/big.json"
checkall "시험 입력이 262144바이트를 넘고 1048576 안" [ "$(wc -c < "$T/big.json" | tr -d ' ')" -gt 262144 ] '&&' [ "$(wc -c < "$T/big.json" | tr -d ' ')" -lt 1048576 ]
tlf user "$T/big.json"; rc=$?; checkall "262144바이트 넘고 1048576 안: exit 0, 긴 글이 cut 으로 기록됨" [ $rc = 0 ] '&&' [ "$(q '(len(lines[0]["text"]),lines[0]["cut"],"lost" in lines[0])')" = "(65536, True, False)" ]
clean
"$REAL_PY" -I -c 'import json,sys;sys.stdout.write(json.dumps({"session_id":"sess-12345678","hook_event_name":"UserPromptSubmit","prompt":"끝","pad":"p"*300000}))' > "$T/big2.json"
tlf user "$T/big2.json"; checkall "뒤쪽 필드가 커도 1048576 안이면 정상 기록" [ "$(nlines)" = 1 ] '&&' [ "$(q 'lines[0]["text"]')" = "끝" ]
clean
"$REAL_PY" -I -c 'import json,sys;b=json.dumps({"session_id":"sess-12345678","prompt":"정확","pad":""});n=1048576-len(b.encode());sys.stdout.write(json.dumps({"session_id":"sess-12345678","prompt":"정확","pad":"p"*n}))' > "$T/exact_lim.json"
check "시험 입력이 정확히 1048576바이트" [ "$(wc -c < "$T/exact_lim.json" | tr -d ' ')" = 1048576 ]
tlf user "$T/exact_lim.json"; checkall "정확히 상한 크기인 온전한 JSON: 파싱되어 정상 기록(lost 아님)" [ "$(nlines)" = 1 ] '&&' [ "$(q '(lines[0]["text"],"lost" in lines[0])')" = "('정확', False)" ]
clean
"$REAL_PY" -I -c 'import json,sys;sys.stdout.write(json.dumps({"session_id":"sess-12345678","hook_event_name":"UserPromptSubmit","prompt":"가"*400000,"x":"y"}, ensure_ascii=False))' > "$T/huge.json"
check "시험 입력이 1048576바이트를 넘음" [ "$(wc -c < "$T/huge.json" | tr -d ' ')" -gt 1048576 ]
tlf user "$T/huge.json"; rc=$?
checkall "1048576바이트 넘는 입력: exit 0, 출력 없음, lost 줄 하나" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ] '&&' [ "$(nlines)" = 1 ] '&&' [ "$(q '[(list(l),l["role"],l["text"],l["lost"]) for l in lines]')" = "[(['v', 'at', 'role', 'text', 'lost'], 'user', '', True)]" ]
tlf user "$T/huge.json"
check "lost 거듭 쓰기 방지: 같은 role 이면 안 씀" [ "$(nlines)" = 1 ]
"$REAL_PY" -I -c 'import json,sys;sys.stdout.write(json.dumps({"session_id":"sess-12345678","hook_event_name":"Stop","last_assistant_message":"나"*400000,"x":"y"}, ensure_ascii=False))' > "$T/huge_a.json"
tlf assistant "$T/huge_a.json"
checkall "role 이 다르면 lost 줄을 씀" [ "$(nlines)" = 2 ] '&&' [ "$(q '[(l["role"],l.get("lost")) for l in lines]')" = "[('user', True), ('assistant', True)]" ]
tl user "$(UIN '정상 질문')"; tlf user "$T/huge.json"
checkall "정상 줄이 사이에 있으면 lost 줄을 다시 씀" [ "$(nlines)" = 4 ] '&&' [ "$(q 'lines[-1].get("lost")')" = True ]

echo "== 글 길이 상한(65536자)"
clean
"$REAL_PY" -I -c 'import json,sys;sys.stdout.write(json.dumps({"session_id":"sess-12345678","hook_event_name":"Stop","last_assistant_message":"가"*65536},ensure_ascii=False))' > "$T/exact.json"
tlf assistant "$T/exact.json"
check "정확히 65536자: 자르지 않음, cut 없음" [ "$(q '(len(lines[0]["text"]),"cut" in lines[0])')" = "(65536, False)" ]
clean
"$REAL_PY" -I -c 'import json,sys;sys.stdout.write(json.dumps({"session_id":"sess-12345678","hook_event_name":"Stop","last_assistant_message":"나"*65535+"\U0001F600\U0001F600abc"},ensure_ascii=False))' > "$T/long.json"
tlf assistant "$T/long.json"; rc=$?
checkall "65536자 넘음: exit 0, 65536자로 자르고 cut=true" [ $rc = 0 ] '&&' [ "$(q '(len(lines[0]["text"]),lines[0]["cut"],list(lines[0]))')" = "(65536, True, ['v', 'at', 'role', 'text', 'cut'])" ]
check "자른 끝이 온전한 코드포인트(이모지 앞쪽 하나까지, 짝 없는 서로게이트 없음, UTF-8 로 읽힘)" [ "$(q 'lines[0]["text"][-1]=="\U0001F600" and not any(0xd800<=ord(c)<=0xdfff for c in lines[0]["text"])')" = True ]
check "한 줄 크기가 합리적(512KB 이하)" [ "$(wc -c < "$F" | tr -d ' ')" -lt 524288 ]

echo "== 같은 내용 거듭 쓰기"
clean
tl assistant "$(AIN '같은 답변')"; tl assistant "$(AIN '같은 답변')"
check "같은 assistant 두 번: 한 줄" [ "$(nlines)" = 1 ]
tl user "$(UIN '같은 답변')"
check "role 이 다르면 같은 글이어도 씀" [ "$(nlines)" = 2 ]
tl user "$(UIN '같은 답변')"
check "마지막 줄과 같으면 안 씀" [ "$(nlines)" = 2 ]
tl assistant "$(AIN '같은 답변')"
check "마지막 줄이 아닌 같은 줄은 막지 않음" [ "$(nlines)" = 3 ]
tl assistant "$(AIN '다른 답변')"
check "글이 다르면 씀" [ "$(nlines)" = 4 ]
clean; tlf assistant "$T/long.json"; tlf assistant "$T/long.json"
check "잘린 긴 글도 거듭 쓰지 않음" [ "$(nlines)" = 1 ]
clean; mkdir -p "$APP"; printf '{"v":1,"at":1,"role":"user","text":"끊긴 줄' > "$F"; chmod 600 "$F"
tl user "$(UIN '이어서')"; rc=$?
checkall "끝에 줄바꿈 없는 깨진 줄 뒤: 줄을 바꿔 덧붙임, 마지막 줄은 온전" [ $rc = 0 ] '&&' [ "$(tail -1 "$F")" != "" ] '&&' [ "$(wc -l < "$F" | tr -d ' ')" = 2 ] '&&' [ "$(tail -1 "$F" | "$REAL_PY" -I -c 'import json,sys;print(json.loads(sys.stdin.read())["text"])')" = "이어서" ]

echo "== 줄 수 상한(240 초과 → 최근 200줄)"
clean
for i in $(seq 1 240); do tl user "$(UIN "m$i")"; done
check "240줄까지는 그대로 쌓임" [ "$(nlines)" = 240 ]
check "240줄: 처음과 끝" [ "$(q '(lines[0]["text"],lines[-1]["text"])')" = "('m1', 'm240')" ]
tl user "$(UIN 'm241')"
check "241줄째: 200줄로 줄어듦" [ "$(nlines)" = 200 ]
check "최근 200줄 유지, 순서 보존(m42..m241)" [ "$(q '[l["text"] for l in lines]==["m%d"%i for i in range(42,242)]')" = True ]
check "줄인 뒤에도 모드 600" [ "$(mode_of "$F")" = 600 ]
check "임시 파일이 남지 않음" [ "$(ls -A "$APP")" = "$SID.talk.jsonl" ]
tl user "$(UIN 'm242')"
checkall "줄인 뒤에는 다시 덧붙임(201줄)" [ "$(nlines)" = 201 ] '&&' [ "$(q 'lines[-1]["text"]')" = m242 ]

echo "== 크기 상한(8MB 넘으면 정리, 6MB 이하만 남김)"
gen_big() { "$REAL_PY" -I -c 'import json,sys;sys.stdout.write(json.dumps({"session_id":"sess-12345678","hook_event_name":"Stop","last_assistant_message":"\U0001F600"*65500+sys.argv[1]},ensure_ascii=False))' "$1" > "$T/g.json"; }
clean
sz=0; cleaned_at=0; maxsz=0
for i in $(seq 1 45); do
  gen_big "n$i"; t0=$(date +%s); tlf assistant "$T/g.json"; t1=$(date +%s)
  sz=$(wc -c < "$F" | tr -d ' '); [ "$sz" -gt "$maxsz" ] && maxsz=$sz
  [ "$cleaned_at" = 0 ] && [ "$(nlines)" -lt "$i" ] && cleaned_at=$i && cleaned_secs=$((t1-t0))
done
checkall "긴 줄이 쌓이면(240줄 전에) 8MB 를 넘는 시점에 정리됨" [ "$cleaned_at" -ge 30 ] '&&' [ "$cleaned_at" -le 36 ]
check "정리하는 실행이 5초 안에 끝남" [ "${cleaned_secs:-99}" -le 4 ]
check "파일이 8MB 를 크게 넘은 적 없음(최대 크기 < 8MB + 한 줄)" [ "$maxsz" -lt $((8*1024*1024 + 300000)) ]
checkall "정리 뒤에도 계속 기록됨: 마지막 줄이 n45, 번호가 증가하는 순서 그대로" [ "$(q 'lines[-1]["text"][-3:]')" = n45 ] '&&' [ "$(q '(lambda ns: ns==sorted(ns) and len(set(ns))==len(ns))([int(l["text"].lstrip(chr(128512))[1:]) for l in lines])')" = True ]
checkall "남은 줄: 200줄 이하이고 크기가 8MB 이하(6MB 로 정리된 뒤 몇 줄 더해짐)" [ "$(nlines)" -le 200 ] '&&' [ "$(wc -c < "$F" | tr -d ' ')" -le $((8*1024*1024)) ]
# 한 줄이 6MB 보다 큰 경우는 만들 수 없으므로(글 65536자 상한), 가장 최근 줄은 항상 남는다는 것은 17MB 파일로 확인한다
rm -f "$F"; "$REAL_PY" -I -c 'f=open("'"$F"'","wb");f.truncate(17*1024*1024)'; chmod 600 "$F"
tl user "$(UIN '큰 파일 뒤')"; rc=$?
checkall "17MB 파일(줄 하나가 6MB 초과): exit 0, 새 줄이 남고 파일이 작아짐" [ $rc = 0 ] '&&' [ "$(wc -c < "$F" | tr -d ' ')" -lt 1000 ] '&&' [ "$(q 'lines[-1]["text"]')" = "큰 파일 뒤" ]
tl user "$(UIN '그 뒤')"
check "그 뒤에도 계속 기록됨" [ "$(q 'lines[-1]["text"]')" = "그 뒤" ]
rm -f "$F"; "$REAL_PY" -I -c 'f=open("'"$F"'","wb");f.truncate(65*1024*1024)'; chmod 600 "$F"
t0=$(date +%s); tl user "$(UIN '64MB 초과 뒤')"; rc=$?; t1=$(date +%s)
checkall "64MB 초과 파일: 읽지 않고 새 줄 하나만 든 파일로 바뀜(5초 안)" [ $rc = 0 ] '&&' [ "$(nlines)" = 1 ] '&&' [ "$(q 'lines[0]["text"]')" = "64MB 초과 뒤" ] '&&' [ $((t1-t0)) -le 4 ] '&&' [ "$(mode_of "$F")" = 600 ] '&&' [ "$(ls -A "$APP")" = "$SID.talk.jsonl" ]
tl user "$(UIN '64MB 뒤 다음')"
check "64MB 초과 처리 뒤에도 계속 기록됨" [ "$(nlines)" = 2 ]
# 정리용 임시 파일을 만들 수 없어도(폴더 쓰기 불가) 기록은 멈추지 않고 덧붙는다
clean
for i in $(seq 1 240); do tl user "$(UIN "m$i")"; done
chmod 500 "$APP"; tl user "$(UIN 'm241')"; rc=$?; chmod 700 "$APP"
checkall "정리에 실패해도: exit 0, 기록은 덧붙고(241줄), 임시 파일이 남지 않음" [ $rc = 0 ] '&&' [ "$(nlines)" = 241 ] '&&' [ "$(ls -A "$APP")" = "$SID.talk.jsonl" ]
tl user "$(UIN 'm242')"
check "폴더가 다시 쓰기 가능해지면 정리됨(200줄 이하)" [ "$(nlines)" -le 200 ]

echo "== 링크·비정상 파일"
clean; mkdir -p "$APP"; printf 'victim\n' > "$T/victim"; ln -s "$T/victim" "$F"
tl user "$(UIN 'x')"; rc=$?
checkall "기록 파일이 심볼릭 링크: 안 씀(대상 파일 그대로)" [ $rc = 0 ] '&&' [ "$(cat "$T/victim")" = victim ] '&&' [ -L "$F" ]
rm -f "$F"; mkdir "$F"
tl user "$(UIN 'x')"; rc=$?
checkall "기록 파일이 폴더: 안 씀, exit 0" [ $rc = 0 ] '&&' [ -d "$F" ] '&&' [ -z "$(ls -A "$F")" ]
rmdir "$F"; ln -s "$T/nonexistent" "$F"
tl user "$(UIN 'x')"
check "끊어진 심볼릭 링크: 대상을 만들지 않음" [ ! -e "$T/nonexistent" ]
rm -f "$F"
clean; mkdir -p "$R/data/state"; mkdir -p "$T/elsewhere"; ln -s "$T/elsewhere" "$APP"
tl user "$(UIN 'x')"; rc=$?
checkall "data/state/app 이 심볼릭 링크: 안 씀(대상 폴더 비어 있음)" [ $rc = 0 ] '&&' [ -L "$APP" ] '&&' [ -z "$(ls -A "$T/elsewhere")" ]
rm -f "$APP"
rm -rf "$T/elsewhere"

echo "== python3 를 못 찾을 때"
clean
tl user "$(UIN 'x')" MARU_TOOL_DIRS= PATH="$T/stub:/usr/bin:/bin"; rc=$?
checkall "python3 없음: exit 0, 출력 없음, 파일 없음" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ] '&&' [ ! -e "$F" ]
mkdir -p "$T/badpy"; printf '%s\n' '#!/bin/sh' 'exit 1' > "$T/badpy/python3"; chmod +x "$T/badpy/python3"
tl user "$(UIN 'x')" MARU_TOOL_DIRS="$T/badpy" PATH="$T/badpy:$BASEPATH"; rc=$?
checkall "고장난 python3: exit 0, 출력 없음, 파일 없음" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ] '&&' [ ! -e "$F" ]
mkdir -p "$T/pathpy"; printf '%s\n' '#!/bin/sh' "exec \"$REAL_PY\" \"\$@\"" > "$T/pathpy/python3"; chmod +x "$T/pathpy/python3"
tl user "$(UIN '경로의 python')" MARU_TOOL_DIRS= PATH="$T/pathpy:/usr/bin:/bin"
check "MARU_TOOL_DIRS 가 비어도 PATH 의 python3 를 찾음" [ -f "$F" ]

echo "== 표준출력·종료 코드(여러 경우)"
clean
allok=1; anyout=0
for args in "user|$(UIN 'a')" "assistant|$(AIN 'b')" "bogus|{}" "user|garbage" "user|" "assistant|$(UIN 'c')"; do
  tl "${args%%|*}" "${args#*|}"; [ $? = 0 ] || allok=0; { [ -s "$T/so" ] || [ -s "$T/se" ]; } && anyout=1
done
check "모든 경우 exit 0" [ $allok = 1 ]
check "모든 경우 표준출력·표준오류가 비어 있음" [ $anyout = 0 ]
chmod 500 "$APP" 2>/dev/null
tl user "$(UIN 'z')"; rc=$?; checkall "쓸 수 없는 폴더: exit 0, 출력 없음" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ]
chmod 700 "$APP"

echo "== 활동 기록(pre·post): data/state/app/<session_id>.act.jsonl"
AF=$APP/$SID.act.jsonl
set +B   # macOS 의 bash 3.2 는 "$(f "{'a':1,'b':2}")" 처럼 중첩된 따옴표 안의 {a,b} 를 중괄호 확장해 버린다
# mkact <pre|post> <tool> <tool_use_id> <tool_input 파이썬 식> [<추가 필드 파이썬 식 dict>]: 훅 입력 JSON 을 만든다
mkact() { "$REAL_PY" -I -c '
import json, sys, os
d = {"session_id": os.environ.get("TSID", "sess-12345678"), "hook_event_name": "PreToolUse" if sys.argv[1] == "pre" else "PostToolUse", "tool_name": sys.argv[2], "tool_use_id": sys.argv[3], "tool_input": eval(sys.argv[4])}
if len(sys.argv) > 5:
    d.update(eval(sys.argv[5]))
sys.stdout.write(json.dumps(d))' "$@"; }   # ensure_ascii 기본값: 짝 없는 서로게이트도 \ud800 글자 그대로 보낼 수 있다
tla() { local k=$1; shift; tl "$k" "$(mkact "$k" "$@")"; }   # tla <pre|post> <tool> <id> <input> [<extra>]
aq() { "$REAL_PY" -I -c 'import json,sys;lines=[json.loads(l) for l in open(sys.argv[1],encoding="utf-8")];print(eval(sys.argv[2]))' "$AF" "$1"; }
anl() { wc -l < "$AF" | tr -d ' '; }
sumof() { tla pre "$@"; aq 'lines[-1]["sum"]'; }   # sumof <tool> <id> <input>: 방금 쓴 pre 줄의 sum
clean
tla pre Bash toolu_01abc "{'command':'ls -la','description':'폴더 목록 보기'}"; rc=$?
checkall "pre: exit 0, 출력 없음, 파일이 생김" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ] '&&' [ -f "$AF" ] '&&' [ ! -e "$F" ]
check "pre 줄: 키가 v, at, k, id, tool, sum 순서이고 값이 맞음" [ "$(aq '[list(lines[0]), lines[0]["v"], lines[0]["k"], lines[0]["id"], lines[0]["tool"], lines[0]["sum"]]')" = "[['v', 'at', 'k', 'id', 'tool', 'sum'], 1, 'pre', 'toolu_01abc', 'Bash', '폴더 목록 보기']" ]
check "at 이 소수 셋째 자리까지 있는 초 단위 숫자이고 지금 근처" sh -c 'l=$(head -1 "$1"); case "$l" in *"\"at\":"[0-9]*"."[0-9][0-9][0-9]","*) exit 0;; *) exit 1;; esac' _ "$AF"
check "at 값이 지금 근처" [ "$(aq 'abs(lines[0]["at"]-'"$(date +%s)"')<=10')" = True ]
tla post Bash toolu_01abc "{'command':'ls'}" "{'duration_ms':123,'tool_response':{'stdout':'x','is_error':False}}"; rc=$?
checkall "post: exit 0, 출력 없음, 두 줄" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ] '&&' [ "$(anl)" = 2 ]
check "post 줄: 키가 v, at, k, id, tool, ms(sum·err 없음)" [ "$(aq '[list(lines[1]), lines[1]["k"], lines[1]["id"], lines[1]["tool"], lines[1]["ms"]]')" = "[['v', 'at', 'k', 'id', 'tool', 'ms'], 'post', 'toolu_01abc', 'Bash', 123]" ]
check "파일 모드 600" [ "$(mode_of "$AF")" = 600 ]
check "임시 파일이 남지 않음" [ "$(ls -A "$APP")" = "$SID.act.jsonl" ]

echo "== 활동 기록: 도구별 요약"
clean
check "Bash description 이 있으면 그것(명령은 안 씀)" [ "$(sumof Bash t1 "{'command':'rm -rf /tmp/zzz','description':'임시 폴더 지우기'}")" = "임시 폴더 지우기" ]
check "Bash description 이 없으면 명령의 첫 낱말만" [ "$(sumof Bash t2 "{'command':'git status --short'}")" = "git" ]
check "Bash 첫 낱말이 경로면 마지막 마디" [ "$(sumof Bash t3 "{'command':'/usr/local/bin/node --version'}")" = "node" ]
check "Bash 앞에 공백·줄바꿈이 있어도 첫 낱말" [ "$(sumof Bash t4 "{'command':'  \n\tmake all'}")" = "make" ]
check "Bash description 이 문자열이 아니면 명령의 첫 낱말" [ "$(sumof Bash t5 "{'command':'ls -la','description':5}")" = "ls" ]
checkall "Bash 첫 낱말은 32자까지(33자부터는 빈 글)" [ "$(sumof Bash t6 "{'command':'$(printf 'a%.0s' $(seq 1 100)) x'}")" = "" ] '&&' [ "$(sumof Bash t6b "{'command':'$(printf 'a%.0s' $(seq 1 33)) x'}")" = "" ] '&&' [ "$(sumof Bash t6c "{'command':'$(printf 'a%.0s' $(seq 1 32)) x'}")" = "$(printf 'a%.0s' $(seq 1 32))" ]
check "Bash command 도 description 도 없으면 빈 글" [ "$(sumof Bash t7 "{}")" = "" ]
clean
tla pre Bash t8 "{'command':'TOKEN=abc123SECRET curl -H \"Authorization: Bearer sk-live-999\" https://example.com/api?key=zzz'}"
checkall "Bash 명령의 비밀값 모양 글(TOKEN=…·Bearer·키)이 파일 어디에도 없음" [ "$(aq 'lines[0]["sum"]')" = "curl" ] '&&' sh -c '! grep -q -e abc123 -e SECRET -e Bearer -e sk-live -e zzz -e example.com "$1"' _ "$AF"
clean; tla pre Bash t9 "{'command':'API_KEY=hunter2 ./run.sh --token=abc'}"
checkall "Bash 첫 낱말에 =가 붙은 값: 앞의 NAME=값 을 건너뛰고 비밀값이 없음" [ "$(aq 'lines[0]["sum"]')" = "run.sh" ] '&&' sh -c '! grep -q -e hunter2 -e abc "$1"' _ "$AF"
clean; tla pre Bash t10 "{'command':'SECRET_ONLY=abc999'}"
checkall "Bash 명령이 NAME=값 뿐이면 빈 글이고 값이 없음" [ "$(aq 'lines[0]["sum"]')" = "" ] '&&' sh -c '! grep -q abc999 "$1"' _ "$AF"
clean
check "Read 는 경로의 마지막 두 마디" [ "$(sumof Read t11 "{'file_path':'/a/b/c/d.js'}")" = "c/d.js" ]
check "Edit 도 마지막 두 마디" [ "$(sumof Edit t12 "{'file_path':'/x/src/app.py','old_string':'비밀','new_string':'값'}")" = "src/app.py" ]
check "Write: 파일 내용(content)은 안 씀" [ "$(sumof Write t13 "{'file_path':'/tmp/out.txt','content':'TOP-SECRET-BODY'}")" = "tmp/out.txt" ]
check "경로가 한 마디면 그것만" [ "$(sumof Read t14 "{'file_path':'/f.txt'}")" = "f.txt" ]
check "NotebookEdit: notebook_path 의 마지막 두 마디" [ "$(sumof NotebookEdit t15 "{'notebook_path':'/n/dir/nb.ipynb','new_source':'x'}")" = "dir/nb.ipynb" ]
check "Grep 은 pattern" [ "$(sumof Grep t16 "{'pattern':'foo.*bar','path':'/x'}")" = "foo.*bar" ]
check "Glob 은 pattern" [ "$(sumof Glob t17 "{'pattern':'**/*.ts'}")" = "**/*.ts" ]
check "WebFetch 는 호스트 이름만(경로·쿼리·사용자 정보 없음)" [ "$(sumof WebFetch t18 "{'url':'https://user:pw@Docs.Example.org:8443/a/b?token=xyz#f','prompt':'요약'}")" = "docs.example.org" ]
check "WebFetch 주소가 아니면 빈 글" [ "$(sumof WebFetch t19 "{'url':'not a url'}")" = "" ]
check "WebSearch 는 query" [ "$(sumof WebSearch t20 "{'query':'마루 훅 시험'}")" = "마루 훅 시험" ]
check "Agent 는 description(prompt 는 안 씀)" [ "$(sumof Agent t21 "{'description':'조사하기','prompt':'긴 지시문 SECRETPROMPT','subagent_type':'x'}")" = "조사하기" ]
check "Task 도 description" [ "$(sumof Task t22 "{'description':'하위 작업'}")" = "하위 작업" ]
check "Skill 은 스킬 이름" [ "$(sumof Skill t23 "{'skill':'recall','args':'비밀'}")" = "recall" ]
check "모르는 도구는 sum 이 빈 문자열(키는 있음)" [ "$(sumof mcp__x__y t24 "{'command':'rm -rf /','secret':'s3cr3t'}")" = "" ]
check "모르는 도구의 입력 값이 파일에 없음" sh -c '! grep -q -e s3cr3t -e "rm -rf" "$1"' _ "$AF"
checkall "tool_input 이 객체가 아니어도 줄은 쓰고 sum 은 빈 글(마지막 줄의 id 도 맞음)" [ "$(sumof Bash t25 "'문자열'")" = "" ] '&&' [ "$(aq 'lines[-1]["id"]')" = t25 ]
tl pre "{\"session_id\":\"$SID\",\"tool_name\":\"Bash\",\"tool_use_id\":\"t26\"}"
checkall "tool_input 이 없어도 줄은 쓰고 sum 은 빈 글(마지막 줄의 id 도 맞음)" [ "$(aq 'lines[-1]["sum"]')" = "" ] '&&' [ "$(aq 'lines[-1]["id"]')" = t26 ]
clean

echo "== 활동 기록: Bash 첫 낱말 규칙과 비밀값 거르기"
mkbash() { "$REAL_PY" -I -c 'import json,sys;sys.stdout.write(json.dumps({"session_id":"sess-12345678","tool_name":"Bash","tool_use_id":"bc1","tool_input":{"command":sys.argv[1]}}))' "$1"; }
# bashcase "이름" "<명령>" "<기대 sum>" [파일에 없어야 할 글…]
bashcase() {
  local name=$1 cmd=$2 want=$3 g conds; shift 3; clean; tl pre "$(mkbash "$cmd")"
  conds=( [ "$(aq 'lines[0]["sum"]')" = "$want" ] )
  for g in "$@"; do conds+=( '&&' sh -c '! grep -qF -e "$2" "$1"' _ "$AF" "$g" ); done
  checkall "$name" "${conds[@]}"
}
bashcase "따옴표 안의 값 조각을 내지 않음(PASSWORD=\"my secret pass\" mysql)" 'PASSWORD="my secret pass" mysql -u root' mysql secret "my secret"
bashcase "작은따옴표 값(TOKEN='abc def' ./x)" "TOKEN='abc def' ./x" x "abc def" def
bashcase "A=\$'x y' z" "A=\$'x y' z" z "x y"
bashcase "앞머리가 (: 빈 글" '(TOKEN=abc curl x)' "" abc TOKEN
bashcase "앞머리가 \$( 와 따옴표: 빈 글" '"$(cat key)" x' "" "cat key" key
bashcase "키 모양 첫 낱말: 빈 글" 'sk-live-ABCDEF1234abcd5678efgh | pbcopy' "" sk-live ABCDEF
bashcase "ls -la /tmp 는 ls" 'ls -la /tmp' ls
bashcase "/usr/bin/env FOO=1 node x.js 는 규칙대로 env" '/usr/bin/env FOO=1 node x.js' env
bashcase "따옴표가 닫히지 않으면(shlex 예외) 빈 글" 'echo "unterminated secret' "" secret
bashcase "백틱·중괄호·\$ 앞머리: 빈 글" '`whoami` x' ""
bashcase "{ 앞머리: 빈 글" '{ rm -rf /tmp/zzz; }' "" zzz
bashcase "한글 첫 낱말: 빈 글" '가나 x' ""
clean
tla pre Bash bd1 "{'command':'curl x','description':'토큰 sk-ant-abc123DEF456ghi789JKL012mno 로 조회'}"
checkall "Bash description 에 키 모양 글: 요약이 빈 글(명령 첫 낱말로 되돌아가지 않음)" [ "$(aq 'lines[0]["sum"]')" = "" ] '&&' sh -c '! grep -q -e sk-ant -e curl "$1"' _ "$AF"
clean; tla pre Agent ag1 "{'description':'키 abcdefghij0123456789abcdefghij 점검'}"
checkall "Agent description 에 키 모양 글: 요약이 빈 글" [ "$(aq 'lines[0]["sum"]')" = "" ] '&&' sh -c '! grep -q abcdefghij0123456789 "$1"' _ "$AF"
clean; tla pre Grep gp1 "{'pattern':'sk-ant-abc123DEF456ghi789JKL012mno'}"
checkall "Grep pattern 에 24자 이상 키 모양 글: 요약이 빈 글" [ "$(aq 'lines[0]["sum"]')" = "" ] '&&' sh -c '! grep -q sk-ant "$1"' _ "$AF"
clean; tla pre Glob gl1 "{'pattern':'AbCdEf0123456789AbCdEf0123456789/**'}"
check "Glob pattern 에 키 모양 글: 요약이 빈 글" [ "$(aq 'lines[0]["sum"]')" = "" ]
clean; tla pre WebSearch ws1 "{'query':'token ghp_abcDEF123456ghiJKL789mnoPQR012 사용법'}"
checkall "WebSearch query 에 키 모양 글: 요약이 빈 글" [ "$(aq 'lines[0]["sum"]')" = "" ] '&&' sh -c '! grep -q ghp_ "$1"' _ "$AF"
clean
check "글자만 24자 이상인 pattern 은 그대로(숫자 없음)" [ "$(sumof Grep gp2 "{'pattern':'abcdefghijklmnopqrstuvwxyz'}")" = "abcdefghijklmnopqrstuvwxyz" ]
check "숫자만 24자 이상인 pattern 은 그대로(글자 없음)" [ "$(sumof Grep gp3 "{'pattern':'123456789012345678901234567'}")" = "123456789012345678901234567" ]
check "보통 pattern 은 그대로" [ "$(sumof Grep gp4 "{'pattern':'function \\\\w+\\\\(.*\\\\)'}")" = 'function \w+\(.*\)' ]
checkall "Grep pattern 은 80자까지" [ "$(sumof Grep gp5 "{'pattern':'$(printf 'q%.0s' $(seq 1 120))'}")" = "$(printf 'q%.0s' $(seq 1 80))" ] '&&' [ "$(sumof Glob gp6 "{'pattern':'$(printf 'q%.0s' $(seq 1 81))'}")" = "$(printf 'q%.0s' $(seq 1 80))" ]
check "WebSearch query 는 80자까지" [ "$(sumof WebSearch gp7 "{'query':'$(printf '가%.0s' $(seq 1 120))'}")" = "$(printf '가%.0s' $(seq 1 80))" ]
clean
L=$(printf '가%.0s' $(seq 1 300))
tla pre Agent t30 "{'description':'$L'}"
checkall "긴 요약은 160자에서 자름" [ "$(aq 'len(lines[0]["sum"])')" = 160 ] '&&' [ "$(aq 'lines[0]["sum"]=="가"*160')" = True ]
clean; tla pre Agent t31 "{'description':'줄1\n줄2\r\n탭\t끝\x00널\x1b[0m'}"
check "제어 문자·줄바꿈은 공백으로" [ "$(aq 'lines[0]["sum"]')" = "줄1 줄2  탭 끝 널 [0m" ]
check "파일은 여전히 한 줄" [ "$(anl)" = 1 ]
clean; tla pre Agent t32 "{'description':'가‮나​다⁦라﻿마 바'}"
check "방향 제어·보이지 않는 글자는 지우고 줄 구분 글자는 공백" [ "$(aq 'lines[0]["sum"]')" = "가나다라마 바" ]
clean; tla pre Agent t33 "{'description':'\ud800 쌍 없음'}"
checkall "짝 없는 서로게이트: 유효한 UTF-8 한 줄" [ "$(anl)" = 1 ] '&&' [ "$(aq 'lines[0]["sum"]')" = "? 쌍 없음" ]

echo "== 활동 기록: id·tool·ms·err 검사"
clean
bad_none() { [ ! -e "$AF" ]; }
for bid in "a b" 'a"b' "a/b" "../x" "" "$(printf 'x%.0s' $(seq 1 81))" "가나" "a.b" "a:b"; do
  tla pre Bash "$bid" "{'description':'x'}"; rc=$?
  checkall "잘못된 id($bid): 안 씀, exit 0" [ $rc = 0 ] '&&' bad_none
done
tla pre Bash "$(printf 'x%.0s' $(seq 1 80))" "{'description':'x'}"; check "80자 id 는 받음" [ -f "$AF" ]
clean
for bt in "a b" 'a"b' "a/b" "" "$(printf 'x%.0s' $(seq 1 81))" "가나" "a;b"; do
  tla pre "$bt" t1 "{'description':'x'}"; rc=$?
  checkall "잘못된 tool($bt): 안 씀, exit 0" [ $rc = 0 ] '&&' bad_none
done
tl pre "{\"session_id\":\"$SID\",\"tool_name\":5,\"tool_use_id\":\"t1\"}"; check "tool_name 이 문자열이 아님: 안 씀" bad_none
tl pre "{\"session_id\":\"$SID\",\"tool_name\":\"Bash\",\"tool_use_id\":7}"; check "tool_use_id 가 문자열이 아님: 안 씀" bad_none
tl pre "{\"session_id\":\"$SID\",\"tool_name\":\"Bash\"}"; check "tool_use_id 없음: 안 씀" bad_none
tla pre mcp__srv.a:b-c t1 "{}"; check "tool 에 _ . : - 허용" [ "$(aq 'lines[0]["tool"]')" = "mcp__srv.a:b-c" ]
clean
postkeys() { aq 'list(lines[-1])'; }
tla post Bash p1 "{}" "{'duration_ms':0}"; check "ms=0 은 씀" [ "$(aq 'lines[-1]["ms"]')" = 0 ]
tla post Bash p2 "{}" "{'duration_ms':86400000}"; check "ms=86400000 은 씀" [ "$(aq 'lines[-1]["ms"]')" = 86400000 ]
tla post Bash p3 "{}" "{'duration_ms':86400001}"; check "ms=86400001: ms 를 뺌(줄은 씀)" [ "$(postkeys)" = "['v', 'at', 'k', 'id', 'tool']" ]
tla post Bash p4 "{}" "{'duration_ms':-1}"; check "ms 가 음수: ms 를 뺌" [ "$(postkeys)" = "['v', 'at', 'k', 'id', 'tool']" ]
tla post Bash p5 "{}" "{'duration_ms':1.5}"; check "ms 가 소수: ms 를 뺌" [ "$(postkeys)" = "['v', 'at', 'k', 'id', 'tool']" ]
tla post Bash p6 "{}" "{'duration_ms':'12'}"; check "ms 가 문자열: ms 를 뺌" [ "$(postkeys)" = "['v', 'at', 'k', 'id', 'tool']" ]
tla post Bash p7 "{}" "{'duration_ms':True}"; check "ms 가 true: ms 를 뺌" [ "$(postkeys)" = "['v', 'at', 'k', 'id', 'tool']" ]
tla post Bash p8 "{}"; check "ms 없음: ms 를 뺌" [ "$(postkeys)" = "['v', 'at', 'k', 'id', 'tool']" ]
tla post Bash e1 "{}" "{'duration_ms':5,'tool_response':{'is_error':True}}"; check "is_error 참: err:true, 키 순서 …ms, err" [ "$(postkeys)" = "['v', 'at', 'k', 'id', 'tool', 'ms', 'err']" ]
check "err 값은 true" [ "$(aq 'lines[-1]["err"]')" = True ]
tla post Bash e2 "{}" "{'duration_ms':5,'tool_response':{'interrupted':True}}"; check "interrupted 참: err:true" [ "$(aq 'lines[-1].get("err")')" = True ]
tla post Bash e3 "{}" "{'duration_ms':5,'tool_response':{'is_error':False,'interrupted':False,'stdout':'ok'}}"; check "둘 다 거짓: err 없음" [ "$(aq '"err" in lines[-1]')" = False ]
tla post Bash e4 "{}" "{'duration_ms':5,'tool_response':'오류 문자열'}"; check "tool_response 가 문자열: err 없음" [ "$(aq '"err" in lines[-1]')" = False ]
tla post Bash e5 "{}" "{'duration_ms':5,'tool_response':[1]}"; check "tool_response 가 목록: err 없음" [ "$(aq '"err" in lines[-1]')" = False ]
tla post Bash e6 "{}" "{'tool_response':{'is_error':True,'stdout':'SECRETOUT'}}"; checkall "도구 결과 글은 어디에도 없음" sh -c '! grep -q SECRETOUT "$1"' _ "$AF" '&&' [ "$(aq 'lines[-1]["err"]')" = True ]
check "post 줄에는 sum 이 없음" [ "$(aq 'any("sum" in l for l in lines if l["k"]=="post")')" = False ]

echo "== 활동 기록: 쓰지 않는 조건"
clean
tla pre Bash t1 "{'description':'x'}" ; rm -rf "$APP"
tl pre "$(mkact pre Bash t1 "{'description':'x'}")" MARU_APP_SESSION=; rc=$?; checkall "pre: MARU_APP_SESSION 비어 있음" [ $rc = 0 ] '&&' [ ! -e "$APP" ]
tl post "$(mkact post Bash t1 "{}")" MARU_APP_SESSION=; checkall "post: MARU_APP_SESSION 비어 있음" [ ! -e "$APP" ]
tl pre "$(mkact pre Bash t1 "{}")" MARU_APP_SESSION=short; check "앱 세션 값 형식이 틀림: 안 씀" [ ! -e "$APP" ]
tl pre "$(mkact pre Bash t1 "{}")" MARU_NO_TALK_LOG=1; rc=$?; checkall "pre: MARU_NO_TALK_LOG=1" [ $rc = 0 ] '&&' [ ! -e "$AF" ]
tl post "$(mkact post Bash t1 "{}")" MARU_NO_TALK_LOG=1; check "post: MARU_NO_TALK_LOG=1" [ ! -e "$AF" ]
tl pre "$(mkact pre Bash t1 "{}")" MARU_NO_TALK_LOG=0; check "MARU_NO_TALK_LOG=0 은 끄지 않음" [ -f "$AF" ]
clean
tl pre "$(mkact pre Bash t1 "{}")" CLAUDE_CODE_ENTRYPOINT=sdk-cli; rc=$?; checkall "pre: sdk-cli 에서는 안 씀, 출력 없음" [ $rc = 0 ] '&&' [ ! -e "$AF" ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ]
tl post "$(mkact post Bash t1 "{}")" CLAUDE_CODE_ENTRYPOINT=sdk-cli; check "post: sdk-cli 에서는 안 씀" [ ! -e "$AF" ]
tl pre "$(mkact pre Bash t1 "{}")" AGENT_REFLECTING=1; check "AGENT_REFLECTING=1: 안 씀" [ ! -e "$AF" ]
tl pre "$(mkact pre Bash t1 "{}")" CLAUDE_CODE_ENTRYPOINT=cli; check "ENTRYPOINT=cli: 씀" [ -f "$AF" ]
clean
for bsid in "short" "../x" "a/b" "has_under12345"; do
  TSID=$bsid tl pre "$(TSID=$bsid mkact pre Bash t1 "{}")"; rc=$?
  checkall "형식이 틀린 session_id($bsid): 안 씀" [ $rc = 0 ] '&&' NOFILES
done
tl pre '{"tool_name":"Bash","tool_use_id":"t1"}'; check "session_id 없음: 안 씀" NOFILES
tl pre '{"session_id":"sess-12345678","tool_name":"Bash","tool_use_id":"t1","tool_input":{"description":"끊긴'; rc=$?
checkall "깨진 JSON: exit 0, 안 씀, 출력 없음" [ $rc = 0 ] '&&' [ ! -e "$AF" ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ]
tl post 'garbage {{{'; checkall "쓰레기 입력(post): 안 씀, 출력 없음" [ ! -e "$AF" ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ]
tl pre ''; check "빈 입력: 안 씀" [ ! -e "$AF" ]
tl pre '[1,2]'; check "객체가 아닌 JSON: 안 씀" [ ! -e "$AF" ]
# 1MB 를 넘는 입력은 잘려 JSON 해석이 실패한다. 앞쪽에서 session_id·tool_use_id·tool_name 을 정규식으로 찾아 sum 이 빈 pre 줄·ms 없는 post 줄을 쓴다(못 찾으면 안 씀).
"$REAL_PY" -I -c '
import json, sys
sys.stdout.write(json.dumps({"session_id": "sess-12345678", "tool_name": "Bash", "tool_use_id": "t1", "tool_input": {"description": "x", "pad": "a" * 1100000}}))' > "$T/bigact.json"
tlf pre "$T/bigact.json"; rc=$?
checkall "1.1MB 입력의 pre: exit 0, 출력 없음, sum 이 빈 pre 줄 하나" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ] '&&' [ "$(anl)" = 1 ] '&&' [ "$(aq '[list(lines[0]), lines[0]["k"], lines[0]["id"], lines[0]["tool"], lines[0]["sum"]]')" = "[['v', 'at', 'k', 'id', 'tool', 'sum'], 'pre', 't1', 'Bash', '']" ]
tlf post "$T/bigact.json"; rc=$?
checkall "1.1MB 입력의 post: exit 0, 출력 없음, ms 없는 post 줄" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ] '&&' [ "$(anl)" = 2 ] '&&' [ "$(aq '[list(lines[1]), lines[1]["k"], lines[1]["id"], lines[1]["tool"]]')" = "[['v', 'at', 'k', 'id', 'tool'], 'post', 't1', 'Bash']" ] '&&' [ "$(wc -c < "$AF" | tr -d ' ')" -lt 2000 ]
rm -f "$AF"
"$REAL_PY" -I -c '
import json, sys
sys.stdout.write(json.dumps({"pad": "a" * 1100000, "session_id": "sess-12345678", "tool_name": "Bash", "tool_use_id": "t1"}))' > "$T/bigact2.json"
tlf pre "$T/bigact2.json"; rc=$?
checkall "1.1MB 입력에서 세 값이 상한 밖에 있어 못 찾음: exit 0, 안 씀" [ $rc = 0 ] '&&' [ ! -e "$AF" ] '&&' [ ! -s "$T/so" ]
"$REAL_PY" -I -c '
import json, sys
sys.stdout.write(json.dumps({"session_id": "sess-12345678", "tool_name": "Bash", "tool_use_id": "bad id!", "tool_input": {"pad": "a" * 1100000}}))' > "$T/bigact3.json"
tlf pre "$T/bigact3.json"; check "1.1MB 입력에서 tool_use_id 형식이 틀리면 안 씀" [ ! -e "$AF" ]
rm -f "$T/bigact.json" "$T/bigact2.json" "$T/bigact3.json"
# 심볼릭 링크
clean; mkdir -p "$APP"; ln -s "$T/nonexistent-act" "$AF"
tla pre Bash t1 "{}"; rc=$?
checkall "활동 파일이 끊어진 심볼릭 링크: 대상을 만들지 않음" [ $rc = 0 ] '&&' [ ! -e "$T/nonexistent-act" ] '&&' [ -L "$AF" ]
rm -f "$AF"; : > "$T/real-act"; ln -s "$T/real-act" "$AF"
tla pre Bash t1 "{}"; checkall "활동 파일이 링크: 대상에 안 씀" [ ! -s "$T/real-act" ]
rm -f "$AF" "$T/real-act"
mkdir "$AF"; tla pre Bash t1 "{}"; rc=$?; checkall "활동 경로가 폴더(일반 파일 아님): 안 씀, exit 0" [ $rc = 0 ] '&&' [ -z "$(ls -A "$AF")" ]
rmdir "$AF"
clean; mkdir -p "$R/data/state"; mkdir -p "$T/elsewhere"; ln -s "$T/elsewhere" "$APP"
tla pre Bash t1 "{}"; checkall "data/state/app 이 심볼릭 링크: 안 씀" [ -z "$(ls -A "$T/elsewhere")" ]
rm -f "$APP"; rm -rf "$T/elsewhere"
clean
tl pre "$(mkact pre Bash t1 "{}")" MARU_TOOL_DIRS= PATH="$T/stub:/usr/bin:/bin"; rc=$?
checkall "python3 없음: exit 0, 출력 없음, 파일 없음" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ] '&&' [ ! -e "$AF" ]
tl bogus "$(mkact pre Bash t1 "{}")"; check "모르는 동작: 안 씀" [ ! -e "$AF" ]
chmod 500 "$APP" 2>/dev/null || { mkdir -p "$APP"; chmod 500 "$APP"; }
tla pre Bash t1 "{}"; rc=$?; checkall "쓸 수 없는 폴더: exit 0, 출력 없음" [ $rc = 0 ] '&&' [ ! -s "$T/so" ] '&&' [ ! -s "$T/se" ]
chmod 700 "$APP"
echo "== 활동 기록: 줄 수 제한"
clean
for i in $(seq 1 300); do tla pre Bash "n$i" "{'description':'d$i'}"; done
check "300줄까지는 줄이지 않음" [ "$(anl)" = 300 ]
tla pre Bash n301 "{'description':'d301'}"
checkall "301번째 줄: 250줄로 줄고 가장 새 줄이 마지막, 순서 유지, 앞쪽이 버려짐" [ "$(anl)" = 250 ] '&&' [ "$(aq 'lines[-1]["id"]')" = n301 ] '&&' [ "$(aq 'lines[0]["id"]')" = n52 ] '&&' [ "$(aq '[l["id"] for l in lines]==["n%d"%i for i in range(52,302)]')" = True ]
checkall "줄인 뒤에도 모드 600, 임시 파일 없음(남는 것은 활동 파일과 잠금 파일뿐)" [ "$(mode_of "$AF")" = 600 ] '&&' [ "$(ls -A "$APP" | tr '\n' ' ')" = "$SID.act.jsonl $SID.act.lock " ]
checkall "잠금 파일: 모드 600, 크기 0, 일반 파일" [ "$(mode_of "$APP/$SID.act.lock")" = 600 ] '&&' [ ! -s "$APP/$SID.act.lock" ] '&&' [ -f "$APP/$SID.act.lock" ] '&&' [ ! -L "$APP/$SID.act.lock" ]
clean
mkdir -p "$APP"
# 줄 수는 적지만 크기가 큰 파일(200줄 × 약 2KB = 약 400KB)을 미리 만들어 크기 제한을 본다
"$REAL_PY" -I -c '
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    for i in range(200):
        f.write(json.dumps({"v": 1, "at": 1.0, "k": "pre", "id": "s%d" % i, "tool": "Bash", "sum": "", "pad": "x" * 2000}) + "\n")' "$AF"
chmod 600 "$AF"
tla pre Bash znew "{'description':'새 줄'}"
checkall "크기가 256KB 를 넘기면 앞에서부터 버려 200KB 이하로 줄고 가장 새 줄이 마지막" [ "$(wc -c < "$AF" | tr -d ' ')" -le 204800 ] '&&' [ "$(anl)" -le 250 ] '&&' [ "$(aq 'lines[-1]["id"]')" = znew ] '&&' [ "$(aq 'lines[-2]["id"]')" = s199 ] '&&' [ "$(aq 'lines[0]["id"]')" != s0 ]
check "크기로 줄인 뒤에도 모드 600" [ "$(mode_of "$AF")" = 600 ]
# 잠금 파일이 링크면 줄이기를 건너뛰고 덧붙이기만 한다(대상은 만들지 않는다)
clean; mkdir -p "$APP"
"$REAL_PY" -I -c '
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    for i in range(200):
        f.write(json.dumps({"v": 1, "at": 1.0, "k": "pre", "id": "s%d" % i, "tool": "Bash", "sum": "", "pad": "x" * 2000}) + "\n")' "$AF"
chmod 600 "$AF"; ln -s "$T/lock-victim" "$APP/$SID.act.lock"
tla pre Bash znew "{'description':'새 줄'}"; rc=$?
checkall "잠금 파일이 링크: 줄이기는 건너뛰고 덧붙임(201줄), 링크 대상은 만들지 않음, exit 0" [ $rc = 0 ] '&&' [ "$(anl)" = 201 ] '&&' [ "$(aq 'lines[-1]["id"]')" = znew ] '&&' [ ! -e "$T/lock-victim" ] '&&' [ ! -s "$T/se" ]
# 다른 프로세스가 잠금을 쥐고 있으면 0.5초 다시 시도한 뒤 줄이기를 건너뛰고 덧붙이기만 한다. user 는 못 잡아도 비운다.
clean; mkdir -p "$APP"
"$REAL_PY" -I -c '
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    for i in range(200):
        f.write(json.dumps({"v": 1, "at": 1.0, "k": "pre", "id": "s%d" % i, "tool": "Bash", "sum": "", "pad": "x" * 2000}) + "\n")' "$AF"
chmod 600 "$AF"
heldrun() {   # heldrun <pre|user> <입력>: 잠금을 쥔 채 훅을 돌리고 걸린 초를 출력한다
  "$REAL_PY" -I -c '
import fcntl, os, subprocess, sys, time
lk, script, role, inp, pydir, sid = sys.argv[1:7]
fd = os.open(lk, os.O_RDWR | os.O_CREAT, 0o600)
fcntl.flock(fd, fcntl.LOCK_EX)
env = {"HOME": os.path.dirname(lk), "PATH": "/usr/bin:/bin", "MARU_TOOL_DIRS": pydir, "MARU_APP_SESSION": sid}
t = time.time()
r = subprocess.run(["bash", script, role], input=inp.encode(), env=env, capture_output=True)
print("%.2f %d %d" % (time.time() - t, r.returncode, len(r.stdout) + len(r.stderr)))' "$APP/$SID.act.lock" "$TL" "$1" "$2" "$PYDIR" "$SID"
}
held=$(heldrun pre "$(mkact pre Bash zheld "{'description':'x'}")")
checkall "잠금을 다른 프로세스가 쥐고 있으면: 약 0.5초 뒤 exit 0·출력 없음, 줄이기 없이 덧붙임(201줄)" [ "$(echo "$held" | awk '{print ($1>=0.4 && $1<3.0)?"ok":"bad"}')" = ok ] '&&' [ "$(echo "$held" | awk '{print $2" "$3}')" = "0 0" ] '&&' [ "$(anl)" = 201 ] '&&' [ "$(aq 'lines[-1]["id"]')" = zheld ]
held=$(heldrun user "$(UIN '질문')")
checkall "잠금을 쥐고 있어도 user 는 약 0.5초 뒤 활동 파일을 비움, exit 0" [ "$(echo "$held" | awk '{print ($1>=0.4 && $1<3.0)?"ok":"bad"}')" = ok ] '&&' [ "$(echo "$held" | awk '{print $2" "$3}')" = "0 0" ] '&&' [ ! -s "$AF" ] '&&' [ "$(nlines)" = 1 ]

echo "== 활동 기록: user 동작이 활동 파일을 비운다"
clean
tla pre Bash t1 "{'description':'일'}"; tla post Bash t1 "{}" "{'duration_ms':3}"
tl user "$(UIN '새 질문')"; rc=$?
checkall "user: exit 0, 활동 파일은 남지만 비어 있음, talk 파일에 한 줄" [ $rc = 0 ] '&&' [ -f "$AF" ] '&&' [ ! -s "$AF" ] '&&' [ "$(nlines)" = 1 ]
tl user "$(UIN '두 번째 질문')"; checkall "다시 user: talk 은 한 줄 더, 활동 파일은 비어 있음" [ "$(nlines)" = 2 ] '&&' [ ! -s "$AF" ]
checkall "user 가 비운 뒤에도 잠금 파일은 지우지 않고 둠(모드 600, 크기 0)" [ -f "$APP/$SID.act.lock" ] '&&' [ "$(mode_of "$APP/$SID.act.lock")" = 600 ] '&&' [ ! -s "$APP/$SID.act.lock" ]
tla pre Bash t2 "{'description':'다음 턴'}"; checkall "비운 뒤에 다시 쓰면 새 줄부터" [ "$(anl)" = 1 ] '&&' [ "$(aq 'lines[0]["id"]')" = t2 ]
tl assistant "$(AIN '답')"; check "assistant 는 활동 파일을 비우지 않음" [ "$(anl)" = 1 ]
check "활동 파일 모드 600 유지" [ "$(mode_of "$AF")" = 600 ]
clean
tl user "$(UIN '처음 질문')"
checkall "활동 파일이 없을 때 user: 활동 파일을 만들지 않음" [ ! -e "$AF" ] '&&' [ "$(nlines)" = 1 ]
tla pre Bash t1 "{}"; tl user "$(UIN '   ')"; check "공백뿐인 질문(talk 안 씀)에서는 활동 파일을 비우지 않음" [ "$(anl)" = 1 ]
tl user "$(UIN '처음 질문')"; checkall "같은 질문을 되풀이해도(talk 줄은 안 늘어도) 활동 파일은 비움" [ "$(nlines)" = 1 ] '&&' [ ! -s "$AF" ]
clean; mkdir -p "$APP"; ln -s "$T/real-act2" "$AF"; : > "$T/real-act2"; printf 'keep\n' > "$T/real-act2"
tl user "$(UIN '질문')"; checkall "활동 파일이 링크면 user 가 대상을 비우지 않음" [ "$(cat "$T/real-act2")" = keep ] '&&' [ "$(nlines)" = 1 ]
rm -f "$AF" "$T/real-act2"
clean
TSID=other-sess-123 tl pre "$(TSID=other-sess-123 mkact pre Bash t1 "{}")"
tla pre Bash t2 "{}"
tl user "$(UIN '질문')"
check "다른 세션의 활동 파일은 비우지 않음" [ -s "$APP/other-sess-123.act.jsonl" ]
clean

echo "== 활동 기록: 병렬 실행"
# 입력을 미리 만들어 두고 pre 40개를 동시에 돌린다(한 줄이 PIPE_BUF 안이라 O_APPEND 한 번의 write 로 섞이지 않아야 한다)
mkdir -p "$T/par"; clean
for i in $(seq 1 40); do mkact pre Bash "par$i" "{'description':'병렬 $i'}" > "$T/par/in$i.json"; done
for i in $(seq 1 40); do env -i HOME="$T/home" PATH="$BASEPATH" MARU_TOOL_DIRS="$PYDIR" MARU_APP_SESSION="$SID" bash "$TL" pre < "$T/par/in$i.json" >"$T/par/so$i" 2>"$T/par/se$i" & done
wait
checkall "pre 40개 동시: 줄 수 40, 깨진 JSON 줄 없음, id 40개가 모두 다름, 출력 없음" [ "$(anl)" = 40 ] '&&' [ "$(aq 'len(set(l["id"] for l in lines))')" = 40 ] '&&' [ -z "$(cat "$T"/par/so* "$T"/par/se* 2>/dev/null)" ] '&&' [ "$(mode_of "$AF")" = 600 ]
# 줄이기와 겹치는 경우: 280줄(16KB 초과)을 미리 쓰고 40개를 동시에 돌린다(줄이기는 잠금 안에서 한 번에 하나만)
clean; mkdir -p "$APP"
"$REAL_PY" -I -c '
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    for i in range(280):
        f.write(json.dumps({"v": 1, "at": 1.0, "k": "pre", "id": "old%d" % i, "tool": "Bash", "sum": "이전 줄"}, ensure_ascii=False, separators=(",", ":")) + "\n")' "$AF"
chmod 600 "$AF"
for i in $(seq 1 40); do env -i HOME="$T/home" PATH="$BASEPATH" MARU_TOOL_DIRS="$PYDIR" MARU_APP_SESSION="$SID" bash "$TL" pre < "$T/par/in$i.json" >"$T/par/so$i" 2>"$T/par/se$i" & done
wait
checkall "줄이기와 겹친 동시 40개: 깨진 JSON 줄 없음, 300줄 이하, 줄 id 가 중복 없음, 임시 파일 없음, 출력 없음" [ "$(aq 'len(lines)<=300 and len(lines)>=200')" = True ] '&&' [ "$(aq 'len(set(l["id"] for l in lines))==len(lines)')" = True ] '&&' [ "$(ls -A "$APP" | grep -c 'tmp')" = 0 ] '&&' [ -z "$(cat "$T"/par/so* "$T"/par/se* 2>/dev/null)" ] '&&' [ "$(mode_of "$AF")" = 600 ]
rm -rf "$T/par"
clean

set -B

echo "== 세션 시작 표지(start·compact): data/state/app/<MARU_APP_SESSION 값>.sess"
SF=$APP/$SID.sess
HSID=hook-sid-00000001
SIN() { TSID=${2:-$HSID} mkin SessionStart source "$1"; }
CIN() { TSID=${1:-$HSID} mkin PreCompact trigger manual; }
sq() { "$REAL_PY" -I -c 'import json,sys;l=open(sys.argv[1],encoding="utf-8").read();assert l.endswith("\n") and l.count("\n")==1;o=json.loads(l);print(eval(sys.argv[2]))' "$SF" "$1"; }
quiet() { [ ! -s "$T/so" ] && [ ! -s "$T/se" ]; }
for src in startup resume clear compact; do
  clean; tl start "$(SIN $src)"; rc=$?
  checkall "start source=$src: exit 0, 출력 없음, 파일 내용 맞음" [ $rc = 0 ] '&&' quiet '&&' [ "$(sq '[list(o), o["v"], o["sid"], o["source"]]')" = "[['v', 'at', 'sid', 'source'], 1, '$HSID', '$src']" ]
done
check "at 형식(소수 3자리)과 지금 근처" sh -c 'l=$(head -1 "$1"); case "$l" in "{\"v\":1,\"at\":"[0-9]*"."[0-9][0-9][0-9]",\"sid\":"*) exit 0;; *) exit 1;; esac' _ "$SF"
check "at 이 지금 근처" [ "$(sq 'abs(o["at"]-'"$(date +%s)"')<=10')" = True ]
check "파일 이름은 앱 세션 값이고 훅의 세션 id 가 아님, 임시 파일 없음" [ "$(ls -A "$APP")" = "$SID.sess" ]
check "모드 600" [ "$(mode_of "$SF")" = 600 ]
clean; tl start "$(SIN bogus)"; rc=$?; checkall "모르는 source: 안 씀, exit 0, 출력 없음" [ $rc = 0 ] '&&' [ ! -e "$SF" ] '&&' quiet
tl start "$(SIN '')"; check "빈 source: 안 씀" [ ! -e "$SF" ]
tl start "$(SIN precompact)"; check "start 에 source=precompact: 안 씀" [ ! -e "$SF" ]
tl start '{"session_id":"hook-sid-00000001"}'; check "source 없음: 안 씀" [ ! -e "$SF" ]
tl start '{"session_id":"hook-sid-00000001","source":5}'; check "source 가 문자열이 아님: 안 씀" [ ! -e "$SF" ]
clean; tl compact "$(CIN)"; rc=$?
checkall "compact: exit 0, 출력 없음, source=precompact" [ $rc = 0 ] '&&' quiet '&&' [ "$(sq '[o["sid"], o["source"]]')" = "['$HSID', 'precompact']" ]
tl compact '{"session_id":"hook-sid-00000001","source":"clear"}'; check "compact 는 입력의 source 를 무시하고 precompact" [ "$(sq 'o["source"]')" = precompact ]
tl start "$(SIN startup)"; tl start "$(SIN clear hook-sid-00000002)"
checkall "다시 쓰면 통째로 바뀜(한 줄, 새 sid·source), 모드 600, 임시 파일 없음" [ "$(wc -l < "$SF" | tr -d ' ')" = 1 ] '&&' [ "$(sq '[o["sid"], o["source"]]')" = "['hook-sid-00000002', 'clear']" ] '&&' [ "$(mode_of "$SF")" = 600 ] '&&' [ "$(ls -A "$APP")" = "$SID.sess" ]
clean; mkdir -p "$APP"; printf 'x\n' > "$APP/$SID.talk.jsonl"; printf 'y\n' > "$APP/$SID.act.jsonl"; printf 'z\n' > "$APP/other-12345678.sess"
tl start "$(SIN clear)"
checkall "source=clear 는 아무것도 지우지 않음(기록 파일·다른 표지 그대로)" [ -s "$APP/$SID.talk.jsonl" ] '&&' [ -s "$APP/$SID.act.jsonl" ] '&&' [ "$(cat "$APP/other-12345678.sess")" = z ] '&&' [ -f "$SF" ]
# 링크 거부
clean; mkdir -p "$APP"; printf 'victim\n' > "$T/sess-victim"; ln -s "$T/sess-victim" "$SF"
tl start "$(SIN startup)"; rc=$?
checkall "표지 경로가 링크: 거부(대상 그대로, 링크 그대로, exit 0, 출력 없음)" [ $rc = 0 ] '&&' quiet '&&' [ "$(cat "$T/sess-victim")" = victim ] '&&' [ -L "$SF" ]
rm -f "$SF"; ln -s "$T/nonexistent-sess" "$SF"
tl compact "$(CIN)"; checkall "끊어진 링크: 대상을 만들지 않음" [ ! -e "$T/nonexistent-sess" ] '&&' [ -L "$SF" ]
rm -f "$SF"; mkdir "$SF"; tl start "$(SIN startup)"; rc=$?; checkall "표지 경로가 폴더: 안 씀, exit 0" [ $rc = 0 ] '&&' [ -z "$(ls -A "$SF")" ]
rmdir "$SF"
clean; mkdir -p "$R/data/state"; mkdir -p "$T/elsewhere"; ln -s "$T/elsewhere" "$APP"
tl start "$(SIN startup)"; checkall "data/state/app 이 링크: 안 씀" [ -z "$(ls -A "$T/elsewhere")" ]
rm -f "$APP"; rm -rf "$T/elsewhere"
# 조건
clean
tl start "$(SIN startup)" MARU_NO_TALK_LOG=1; check "MARU_NO_TALK_LOG=1: 안 씀" [ ! -e "$SF" ]
tl compact "$(CIN)" MARU_NO_TALK_LOG=1; check "MARU_NO_TALK_LOG=1(compact): 안 씀" [ ! -e "$SF" ]
tl start "$(SIN startup)" MARU_APP_SESSION=; rc=$?; checkall "앱 세션 아님(빈 값): 안 씀" [ $rc = 0 ] '&&' [ ! -e "$APP" ] '&&' quiet
env -i HOME="$T/home" PATH="$BASEPATH" MARU_TOOL_DIRS="$PYDIR" bash "$TL" start <<<"$(SIN startup)" >"$T/so" 2>"$T/se"; checkall "MARU_APP_SESSION 없음: 안 씀" [ ! -e "$APP" ] '&&' quiet
tl start "$(SIN startup)" MARU_APP_SESSION=short; check "앱 세션 값 형식 틀림: 안 씀" [ -z "$(find "$R/data" -name '*.sess' 2>/dev/null)" ]
tl start "$(SIN startup)" CLAUDE_CODE_ENTRYPOINT=sdk-cli; checkall "sdk-cli: 안 씀, 출력 없음" [ ! -e "$SF" ] '&&' quiet
tl compact "$(CIN)" CLAUDE_CODE_ENTRYPOINT=sdk-cli; check "sdk-cli(compact): 안 씀" [ ! -e "$SF" ]
tl start "$(SIN startup)" AGENT_REFLECTING=1; check "AGENT_REFLECTING=1: 안 씀" [ ! -e "$SF" ]
tl start "$(SIN startup hook-ab)"; check "session_id 가 짧음: 안 씀" [ ! -e "$SF" ]
tl start "$(SIN startup 'bad_id_with_underscore')"; check "session_id 에 허용 안 된 글자: 안 씀" [ ! -e "$SF" ]
tl start "$(SIN startup -)"; check "session_id 없음: 안 씀" [ ! -e "$SF" ]
tl compact "$(CIN bad_id_with_underscore)"; check "compact: session_id 형식 틀림: 안 씀" [ ! -e "$SF" ]
tl start '{"session_id":123,"source":"startup"}'; check "session_id 가 문자열이 아님: 안 씀" [ ! -e "$SF" ]
tl bogus "$(SIN startup)"; check "모르는 동작: 안 씀" [ ! -e "$SF" ]
tl start "$(SIN startup)" CLAUDE_CODE_ENTRYPOINT=cli; check "CLAUDE_CODE_ENTRYPOINT=cli: 씀" [ -f "$SF" ]
# 깨진 입력·출력
clean
allok=1; anyout=0
for inp in '{"session_id":"hook-sid-00000001","source":"star' '' 'garbage {{{' '[1]' 'null' "$(SIN startup)" "$(SIN bogus)"; do
  for act in start compact; do tl $act "$inp"; [ $? = 0 ] || allok=0; { [ -s "$T/so" ] || [ -s "$T/se" ]; } && anyout=1; done
done
checkall "깨진·빈·정상 입력 모두 exit 0, 표준출력·표준오류 항상 빈 것" [ $allok = 1 ] '&&' [ $anyout = 0 ]
clean; tl start '{"session_id":"hook-sid-00000001","source":"star'; rc=$?; checkall "깨진 JSON: 0, 출력 없음, 안 씀" [ $rc = 0 ] '&&' quiet '&&' [ ! -e "$SF" ]
tl start "$(SIN startup)" MARU_TOOL_DIRS= PATH="$T/stub:/usr/bin:/bin"; rc=$?; checkall "python3 없음: 0, 출력 없음, 안 씀" [ $rc = 0 ] '&&' quiet '&&' [ ! -e "$SF" ]
chmod 500 "$APP" 2>/dev/null || { mkdir -p "$APP"; chmod 500 "$APP"; }
tl start "$(SIN startup)"; rc=$?; checkall "쓸 수 없는 폴더: 0, 출력 없음" [ $rc = 0 ] '&&' quiet
chmod 700 "$APP"
clean

echo "== maru-claude.sh: --settings 의 훅"
cat > "$T/stub/claude" <<'EOS'
#!/bin/bash
: > "$STUB_OUT"; for a in "$@"; do printf '%s\0' "$a" >> "$STUB_OUT"; done
exit 0
EOS
chmod +x "$T/stub/claude"
WR=$R/scripts/maru-claude.sh; SO=$T/argv.out
wrap_in() { local d=$1; shift; rm -f "$SO"; ( cd "$d" && env -i HOME="$T/home" PATH="$T/stub:$BASEPATH" MARU_PATH_PREFIX= MARU_TOOL_DIRS="$PYDIR" MARU_DATA="$R/data" MARU_HOME="$R" MARU_NO_SQUADS=1 STUB_OUT="$SO" "$@" bash "$WR" ) >/dev/null 2>&1; }
# $1 = talk 훅이 있어야 하는지(yes|no). UserPromptSubmit·Stop 에만 있고, 상태 훅은 그대로 첫 항목.
talk_check() { "$REAL_PY" -I -c '
import json, shlex, sys
a = [x.decode() for x in open(sys.argv[1], "rb").read().split(b"\0")[:-1]]
assert a[0] == "--settings", a
d = json.loads(a[1])
h = d["hooks"]
tl = sys.argv[2]
for ev, arg in (("UserPromptSubmit", "user"), ("Stop", "assistant"), ("PreToolUse", "pre"), ("PostToolUse", "post")):
    cmds = [x["command"] for e in h[ev] for x in e["hooks"]]
    t = [c for c in cmds if "talk-log.sh" in c]
    assert shlex.split(cmds[0])[0].endswith("agent-state.sh"), cmds
    assert shlex.split(cmds[0])[1] == {"user": "busy", "assistant": "idle", "pre": "busy", "post": "busy"}[arg], cmds
    if sys.argv[3] == "yes":
        assert len(t) == 1 and shlex.split(t[0]) == [tl, arg], cmds
        e = [e for e in h[ev] if any("talk-log.sh" in x["command"] for x in e["hooks"])][0]
        x = [x for x in e["hooks"] if "talk-log.sh" in x["command"]][0]
        assert x["type"] == "command" and x["timeout"] == 5, x
    else:
        assert not t, cmds
for ev, arg in (("SessionStart", "start"), ("PreCompact", "compact")):
    if sys.argv[3] == "yes":
        assert len(h[ev]) == 1 and len(h[ev][0]["hooks"]) == 1, h[ev]
        x = h[ev][0]["hooks"][0]
        assert shlex.split(x["command"]) == [tl, arg] and x["type"] == "command" and x["timeout"] == 5, x
    else:
        assert ev not in h, ev
for ev in h:
    if ev not in ("UserPromptSubmit", "Stop", "PreToolUse", "PostToolUse", "SessionStart", "PreCompact"):
        assert not any("talk-log.sh" in x["command"] for e in h[ev] for x in e["hooks"]), ev
' "$SO" "$R/scripts/talk-log.sh" "$1"; }
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; check "저장소 밖(공백 폴더): UserPromptSubmit·Stop 에 talk-log.sh user/assistant(timeout 5), 상태 훅이 먼저" talk_check yes
check "나머지 상태 훅은 그대로 8종" "$REAL_PY" -I -c '
import json,sys
a=[x.decode() for x in open(sys.argv[1],"rb").read().split(b"\0")[:-1]]
d=json.loads(a[1]); assert sorted(d["hooks"])==sorted(["UserPromptSubmit","PreToolUse","PostToolUse","Stop","StopFailure","Notification","SubagentStart","SubagentStop","SessionStart","PreCompact"])
assert all("talk-log" not in x["command"] for x in d["hooks"]["StopFailure"][0]["hooks"])' "$SO"
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_TALK_LOG=1; check "MARU_NO_TALK_LOG=1: talk-log 훅이 빠지고 상태 훅은 남음" talk_check no
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_TALK_LOG=0; check "MARU_NO_TALK_LOG=0: 붙음" talk_check yes
mkdir -p "$R/sub"; wrap_in "$R/sub" MARU_APP_SESSION=insub-12345; check "저장소 하위 폴더: 붙음" talk_check yes
wrap_in "$R" MARU_APP_SESSION=inroot-12345; check "저장소 루트: 프로젝트 설정의 훅이 돌므로 --settings 에 훅 없음" sh -c '! tr "\0" "\n" < "$1" | grep -q talk-log' _ "$SO"
wrap_in "$R"; check "MARU_APP_SESSION 없음: 인자 없음" [ ! -s "$SO" ]
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_STATE_HOOKS=1; check "MARU_NO_STATE_HOOKS=1: talk-log 훅도 붙지 않음" sh -c '! tr "\0" "\n" < "$1" | grep -q talk-log' _ "$SO"
rm -f "$R/data/state/app/"*.hooked

echo "== maru-claude.sh: 화면 블록 지시문(--append-system-prompt)"
mkdir -p "$R/prompts"; cp "$REPO/prompts/read-surface.md" "$R/prompts/read-surface.md"
SP=$R/prompts/read-surface.md
# 인자 개수(--append-system-prompt 가 몇 번 나오는지)와 그 값
sp_count() { tr '\0' '\n' < "$SO" | grep -c -x -e '--append-system-prompt'; }
sp_value() { "$REAL_PY" -I -c '
import sys
a = [x.decode() for x in open(sys.argv[1], "rb").read().split(b"\0")[:-1]]
i = a.index("--append-system-prompt"); sys.stdout.write(a[i + 1])' "$SO"; }
sp_none() { [ "$(sp_count)" = 0 ]; }
want=$(cat "$SP")
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345
checkall "앱 세션 + 훅 조건: --append-system-prompt 가 한 번 붙고 값이 prompts/read-surface.md 내용과 같음" [ "$(sp_count)" = 1 ] '&&' [ "$(sp_value)" = "$want" ] '&&' talk_check yes
check "원본 파일이 비어 있지 않고 4096바이트 이하이며 코드 펜스가 없음" sh -c '[ -s "$1" ] && [ "$(wc -c < "$1")" -le 4096 ] && ! grep -qF "$2" "$1"' _ "$REPO/prompts/read-surface.md" "$(printf '\140\140\140')"
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_SURFACE=1; checkall "MARU_NO_SURFACE=1: 안 붙음(훅은 그대로)" sp_none '&&' talk_check yes
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_SURFACE=0; check "MARU_NO_SURFACE=0: 붙음" [ "$(sp_count)" = 1 ]
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_TALK_LOG=1; check "MARU_NO_TALK_LOG=1: 안 붙음" sp_none
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_STATE_HOOKS=1; check "MARU_NO_STATE_HOOKS=1(훅 없음): 안 붙음" sp_none
wrap_in "$R" MARU_APP_SESSION=inroot-12345; check "저장소 루트(talk 훅 없음): 안 붙음" sp_none
wrap_in "$T/out side"; check "앱 세션 아님(MARU_APP_SESSION 없음): 안 붙음" sp_none
mv "$SP" "$SP.bak"; ln -s "$SP.bak" "$SP"
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; check "지시문 파일이 심볼릭 링크: 안 붙음" sp_none
rm -f "$SP"; wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; checkall "지시문 파일 없음: 안 붙고 훅은 그대로" sp_none '&&' talk_check yes
: > "$SP"; wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; check "지시문 파일이 비어 있음: 안 붙음" sp_none
"$REAL_PY" -I -c 'import sys;sys.stdout.write("a"*4097)' > "$SP"; wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; check "지시문 파일 4097바이트: 안 붙음" sp_none
"$REAL_PY" -I -c 'import sys;sys.stdout.write("a"*4096)' > "$SP"; wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; check "지시문 파일 4096바이트: 붙음" [ "$(sp_count)" = 1 ]
rm -f "$SP"; mkdir "$SP"; wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; check "지시문 경로가 폴더: 안 붙음" sp_none
rmdir "$SP"; rm -f "$SP.bak"; cp "$REPO/prompts/read-surface.md" "$SP"
# 사용자가 넘긴 인자: wrap_in 은 "$@" 를 환경 앞부분에 쓰므로 여기서는 직접 실행한다
wrap_args() { local d=$1; shift; rm -f "$SO"; ( cd "$d" && env -i HOME="$T/home" PATH="$T/stub:$BASEPATH" MARU_PATH_PREFIX= MARU_TOOL_DIRS="$PYDIR" MARU_DATA="$R/data" MARU_HOME="$R" MARU_NO_SQUADS=1 STUB_OUT="$SO" MARU_APP_SESSION=outside-12345 bash "$WR" "$@" ) >/dev/null 2>&1; }
wrap_args "$T/out side" --append-system-prompt "내 지시"; checkall "사용자가 --append-system-prompt 를 줌: 한 번만(사용자 값) 나옴" [ "$(sp_count)" = 1 ] '&&' [ "$(sp_value)" = "내 지시" ]
wrap_args "$T/out side" --append-system-prompt=내지시; check "--append-system-prompt=값 형태: 안 붙음" sh -c '! tr "\0" "\n" < "$1" | grep -q -x -e "--append-system-prompt"' _ "$SO"
wrap_args "$T/out side" --system-prompt "전부 바꿈"; check "사용자가 --system-prompt 를 줌: 안 붙음" sp_none
wrap_args "$T/out side" --resume 11111111-2222-3333-4444-555555555555; checkall "--resume 과 함께: 붙고 --resume 인자도 그대로" [ "$(sp_count)" = 1 ] '&&' sh -c 'tr "\0" "\n" < "$1" | grep -q -x -e "--resume"' _ "$SO"
wrap_args "$T/out side" --system-prompt-file /x/sys.md; check "사용자가 --system-prompt-file 을 줌: 안 붙음" sp_none
wrap_args "$T/out side" --append-system-prompt-file /x/app.md; check "사용자가 --append-system-prompt-file 을 줌: 안 붙음(값은 그대로 전달)" sp_none
# python3 를 못 찾음: talk-log 훅이 --settings 에 못 들어가므로 지시문도 붙이지 않는다(회귀: 예전엔 tk_arg 만 보고 붙였다)
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_TOOL_DIRS= PATH="$T/stub:/bin"
checkall "python3 를 찾지 못함: 지시문 없음, --settings 없음" sp_none '&&' [ -f "$SO" ] '&&' [ ! -s "$SO" ]
# 환경에서 들어온 tk_arg·surf_want 는 앱 세션이 아닌 실행에서 쓰이지 않는다
wrap_in "$T/out side" tk_arg=x surf_want=1; check "앱 세션 아님 + 환경 tk_arg=x surf_want=1: 안 붙음" sp_none
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_TALK_LOG=1 tk_arg=x surf_want=1; check "앱 세션 + 훅 없음 + 환경 tk_arg=x surf_want=1: 안 붙음" sp_none
# prompts 폴더가 심볼릭 링크
mv "$R/prompts" "$R/prompts.real"; ln -s "$R/prompts.real" "$R/prompts"
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; checkall "prompts 폴더가 심볼릭 링크: 안 붙고 훅은 그대로" sp_none '&&' talk_check yes
rm -f "$R/prompts"; mv "$R/prompts.real" "$R/prompts"
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; check "prompts 폴더를 되돌리면 다시 붙음" [ "$(sp_count)" = 1 ]

echo "== .claude/settings.json"
check "올바른 JSON 이고 두 항목에 timeout 5, 상태 훅이 먼저, 다른 이벤트엔 없음" "$REAL_PY" -I -c '
import json, sys
d = json.load(open(sys.argv[1]))
h = d["hooks"]
for ev, arg in (("UserPromptSubmit", "user"), ("Stop", "assistant"), ("PreToolUse", "pre"), ("PostToolUse", "post")):
    hs = [x for e in h[ev] for x in e["hooks"]]
    cmds = [x["command"] for x in hs]
    want = "\"$CLAUDE_PROJECT_DIR\"/scripts/talk-log.sh " + arg
    assert cmds.count(want) == 1, cmds
    assert cmds[0].endswith("agent-state.sh " + ("idle" if arg == "assistant" else "busy")), cmds
    x = hs[cmds.index(want)]
    assert x["type"] == "command" and x["timeout"] == 5, x
for ev, arg in (("SessionStart", "start"), ("PreCompact", "compact")):
    cmds = [x for e in h[ev] for x in e["hooks"]]
    want = "\"$CLAUDE_PROJECT_DIR\"/scripts/talk-log.sh " + arg
    mine = [x for x in cmds if x["command"] == want]
    assert len(mine) == 1 and mine[0]["type"] == "command" and mine[0]["timeout"] == 5, cmds
for ev in h:
    if ev not in ("UserPromptSubmit", "Stop", "PreToolUse", "PostToolUse", "SessionStart", "PreCompact"):
        assert not any("talk-log" in x["command"] for e in h[ev] for x in e["hooks"]), ev
' "$REPO/.claude/settings.json"
check "UserPromptSubmit 은 agent-state → talk-log(또는 child-reports 포함) 순서가 유지됨" "$REAL_PY" -I -c '
import json, sys
h = json.load(open(sys.argv[1]))["hooks"]["UserPromptSubmit"][0]["hooks"]
c = [x["command"] for x in h]
assert c[0].endswith("agent-state.sh busy") and any(x.endswith("child-reports.sh") for x in c)
' "$REPO/.claude/settings.json"

echo "== 실제 data/ 에 쓰지 않음"
if [ -f "$T/stamp" ]; then
  # 열려 있는 실제 세션이 훅으로 다른 이름의 기록 파일을 쓸 수 있으므로, 이 시험이 쓰는 세션 값(sess-12345678·outside-12345 등)의 파일만 본다
  check "실제 data/ 에 이 시험의 세션 값으로 만든 파일 없음" [ -z "$(find "$REPO/data" -type f \( -name "$SID*" -o -name 'outside-12345*' -o -name 'insub-12345*' -o -name 'inroot-12345*' -o -name 'sess-*' \) -newer "$T/stamp" 2>/dev/null | head -1)" ]
fi
check "복사본 밖(임시 폴더 아래 repo 외)에 기록 파일이 없음" [ -z "$(find "$T" \( -name '*.talk.jsonl' -o -name '*.act.jsonl' \) ! -path "$R/data/*" ! -path "$T/elsewhere/*" 2>/dev/null | head -1)" ]

echo; if [ $FAIL = 0 ]; then echo "test-talk: OK ($N 항목)"; exit 0; else echo "test-talk: 실패 $FAIL / $N"; exit 1; fi
