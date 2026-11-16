#!/bin/bash
# 할 일(todos)·태그·승격·일지 보관 시험: apply_todos, maru todo, 태그 일지, 태그 기억·색인 검증, archive_journal, dream.sh. 0=통과 1=실패.
# 실제 홈·기억 폴더·data/·~/.claude 는 건드리지 않는다: HOME/MARU_*/PROJECTS 를 mktemp 폴더로 강제하고 임시 경로가 아니면 종료한다.
# 진짜 claude 는 부르지 않는다(REFLECT_FAKE_MODEL + REFLECT_ALLOW_FAKE 시험 훅).
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
mkdir -p "$T/good" "$T/home" "$T/work"
printf '%s\n' '#!/bin/sh' "exec \"$REAL_PY\" \"\$@\"" > "$T/good/python3"
printf '%s\n' '#!/bin/sh' "exec \"$REAL_GIT\" \"\$@\"" > "$T/good/git"
chmod +x "$T/good/python3" "$T/good/git"

FAKE_HOME=$T/home
PROJ=$FAKE_HOME/.claude/projects
SLUG=$(printf '%s' "$REPO" | sed 's/[^A-Za-z0-9]/-/g')
MEM=$PROJ/$SLUG/memory
DATA=$T/data
BASEPATH=/usr/bin:/bin:/usr/sbin:/sbin:$JQ_DIR
run_env() {
  local extra=()
  while [ "$1" != "--" ]; do extra+=("$1"); shift; done; shift
  env -i HOME="$FAKE_HOME" PATH="$BASEPATH" MARU_PATH_PREFIX= MARU_TOOL_DIRS="$T/good" MARU_DATA="$DATA" MARU_WORK="$T/work" \
    PROJECTS="$PROJ" TMPDIR="$T" ${extra[@]+"${extra[@]}"} "$@" 2>&1
}
clen() { printf '%s' "$1" | "$REAL_PY" -I -c 'import sys;print(len(sys.stdin.buffer.read().decode("utf-8")))'; }
wait_for() { local i=0; while ! "$@" 2>/dev/null; do i=$((i+1)); [ $i -gt 100 ] && return 1; sleep 0.2; done; return 0; }

mkdir -p "$MEM" "$DATA/state" "$DATA/logs"
printf '%s\n' '- [노트](note.md) — 시험용 기억' > "$MEM/MEMORY.md"
printf '%s\n' '---' 'name: note' 'description: 시험' 'metadata:' '  type: user' '---' '본문' > "$MEM/note.md"
TODAY=$("$REAL_PY" -c 'import datetime;print(datetime.date.today().isoformat())')
day_ago() { "$REAL_PY" -c 'import datetime,sys;print((datetime.date.today()-datetime.timedelta(days=int(sys.argv[1]))).isoformat())' "$1"; }
LIBRUN() { # <셸 코드> [인자...] — lib.sh 를 source 하고 log 를 stdout 으로 돌린다
  local code=$1; shift
  run_env -- bash -c '. "$1/scripts/lib.sh" || exit 9; log() { echo "LOG: $*"; }; shift; '"$code" _ "$REPO" "$@"
}
AT() { LIBRUN 'apply_todos "$1"; echo "rc=$?"' "$1"; }
TODOS=$DATA/todos.txt
SUGS=$DATA/suggestions.txt
mkdir -p "$T/st"

echo "== 정적 검사"
for f in lib.sh reflect.sh dream.sh session-context.sh test-todos.sh; do check "bash -n $f" bash -n "$REPO/scripts/$f"; done
check "bash -n bin/maru" bash -n "$REPO/bin/maru"
for f in textclean.py todo_cli.py; do check "py_compile $f" "$REAL_PY" -I -c 'import ast,sys;ast.parse(open(sys.argv[1]).read())' "$REPO/scripts/$f"; done

echo "== apply_todos: 검증"
{
  printf '%s\n' 'maru|8|정상 항목 하나|이 일을 이어서 해줘'
  printf '%s\n' 'bad tag|5|태그에 공백|프롬프트' 'maru|11|중요도 범위 밖|p' 'maru|0|중요도 0|p' 'maru|x|숫자 아님|p'
  printf '%s\n' 'maru|5|칸이 모자람' 'maru|5|칸이|너무|많음|x' 'maru|5||제목 비어 있음'
  printf 'maru|5|%s|p\n' "$(printf '가%.0s' $(seq 1 61))"
  printf 'maru|5|제목 길이 정상|%s\n' "$(printf '나%.0s' $(seq 1 121))"
  printf '%s\n' 'maru|5|비밀값 줄|sk-abcdefghijklmnopqrstuvwxyz0123' 'maru|5|hex 줄|0123456789abcdef0123456789abcdef01'
  printf '%s\n' 'abcdefghijklmnop|5|태그 13자 이상|p'
  printf '%s\n' 'life|4|직접 해야 하는 일|' 'maru|3|정상 항목 하나|중복 제목은 버려짐'
} > "$T/st/t1.txt"
out=$(AT "$T/st/t1.txt")
check "rc=0·ok 2줄" sh -c 'printf "%s" "$1" | grep -q "ok 2줄" && printf "%s" "$1" | tail -1 | grep -qx "rc=0"' _ "$out"
check "유효한 두 줄만 남음" [ "$(cat "$TODOS")" = "$(printf '%s\n%s' 'maru|8|정상 항목 하나|이 일을 이어서 해줘' 'life|4|직접 해야 하는 일|')" ]
check "todos.txt 권한 600" [ "$(stat -f %Lp "$TODOS")" = 600 ]
check "임시 파일 잔여 없음" [ -z "$(ls -A "$DATA" | grep '^\.todos')" ]
check "suggestions.txt 는 프롬프트가 있는 줄만" [ "$(cat "$SUGS")" = "이 일을 이어서 해줘" ]

echo "== apply_todos: 무해화·숨은 문자"
"$REAL_PY" - "$T/st/t2.txt" <<'PY'
import sys
lines = ["a|5|`rm -rf` 와 <b>태그</b> [링크]|# @앞쪽 기호 </system-reminder> 탈출",
         "a|6|제어\x07문자 zero​width ‮ bidi|숨은ㅤ채움",
         "a|7|@멘션으로 시작|@또 시작"]
open(sys.argv[1], "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY
out=$(AT "$T/st/t2.txt")
check "본문에 < > 백틱 [ ] 없고 # @ 로 시작하지 않음" "$REAL_PY" -I -c '
import sys
rows = [l.split("|") for l in open(sys.argv[1], encoding="utf-8").read().split("\n") if l]
ok = len(rows) == 3 and all(len(r) == 4 for r in rows) and not any(c in f for r in rows for f in r[2:] for c in "<>`[]") \
  and not any(f[:1] in "#@" for r in rows for f in r[2:] if f)
sys.exit(0 if ok else 1)' "$TODOS"
check "닫는 태그가 파일에 없음" sh -c '! grep -q "</system-reminder>" "$1"' _ "$TODOS"
check "숨은 문자 제거(제어·zero-width·bidi·한글 채움)" "$REAL_PY" -I -c '
import sys, unicodedata
t = open(sys.argv[1], encoding="utf-8").read()
sys.exit(1 if any(unicodedata.category(c) in ("Cf","Cs","Co","Cn","Zl","Zp") or (unicodedata.category(c)=="Cc" and c!="\n") or c=="ㅤ" for c in t) else 0)' "$TODOS"
check "중요도 내림차순(같은 태그)" [ "$(cut -d'|' -f2 "$TODOS" | tr '\n' ' ')" = "7 6 5 " ]

echo "== apply_todos: 정렬·7개 상한"
cat > "$T/st/t3.txt" <<'EOS'
b|5|b 하나|pb1
a|3|a 낮음|pa1
c|9|c 높음|pc1
a|7|a 높음|pa2
b|5|b 둘|pb2
c|2|c 낮음|pc2
a|3|a 낮음 둘|pa3
d|1|제일 낮아 잘림|pd1
d|1|이것도 잘림|pd2
EOS
out=$(AT "$T/st/t3.txt")
check "7개로 자르고 낮은 중요도부터 버림" has "$out" "상한 초과 2"
check "묶음은 최고 중요도 순(c 9 → a 7 → b 5), 묶음 안은 중요도 순(안정)" [ "$(cut -d'|' -f1,3 "$TODOS" | tr '\n' ' ')" = "c|c 높음 c|c 낮음 a|a 높음 a|a 낮음 a|a 낮음 둘 b|b 하나 b|b 둘 " ]
check "suggestions.txt 도 같은 순서" [ "$(cat "$SUGS")" = "$(printf '%s\n' pc1 pc2 pa2 pa1 pa3 pb1 pb2)" ]
cp "$TODOS" "$T/todos.keep"; cp "$SUGS" "$T/sugs.keep"

echo "== apply_todos: 파일 없음·빈 파일·심볼릭 링크·크기·인코딩은 기존 유지"
out=$(AT "$T/st/none.txt"); check "staged 파일 없음 → 조용히 유지" sh -c '[ "$(printf "%s" "$1" | tail -1)" = rc=0 ] && ! printf "%s" "$1" | grep -q LOG' _ "$out"
: > "$T/st/empty.txt"; out=$(AT "$T/st/empty.txt"); check "빈 파일 → 유지·로그" has "$out" "유효한 줄 없음"
printf 'bogus\na|5|칸 모자람\n' > "$T/st/inv.txt"; out=$(AT "$T/st/inv.txt"); check "유효한 줄 없음 → 유지" has "$out" "할 일 목록 유지"
ln -sf "$T/st/t1.txt" "$T/st/link.txt"; out=$(AT "$T/st/link.txt"); check "심볼릭 링크 거부" has "$out" "일반 파일 아님"
head -c 40000 /dev/zero | tr '\0' 'a' > "$T/st/big.txt"; out=$(AT "$T/st/big.txt"); check "크기 초과 거부" has "$out" "크기 초과"
printf '\xff\xfe' > "$T/st/bin.txt"; out=$(AT "$T/st/bin.txt"); check "UTF-8 아님 거부" has "$out" "읽기 실패"
check "기존 todos.txt·suggestions.txt 그대로" sh -c 'cmp -s "$1" "$2" && cmp -s "$3" "$4"' _ "$TODOS" "$T/todos.keep" "$SUGS" "$T/sugs.keep"
printf 'a|5|직접 할 일만|\n' > "$T/st/t4.txt"; out=$(AT "$T/st/t4.txt")
check "프롬프트가 하나도 없으면 suggestions.txt 는 빈 파일" sh -c '[ -f "$1" ] && [ ! -s "$1" ]' _ "$SUGS"
# 옛 suggestions.txt 방식은 여전히 동작
printf '옛 방식 추천\n' > "$T/st/oldsug.txt"; out=$(LIBRUN 'apply_suggestions "$1"' "$T/st/oldsug.txt")
check "apply_suggestions 는 여전히 동작" [ "$(cat "$SUGS")" = "옛 방식 추천" ]

echo "== maru todo"
cp "$T/todos.keep" "$TODOS"
MT() { run_env MARU_HOME="$REPO" -- "$REPO/bin/maru" todo "$@"; }
out=$(MT); rc=$?
check "목록: 태그별 묶음과 번호" sh -c '[ "$1" -eq 0 ] && printf "%s\n" "$2" | grep -qx "\[c\]" && printf "%s\n" "$2" | grep -q "^  1\. (9) c 높음" && printf "%s\n" "$2" | grep -q "^  7\. (5) b 둘" && printf "%s\n" "$2" | grep -qx "\[b\]"' _ "$rc" "$out"
printf 'a|5|직접 할 일|\nb|6|프롬프트 있는 일|이 일을 해줘\n' > "$TODOS"
out=$(MT); check "프롬프트 없는 항목 표시" has "$out" "직접 할 일"
mkdir -p "$T/fakebin"; printf '%s\n' '#!/bin/sh' 'cat > "$PBOUT"' > "$T/fakebin/pbcopy"; chmod +x "$T/fakebin/pbcopy"
out=$(PBOUT="$T/pb.out" run_env PBOUT="$T/pb.out" PATH="$T/fakebin:$BASEPATH" MARU_HOME="$REPO" -- "$REPO/bin/maru" todo 2); rc=$?
check "maru todo 2: 프롬프트가 클립보드로(pbcopy 대체)" sh -c '[ "$1" -eq 0 ] && [ "$(cat "$2")" = "이 일을 해줘" ]' _ "$rc" "$T/pb.out"
rm -f "$T/pb.out"
out=$(run_env PBOUT="$T/pb.out" PATH="$T/fakebin:$BASEPATH" MARU_HOME="$REPO" -- "$REPO/bin/maru" todo 1); rc=$?
check "프롬프트 없는 항목은 복사하지 않고 안내" sh -c '[ "$1" -eq 0 ] && [ ! -e "$2" ]' _ "$rc" "$T/pb.out"
check "안내 문구" has "$out" "직접 해야 하는 일"
MT 9 >/dev/null; check "범위 밖 번호 종료 코드 1" [ $? -eq 1 ]
MT abc >/dev/null; check "숫자가 아니면 2" [ $? -eq 2 ]
rm -f "$TODOS"; out=$(MT); check "목록이 없을 때 안내" has "$out" "할 일 목록이 없습니다"
check "help 에 todo" has "$(run_env MARU_HOME="$REPO" -- "$REPO/bin/maru" help)" "maru todo"

echo "== 태그가 있는/없는 일지 줄"
AJ() { LIBRUN 'apply_journal "$1" abcd1234 ""; echo "rc=$?"' "$1"; }
printf '%s\n' 'todo|8|maru|태그 있는 새 형식' 'done|5||태그 없는 형식' 'decision|6||태그 칸이 빈 새 형식' 'done|4|가-나|@로 시작하는 문장' 'done|3|bad tag!|공백 든 태그' 'done|3|abcdefghijklmnop|태그 13자 이상' 'done|2|옛 세 칸 형식' > "$T/st/j.txt"
out=$(AJ "$T/st/j.txt"); DAYFILE=$MEM/journal/$TODAY.md
check "태그 있는 줄은 '@태그 문장'" sh -c 'grep -qx -- "- \[남은 일\] (8) @maru 태그 있는 새 형식" "$1"' _ "$DAYFILE"
check "태그 칸이 비면 태그 없이" sh -c 'grep -qx -- "- \[한 일\] (5) 태그 없는 형식" "$1" && grep -qx -- "- \[결정\] (6) 태그 칸이 빈 새 형식" "$1"' _ "$DAYFILE"
check "본문 앞 @ 는 제거됨" sh -c 'grep -qx -- "- \[한 일\] (4) @가-나 로 시작하는 문장" "$1"' _ "$DAYFILE"
check "잘못된 태그·3칸 옛 형식은 줄을 버림(본문에 접히지 않음)" sh -c '! grep -q "bad tag\|태그 13자\|옛 세 칸" "$1"' _ "$DAYFILE"
SCX() { printf '{"session_id":"x","hook_event_name":"SessionStart","cwd":"%s"}' /Users/someone/other | run_env -- bash "$REPO/scripts/session-context.sh"; }
out=$(SCX)
check "session-context 가 태그 형식·옛 형식 둘 다 출력" sh -c 'printf "%s" "$1" | grep -qx -- "- \[남은 일\] (8) @maru 태그 있는 새 형식" && printf "%s" "$1" | grep -qx -- "- \[한 일\] (5) 태그 없는 형식"' _ "$out"
check "읽을 때도 본문 앞 @ 제거" sh -c '! printf "%s" "$1" | grep -q "^- \[.*\] ([0-9]*) @@"' _ "$out"
# 손으로 심은 날짜 파일: 옛 형식 줄과 잘못된 태그 줄
printf '# %s 일지\n\n## 10:00 p (abcd9999)\n- [한 일] (5) 옛 날짜 파일 줄\n- [한 일] (5) @bad!tag 잘못된 태그\n- [결정] (7) @@이중\n' "$TODAY" > "$DAYFILE"
out=$(SCX)
check "옛 날짜 파일 줄 유지" has "$out" "- [한 일] (5) 옛 날짜 파일 줄"
check "형식이 틀린 태그는 문장으로 취급되어 @ 가 벗겨짐" has "$out" "- [한 일] (5) bad!tag 잘못된 태그"
check "이중 @ 도 벗겨짐" has "$out" "- [결정] (7) 이중"
rm -rf "$MEM/journal"

echo "== 태그 기억·그룹 색인 검증"
M2=$T/mem2; mkdir -p "$M2/journal/archive"
printf '%s\n' '---' 'name: tagged' 'description: 태그 시험' 'metadata:' '  type: project' '  tags: [maru, 일지]' '---' '본문' > "$M2/tagged.md"
printf '%s\n' '---' 'name: plain' 'description: 태그 없음' 'metadata:' '  type: user' '---' '본문' > "$M2/plain.md"
printf '%s\n' '## maru' '- [태그된](tagged.md) — 훅' '' '## life' '- [일반](plain.md) — 훅' > "$M2/MEMORY.md"
echo x > "$M2/journal/archive/2000-01-01.md"
out=$(LIBRUN 'mem_validate "$1" 2; echo "rc=$?"' "$M2"); check "태그 달린 기억 + 그룹 색인이 mem_validate 통과" [ "$out" = "rc=0" ]
printf '%s\n' '## maru' '- [태그된](tagged.md) — 훅' > "$M2/MEMORY.md"
out=$(LIBRUN 'mem_validate "$1" 2; echo "rc=$?"' "$M2"); check "그룹 색인에서 빠진 기억은 여전히 거부" has "$out" "MEMORY.md에 없음: plain.md"
printf '%s\n' '## maru' '- [태그된](tagged.md) — 훅' '' '## life' '- [일반](plain.md) — 훅' > "$M2/MEMORY.md"
SCM() { printf '{"session_id":"x","hook_event_name":"SessionStart","cwd":"/Users/someone/other"}' | run_env MEM="$M2" -- bash "$REPO/scripts/session-context.sh"; }
rm -rf "$MEM/journal"; cp "$M2/MEMORY.md" "$MEM/MEMORY.md.grp"; mv "$MEM/MEMORY.md" "$T/MEMORY.keep"; mv "$MEM/MEMORY.md.grp" "$MEM/MEMORY.md"
out=$(SCX)
check "session-context 색인 필터가 ## 제목과 - 포인터를 둘 다 통과" sh -c 'printf "%s\n" "$1" | grep -qx "## maru" && printf "%s\n" "$1" | grep -q "^- \[태그된\](tagged.md)" && printf "%s\n" "$1" | grep -qx "## life"' _ "$out"
mv "$T/MEMORY.keep" "$MEM/MEMORY.md"

echo "== archive_journal"
mkdir -p "$MEM/journal"; chmod 700 "$MEM/journal"
D15=$(day_ago 15); D14=$(day_ago 14); D13=$(day_ago 13); D20=$(day_ago 20)
for d in $D15 $D14 $D13; do printf '# %s 일지\n' "$d" > "$MEM/journal/$d.md"; done
echo secret > "$T/outside.md"; ln -s "$T/outside.md" "$MEM/journal/$D20.md"
printf 'x\n' > "$MEM/journal/notes.md"
out=$(LIBRUN 'archive_journal; echo "rc=$?"')
check "15일 지난 파일은 archive/ 로 이동" [ -f "$MEM/journal/archive/$D15.md" ] && [ ! -e "$MEM/journal/$D15.md" ]
check "14일·13일 된 파일은 그대로" [ -f "$MEM/journal/$D14.md" ] && [ -f "$MEM/journal/$D13.md" ]
check "심볼릭 링크는 옮기지 않고 링크 대상도 그대로" sh -c '[ -L "$1/$2.md" ] && [ ! -e "$1/archive/$2.md" ] && [ "$(cat "$3")" = secret ]' _ "$MEM/journal" "$D20" "$T/outside.md"
check "날짜 형식이 아닌 파일은 건드리지 않음" [ -f "$MEM/journal/notes.md" ]
check "archive 700·파일 600" sh -c '[ "$(stat -f %Lp "$1/archive")" = 700 ] && [ "$(stat -f %Lp "$1/archive/$2.md")" = 600 ]' _ "$MEM/journal" "$D15"
check "삭제 없음(이동 개수만큼 존재)" [ "$(find "$MEM/journal" -name '*.md' | wc -l | tr -d ' ')" = 5 ]
printf '# %s 일지\n\n## 10:00 p (abcd0001)\n- [한 일] (5) 보관 대상\n' "$D15" > "$MEM/journal/archive/$D15.md"
out=$(SCX); check "archive 안 내용은 컨텍스트에 안 들어감" hasnt "$out" "보관 대상"
# archive 가 링크면 거부
rm -rf "$MEM/journal/archive"; mkdir -p "$T/arch-target"; ln -s "$T/arch-target" "$MEM/journal/archive"
printf '# x\n' > "$MEM/journal/$D15.md"
out=$(LIBRUN 'archive_journal'); check "archive 가 링크면 거부" has "$out" "archive 가 심볼릭 링크"; check "링크 대상에 쓰지 않음" [ -z "$(ls -A "$T/arch-target")" ]
rm -f "$MEM/journal/archive" "$MEM/journal/$D15.md" "$MEM/journal/$D20.md"
out=$(LIBRUN 'archive_journal'; echo "rc=$?"); check "옮길 게 없으면 조용히 rc=0" [ "$out" = "rc=0" ]

echo "== dream.sh: 보관 순서·journal 변조 검사·할 일 반영"
cat > "$T/dreammodel.sh" <<'EOS'
#!/bin/bash
[ -n "${FAKE_TODOS:-}" ] && cp "$FAKE_TODOS" "$FAKE_STAGE/todos.txt"
[ -n "${FAKE_TOUCH_JOURNAL:-}" ] && echo x >> "$FAKE_MEM/journal/$FAKE_TOUCH_JOURNAL"
echo "${FAKE_OUT:-변경 없음}"
exit "${FAKE_RC:-0}"
EOS
chmod +x "$T/dreammodel.sh"
DREAMENV=(DREAM_FAKE_MODEL="$T/dreammodel.sh" DREAM_ALLOW_FAKE=yes-i-am-testing FAKE_STAGE="$DATA/stage" FAKE_MEM="$MEM")
dream_run() { run_env "${DREAMENV[@]}" "$@" -- bash "$REPO/scripts/dream.sh"; }
rm -rf "$MEM/journal"; mkdir -p "$MEM/journal"; chmod 700 "$MEM/journal"
for d in $D15 $D13; do printf '# %s 일지\n' "$d" > "$MEM/journal/$d.md"; done
rm -f "$DATA/state/dream.marker"
printf 'maru|7|새벽 할 일|이어서 해줘\n' > "$T/st/dt.txt"
out=$(dream_run FAKE_TODOS="$T/st/dt.txt"); rc=$?
check "dream 성공(0)" [ "$rc" -eq 0 ]
check "모델은 journal 을 안 건드렸으니 보관은 변조로 안 잡힘(되돌림 없음)" sh -c '! grep -q "되돌림" "$1"' _ "$DATA/logs/dream.log"
check "15일 지난 일지는 archive 로, 13일은 그대로" [ -f "$MEM/journal/archive/$D15.md" ] && [ ! -e "$MEM/journal/$D15.md" ] && [ -f "$MEM/journal/$D13.md" ]
check "dream 이 할 일을 반영" [ "$(cat "$TODOS")" = "maru|7|새벽 할 일|이어서 해줘" ]
check "suggestions.txt 도 재생성" [ "$(cat "$SUGS")" = "이어서 해줘" ]
check "hist 커밋에 archive 이동 포함" sh -c '"$1" --git-dir="$2/history.git" log --name-only --format=%s | grep -q "journal/archive/$3.md"' _ "$REAL_GIT" "$DATA" "$D15"
check "보관 뒤 마커가 현재 스냅샷과 같음(다음 실행은 건너뜀)" sh -c 'cd "$1" && cur=$(find . -type f -print0 | xargs -0 md5 -r | sort | md5 -q); [ "$cur" = "$(cat "$2")" ]' _ "$MEM" "$DATA/state/dream.marker"
# 모델이 journal/ 을 건드리면 되돌림이고 보관도 하지 않음
printf '# %s 일지\n' "$D20" > "$MEM/journal/$D20.md"; rm -f "$DATA/state/dream.marker"
out=$(dream_run FAKE_TOUCH_JOURNAL="$D13.md"); rc=$?
check "모델이 일지를 쓰면 되돌림" sh -c 'grep -q "모델이 journal/ 을 건드림" "$1"' _ "$DATA/logs/dream.log"
check "되돌려진 실행은 보관하지 않음" [ -f "$MEM/journal/$D20.md" ]
check "일지 내용은 실행 전 그대로" [ "$(cat "$MEM/journal/$D13.md")" = "# $D13 일지" ]
# 모델이 archive/ 를 건드려도 변조
rm -f "$DATA/state/dream.marker"
out=$(dream_run FAKE_TOUCH_JOURNAL="archive/$D15.md"); check "archive/ 변조도 되돌림" [ "$(cat "$MEM/journal/archive/$D15.md")" = "# $D15 일지" ]

echo "== 위험한 프롬프트 시작(숫자·!·/)"
cat > "$T/st/u1.txt" <<'EOS'
maru|7|느낌표|!rm -rf ~/x
maru|6|슬래시|/install-github-app
maru|5|공백 뒤 슬래시|   /clear
maru|4|숫자|1 입력해줘
maru|3|샵 뒤 슬래시|# /clear
maru|2|정상|이어서 해줘
EOS
out=$(AT "$T/st/u1.txt")
check "위험한 프롬프트는 비우고 항목은 직접 할 일로 유지" [ "$(cat "$TODOS")" = "$(printf '%s\n' 'maru|7|느낌표|' 'maru|6|슬래시|' 'maru|5|공백 뒤 슬래시|' 'maru|4|숫자|' 'maru|3|샵 뒤 슬래시|' 'maru|2|정상|이어서 해줘')" ]
check "suggestions.txt 에는 안전한 프롬프트만" [ "$(cat "$SUGS")" = "이어서 해줘" ]
printf '%s\n' '!rm -rf' '/clear' '7 번 고르기' '정상 추천' '   /x' > "$T/st/us.txt"; LIBRUN 'apply_suggestions "$1"' "$T/st/us.txt" >/dev/null
check "옛 suggestions.txt 도 같은 시작 규칙(위험한 줄 버림)" [ "$(cat "$SUGS")" = "정상 추천" ]
printf 'a|5|제목|!위험\nb|5|제목 둘|이거 해줘\n' > "$TODOS"
out=$(MT); check "maru todo 목록이 프롬프트를 둘째 줄에 보여 줌" sh -c 'printf "%s\n" "$1" | grep -q "^       → 이거 해줘$"' _ "$out"
out=$(MT 2); check "복사한 내용을 그대로 출력" has "$out" "복사한 내용: 이거 해줘"
out=$(MT 1); check "읽을 때도 위험한 프롬프트는 복사하지 않음" has "$out" "직접 해야 하는 일"

echo "== 셸·앱 파서 교차 검증(node)"
NODE=$(command -v node 2>/dev/null || { [ -x "$HOME/.local/bin/node" ] && echo "$HOME/.local/bin/node"; })
if [ -z "$NODE" ] || [ ! -f "$REPO/app/lib.js" ]; then
  echo "  skip node 또는 app/lib.js 없음 — 교차 검증 건너뜀"
else
  "$REAL_PY" - "$T/st/x.txt" <<'PY'
import sys
L = ["a|5|정상 하나|p1",
     "b|6|결합͏그래프͏제목|p2",
     "c|7|한글ᅟ채움ᅠ제목|p3",
     "d|8|몽골᠎구분자|p4",
     "e|4|변형️선택︎자|p5",
     "f|3|보조\U000e0100변형\U000e01ef선택자|p6",
     "g|2|͏᠎️|전부 숨은 문자 제목",
     "h͏|9|태그에 숨은 문자|p",
     "i|10|프롬프트도 지워짐|숨은ᅟ문자ㅤ프롬프트",
     "j|1|제목|" + "가" * 121,
     "k|5|" + "나" * 61 + "|p",
     "l|11|범위 밖|p", "m|0|영|p", "n|5|칸 모자람", "o|5|칸|너무|많음|x"]
open(sys.argv[1], "w", encoding="utf-8").write("\n".join(L) + "\n")
PY
  # 앱이 보는 항목: tag|importance|title (7개 상한 전). 줄이 7개 이하가 되도록 유효 줄만 앞 7개로 비교한다.
  app_items=$("$NODE" -e '
const L = require(process.argv[1]); const t = require("fs").readFileSync(process.argv[2], "utf8");
for (const x of L.parseTodos(t)) console.log([x.tag, x.importance, x.title].join("|"));' "$REPO/app/lib.js" "$T/st/x.txt" | sort)
  AT "$T/st/x.txt" >/dev/null
  sh_items=$(cut -d'|' -f1-3 "$TODOS" | sort)
  check "같은 입력에서 셸(apply_todos)과 앱(parseTodos)이 같은 항목을 받음" [ -n "$app_items" ] && [ "$app_items" = "$sh_items" ]
  check "숨은 문자만 있는 제목은 둘 다 거부" sh -c '! printf "%s" "$1" | grep -q "^g|"' _ "$sh_items"
fi

echo "== 보관 이름 충돌·mem_validate 한도"
mkdir -p "$MEM/journal/archive"; D16=$(day_ago 16)
printf 'old\n' > "$MEM/journal/archive/$D16.md"; printf 'new\n' > "$MEM/journal/$D16.md"
LIBRUN 'archive_journal' >/dev/null
check "이름이 겹치면 숫자 접미사로 옮김(원본 안 남음, 기존 파일 보존)" sh -c '[ ! -e "$1/$2.md" ] && [ "$(cat "$1/archive/$2.md")" = old ] && [ "$(cat "$1/archive/$2.1.md")" = new ]' _ "$MEM/journal" "$D16"
printf 'new2\n' > "$MEM/journal/$D16.md"; LIBRUN 'archive_journal' >/dev/null
check "두 번째 충돌은 .2" [ "$(cat "$MEM/journal/archive/$D16.2.md" 2>/dev/null)" = new2 ]
M3=$T/mem3; mkdir -p "$M3"
printf '%s\n' '---' 'name: a' 'description: x' 'metadata:' '  type: user' '---' 'b' > "$M3/a.md"
{ echo '- [a](a.md) — x'; for i in $(seq 1 200); do echo "- 메모 $i"; done; } > "$M3/MEMORY.md"
out=$(LIBRUN 'mem_validate "$1" 1; echo "rc=$?"' "$M3"); check "MEMORY.md 200줄 초과 거부" sh -c 'printf "%s" "$1" | grep -q "200줄 초과" && printf "%s" "$1" | grep -q rc=1' _ "$out"
{ echo '- [a](a.md) — x'; for i in $(seq 1 100); do echo "- $(printf '가%.0s' $(seq 1 100))"; done; } > "$M3/MEMORY.md"
out=$(LIBRUN 'mem_validate "$1" 1; echo "rc=$?"' "$M3"); check "MEMORY.md 25KB 초과 거부" has "$out" "25KB 초과"
{ echo '- [a](a.md) — x'; for i in $(seq 1 199); do echo "- 메모 $i"; done; } > "$M3/MEMORY.md"
out=$(LIBRUN 'mem_validate "$1" 1; echo "rc=$?"' "$M3"); check "200줄 이하는 통과" [ "$out" = "rc=0" ]
check "consolidate 프롬프트: 승격 3개 상한·결정만 되풀이·출처 날짜·승격 보고" sh -c 'grep -q "최대 3개" "$1" && grep -q "되풀이해 나온 \`\[결정\]\`" "$1" && grep -q "source: journal" "$1" && grep -q "승격: 파일1.md" "$1"' _ "$REPO/prompts/consolidate-prompt.md"
check "reflect 프롬프트: 4칸 고정·## 태그 아래 포인터" sh -c 'grep -q "<kind>|<중요도>||<문장>" "$1" && grep -q "제목 아래에 둔다" "$1"' _ "$REPO/prompts/reflect-prompt.md"

echo "== 가드"
check "실제 data/ 에 쓰지 않음" [ -z "$(find "$REPO/data" -newer "$T/good/python3" 2>/dev/null | head -1)" ]
echo
if [ "$FAIL" = 0 ]; then echo "test-todos: OK ($N 항목)"; exit 0; else echo "test-todos: $FAIL/$N 실패"; exit 1; fi
