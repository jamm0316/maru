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
for ev, arg in (("UserPromptSubmit", "user"), ("Stop", "assistant")):
    cmds = [x["command"] for e in h[ev] for x in e["hooks"]]
    t = [c for c in cmds if "talk-log.sh" in c]
    assert shlex.split(cmds[0])[0].endswith("agent-state.sh"), cmds
    if sys.argv[3] == "yes":
        assert len(t) == 1 and shlex.split(t[0]) == [tl, arg], cmds
        e = [e for e in h[ev] if any("talk-log.sh" in x["command"] for x in e["hooks"])][0]
        x = [x for x in e["hooks"] if "talk-log.sh" in x["command"]][0]
        assert x["type"] == "command" and x["timeout"] == 5, x
    else:
        assert not t, cmds
for ev in h:
    if ev not in ("UserPromptSubmit", "Stop"):
        assert not any("talk-log.sh" in x["command"] for e in h[ev] for x in e["hooks"]), ev
' "$SO" "$R/scripts/talk-log.sh" "$1"; }
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345; check "저장소 밖(공백 폴더): UserPromptSubmit·Stop 에 talk-log.sh user/assistant(timeout 5), 상태 훅이 먼저" talk_check yes
check "나머지 상태 훅은 그대로 8종" "$REAL_PY" -I -c '
import json,sys
a=[x.decode() for x in open(sys.argv[1],"rb").read().split(b"\0")[:-1]]
d=json.loads(a[1]); assert sorted(d["hooks"])==sorted(["UserPromptSubmit","PreToolUse","PostToolUse","Stop","StopFailure","Notification","SubagentStart","SubagentStop"])
assert all("talk-log" not in x["command"] for x in d["hooks"]["StopFailure"][0]["hooks"])' "$SO"
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_TALK_LOG=1; check "MARU_NO_TALK_LOG=1: talk-log 훅이 빠지고 상태 훅은 남음" talk_check no
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_TALK_LOG=0; check "MARU_NO_TALK_LOG=0: 붙음" talk_check yes
mkdir -p "$R/sub"; wrap_in "$R/sub" MARU_APP_SESSION=insub-12345; check "저장소 하위 폴더: 붙음" talk_check yes
wrap_in "$R" MARU_APP_SESSION=inroot-12345; check "저장소 루트: 프로젝트 설정의 훅이 돌므로 --settings 에 훅 없음" sh -c '! tr "\0" "\n" < "$1" | grep -q talk-log' _ "$SO"
wrap_in "$R"; check "MARU_APP_SESSION 없음: 인자 없음" [ ! -s "$SO" ]
wrap_in "$T/out side" MARU_APP_SESSION=outside-12345 MARU_NO_STATE_HOOKS=1; check "MARU_NO_STATE_HOOKS=1: talk-log 훅도 붙지 않음" sh -c '! tr "\0" "\n" < "$1" | grep -q talk-log' _ "$SO"
rm -f "$R/data/state/app/"*.hooked

echo "== .claude/settings.json"
check "올바른 JSON 이고 두 항목에 timeout 5, 상태 훅이 먼저, 다른 이벤트엔 없음" "$REAL_PY" -I -c '
import json, sys
d = json.load(open(sys.argv[1]))
h = d["hooks"]
for ev, arg in (("UserPromptSubmit", "user"), ("Stop", "assistant")):
    hs = [x for e in h[ev] for x in e["hooks"]]
    cmds = [x["command"] for x in hs]
    want = "\"$CLAUDE_PROJECT_DIR\"/scripts/talk-log.sh " + arg
    assert cmds.count(want) == 1, cmds
    assert cmds[0].endswith("agent-state.sh " + ("busy" if arg == "user" else "idle")), cmds
    x = hs[cmds.index(want)]
    assert x["type"] == "command" and x["timeout"] == 5, x
for ev in h:
    if ev not in ("UserPromptSubmit", "Stop"):
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
check "복사본 밖(임시 폴더 아래 repo 외)에 기록 파일이 없음" [ -z "$(find "$T" -name '*.talk.jsonl' ! -path "$R/data/*" ! -path "$T/elsewhere/*" 2>/dev/null | head -1)" ]

echo; if [ $FAIL = 0 ]; then echo "test-talk: OK ($N 항목)"; exit 0; else echo "test-talk: 실패 $FAIL / $N"; exit 1; fi
