#!/bin/bash
# 사용량·안정성 시험: reflect 사전 검증·백오프·PreCompact 우회, 사용량 게이트(usage_gate), dream 이틀 연속 규칙·건너뛰는 조건·모델 없는 정리,
# last.reflect/last.dream 결과 파일, journal-tick 조기 종료(lib.sh 를 부르지 않음), maru doctor. 0=통과 1=실패.
# 실제 홈·기억 폴더·data/·~/.claude 는 건드리지 않는다: HOME/MARU_*/PROJECTS 를 mktemp 폴더로 강제하고 임시 경로가 아니면 종료한다.
# 진짜 claude 는 부르지 않는다(REFLECT_FAKE_MODEL / DREAM_FAKE_MODEL + *_ALLOW_FAKE 시험 훅). 네트워크·osascript 는 가짜로 막는다.
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
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
hasnt() { case "$1" in *"$2"*) return 1;; *) return 0;; esac; }

find_real() {
  local t=$1 d
  for d in /Library/Developer/CommandLineTools/usr/bin /opt/homebrew/bin /usr/local/bin /usr/bin; do
    [ -x "$d/$t" ] || continue
    case $t in
      python3) "$d/$t" -c 'pass' >/dev/null 2>&1 </dev/null || continue ;;
      git)     "$d/$t" --version >/dev/null 2>&1 </dev/null || continue ;;
    esac
    printf '%s' "$d/$t"; return 0
  done
  return 1
}
REAL_PY=$(find_real python3) || { echo "동작하는 python3 없음 — 시험 불가" >&2; exit 1; }
REAL_GIT=$(find_real git) || { echo "동작하는 git 없음 — 시험 불가" >&2; exit 1; }
JQ_DIR=$(dirname "$(command -v jq 2>/dev/null || echo /usr/bin/jq)")
mkdir -p "$T/good" "$T/home" "$T/work" "$T/bin"
printf '%s\n' '#!/bin/sh' "exec \"$REAL_PY\" \"\$@\"" > "$T/good/python3"
printf '%s\n' '#!/bin/sh' "exec \"$REAL_GIT\" \"\$@\"" > "$T/good/git"
chmod +x "$T/good/python3" "$T/good/git"
# 가짜 osascript: 알림 문구를 파일에 적는다(진짜 알림을 띄우지 않는다)
printf '%s\n' '#!/bin/sh' 'for a; do :; done' 'echo "$a" >> "$NOTIFY_LOG"' > "$T/bin/osascript"; chmod +x "$T/bin/osascript"

FAKE_HOME=$T/home
PROJ=$FAKE_HOME/.claude/projects
# 스크립트는 임시 저장소 복사본에서 돌린다: usage_gate 는 <저장소>/data/usage.json 을 읽으므로 실제 저장소의 data/ 를 건드리거나 읽지 않게 하려는 것
RR=$T/repo; mkdir -p "$RR"; cp -R "$REPO/scripts" "$REPO/prompts" "$REPO/squads" "$REPO/squads-en" "$RR/"
SLUG=$(printf '%s' "$RR" | sed 's/[^A-Za-z0-9]/-/g')
MEM=$PROJ/$SLUG/memory
DATA=$T/data
ST=$DATA/state
NOTIFY=$T/notify.log
BASEPATH=$T/bin:/usr/bin:/bin:/usr/sbin:/sbin:$JQ_DIR
run_env() {
  local extra=()
  while [ "$1" != "--" ]; do extra+=("$1"); shift; done; shift
  env -i HOME="$FAKE_HOME" PATH="$BASEPATH" MARU_PATH_PREFIX= MARU_TOOL_DIRS="$T/good" MARU_DATA="$DATA" MARU_WORK="$T/work" \
    PROJECTS="$PROJ" TMPDIR="$T" NOTIFY_LOG="$NOTIFY" ${extra[@]+"${extra[@]}"} "$@" 2>&1
}
LIBRUN() { # <셸 코드> [인자...] — lib.sh 를 source 하고 log 를 stdout 으로 돌린다
  local code=$1; shift
  run_env ${LIBENV[@]+"${LIBENV[@]}"} -- bash -c '. "$1/scripts/lib.sh" || exit 9; log() { echo "LOG: $*"; }; shift; '"$code" _ "$RR" "$@"
}
LIBENV=()
now() { date +%s; }
last_of() { cat "$ST/last.$1" 2>/dev/null; }
field() { printf '%s' "$1" | cut -d'|' -f"$2"; }

reset_mem() {
  rm -rf "$MEM"; mkdir -p "$MEM" "$ST" "$DATA/logs"
  printf '%s\n' '- [노트](note.md) — 시험용 기억' > "$MEM/MEMORY.md"
  printf '%s\n' '---' 'name: note' 'description: 시험' 'metadata:' '  type: user' '---' '본문' > "$MEM/note.md"
}
break_mem() { printf '%s\n' '- [노트](note.md) — 시험용 기억' '- [유령](ghost.md) — 없는 파일' > "$MEM/MEMORY.md"; }
reset_all() { rm -rf "$DATA" "$RR/data"; mkdir -p "$ST" "$DATA/logs" "$RR/data"; reset_mem; : > "$NOTIFY"; : > "$T/calls"; rm -rf "$PROJ/-fake"; }
calls() { wc -l < "$T/calls" | tr -d ' '; }

# 가짜 모델(reflect·dream 공용): 호출 때마다 $FAKE_CALLS 에 한 줄
cat > "$T/fakemodel.sh" <<'EOF'
#!/bin/bash
echo "called" >> "$FAKE_CALLS"
[ -n "${FAKE_JOURNAL:-}" ] && cp "$FAKE_JOURNAL" "$FAKE_STAGE/journal.txt"
echo "${FAKE_OUT:-변경 없음}"
exit "${FAKE_RC:-0}"
EOF
chmod +x "$T/fakemodel.sh"
MODELENV=(REFLECT_FAKE_MODEL="$T/fakemodel.sh" REFLECT_ALLOW_FAKE=yes-i-am-testing DREAM_FAKE_MODEL="$T/fakemodel.sh" DREAM_ALLOW_FAKE=yes-i-am-testing
  FAKE_CALLS="$T/calls" FAKE_STAGE="$DATA/stage" FAKE_MEM="$MEM")
mk_session() { # <번호> -> sid. 사용자 턴 3개
  local sid; sid=$(printf 'aaaaaaaa-bbbb-cccc-dddd-%012d' "$1")
  mkdir -p "$PROJ/-fake"
  "$REAL_PY" - "$PROJ/-fake/$sid.jsonl" <<'PY'
import json, sys
with open(sys.argv[1], "w") as o:
    for i in range(3):
        o.write(json.dumps({"type": "user", "cwd": "/x/proj", "message": {"role": "user", "content": "요청 %d" % i}}) + "\n")
        o.write(json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "답 %d" % i}]}}) + "\n")
PY
  echo "$sid"
}
reflect_run() { local sid=$1; shift; run_env "${MODELENV[@]}" "$@" -- bash "$RR/scripts/reflect.sh" --run "$PROJ/-fake/$sid.jsonl" "$sid"; }
dream_run() { run_env "${MODELENV[@]}" "$@" -- bash "$RR/scripts/dream.sh"; }
usage_json() { # <at 오프셋(초, 과거는 음수)> <5h pct> <5h resets 오프셋> <7d pct> <7d resets 오프셋>  → $DATA/usage.json
  mkdir -p "$RR/data"
  "$REAL_PY" - "$RR/data/usage.json" "$@" <<'PY'
import json, sys, time
f, a, p5, r5, p7, r7 = sys.argv[1:7]
n = int(time.time())
json.dump({"v": 1, "at": n + int(a), "five_hour": {"pct": float(p5), "resets_at": n + int(r5)}, "seven_day": {"pct": float(p7), "resets_at": n + int(r7)}}, open(f, "w"))
PY
}

echo "== 정적 검사"
for f in lib.sh reflect.sh dream.sh journal-tick.sh test-quota.sh; do check "bash -n $f" bash -n "$REPO/scripts/$f"; done
check "bash -n bin/maru" bash -n "$REPO/bin/maru"

echo "== 사용량 게이트(usage_gate)"
reset_all
gate() { LIBRUN 'g=$(usage_gate); echo "rc=$? $g"'; }   # 닫히면 rc=1 과 이유
rm -f "$RR/data/usage.json"; out=$(gate); check "파일이 없으면 열림" [ "$out" = "rc=0 " ]
echo '{깨짐' > "$RR/data/usage.json"; out=$(gate); check "깨진 파일은 열림" [ "$out" = "rc=0 " ]
printf '[1,2]' > "$RR/data/usage.json"; out=$(gate); check "형식이 틀린 JSON 은 열림" [ "$out" = "rc=0 " ]
rm -f "$RR/data/usage.json"; mkdir "$RR/data/usage.json"; out=$(gate); check "읽을 수 없는(폴더) 파일은 열림" [ "$out" = "rc=0 " ]; rmdir "$RR/data/usage.json"
usage_json -$((7*3600)) 99 3600 99 3600; out=$(gate); check "6시간보다 오래된 파일은 열림(99%여도)" [ "$out" = "rc=0 " ]
usage_json -$((5*3600)) 99 3600 10 3600; out=$(gate); check "5시간 된 파일은 유효 → 닫힘" has "$out" "rc=1 five_hour"
usage_json 0 89.9 3600 94 3600; out=$(gate); check "89.9% / 94% 는 열림" [ "$out" = "rc=0 " ]
usage_json 0 90 3600 10 3600; out=$(gate); check "5시간 창 정확히 90% 는 닫힘(이상)" has "$out" "rc=1 five_hour 90>=90"
usage_json 0 10 3600 94.9 3600; out=$(gate); check "7일 94.9% 는 열림" [ "$out" = "rc=0 " ]
usage_json 0 10 3600 95 3600; out=$(gate); check "7일 정확히 95% 는 닫힘" has "$out" "rc=1 seven_day 95>=95"
usage_json 0 99 -10 96 -10; out=$(gate); check "리셋 시각이 지난 창은 0% 로 봐서 열림" [ "$out" = "rc=0 " ]
usage_json 0 99 -10 96 3600; out=$(gate); check "5시간 창만 만료면 7일 창으로 판정(닫힘)" has "$out" "seven_day"
usage_json 0 99 3600 10 3600
LIBENV=(MARU_USAGE_GATE_5H=0); out=$(gate); check "5시간 기준 0 이면 그 기준을 끔(열림)" [ "$out" = "rc=0 " ]
usage_json 0 99 3600 99 3600
LIBENV=(MARU_USAGE_GATE_5H=0 MARU_USAGE_GATE_7D=0); out=$(gate); check "두 기준을 모두 0 으로 끄면 열림" [ "$out" = "rc=0 " ]
LIBENV=(MARU_USAGE_GATE_5H=0); out=$(gate); check "7일 기준은 따로 동작(5h 만 끄면 7일 99% 로 닫힘)" has "$out" "seven_day"
usage_json 0 90 3600 10 3600
for v in abc 150 -5 5.5 "" 101 "9 0"; do
  LIBENV=(MARU_USAGE_GATE_5H="$v"); out=$(gate); check "잘못된 5h 설정 '$v' → 기본 90 으로 닫힘" has "$out" "rc=1 five_hour 90>=90"
done
LIBENV=(MARU_USAGE_GATE_5H=95); out=$(gate); check "5h 기준을 95 로 올리면 90% 는 열림" [ "$out" = "rc=0 " ]
LIBENV=(MARU_USAGE_GATE_5H=050); usage_json 0 60 3600 10 3600; out=$(gate); check "앞의 0 은 10진수(050 → 50)로 닫힘" has "$out" "five_hour 60>=50"
LIBENV=(MARU_USAGE_GATE_7D=junk); usage_json 0 10 3600 95 3600; out=$(gate); check "잘못된 7d 설정은 기본 95" has "$out" "seven_day 95>=95"
LIBENV=()
usage_json 0 99 3600 99 3600
out=$(LIBRUN 'hash -r; PATH=/nonexistent; g=$(usage_gate); echo "rc=$? $g"'); check "python3 가 없으면 열림" [ "$out" = "rc=0 " ]
out=$(gate); check "(대조) python3 가 있으면 같은 파일로 닫힘" has "$out" "rc=1"

echo "== reflect: 사용량 게이트·사전 검증·결과 파일"
reset_all; SID=$(mk_session 1); usage_json 0 95 3600 10 3600
out=$(reflect_run "$SID"); rc=$?
check "사용량 게이트가 닫히면 rc=13(건너뜀)" [ "$rc" -eq 13 ]
check "모델을 부르지 않음" [ "$(calls)" = 0 ]
check "진행 기록(.lines)을 앞으로 보내지 않음" [ ! -e "$ST/$SID.lines" ]
check "last.reflect = epoch|skip|usage|" sh -c 'printf "%s" "$1" | grep -Eq "^[0-9]+\|skip\|usage\|$"' _ "$(last_of reflect)"
check "로그에 고정 형식 skip code=usage" grep -q "skip code=usage$" "$DATA/logs/reflect.log"
check "실패로 세지 않음(fail 카운트·백오프 없음)" [ ! -e "$ST/fail.reflect" ] && [ ! -e "$ST/$SID.backoff" ]
check "임시 파일 잔여 없음" [ -z "$(ls -A "$ST" | grep '^\.last\.')" ]
out=$(reflect_run "$SID" MARU_TICK_PRECOMPACT=1); rc=$?
check "PreCompact 는 게이트를 무시하고 모델을 부름" [ "$rc" -eq 0 ] && [ "$(calls)" = 1 ]
check "성공하면 last.reflect = ok" sh -c 'printf "%s" "$1" | grep -Eq "^[0-9]+\|ok\|\|$"' _ "$(last_of reflect)"
check "성공 로그에는 커밋 줄 없이도 skip/fail 줄이 새로 생기지 않음" sh -c '! tail -3 "$1" | grep -q "fail code="' _ "$DATA/logs/reflect.log"

reset_all; SID=$(mk_session 2); break_mem
out=$(reflect_run "$SID"); rc=$?
check "기억 폴더가 어긋나 있으면 rc=13" [ "$rc" -eq 13 ]
check "모델을 부르지 않음(사전 검증)" [ "$(calls)" = 0 ]
check "진행 기록을 앞으로 보내지 않음" [ ! -e "$ST/$SID.lines" ]
check "last.reflect = skip|invalid" sh -c 'printf "%s" "$1" | grep -Eq "^[0-9]+\|skip\|invalid\|$"' _ "$(last_of reflect)"
check "로그에 skip code=invalid" grep -q "skip code=invalid$" "$DATA/logs/reflect.log"
check "알림 1회" [ "$(wc -l < "$NOTIFY" | tr -d ' ')" = 1 ]
SID2=$(mk_session 3); out=$(reflect_run "$SID2"); out=$(reflect_run "$SID"); rc=$?
check "계속 어긋나 있어도 알림은 다시 안 뜸(여러 세션·여러 번)" [ "$(wc -l < "$NOTIFY" | tr -d ' ')" = 1 ] && [ "$(calls)" = 0 ]
check "사전 검증 건너뜀은 실패로 세지 않음" [ ! -e "$ST/fail.reflect" ] && [ ! -e "$ST/$SID.backoff" ]
# 고치면 다시 돌고(알림 표지 해제), 다시 어긋나면 한 번 더 알림
reset_mem; out=$(reflect_run "$SID"); rc=$?
check "고쳐지면 모델을 부르고 성공" [ "$rc" -eq 0 ] && [ "$(calls)" = 1 ] && [ -s "$ST/$SID.lines" ]
check "알림 표지가 풀림" [ ! -e "$ST/invalid.reflect.notified" ]
break_mem; SID4=$(mk_session 4); out=$(reflect_run "$SID4")
check "다시 어긋나면 알림이 다시 한 번 뜸" [ "$(wc -l < "$NOTIFY" | tr -d ' ')" = 2 ]
# PreCompact 도 사전 검증은 받는다(어차피 되돌려질 호출이므로)
c0=$(calls); out=$(reflect_run "$SID4" MARU_TICK_PRECOMPACT=1); rc=$?
check "PreCompact 도 어긋난 기억에는 호출하지 않음" [ "$rc" -eq 13 ] && [ "$(calls)" = "$c0" ]
# dream 은 사전 검증 없이 부르고(색인을 고칠 수 있음) 결과를 사후 검증한다
c0=$(calls); out=$(dream_run); rc=$?
check "dream 은 어긋난 기억에도 모델을 부름" [ "$(calls)" = $((c0+1)) ]
check "그래도 어긋나 있으면 되돌리고 last.dream = fail" sh -c 'printf "%s" "$1" | grep -Eq "^[0-9]+\|fail\|other\|$"' _ "$(last_of dream)"
check "로그에 fail code=other" grep -q "\[dream\] fail code=other$" "$DATA/logs/dream.log"

echo "== reflect: 백오프(연속 실패 2회째부터 30분×2^(n-2), 최대 6시간)"
reset_all
out=$(LIBRUN 'for i in 1 2 3 4 5 6 7 8 9; do backoff_bump bsid; read -r n u < "$STATE/bsid.backoff"; echo "$i $n $((u==0 ? 0 : u-$(date +%s)))"; done')
got=$(printf '%s\n' "$out" | "$REAL_PY" -c '
import sys
rows = [l.split() for l in sys.stdin]
want = [0, 1800, 3600, 7200, 14400, 21600, 21600, 21600, 21600]
ok = len(rows) == 9 and all(abs(int(r[2]) - w) <= 5 for r, w in zip(rows, want)) and [int(r[1]) for r in rows] == list(range(1, 10))
print("ok" if ok else "bad:" + repr(rows))')
check "백오프 일정: 0, 30분, 1시간, 2시간, 4시간, 6시간(상한)" [ "$got" = ok ]
reset_all; SID=$(mk_session 5)
out=$(reflect_run "$SID" FAKE_RC=1); rc=$?
check "1차 실패는 11 이고 대기 없음(until 0)" [ "$rc" -eq 11 ] && [ "$(cut -d' ' -f1,2 "$ST/$SID.backoff")" = "1 0" ]
check "last.reflect = fail|other" sh -c 'printf "%s" "$1" | grep -Eq "^[0-9]+\|fail\|other\|$"' _ "$(last_of reflect)"
check "로그에 fail code=other" grep -q "fail code=other$" "$DATA/logs/reflect.log"
c1=$(calls); out=$(reflect_run "$SID" FAKE_RC=1); rc=$?
check "2차 실패(대기 없이 다시 시도됨)" [ "$rc" -eq 11 ] && [ "$(calls)" = $((c1+1)) ]
u=$(cut -d' ' -f2 "$ST/$SID.backoff"); d=$((u - $(now)))
check "2회째부터 약 30분 대기(until)" [ "$d" -ge 1790 ] && [ "$d" -le 1810 ]
c2=$(calls); out=$(reflect_run "$SID"); rc=$?
check "대기 중에는 모델을 부르지 않고 rc=13" [ "$rc" -eq 13 ] && [ "$(calls)" = "$c2" ]
check "last.reflect = skip|backoff|<until>" [ "$(last_of reflect | cut -d'|' -f2,3,4)" = "skip|backoff|$u" ]
check "로그에 skip code=backoff until=<epoch>" grep -q "skip code=backoff until=$u$" "$DATA/logs/reflect.log"
check "대기 중에도 진행 기록은 그대로" [ ! -e "$ST/$SID.lines" ]
out=$(reflect_run "$SID" MARU_TICK_PRECOMPACT=1 FAKE_RC=1); rc=$?
check "PreCompact 는 백오프를 무시하고 호출하되 실패는 센다(3회째 → 약 1시간)" [ "$rc" -eq 11 ] && [ "$(calls)" = $((c2+1))  ] && [ "$(cut -d' ' -f1 "$ST/$SID.backoff")" = 3 ] && [ $(( $(cut -d' ' -f2 "$ST/$SID.backoff") - $(now) )) -ge 3590 ]
echo "3 $(( $(now) - 5 ))" > "$ST/$SID.backoff"
out=$(reflect_run "$SID"); rc=$?
check "대기 시간이 지나면 다시 시도하고 성공" [ "$rc" -eq 0 ]
check "성공하면 백오프가 풀림" [ ! -e "$ST/$SID.backoff" ]
check "last.reflect = ok" sh -c 'printf "%s" "$1" | grep -Eq "^[0-9]+\|ok\|\|$"' _ "$(last_of reflect)"
# 시간 초과(142)는 code=timeout
SID=$(mk_session 6); cat > "$T/slow.sh" <<'EOF'
#!/bin/bash
kill -ALRM $$
EOF
chmod +x "$T/slow.sh"
out=$(reflect_run "$SID" REFLECT_FAKE_MODEL="$T/slow.sh"); rc=$?
check "모델 시간 초과(rc 142)는 fail code=timeout" [ "$rc" -eq 11 ] && [ "$(last_of reflect | cut -d'|' -f2,3)" = "fail|timeout" ]
# 잠금 시간 초과는 12 + skip lock (잠금을 쥔 살아 있는 프로세스를 흉내 낸다)
SID=$(mk_session 7); mkdir -p "$ST/lock.d"; sleep 30 & SLP=$!; echo $SLP > "$ST/lock.d/pid"
# acquire_lock 은 5초 간격으로 180번 기다리므로, 이 시험은 잠금 대기를 줄이려고 함수만 직접 시험한다
out=$(LIBRUN 'acquire_lock "$1" 1; echo "rc=$?"' "$ST/lock.d"); kill $SLP 2>/dev/null; rm -rf "$ST/lock.d"
check "(참고) 살아 있는 잠금은 대기 후 실패 — reflect 는 이를 exit 12 + skip lock 으로 기록" [ "$out" = "rc=1" ] && grep -q 'skip lock; exit 12' "$REPO/scripts/reflect.sh"
# 너무 짧은 세션
SID=$(mk_session 8); : > "$PROJ/-fake/$SID.jsonl"; echo '{"type":"user","message":{"role":"user","content":"하나"}}' > "$PROJ/-fake/$SID.jsonl"
out=$(reflect_run "$SID"); rc=$?
check "턴이 모자라면 10 + skip short" [ "$rc" -eq 10 ] && [ "$(last_of reflect | cut -d'|' -f2,3)" = "skip|short" ] && grep -q "skip code=short$" "$DATA/logs/reflect.log"

echo "== dream sweep 은 마지막 기회: 백오프·사용량 게이트를 건너뛴다(사전 검증은 그대로)"
old_epoch() { touch -t "$(date -v-3H +%Y%m%d%H%M)" "$PROJ/-fake/$1.jsonl"; }
reset_all; SID=$(mk_session 9); old_epoch "$SID"
echo "2 $(( $(now) + 3000 ))" > "$ST/$SID.backoff"
out=$(dream_run); rc=$?
check "백오프 중인 세션도 sweep 은 모델을 부름(sweep 1 + 정리 1)" [ "$(calls)" = 2 ] && [ -e "$ST/$SID.swept" ] && [ -s "$ST/$SID.lines" ]
check "성공하면 백오프가 풀림" [ ! -e "$ST/$SID.backoff" ]
reset_all; SID=$(mk_session 10); old_epoch "$SID"; usage_json 0 99 3600 99 3600
out=$(dream_run); rc=$?
check "사용량 게이트가 닫혀 있어도 sweep 은 모델을 부름(정리 본체는 게이트로 건너뜀)" [ "$(calls)" = 1 ] && [ -e "$ST/$SID.swept" ] && [ "$(last_of dream | cut -d'|' -f2,3)" = "skip|usage" ]
reset_all; SID=$(mk_session 11); old_epoch "$SID"; break_mem
out=$(dream_run); rc=$?
check "기억 폴더가 어긋나 있으면 sweep 도 건너뜀(rc 13): 처리 완료로 표시 안 함" [ ! -e "$ST/$SID.swept" ] && [ ! -e "$ST/$SID.lines" ] && grep -q "reflect rc=13" "$DATA/logs/dream.log"
check "(sweep 안의 reflect 는 모델을 안 부름; 정리 본체 1회만)" [ "$(calls)" = 1 ]
reset_all; SID=$(mk_session 12); old_epoch "$SID"
out=$(dream_run FAKE_RC=1)
check "sweep 실패도 센다(백오프 1회째), 처리 완료로 표시 안 함" [ "$(cut -d' ' -f1 "$ST/$SID.backoff")" = 1 ] && [ ! -e "$ST/$SID.swept" ]
reset_all; SID=$(mk_session 13); echo "3 $(( $(now) + 3000 ))" > "$ST/$SID.backoff"
out=$(reflect_run "$SID"); rc=$?
check "세션 종료 시도는 백오프로 미뤄짐(13)·진행 기록 없음" [ "$rc" -eq 13 ] && [ ! -e "$ST/$SID.lines" ] && [ ! -e "$ST/$SID.swept" ]
old_epoch "$SID"; out=$(dream_run)
check "다음 sweep 이 그 세션을 회고함" [ -s "$ST/$SID.lines" ] && [ -e "$ST/$SID.swept" ]
reset_all; SID=$(mk_session 14); old_epoch "$SID"
out=$(dream_run); check "(대조) 백오프도 게이트도 없으면 sweep 이 모델을 부름" [ "$(calls)" = 2 ] && [ -e "$ST/$SID.swept" ]

echo "== 게이트가 읽는 파일 = 쓰는 쪽(usage-status.sh)·앱과 같은 <저장소>/data/usage.json"
reset_all; usage_json 0 99 3600 10 3600
mkdir -p "$T/otherdata"; echo '{"v":1}' > "$T/otherdata/usage.json"
out=$(LIBRUN 'g=$(usage_gate); echo "rc=$? $g"'); check "MARU_DATA 가 다른 곳을 가리켜도 <저장소>/data/usage.json 으로 닫힘" has "$out" "rc=1 five_hour"
AT=$(now); printf '{"v":1,"at":%s,"five_hour":{"pct":99,"resets_at":%s}}' "$AT" "$((AT+3600))" > "$T/otherdata/usage.json"
rm -f "$RR/data/usage.json"
out=$(LIBRUN 'g=$(usage_gate); echo "rc=$? $g"'); check "MARU_DATA 쪽 usage.json 은 읽지 않음(저장소 쪽이 없으면 열림)" [ "$out" = "rc=0 " ]
printf '%s' '{"rate_limits":{"five_hour":{"used_percentage":97,"resets_at":'$(( $(now) + 3600 ))'}}}' | env -i HOME="$FAKE_HOME" PATH=/usr/bin:/bin MARU_TOOL_DIRS="$T/good" MARU_DATA="$T/otherdata" bash "$RR/scripts/usage-status.sh" >/dev/null 2>&1
out=$(LIBRUN 'g=$(usage_gate); echo "rc=$? $g"'); check "usage-status.sh 가 쓴 파일을 게이트가 그대로 읽음(MARU_DATA 와 무관)" has "$out" "rc=1 five_hour 97>=90"

echo "== 백오프: 시계가 거꾸로 간 뒤의 먼 미래 until 은 만료"
reset_all; SID=$(mk_session 15)
echo "5 $(( $(now) + 21000 ))" > "$ST/$SID.backoff"; out=$(LIBRUN 'backoff_until "$1" >/dev/null; echo "rc=$?"' "$SID")
check "6시간 안의 until 은 대기" [ "$out" = "rc=0" ]
echo "5 $(( $(now) + 22000 ))" > "$ST/$SID.backoff"; out=$(LIBRUN 'backoff_until "$1" >/dev/null; echo "rc=$?"' "$SID")
check "6시간보다 먼 until 은 만료(rc=1)" [ "$out" = "rc=1" ]
out=$(reflect_run "$SID"); rc=$?
check "그 세션은 바로 시도됨" [ "$rc" -eq 0 ] && [ "$(calls)" = 1 ]

echo "== 기억 본문 해시: *.md 만, 부스러기 파일 무시"
reset_all
h1=$(LIBRUN 'mem_body_hash "$MEM"')
: > "$MEM/.DS_Store"; echo x > "$MEM/stray.txt"; mkdir -p "$MEM/sub"; echo y > "$MEM/sub/junk.bin"
h2=$(LIBRUN 'mem_body_hash "$MEM"'); check "md 가 아닌 파일은 해시에 영향 없음" [ -n "$h1" ] && [ "$h1" = "$h2" ]
echo 더 >> "$MEM/MEMORY.md"; h3=$(LIBRUN 'mem_body_hash "$MEM"'); check "MEMORY.md 변경은 해시에 반영" [ "$h3" != "$h2" ]
echo 더 >> "$MEM/note.md"; h4=$(LIBRUN 'mem_body_hash "$MEM"'); check "다른 기억 .md 변경도 반영" [ "$h4" != "$h3" ]
mkdir -p "$MEM/journal" "$MEM/diary"; echo a > "$MEM/journal/2000-01-01.md"; echo b > "$MEM/diary/2000-01-01.md"
h5=$(LIBRUN 'mem_body_hash "$MEM"'); check "journal/·diary/ 의 .md 는 제외" [ "$h5" = "$h4" ]
reset_all; out=$(dream_run); c0=$(calls)
LIBRUN 'printf "v2 %s %s\n" "$(mem_body_hash "$MEM")" "$(( $(date +%s) - 3600 ))" > "$STATE/dream.marker"' >/dev/null
: > "$MEM/.DS_Store"; out=$(dream_run)
check "Finder 부스러기만 생겨도 정리 모델을 부르지 않음" [ "$(calls)" = "$c0" ]

echo "== dream: 사용량 게이트(이틀 연속 건너뛰지 않음)"
reset_all; usage_json 0 99 3600 10 3600
out=$(dream_run); rc=$?
check "게이트가 닫히면 모델을 부르지 않고 last.dream = skip|usage" [ "$rc" -eq 0 ] && [ "$(calls)" = 0 ] && [ "$(last_of dream | cut -d'|' -f2,3)" = "skip|usage" ]
check "로그에 [dream] skip code=usage" grep -q "\[dream\] skip code=usage$" "$DATA/logs/dream.log"
check "마커를 쓰지 않음(다음에 다시 판단)" [ ! -e "$ST/dream.marker" ]
out=$(dream_run); rc=$?
check "바로 전 시도가 skip|usage 였으면 이번에는 그대로 실행" [ "$rc" -eq 0 ] && [ "$(calls)" = 1 ] && [ "$(last_of dream | cut -d'|' -f2,3)" = "ok|" ]
rm -f "$ST/dream.marker"; echo x >> "$MEM/note.md"
out=$(dream_run); check "그다음 밤에는 다시 게이트 적용" [ "$(calls)" = 1 ] && [ "$(last_of dream | cut -d'|' -f2,3)" = "skip|usage" ]
usage_json 0 99 3600 10 3600; echo "$(now)|skip|usage|" > "$ST/last.dream"; : > "$T/calls"
out=$(dream_run MARU_USAGE_GATE_5H=0); check "기준을 0 으로 끄면 게이트 없이 실행" [ "$(calls)" = 1 ]

echo "== dream: 모델을 부르지 않는 조건"
DT=$(date +%F); TNOW=$(date +%H:%M)
setmarker() { # <epoch 오프셋>: 현재 기억 본문 해시 + (지금+오프셋)
  LIBRUN 'printf "v2 %s %s\n" "$(mem_body_hash "$MEM")" "$(( $(date +%s) + $1 ))" > "$STATE/dream.marker"' "$1" >/dev/null
}
jblock() { # <날짜 파일> <HH:MM> <줄...>
  local f=$MEM/journal/$1 h=$2; shift 2
  mkdir -p "$MEM/journal"; chmod 700 "$MEM/journal"
  [ -f "$f" ] || printf '# %s 일지\n' "${1%.md}" > "$f"
  { printf '\n## %s 시험(abcd1234)\n' "$h"; printf '%s\n' "$@"; } >> "$f"
}
reset_all
out=$(dream_run); check "(1) 마커가 없으면 모델을 부름" [ "$(calls)" = 1 ]
check "성공하면 마커가 v2 형식" sh -c 'grep -Eq "^v2 [0-9a-f]{32} [0-9]+$" "$1"' _ "$ST/dream.marker"
check "last.dream = ok" [ "$(last_of dream | cut -d'|' -f2,3)" = "ok|" ]
out=$(dream_run); check "(2) 아무것도 안 바뀌면 부르지 않음" [ "$(calls)" = 1 ] && has "$out$(cat "$DATA/logs/dream.log")" "기억 변경 없음 — 정리 건너뜀"
check "건너뛴 실행도 last.dream = ok(할 일 없음)" [ "$(last_of dream | cut -d'|' -f2,3)" = "ok|" ]
setmarker -3600
jblock "$DT.md" "$TNOW" '- [한 일] (5) @maru 일반 항목' '- [결정] (7) @maru 중요도 7 항목'
out=$(dream_run); check "(3) 일지만 늘고(하루 회고 날짜 없음, 중요도 8 미만) → 모델 안 부름" [ "$(calls)" = 1 ]
setmarker -3600
jblock "$DT.md" "$TNOW" '- [결정] (8) @maru 중요한 결정'
out=$(dream_run); check "(4) 마커 이후 중요도 8 이상 항목 → 모델 부름" [ "$(calls)" = 2 ]
# 마커보다 오래된 중요도 9 는 무시
setmarker 3600
out=$(dream_run); check "(4b) 마커보다 먼저 쓰인 중요도 8 이상은 무시 → 안 부름" [ "$(calls)" = 2 ]
setmarker -3600; echo "추가 본문" >> "$MEM/note.md"
out=$(dream_run); check "(5) 기억 본문이 바뀌면 부름" [ "$(calls)" = 3 ]
(cd "$MEM" && find . -type f -print0 | xargs -0 md5 -r | sort | md5 -q) > "$ST/dream.marker"
out=$(dream_run); check "(6) 옛 형식 마커(해시만)는 한 번 정상 실행" [ "$(calls)" = 4 ] && grep -Eq "^v2 " "$ST/dream.marker"
rm -f "$MEM/journal/$DT.md"   # 정리 시작 1분 안에 쓴 중요도 8 이상 항목은 보수적으로 한 번 더 세므로(마커 epoch 가 1분 앞) 치운다
out=$(dream_run); check "(6b) 그다음엔 다시 건너뜀" [ "$(calls)" = 4 ]
D2=$(date -v-2d +%F); jblock "$D2.md" "10:00" '- [한 일] (5) @maru 이틀 전 일'
out=$(dream_run); check "(7) 하루 회고를 맡길 날짜가 있으면 부름" [ "$(calls)" = 5 ]
mkdir -p "$MEM/diary"; printf '# 제목\n\n본문이 충분히 긴 하루 회고 문장입니다.\n' > "$MEM/diary/$D2.md"; setmarker -3600
out=$(dream_run); check "(7b) diary 가 있으면 다시 건너뜀(diary/ 변경은 본문 변경이 아님)" [ "$(calls)" = 5 ]
rm -rf "$MEM/diary" "$MEM/journal"

echo "== dream: 건너뛸 때도 모델 없이 하는 정리(보관·완료 표시)"
reset_all; out=$(dream_run); c0=$(calls)
D20=$(date -v-20d +%F)
mkdir -p "$MEM/journal"; chmod 700 "$MEM/journal"; printf '# %s 일지\n' "$D20" > "$MEM/journal/$D20.md"
printf '%s|done|maru|시험 할 일 하나\n' "$(now)" > "$DATA/todo-done.txt"
setmarker -3600
out=$(dream_run)
check "모델은 안 부름" [ "$(calls)" = "$c0" ]
check "오래된 일지는 archive 로 보관됨" [ -f "$MEM/journal/archive/$D20.md" ] && [ ! -e "$MEM/journal/$D20.md" ]
check "완료 표시가 일지에 반영됨" sh -c 'grep -q "사용자가 완료 표시" "$1/journal/$2.md"' _ "$MEM" "$DT"
check "일지 정리가 hist 에 커밋됨(archive 이동 포함)" sh -c '"$1" --git-dir="$2/history.git" log --name-only --format=%s | grep -q "journal/archive/$3.md"' _ "$REAL_GIT" "$DATA" "$D20"
check "잠금이 풀림" [ ! -e "$ST/lock.d" ] && [ ! -e "$ST/dream.lock.d" ]
check "마커는 그대로(본문 변경 없음)" sh -c 'grep -Eq "^v2 " "$1"' _ "$ST/dream.marker"

echo "== 커밋 로그에 hash"
reset_all; SID=$(mk_session 11); mkdir -p "$T/st"; printf '%s\n' 'done|7||시험 일을 했다' > "$T/st/j.txt"
out=$(reflect_run "$SID" FAKE_JOURNAL="$T/st/j.txt"); rc=$?
check "reflect 커밋 줄 = [sid8] 커밋 완료 hash=<7자>" sh -c 'grep -Eq "\[aaaaaaaa\] 커밋 완료 hash=[0-9a-f]{7}$" "$1"' _ "$DATA/logs/reflect.log"
rm -f "$ST/dream.marker"; echo "더" >> "$MEM/note.md"; out=$(dream_run)
check "dream 커밋 줄 = [dream] 커밋 완료 hash=<7자>" sh -c 'grep -Eq "\[dream\] 커밋 완료 hash=[0-9a-f]{7}$" "$1"' _ "$DATA/logs/dream.log"

echo "== 결과 파일: 심볼릭 링크 거부·형식"
reset_all; mkdir -p "$T/elsewhere"
ln -s "$T/elsewhere/target" "$ST/last.reflect"
out=$(LIBRUN 'record_outcome reflect skip usage; echo "rc=$?"')
check "last.* 가 링크면 쓰지 않고 rc=0" has "$out" "rc=0" && [ -L "$ST/last.reflect" ] && [ ! -e "$T/elsewhere/target" ]
check "링크여도 로그 줄은 남음" has "$out" "LOG: skip code=usage"
rm -f "$ST/last.reflect"; mv "$ST" "$T/state.real"; ln -s "$T/state.real" "$ST"
out=$(LIBRUN 'record_outcome dream skip usage; echo "rc=$?"')
check "STATE 가 링크면 쓰지 않음" [ ! -e "$T/state.real/last.dream" ]
rm -f "$ST"; mv "$T/state.real" "$ST"
out=$(LIBRUN 'record_outcome dream skip backoff 1234567890; record_outcome reflect fail timeout; echo done')
check "형식 epoch|결과|코드|until" sh -c 'grep -Eq "^[0-9]+\|skip\|backoff\|1234567890$" "$1/last.dream" && grep -Eq "^[0-9]+\|fail\|timeout\|$" "$1/last.reflect"' _ "$ST"
check "로그 고정 형식(until 포함)" has "$out" "LOG: skip code=backoff until=1234567890" && has "$out" "LOG: fail code=timeout"
check "한 줄 파일·임시 파일 없음" [ "$(wc -l < "$ST/last.dream" | tr -d ' ')" = 1 ] && [ -z "$(ls -A "$ST" | grep '^\.last\.')" ]
out=$(LIBRUN 'record_outcome dream ok; echo done'); check "ok 는 로그 줄을 남기지 않고 코드·until 이 빔" hasnt "$out" "LOG:" && [ "$(last_of dream | cut -d'|' -f2-)" = "ok||" ]

echo "== journal-tick: lib.sh 를 부르기 전에 간격 검사"
mkdir -p "$T/tk/scripts"; cp "$REPO/scripts/journal-tick.sh" "$T/tk/scripts/"
cat > "$T/tk/scripts/lib.sh" <<'EOF'
# 시험용 가짜 lib.sh: 불렸다는 표지만 남기고 훅이 쓰는 변수를 설정한다
echo sourced >> "$TK_MARK"
MARU_DATA=${MARU_DATA:-$MARU_HOME/data}; STATE=${MARU_STATE:-$MARU_DATA/state}; LOGS=$MARU_DATA/logs; PROJECTS=${PROJECTS:-/nonexistent}
EOF
cat > "$T/tk/stub.sh" <<'EOF'
#!/bin/bash
echo "pc=${MARU_TICK_PRECOMPACT:-} run=${MARU_TICK_RUN:-}" >> "$TK_OUT"
cat > /dev/null
EOF
chmod +x "$T/tk/stub.sh"
TK_DATA=$T/tkdata; mkdir -p "$TK_DATA/state" "$TK_DATA/logs"
TSID=dddddddd-1111-2222-3333-444444444444
tk() { # <event> [추가 환경...]
  local ev=$1; shift
  printf '{"session_id":"%s","hook_event_name":"%s","transcript_path":"/x/t.jsonl","cwd":"/x"}' "$TSID" "$ev" \
    | run_env TK_MARK="$T/tk.mark" TK_OUT="$T/tk.out" MARU_HOME="$T/tk" MARU_DATA="$TK_DATA" REFLECT_ALLOW_FAKE=yes-i-am-testing JOURNAL_TICK_REFLECT="$T/tk/stub.sh" "$@" -- bash "$T/tk/scripts/journal-tick.sh"
}
tkrst() { : > "$T/tk.mark"; : > "$T/tk.out"; }
wait_for() { local i=0; while ! "$@" 2>/dev/null; do i=$((i+1)); [ $i -gt 50 ] && return 1; sleep 0.2; done; return 0; }
marks() { wc -l < "$T/tk.mark" | tr -d ' '; }
tkrst; rm -f "$TK_DATA/state/tick.$TSID"
out=$(tk Stop); wait_for [ -s "$T/tk.out" ]
check "(진행) 간격 파일이 없으면 lib.sh 를 부르고 reflect 를 띄움" [ "$(marks)" = 1 ] && [ -s "$T/tk.out" ] && [ -s "$TK_DATA/state/tick.$TSID" ]
check "(진행) Stop 은 PreCompact 표지 없음" has "$(cat "$T/tk.out")" "pc= run=1"
tkrst; out=$(tk Stop); sleep 0.5
check "30분 안의 Stop 은 lib.sh 를 부르지 않고 종료" [ "$(marks)" = 0 ] && [ ! -s "$T/tk.out" ] && [ -z "$out" ]
tkrst; out=$(tk PreCompact); wait_for [ -s "$T/tk.out" ]
check "PreCompact 는 간격과 무관하게 진행하고 MARU_TICK_PRECOMPACT=1" [ "$(marks)" = 1 ] && has "$(cat "$T/tk.out")" "pc=1 run=1"
echo $(( $(now) - 1801 )) > "$TK_DATA/state/tick.$TSID"; tkrst
out=$(tk Stop); wait_for [ -s "$T/tk.out" ]; check "30분이 지나면 진행" [ "$(marks)" = 1 ]
tkrst; out=$(tk Stop "AGENT_REFLECTING=1"); sleep 0.3; check "AGENT_REFLECTING 이면 즉시 종료" [ "$(marks)" = 0 ] && [ ! -s "$T/tk.out" ]
# 나쁜 입력: 조기 종료
tkrst; out=$(printf 'not json' | run_env TK_MARK="$T/tk.mark" MARU_HOME="$T/tk" MARU_DATA="$TK_DATA" -- bash "$T/tk/scripts/journal-tick.sh"); rc=$?
check "깨진 입력은 0·무출력·lib.sh 안 부름" [ "$rc" -eq 0 ] && [ -z "$out" ] && [ "$(marks)" = 0 ]
# MARU_STATE 재정의: lib.sh 와 같은 경로를 본다
mkdir -p "$T/altstate"; echo "$(now)" > "$T/altstate/tick.$TSID"; echo $(( $(now) - 99999 )) > "$TK_DATA/state/tick.$TSID"; tkrst
out=$(tk Stop MARU_STATE="$T/altstate"); sleep 0.4
check "MARU_STATE 로 옮긴 간격 파일을 읽어 조기 종료" [ "$(marks)" = 0 ] && [ ! -s "$T/tk.out" ]
echo "$(now)" > "$TK_DATA/state/tick.$TSID"; rm -f "$T/altstate/tick.$TSID"; tkrst
out=$(tk Stop MARU_STATE="$T/altstate"); wait_for [ -s "$T/tk.out" ]
check "기본 위치의 최근 파일은 MARU_STATE 가 다르면 무시(진행)" [ "$(marks)" = 1 ] && [ -s "$T/altstate/tick.$TSID" ]
# maru.conf 가 있으면 계산하지 않고 lib.sh 로 간다(conf 안에서 경로가 바뀔 수 있음)
echo "$(now)" > "$TK_DATA/state/tick.$TSID"; : > "$TK_DATA/maru.conf"; tkrst
out=$(tk Stop); sleep 0.4
check "maru.conf 가 있으면 lib.sh 를 부른 뒤 같은 간격 규칙(최근이면 종료)" [ "$(marks)" = 1 ] && [ ! -s "$T/tk.out" ]
rm -f "$TK_DATA/maru.conf"
# 자식 세션 보고 조건이면 lib.sh 를 먼저 부른다(보고는 간격과 무관)
echo "$(now)" > "$TK_DATA/state/tick.$TSID"; tkrst
out=$(tk Stop MARU_PARENT_WS=parentws1 MARU_WS=childws12); sleep 0.4
check "자식 세션(MARU_PARENT_WS·MARU_WS)이면 lib.sh 를 부름(보고 경로 유지)" [ "$(marks)" = 1 ] && [ ! -s "$T/tk.out" ]
check "실제 journal-tick.sh 는 lib.sh 를 부르기 전에 jq 로 간격을 검사(정적)" sh -c 'a=$(grep -n "lib.sh\" >/dev/null" "$1" | head -1 | cut -d: -f1); b=$(grep -n "exit 0; fi" "$1" | head -1 | cut -d: -f1); [ -n "$a" ] && [ -n "$b" ] && [ "$b" -lt "$a" ]' _ "$REPO/scripts/journal-tick.sh"

echo "== maru doctor"
mkdir -p "$T/dr/bin" "$T/dr/scripts"; cp "$REPO/bin/maru" "$T/dr/bin/"; cp "$REPO"/scripts/*.sh "$REPO"/scripts/*.py "$T/dr/scripts/" 2>/dev/null
DMEM=$PROJ/drslug/memory; DDATA=$T/drdata
mkdir -p "$DMEM" "$DDATA/state" "$DDATA/logs"
printf '%s\n' '- [노트](note.md) — 시험용 기억' > "$DMEM/MEMORY.md"
printf '%s\n' '---' 'name: note' 'description: 시험' '---' '본문' > "$DMEM/note.md"
doctor() { run_env MEM="$DMEM" MARU_DATA="$DDATA" "$@" -- bash "$T/dr/bin/maru" doctor; }
before=$(cd "$DDATA" && find . | sort | md5 -q)
out=$(doctor MARU_LANG=ko); check "정상 기억 폴더: 검증 통과 줄" has "$out" "OK    기억 폴더 검증 통과"
check "doctor 는 읽기 전용(data 아래 파일 수 변화 없음)" [ "$(cd "$DDATA" && find . | sort | md5 -q)" = "$before" ]
printf '%s\n' '- [노트](note.md) — 시험용 기억' '- [유령](ghost.md) — 없는 파일' > "$DMEM/MEMORY.md"
out=$(doctor MARU_LANG=ko)
check "어긋난 기억 폴더: 검증 실패 + 이유" has "$out" "주의  기억 폴더 검증 실패: 색인이 없는 파일을 가리킴: ghost.md"
check "안내 한 줄(한국어)" has "$out" "새벽 정리가 고치거나, 마루에게 색인과 기억 파일을 맞춰 달라고 하세요. 고칠 때까지 회고는 건너뜁니다."
out=$(doctor MARU_LANG=en)
check "영어: 실패 줄·안내" has "$out" "Memory folder validation failed: 색인이 없는 파일을 가리킴: ghost.md" && has "$out" "Reflection is skipped until it is fixed."
E=$(now); printf '%s|skip|invalid|\n' "$E" > "$DDATA/state/last.reflect"; printf '%s|skip|backoff|%s\n' "$E" "$((E+600))" > "$DDATA/state/last.dream"
out=$(doctor MARU_LANG=ko)
check "last.reflect/last.dream 을 사람이 읽는 형태로 표시" has "$out" "최근 회고: " && has "$out" "건너뜀 (invalid)" && has "$out" "최근 정리: " && has "$out" "(backoff), 다음 시도 가능 "
out=$(doctor MARU_LANG=en); check "영어 표시" has "$out" "last reflect: " && has "$out" "skipped (invalid)" && has "$out" "retry after"
rm -f "$DDATA/state/last.reflect" "$DDATA/state/last.dream"; out=$(doctor MARU_LANG=ko); check "결과 파일이 없으면 그 줄은 없음" hasnt "$out" "최근 회고"

echo "== 가드"
check "시험이 쓰는 데이터 폴더는 모두 임시 폴더 안" sh -c 'case "$1" in "$2"/*) exit 0;; esac; exit 1' _ "$DATA" "$T"
check "추적 파일에 개인 절대 경로가 없음(신규·변경분)" sh -c '! grep -Il "/Us""ers/" "$1/scripts/test-quota.sh" "$1/scripts/lib.sh" "$1/scripts/reflect.sh" "$1/scripts/dream.sh" "$1/scripts/journal-tick.sh" "$1/bin/maru" | grep -q .' _ "$REPO"
echo
if [ "$FAIL" = 0 ]; then echo "test-quota: OK ($N 항목)"; exit 0; else echo "test-quota: $FAIL/$N 실패"; exit 1; fi
