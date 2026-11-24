#!/bin/bash
# 하루 회고(diary) 시험: diary_days_text 날짜 선택, apply_diary 검증·설치, dream.sh 연동(변조 되돌림·hist 커밋), 프롬프트 자리표시자. 0=통과 1=실패.
# 실제 홈·기억 폴더·data/·~/.claude 는 건드리지 않는다: HOME/MARU_*/PROJECTS 를 mktemp 폴더로 강제하고 임시 경로가 아니면 종료한다.
# 진짜 claude 는 부르지 않는다(DREAM_FAKE_MODEL + DREAM_ALLOW_FAKE 시험 훅).
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
checkall() { local name=$1 a okk=1; shift; local cur=(); for a in "$@" "&&"; do if [ "$a" = "&&" ]; then if [ ${#cur[@]} -gt 0 ]; then "${cur[@]}" || okk=0; fi; cur=(); else cur+=("$a"); fi; done; if [ $okk = 1 ]; then ok "$name"; else bad "$name"; fi; }

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
mkdir -p "$T/st"
for f in lib.sh dream.sh test-diary.sh; do check "bash -n $f" bash -n "$REPO/scripts/$f"; done

item() { printf '%s\n' "# $1 일지" '' '## 10:00 시험(abcd1234)' '- [한 일] (5) @maru 시험용 일을 했다' '- [결정] (8) @maru 방식 A 를 택했다'; }
D1=$(day_ago 1); D2=$(day_ago 2); D3=$(day_ago 3); D4=$(day_ago 4); D5=$(day_ago 5); D6=$(day_ago 6); D8=$(day_ago 8)

echo "== 날짜 선택(diary_days_text)"
rm -rf "$MEM/journal" "$MEM/diary"; mkdir -p "$MEM/journal" "$MEM/diary"
for d in $TODAY $D1 $D2 $D3 $D4 $D8; do item "$d" > "$MEM/journal/$d.md"; done
printf '# %s 일지\n\n## 10:00 시험(abcd1234)\n- 항목 형식이 아닌 줄\n' "$D5" > "$MEM/journal/$D5.md"
ln -s "$MEM/journal/$D3.md" "$MEM/journal/$D6.md"
printf '# 기존\n\n본문\n' > "$MEM/diary/$D4.md"
out=$(LIBRUN 'diary_days_text'); check "최신순 최대 2개(어제, 그제)" [ "$out" = "$(printf '%s\n%s' "$D1" "$D2")" ]
check "오늘은 제외" hasnt "$out" "$TODAY"
rm -f "$MEM/journal/$D1.md" "$MEM/journal/$D2.md"
out=$(LIBRUN 'diary_days_text'); check "이미 diary 가 있는 날·항목 줄 없는 날·8일 전·심볼릭 링크 파일 제외 → 3일 전만" [ "$out" = "$D3" ]
rm -f "$MEM/journal/$D3.md"; out=$(LIBRUN 'diary_days_text'); check "남은 후보가 없으면 빈 출력" [ -z "$out" ]
rm -rf "$MEM/journal"; ln -s "$T/st" "$MEM/journal"; out=$(LIBRUN 'diary_days_text'); check "journal 이 링크면 빈 출력" [ -z "$out" ]
rm -f "$MEM/journal"

echo "== apply_diary: 받는 경우"
rm -rf "$MEM/diary" "$T/s1"; mkdir -p "$T/s1"
BODY1='오전에는 시험용 일을 했다. 방식 A 를 택하기로 결정했다. 남은 일은 다음에 이어 간다.'
printf '시험용 하루\n\n%s\n' "$BODY1" > "$T/s1/$D1.txt"
out=$(LIBRUN 'apply_diary "$1" "$2"; echo "rc=$?"' "$T/s1" "$D1"); check "설치 성공(rc=0, 로그에 ok)" sh -c 'printf "%s" "$1" | grep -q "ok 설치" && printf "%s" "$1" | grep -q rc=0' _ "$out"
check "정확한 파일 형식" [ "$(cat "$MEM/diary/$D1.md"; echo .)" = "$(printf '# 시험용 하루\n\n%s\n.' "$BODY1")" ]
check "파일 모드 600·폴더 700" sh -c '[ "$(stat -f %Lp "$1/diary/$2.md")" = 600 ] && [ "$(stat -f %Lp "$1/diary")" = 700 ]' _ "$MEM" "$D1"
check "임시 파일이 남지 않음" [ "$(ls -A "$MEM/diary" | wc -l | tr -d ' ')" = 1 ]
rm -rf "$MEM/diary"; printf '제목\n\n첫째 문단은 여기에 있다 충분히 길게.\n둘째 줄도 같은 문단이다.\n\n\n\n둘째 문단이다 이것도 길게.\n' > "$T/s1/$D1.txt"
LIBRUN 'apply_diary "$1" "$2"' "$T/s1" "$D1" >/dev/null
check "문단 사이는 빈 줄 하나, 같은 문단 줄은 공백으로 합침" [ "$(cat "$MEM/diary/$D1.md"; echo .)" = "$(printf '# 제목\n\n첫째 문단은 여기에 있다 충분히 길게. 둘째 줄도 같은 문단이다.\n\n둘째 문단이다 이것도 길게.\n.')" ]

echo "== apply_diary: 무해화"
rm -rf "$MEM/diary"; printf '## `제목` <b>굵게</b> @x\n\n# `코드` 와 <script>alert</script> 그리고 [링크](x) 가 있는 본문 문장이다.\n' > "$T/s1/$D1.txt"
LIBRUN 'apply_diary "$1" "$2"' "$T/s1" "$D1" >/dev/null
c=$(cat "$MEM/diary/$D1.md")
checkall "백틱 제거·꺾쇠 치환·대괄호 치환·앞쪽 # @ 제거" has "$c" '# 제목 ‹b›굵게‹/b› @x' '&&' has "$c" '코드 와 ‹script›alert‹/script› 그리고 (링크)(x) 가 있는' '&&' hasnt "$c" '`' '&&' hasnt "$c" '<' '&&' hasnt "$c" '>' '&&' hasnt "$c" '[' '&&' hasnt "$c" '## '
printf '제목\n\n본문\x01에 제어\x07문자와 탭\t이 섞여 있어도 충분히 긴 문장이다.\n' > "$T/s1/$D1.txt"; rm -rf "$MEM/diary"
LIBRUN 'apply_diary "$1" "$2"' "$T/s1" "$D1" >/dev/null
check "제어 문자 제거" sh -c 'grep -q "본문에 제어문자와 탭 이 섞여" "$1"' _ "$MEM/diary/$D1.md"
rm -rf "$MEM/diary"; "$REAL_PY" -c 'print("가"*100+"\n\n"+"abcde."*400)' > "$T/s1/$D1.txt"
LIBRUN 'apply_diary "$1" "$2"' "$T/s1" "$D1" >/dev/null
t=$(sed -n 1p "$MEM/diary/$D1.md"); b=$(sed -n 3p "$MEM/diary/$D1.md")
check "제목 60자·본문 1500자로 자름" [ "$(clen "$t")" = 62 ] && [ "$(clen "$b")" = 1500 ]

echo "== apply_diary: 거부"
rej() { # <이름> <기대 로그 문구> — 현재 $T/s1 로 실행해 diary 파일이 안 생기고 로그에 문구가 있는지
  local name=$1 want=$2 o; rm -rf "$MEM/diary"
  o=$(LIBRUN 'apply_diary "$1" "$2"; echo "rc=$?"' "$T/s1" "$D1"$'\n'"$D2")
  checkall "$name" has "$o" "$want" '&&' has "$o" 'rc=0' '&&' test ! -e "$MEM/diary/$D1.md"
}
rm -rf "$T/s1"; mkdir -p "$T/s1"
printf '제목\n\n%s\n' "$BODY1" > "$T/s1/$D3.txt"; rej "맡기지 않은 날짜" "이번에 맡기지 않은 날짜"; check "그 날짜 파일도 안 생김" test ! -e "$MEM/diary/$D3.md"
rm -f "$T/s1/$D3.txt"; printf '제목\n\n%s\n' "$BODY1" > "$T/real.txt"; ln -s "$T/real.txt" "$T/s1/$D1.txt"; rej "심볼릭 링크 stage 파일" "일반 파일 아님"
rm -f "$T/s1/$D1.txt"; "$REAL_PY" -c 'print("제목\n\n"+"가나다라 "*1100)' > "$T/s1/$D1.txt"; rej "4KB 초과" "크기 초과"
printf '\n\n   \n' > "$T/s1/$D1.txt"; rej "제목 없음" "제목 없음"
printf '# \n\n%s\n' "$BODY1" > "$T/s1/$D1.txt"; rej "# 뿐인 첫 줄은 거부(본문 첫 줄을 제목으로 올리지 않음)" "첫 줄이 # 뿐"
printf '\n  ### \n%s\n\n%s\n' "$BODY1" "$BODY1" > "$T/s1/$D1.txt"; rej "앞 빈 줄 뒤 # 와 공백뿐인 첫 줄도 거부" "첫 줄이 # 뿐"
printf '제목\n\n짧다\n' > "$T/s1/$D1.txt"; rej "본문 20자 미만" "본문"
printf '제목만 있다\n' > "$T/s1/$D1.txt"; rej "본문 없음" "본문"
printf '제목\n\n키는 sk-abcdefghijklmnopqrstuvwxyz0123 이고 충분히 긴 본문 문장이다.\n' > "$T/s1/$D1.txt"; rej "비밀값처럼 보이는 본문" "비밀값처럼 보임"
printf 'sk-abcdefghijklmnopqrstuvwxyz0123\n\n%s\n' "$BODY1" > "$T/s1/$D1.txt"; rej "비밀값처럼 보이는 제목" "비밀값처럼 보임"
printf '\xff\xfe제목\n\n%s\n' "$BODY1" > "$T/s1/$D1.txt"; rej "UTF-8 아님" "읽기 실패"
printf '제목\n\n%s\n' "$BODY1" > "$T/s1/$D1.md"; rm -f "$T/s1/$D1.txt"; rej "확장자가 .txt 아님" "이름 형식"
rm -f "$T/s1/$D1.md"
# 이미 있는 diary 는 덮어쓰지 않음
printf '제목\n\n%s\n' "$BODY1" > "$T/s1/$D1.txt"; rm -rf "$MEM/diary"; mkdir -p "$MEM/diary"; printf '# 원래\n\n원래 본문\n' > "$MEM/diary/$D1.md"
o=$(LIBRUN 'apply_diary "$1" "$2"' "$T/s1" "$D1"); check "이미 있는 diary 는 덮어쓰지 않음" [ "$(cat "$MEM/diary/$D1.md")" = "$(printf '# 원래\n\n원래 본문')" ] && has "$o" "이미 있음"
# diary 가 링크 / 일반 파일
rm -rf "$MEM/diary" "$T/dtarget"; mkdir -p "$T/dtarget"; ln -s "$T/dtarget" "$MEM/diary"
o=$(LIBRUN 'apply_diary "$1" "$2"; echo "rc=$?"' "$T/s1" "$D1"); checkall "diary 가 링크면 거부하고 대상에 쓰지 않음" has "$o" "링크이거나 폴더가 아님" '&&' has "$o" rc=0 '&&' test -z "$(ls -A "$T/dtarget")"
rm -f "$MEM/diary"; echo x > "$MEM/diary"
o=$(LIBRUN 'apply_diary "$1" "$2"; echo "rc=$?"' "$T/s1" "$D1"); checkall "diary 가 일반 파일이면 거부" has "$o" "링크이거나 폴더가 아님" '&&' has "$o" rc=0 '&&' test "$(cat "$MEM/diary")" = x
rm -f "$MEM/diary"
# stage diary 가 링크
rm -rf "$T/s2"; mkdir -p "$T/s2real"; printf '제목\n\n%s\n' "$BODY1" > "$T/s2real/$D1.txt"; ln -s "$T/s2real" "$T/s2"
o=$(LIBRUN 'apply_diary "$1" "$2"; echo "rc=$?"' "$T/s2" "$D1"); checkall "stage diary 가 링크면 거부" has "$o" "링크이거나 폴더가 아님" '&&' test ! -e "$MEM/diary/$D1.md"
# 맡긴 날짜가 없거나 stage 폴더가 없으면 조용히 0
o=$(LIBRUN 'apply_diary "$1" ""; echo "rc=$?"' "$T/s1"); check "맡긴 날짜가 없으면 아무것도 안 함" [ "$o" = "rc=0" ]
o=$(LIBRUN 'apply_diary "$1" "$2"; echo "rc=$?"' "$T/없음" "$D1"); check "stage 폴더가 없으면 조용히 rc=0" [ "$o" = "rc=0" ]

echo "== dream.sh 연동"
cat > "$T/dreammodel.sh" <<'EOS2'
#!/bin/bash
[ -n "${FAKE_DIARY_SRC:-}" ] && { mkdir -p "$FAKE_STAGE/diary"; cp "$FAKE_DIARY_SRC"/* "$FAKE_STAGE/diary/"; }
[ -n "${FAKE_TOUCH_DIARY:-}" ] && { mkdir -p "$FAKE_MEM/diary"; echo x >> "$FAKE_MEM/diary/$FAKE_TOUCH_DIARY"; }
[ -n "${FAKE_ADD_DIARY:-}" ] && { mkdir -p "$FAKE_MEM/diary/sub"; echo x > "$FAKE_MEM/diary/$FAKE_ADD_DIARY"; echo y > "$FAKE_MEM/diary/sub/z.md"; }
[ -n "${FAKE_DEL_DIARY:-}" ] && rm -f "$FAKE_MEM/diary/$FAKE_DEL_DIARY"
[ -n "${FAKE_TOUCH_OTHER:-}" ] && echo x > "$FAKE_MEM/other-note.txt"
echo "${FAKE_OUT:-변경 없음}"
exit "${FAKE_RC:-0}"
EOS2
chmod +x "$T/dreammodel.sh"
DREAMENV=(DREAM_FAKE_MODEL="$T/dreammodel.sh" DREAM_ALLOW_FAKE=yes-i-am-testing FAKE_STAGE="$DATA/stage" FAKE_MEM="$MEM")
dream_run() { run_env "${DREAMENV[@]}" "$@" -- bash "$REPO/scripts/dream.sh"; }
reset_mem() { rm -rf "$MEM/journal" "$MEM/diary"; mkdir -p "$MEM/journal"; chmod 700 "$MEM/journal"; item "$D1" > "$MEM/journal/$D1.md"; item "$D2" > "$MEM/journal/$D2.md"; rm -f "$DATA/state/dream.marker"; : > "$DATA/logs/dream.log"; }
rm -rf "$T/dsrc"; mkdir -p "$T/dsrc"
printf '어제의 기록\n\n%s\n' "$BODY1" > "$T/dsrc/$D1.txt"
printf '그제의 기록\n\n%s\n' "$BODY1" > "$T/dsrc/$D2.txt"
printf '엉뚱한 날\n\n%s\n' "$BODY1" > "$T/dsrc/$D5.txt"
reset_mem
out=$(dream_run FAKE_DIARY_SRC="$T/dsrc"); rc=$?
check "dream 성공(0)" [ "$rc" -eq 0 ]
check "맡긴 두 날짜가 설치됨" [ -f "$MEM/diary/$D1.md" ] && [ -f "$MEM/diary/$D2.md" ]
check "맡기지 않은 날짜는 설치 안 됨(로그에 거부 사유)" sh -c '[ ! -e "$1/diary/$2.md" ] && grep -q "이번에 맡기지 않은 날짜): $2" "$3"' _ "$MEM" "$D5" "$DATA/logs/dream.log"
check "되돌림 없음" sh -c '! grep -q "되돌림" "$1"' _ "$DATA/logs/dream.log"
check "hist 커밋에 diary 파일 포함" sh -c '"$1" --git-dir="$2/history.git" log --name-only --format=%s | grep -q "diary/$3.md"' _ "$REAL_GIT" "$DATA" "$D1"
check "설치 뒤 마커가 v2 형식(본문 해시, journal/·diary/ 제외)으로 현재 본문과 같음" sh -c 'cd "$1" && cur=$(find . -type f -not -path "./journal/*" -not -path "./diary/*" -print0 | xargs -0 md5 -r | sort | md5 -q); [ "$(cut -d" " -f1,2 "$2")" = "v2 $cur" ]' _ "$MEM" "$DATA/state/dream.marker"
check "stage 는 실행 뒤 지워짐" [ ! -e "$DATA/stage" ]
# 같은 날짜는 두 번 맡기지 않고 덮어쓰지도 않는다
printf '바뀐 제목\n\n%s 다른 내용이다.\n' "$BODY1" > "$T/dsrc/$D1.txt"; rm -f "$DATA/state/dream.marker"
dream_run FAKE_DIARY_SRC="$T/dsrc" >/dev/null
check "이미 있는 diary 는 두 번째 실행에서도 그대로" sh -c 'head -1 "$1" | grep -qx "# 어제의 기록"' _ "$MEM/diary/$D1.md"
# diary 산출물이 없는 실행도 성공
reset_mem
out=$(dream_run); rc=$?
check "diary 출력이 없어도 성공(0)·되돌림 없음·diary 폴더 안 만듦" [ "$rc" -eq 0 ] && [ ! -e "$MEM/diary" ] && ! grep -q "되돌림" "$DATA/logs/dream.log"
# 거부된 diary 도 실행을 실패시키지 않는다
reset_mem; rm -rf "$T/dbad"; mkdir -p "$T/dbad"; printf '제목\n\n짧다\n' > "$T/dbad/$D1.txt"
out=$(dream_run FAKE_DIARY_SRC="$T/dbad"); rc=$?
check "거부된 diary 는 로그만 남기고 실행은 성공" [ "$rc" -eq 0 ] && grep -q "하루 회고: 거부(본문" "$DATA/logs/dream.log" && ! grep -q "되돌림" "$DATA/logs/dream.log" && [ ! -e "$MEM/diary/$D1.md" ]
# 모델이 diary/ 에 직접 쓰면 diary/ 만 복원하고 실행은 계속된다(다른 변경 유지)
reset_mem; mkdir -p "$MEM/diary"; printf '# 원래\n\n원래 본문\n' > "$MEM/diary/$D2.md"
out=$(dream_run FAKE_TOUCH_DIARY="$D1.md" FAKE_TOUCH_OTHER=1 FAKE_DIARY_SRC="$T/dsrc"); rc=$?
check "모델이 diary/ 를 건드리면 diary/ 만 복원(로그)" grep -q "diary/ 만 실행 전 상태로 복원" "$DATA/logs/dream.log"
check "그 실행은 전체 되돌림이 아님" sh -c '! grep -q "되돌림(변경 폐기" "$1"' _ "$DATA/logs/dream.log"
check "모델이 직접 쓴 diary 파일은 사라지고 apply_diary 가 설치한 것만 남음" sh -c 'head -1 "$1/diary/$2.md" | grep -qx "# 바뀐 제목" && ! grep -qx x "$1/diary/$2.md"' _ "$MEM" "$D1"
check "diary 밖의 변경(모델이 쓴 다른 파일)은 유지" [ -f "$MEM/other-note.txt" ]
check "기존 diary 파일은 그대로" [ "$(cat "$MEM/diary/$D2.md")" = "$(printf '# 원래\n\n원래 본문')" ]
# 기존 diary 파일을 모델이 고치거나 지워도 복원, 새 파일은 제거
reset_mem; mkdir -p "$MEM/diary"; printf '# 원래\n\n원래 본문\n' > "$MEM/diary/$D2.md"
dream_run FAKE_TOUCH_DIARY="$D2.md" FAKE_TOUCH_OTHER=1 FAKE_ADD_DIARY="$D4.md" >/dev/null
check "기존 diary 변조는 복원·추가 파일은 제거·다른 변경 유지" [ "$(cat "$MEM/diary/$D2.md")" = "$(printf '# 원래\n\n원래 본문')" ] && [ ! -e "$MEM/diary/$D4.md" ] && [ -f "$MEM/other-note.txt" ] && grep -q "diary/ 만 실행 전 상태로 복원" "$DATA/logs/dream.log"
reset_mem; mkdir -p "$MEM/diary"; printf '# 원래\n\n원래 본문\n' > "$MEM/diary/$D2.md"
dream_run FAKE_DEL_DIARY="$D2.md" >/dev/null
check "모델이 지운 diary 파일도 복원" [ "$(cat "$MEM/diary/$D2.md")" = "$(printf '# 원래\n\n원래 본문')" ]
reset_mem
dream_run FAKE_ADD_DIARY="$D4.md" >/dev/null
check "diary 폴더가 없던 실행에서 모델이 만든 폴더는 정리됨" [ ! -e "$MEM/diary" ]
# 다른 읽는 곳: diary/ 가 기억 파일 수·색인 검증에 영향 없음
reset_mem; mkdir -p "$MEM/diary"; printf '# 가\n\n나다라마바사아자차카타파하 본문이다.\n' > "$MEM/diary/$D4.md"
out=$(LIBRUN 'mem_validate "$1" 1; echo "rc=$?"' "$MEM"); check "mem_validate 가 diary/ 를 기억 파일로 세지 않음" [ "$out" = "rc=0" ]
out=$(LIBRUN 'archive_journal 14; echo "rc=$?"'); check "archive_journal 은 diary/ 를 건드리지 않음" [ "$out" = "rc=0" ] && [ -f "$MEM/diary/$D4.md" ]
out=$(run_env -- bash "$REPO/scripts/session-context.sh" </dev/null); check "session-context 는 diary 내용을 읽지 않음" hasnt "$out" "나다라마바사아자차카타파하"

echo "== 프롬프트"
for f in consolidate-prompt.md consolidate-prompt.en.md; do
  c=$(cat "$REPO/prompts/$f")
  checkall "$f: {{DIARY_DAYS}} 와 stage 경로" has "$c" '{{DIARY_DAYS}}' '&&' has "$c" '{{STAGE_DIR}}/diary/'
done
o=$(LIBRUN 'render_template "$1/prompts/consolidate-prompt.md" MEMORY_DIR=m STAGE_DIR=s DIARY_DAYS="$2" RECENT_MARKS=r OPEN_PROJECTS=o' "$REPO" "$D1"$'\n'"$D2")
check "렌더링된 프롬프트에 날짜가 들어가고 자리표시자가 남지 않음" sh -c 'printf "%s" "$1" | grep -q "^$2$" && ! printf "%s" "$1" | grep -q "{{"' _ "$o" "$D2"

echo "== 가드"
check "시험이 쓰는 데이터 폴더는 모두 임시 폴더 안" sh -c 'case "$1" in "$2"/*) exit 0;; esac; exit 1' _ "$DATA" "$T"
check "추적 파일에 개인 절대 경로가 없음(신규·변경분)" sh -c '! grep -Il "/Us""ers/" "$1/prompts/consolidate-prompt.md" "$1/prompts/consolidate-prompt.en.md" "$1/scripts/test-diary.sh" | grep -q .' _ "$REPO"
echo
if [ "$FAIL" = 0 ]; then echo "test-diary: OK ($N 항목)"; exit 0; else echo "test-diary: $FAIL/$N 실패"; exit 1; fi
