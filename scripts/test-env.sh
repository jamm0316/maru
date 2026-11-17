#!/bin/bash
# 환경 장애(Xcode 라이선스 미동의로 python3/git 가 종료 코드 69 로 실패) 회귀 시험. 0=통과 1=실패.
# 실제 홈·launchd·기억·data/ 는 건드리지 않는다: HOME/MARU_*/PROJECTS 를 mktemp 폴더로 강제하고, 임시 경로가 아니면 즉시 종료한다.
# launchctl 은 부르지 않는다(가짜 명령 주입). PATH 맨 앞의 가짜 launchctl/osascript 가 호출되면 실패로 센다.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd -P)
REAL_HOME=${HOME:-}
T=$(mktemp -d 2>/dev/null) || { echo "mktemp 실패" >&2; exit 1; }
T=$(cd "$T" && pwd -P)
case "$T" in ""|/|"$REAL_HOME"|"$REAL_HOME"/*|"$REPO"|"$REPO"/*) echo "임시 경로가 아님: $T — 종료" >&2; exit 1;; esac
[ -d "$T" ] && [ -w "$T" ] || { echo "임시 폴더 이상 — 종료" >&2; exit 1; }
trap 'case "$T" in /*/*) rm -rf "$T";; esac' EXIT
FAKE_HOME=$T/home
mkdir -p "$FAKE_HOME" "$T/shim" "$T/good" "$T/emptypy" "$T/nodir"
touch "$T/stamp"

FAIL=0; N=0
ok()   { N=$((N+1)); echo "  ok   $*"; }
bad()  { N=$((N+1)); FAIL=$((FAIL+1)); echo "  FAIL $*"; }
check() { local name=$1; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# ---- 실제로 동작하는 python3/git 를 찾는다(폴백 후보 디렉터리에 심을 래퍼용)
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
REAL_PY=$(find_real python3) || REAL_PY=""
REAL_GIT=$(find_real git) || REAL_GIT=""
JQ_DIR=$(dirname "$(command -v jq 2>/dev/null || echo /usr/bin/jq)")

# ---- 셰임: 라이선스 미동의 Xcode 처럼 종료 코드 69 로 실패하는 python3/git
for t in python3 git; do
  printf '%s\n' '#!/bin/sh' "echo \"You have not agreed to the Xcode license agreements. Please run 'sudo xcodebuild -license' from within a Terminal window to review and agree to the Xcode and Apple SDKs license.\" >&2" 'exit 69' > "$T/shim/$t"
  chmod +x "$T/shim/$t"
done
# 호출되면 안 되는 launchctl, 호출 횟수만 세는 osascript(실제 알림을 띄우지 않기 위함)
printf '%s\n' '#!/bin/sh' "echo called >> \"$T/real-launchctl.called\"" 'exit 1' > "$T/shim/launchctl"
printf '%s\n' '#!/bin/sh' "echo called >> \"$T/osascript.called\"" 'exit 0' > "$T/shim/osascript"
chmod +x "$T/shim/launchctl" "$T/shim/osascript"
# 폴백 후보("좋은" 디렉터리): 진짜 도구로 넘기는 래퍼
if [ -n "$REAL_PY" ] && [ -n "$REAL_GIT" ]; then
  printf '%s\n' '#!/bin/sh' "exec \"$REAL_PY\" \"\$@\"" > "$T/good/python3"
  printf '%s\n' '#!/bin/sh' "exec \"$REAL_GIT\" \"\$@\"" > "$T/good/git"
  chmod +x "$T/good/python3" "$T/good/git"
fi
# 종료 코드 0 이지만 출력이 비는 python3(slug 계산이 빈 문자열이 되는 경우)
printf '%s\n' '#!/bin/sh' 'exit 0' > "$T/emptypy/python3"; chmod +x "$T/emptypy/python3"

PROJ=$T/home/.claude/projects
SLUG=$(printf '%s' "$REPO" | sed 's/[^A-Za-z0-9]/-/g')
BASEPATH=$T/shim:/usr/bin:/bin:/usr/sbin:/sbin:$JQ_DIR
# run_env <추가 환경...> -- <명령...> : 격리된 환경에서 실행. 출력은 stdout+stderr 합쳐서 낸다.
run_env() {
  local extra=()
  while [ "$1" != "--" ]; do extra+=("$1"); shift; done; shift
  env -i HOME="$FAKE_HOME" PATH="$BASEPATH" MARU_PATH_PREFIX= MARU_DATA="$T/data" MARU_WORK="$T/work" \
    PROJECTS="$PROJ" TMPDIR="$T" ${extra[@]+"${extra[@]}"} "$@" 2>&1
}

echo "== 가드: 실제 도구/launchd 에 의존하지 않음"
check "셰임 python3 는 종료 코드 69" sh -c '"$1" -c pass >/dev/null 2>&1; [ $? -eq 69 ]' _ "$T/shim/python3"
check "셰임 git 은 종료 코드 69" sh -c '"$1" --version >/dev/null 2>&1; [ $? -eq 69 ]' _ "$T/shim/git"

echo "== (i) 폴백 후보가 있으면 정상 해석"
if [ -z "$REAL_PY" ] || [ -z "$REAL_GIT" ]; then
  echo "  SKIP 이 맥에서 동작하는 python3/git 를 찾지 못해 (i)·sweep 시험 생략"; HAVE_REAL=""
else
  HAVE_REAL=1
  out=$(run_env MARU_TOOL_DIRS="$T/good" -- bash -c '. "$1/scripts/lib.sh"; echo "rc=$? MEM=$MEM PY=$MARU_PY_FALLBACK GIT=$MARU_GIT_FALLBACK FIRST=${PATH%%:*}"' _ "$REPO")
  check "lib.sh 성공" has "$out" "rc=0 "
  check "기억 폴더가 projects/<slug>/memory" has "$out" "MEM=$PROJ/$SLUG/memory "
  check "python3 폴백 기록" has "$out" "PY=$T/good "
  check "git 폴백 기록" has "$out" "GIT=$T/good "
  check "폴백 디렉터리가 PATH 맨 앞" has "$out" "FIRST=$T/good"
  out=$(run_env MARU_TOOL_DIRS="$T/good" -- bash -c '. "$1/scripts/lib.sh"; python3 -c pass && git --version >/dev/null && echo both-ok' _ "$REPO")
  check "해석 후 python3·git 실제 동작" has "$out" "both-ok"
  # 후보 첫 항목이 죽어 있어도 다음 후보로 넘어간다
  out=$(run_env MARU_TOOL_DIRS="$T/nodir:$T/good" -- bash -c '. "$1/scripts/lib.sh"; echo "MEM=$MEM"' _ "$REPO")
  check "죽은 후보는 건너뜀" has "$out" "MEM=$PROJ/$SLUG/memory"
  # 프로젝트 추적 함수도 폴백 python3 로 동작한다(셰임이 PATH 앞에 있어도): 등록 → 열린 목록 → 할 일 슬러그 대조
  printf '%s\n' 'maru|desktop-app|데스크톱 앱' 'maru|Upper|대문자 슬러그' > "$T/proj.stage"
  printf '%s\n' 'maru/desktop-app|7|앱 마무리|이어서 해줘' 'maru/unknown|5|미등록|p' > "$T/todos.stage"
  out=$(run_env MARU_TOOL_DIRS="$T/good" MARU_DATA="$T/pdata" -- bash -c '. "$1/scripts/lib.sh"; log() { :; }; apply_projects "$2"; echo "rc=$?"; cat "$MARU_DATA/projects.txt"; open_projects_text; apply_todos "$3"; cat "$MARU_DATA/todos.txt"' _ "$REPO" "$T/proj.stage" "$T/todos.stage")
  check "폴백 python3 로 apply_projects 가 등록(검증 거부 줄 제외)" has "$out" "rc=0
maru|desktop-app|데스크톱 앱
maru/desktop-app — 데스크톱 앱"
  check "폴백 python3 로 apply_todos 가 등록된 슬러그만 인정" has "$out" "maru/desktop-app|7|앱 마무리|이어서 해줘
maru|5|미등록|p"
  rm -rf "$T/pdata"
fi

echo "== (ii) 후보가 없으면 즉시 실패하고 MEM 이 설정되지 않음"
out=$(run_env MARU_TOOL_DIRS="$T/nodir" -- bash -c '. "$1/scripts/lib.sh"; echo "AFTER-LIB MEM=[${MEM-UNSET}]"' _ "$REPO"); rc=$?
check "종료 코드 69" [ "$rc" -eq 69 ]
check "lib.sh 뒤의 코드는 실행되지 않음" sh -c 'case "$1" in *AFTER-LIB*) exit 1;; esac' _ "$out"
check "라이선스 안내(sudo xcodebuild -license)" has "$out" "sudo xcodebuild -license"
check "원인 문구 포함" has "$out" "You have not agreed to the Xcode license"
out=$(run_env MARU_TOOL_DIRS="$T/nodir" MARU_LIB_SOFT=1 -- bash -c '. "$1/scripts/lib.sh"; echo "rc=$? MEM=[${MEM-UNSET}] SET=[${MEM_SETTINGS-UNSET}]"' _ "$REPO")
check "soft 모드는 return 1" has "$out" "rc=1 "
check "MEM·MEM_SETTINGS 가 설정되지 않음" has "$out" "MEM=[UNSET] SET=[UNSET]"
out=$(run_env MARU_TOOL_DIRS="" -- bash -c '. "$1/scripts/lib.sh"' _ "$REPO"); rc=$?
check "후보 목록이 비어도 즉시 실패" [ "$rc" -eq 69 ]
out=$(run_env MARU_TOOL_DIRS="$T/nodir" -- bash "$REPO/scripts/hist" log); rc=$?
check "hist 도 같은 검증을 거침(69)" [ "$rc" -eq 69 ]
out=$(run_env MARU_TOOL_DIRS="$T/nodir" -- bash "$REPO/scripts/maru-status.sh" --no-auth); rc=$?
check "maru-status.sh 도 같은 검증을 거침(69)" [ "$rc" -eq 69 ]
out=$(run_env MARU_TOOL_DIRS="$T/nodir" -- bash "$REPO/bin/maru" ui); rc=$?
check "maru ui 런처도 같은 검증을 거침(69)" [ "$rc" -eq 69 ]
out=$(run_env MARU_TOOL_DIRS="$T/nodir" -- bash "$REPO/install.sh" --dry-run); rc=$?
check "install.sh 는 요구사항 단계에서 중단" [ "$rc" -eq 1 ]
check "install.sh 는 아무것도 만들지 않음(data·기억 폴더 없음)" sh -c '[ ! -e "$1/data" ] && [ ! -e "$1/home/.claude" ]' _ "$T"
out=$(run_env MARU_TOOL_DIRS="$T/nodir" -- bash "$REPO/uninstall.sh" --dry-run); rc=$?
check "uninstall.sh 도 중단" [ "$rc" -eq 1 ]

echo "== 기억 폴더·slug 검증"
mc() { run_env MARU_LIB_SOFT=1 MARU_TOOL_DIRS="${GOODDIR:-$T/good}" "$@" -- bash -c '. "$1/scripts/lib.sh"; echo "rc=$? MEM=[${MEM-UNSET}]"' _ "$REPO"; }
if [ -n "$HAVE_REAL" ]; then
  for badmem in "relative/memory" "$PROJ//$SLUG/memory" "$PROJ/memory" "$PROJ//memory" "$T/elsewhere/$SLUG/memory" "$PROJ/a/b/memory" "$PROJ/$SLUG/notmemory" "$PROJ/$SLUG/../x/memory"; do
    out=$(mc MEM="$badmem"); check "거부: $(printf '%s' "$badmem" | sed "s#$T#T#g")" has "$out" "rc=1 MEM=[UNSET]"
  done
  out=$(mc MEM="$PROJ/$SLUG/memory"); check "정상 MEM 수용" has "$out" "rc=0 MEM=[$PROJ/$SLUG/memory]"
  out=$(mc PROJECTS="$PROJ/" ); check "PROJECTS 끝 슬래시는 정규화" has "$out" "rc=0 MEM=[$PROJ/$SLUG/memory]"
  out=$(run_env MARU_LIB_SOFT=1 MARU_TOOL_DIRS="$T/good" PROJECTS="" -- bash -c '. "$1/scripts/lib.sh"; echo "rc=$? MEM=[${MEM-UNSET}]"' _ "$REPO")
  check "PROJECTS 가 비면 기본값($HOME/.claude/projects)으로" has "$out" "rc=0 MEM=[$PROJ/$SLUG/memory]"
  # slug 계산이 빈 문자열이 되는 python3(종료 코드 0, 출력 없음)
  printf '%s\n' '#!/bin/sh' "exec \"$REAL_GIT\" \"\$@\"" > "$T/emptypy/git"; chmod +x "$T/emptypy/git"
  out=$(run_env MARU_LIB_SOFT=1 MARU_TOOL_DIRS="$T/emptypy" -- bash -c '. "$1/scripts/lib.sh"; echo "rc=$? MEM=[${MEM-UNSET}] ERR=${MARU_ENV_ERR}"' _ "$REPO")
  check "slug 가 비면 실패하고 MEM 없음(…/projects//memory 방지)" has "$out" "rc=1 MEM=[UNSET]"
  check "slug 실패 원인 메시지" has "$out" "slug 계산 실패"
fi

echo "== reflect/dream: 환경 실패는 재시도 대상이고 알림에 센다"
mkdir -p "$PROJ/-fake-proj" "$T/data/state"
SID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
printf '{}\n{}\n' > "$PROJ/-fake-proj/$SID.jsonl"
touch -t 202001010000 "$PROJ/-fake-proj/$SID.jsonl"
rm -f "$T/osascript.called"
out=$(run_env MARU_TOOL_DIRS="$T/nodir" -- bash "$REPO/scripts/reflect.sh" --run "$PROJ/-fake-proj/$SID.jsonl" "$SID"); rc=$?
check "reflect --run 은 11(실패, 재시도)" [ "$rc" -eq 11 ]
check "reflect 로그에 환경 오류" sh -c 'grep -q "환경 오류" "$1"' _ "$T/data/logs/reflect.log"
check "reflect 는 진행 기록(.lines)을 남기지 않음" [ ! -e "$T/data/state/$SID.lines" ]
check "reflect 환경 실패가 fail 카운트에 셈" [ "$(cat "$T/data/state/fail.reflect" 2>/dev/null)" = 1 ]
check "첫 환경 실패에서 알림 1회" [ "$(wc -l < "$T/osascript.called" 2>/dev/null | tr -d ' ')" = 1 ]
out=$(printf '{"session_id":"%s","transcript_path":"%s"}' "$SID" "$PROJ/-fake-proj/$SID.jsonl" | run_env MARU_TOOL_DIRS="$T/nodir" -- bash "$REPO/scripts/reflect.sh"); rc=$?
check "reflect 훅 모드는 환경 실패에도 0 으로 종료" [ "$rc" -eq 0 ]
check "같은 연속 실패에서 알림은 다시 안 울림" [ "$(wc -l < "$T/osascript.called" 2>/dev/null | tr -d ' ')" = 1 ]
rm -f "$T/osascript.called" "$T/data/state/fail.reflect" "$T/data/state/fail.reflect.notified"
out=$(run_env MARU_TOOL_DIRS="$T/nodir" -- bash "$REPO/scripts/dream.sh"); rc=$?
check "dream 은 환경 실패로 1 종료" [ "$rc" -eq 1 ]
check "dream 로그에 환경 오류" sh -c 'grep -q "환경 오류" "$1"' _ "$T/data/logs/dream.log"
check "dream 은 어떤 세션도 .swept 로 표시하지 않음" [ -z "$(ls "$T/data/state" 2>/dev/null | grep '\.swept$')" ]
check "dream 환경 실패가 fail 카운트에 셈" [ "$(cat "$T/data/state/fail.dream" 2>/dev/null)" = 1 ]
check "dream 환경 실패 알림" [ -s "$T/osascript.called" ]

echo "== dream: MARU_SWEEP_HOURS"
if [ -n "$HAVE_REAL" ]; then
  mkdir -p "$PROJ/$SLUG/memory"
  printf '%s\n' '#!/bin/sh' 'exit 1' > "$T/fakemodel.sh"; chmod +x "$T/fakemodel.sh"
  for v in abc 0 -5 721 99999 1.5 ""; do
    [ -z "$v" ] && continue
    out=$(run_env MARU_TOOL_DIRS="$T/good" MARU_SWEEP_HOURS="$v" -- bash "$REPO/scripts/dream.sh"); rc=$?
    check "MARU_SWEEP_HOURS='$v' 거부(2)" [ "$rc" -eq 2 ]
  done
  out=$(run_env MARU_TOOL_DIRS="$T/good" MARU_SWEEP_HOURS=096 DREAM_FAKE_MODEL="$T/fakemodel.sh" DREAM_ALLOW_FAKE=yes-i-am-testing -- bash "$REPO/scripts/dream.sh"); rc=$?
  check "096 은 96 으로 수용(시간 창 로그)" sh -c 'grep -q "시간 창 96시간" "$1"' _ "$T/data/logs/dream.log"
  out=$(run_env MARU_TOOL_DIRS="$T/good" DREAM_FAKE_MODEL="$T/fakemodel.sh" DREAM_ALLOW_FAKE=yes-i-am-testing -- bash "$REPO/scripts/dream.sh"); rc=$?
  check "기본값은 36시간" sh -c 'tail -n 20 "$1" | grep -q "시간 창 36시간"' _ "$T/data/logs/dream.log"
fi

echo "== (iii) plist 렌더가 비면 기존 파일·launchd 작업 보존"
# shellcheck disable=SC1091
. "$REPO/scripts/launchd.sh"
MARU_LAUNCHCTL=$T/fakectl; MARU_BOOTSTRAP_WAIT=0
printf '%s\n' '#!/bin/sh' "echo \"\$*\" >> \"$T/ctl.log\"" \
  'case "$1" in print) exit 1;; bootstrap) [ -f "'"$T"'/ctl.failboot" ] && exit 1;; esac' 'exit 0' > "$T/fakectl"
chmod +x "$T/fakectl"
LA=$T/home/Library/LaunchAgents; mkdir -p "$LA"
PL=$LA/com.maru.test.plist
GOODPLIST='<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>com.maru.test</string></dict></plist>'
render_empty() { :; }
render_fail() { echo partial; return 1; }
render_garbage() { echo "not a plist"; }
render_placeholder() { printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<plist version="1.0"><dict><key>X</key><string>{{HOME}}</string></dict></plist>'; }
render_good() { printf '%s\n' "$GOODPLIST"; }
printf 'ORIGINAL\n' > "$PL"; : > "$T/ctl.log"
for fn in render_empty render_fail render_garbage render_placeholder; do
  MARU_PLIST_RENDER=$fn install_launchd com.maru.test /nonexistent "$PL" "" "$T/bk" >/dev/null 2>&1; rc=$?
  check "$fn: 실패 반환" [ "$rc" -ne 0 ]
  check "$fn: 기존 plist 보존" [ "$(cat "$PL")" = ORIGINAL ]
  check "$fn: launchctl 호출 없음(bootout 포함)" sh -c '! grep -q "bootout\|bootstrap" "$1"' _ "$T/ctl.log"
  check "$fn: 임시·잔여 파일 없음" [ "$(ls "$LA" | wc -l | tr -d ' ')" = 1 ]
done
# plist 가 아예 없을 때도 빈 파일을 만들지 않는다
rm -f "$PL"
MARU_PLIST_RENDER=render_empty install_launchd com.maru.test /nonexistent "$PL" "" "$T/bk" >/dev/null 2>&1
check "기존 plist 가 없을 때도 파일을 만들지 않음" [ ! -e "$PL" ]
# 정상 렌더: 검증 뒤에 bootout → 교체 → bootstrap 순서
printf 'ORIGINAL\n' > "$PL"; : > "$T/ctl.log"
MARU_PLIST_RENDER=render_good install_launchd com.maru.test /nonexistent "$PL" "" "$T/bk" >/dev/null 2>&1; rc=$?
check "정상 렌더는 성공" [ "$rc" -eq 0 ]
check "plist 교체됨·lint 통과" sh -c 'plutil -lint "$1" >/dev/null && grep -q com.maru.test "$1"' _ "$PL"
check "bootout 다음에 bootstrap" sh -c 'grep -n "bootout\|bootstrap" "$1" | head -2 | tr "\n" " " | grep -q "bootout.*bootstrap"' _ "$T/ctl.log"
check "교체 전 백업 생성" [ "$(ls "$T/bk" 2>/dev/null | wc -l | tr -d ' ')" = 1 ]
# bootstrap 이 계속 실패하면 이전 plist 로 되돌린다
printf 'ORIGINAL\n' > "$PL"; : > "$T/ctl.log"; touch "$T/ctl.failboot"
MARU_PLIST_RENDER=render_good install_launchd com.maru.test /nonexistent "$PL" "" "" >/dev/null 2>&1; rc=$?
check "bootstrap 실패는 실패 반환" [ "$rc" -ne 0 ]
check "이전 plist 로 복원" [ "$(cat "$PL")" = ORIGINAL ]
rm -f "$T/ctl.failboot"
# dry-run 은 렌더·검증만 하고 아무것도 바꾸지 않음
printf 'ORIGINAL\n' > "$PL"; : > "$T/ctl.log"
MARU_PLIST_RENDER=render_good install_launchd com.maru.test /nonexistent "$PL" 1 "" >/dev/null 2>&1
check "dry-run 은 plist 유지·bootout 없음" sh -c '[ "$(cat "$1")" = ORIGINAL ] && ! grep -q "bootout\|bootstrap" "$2"' _ "$PL" "$T/ctl.log"
if [ -n "$HAVE_REAL" ]; then
  # 실제 템플릿도 기본 렌더 함수로 검증을 통과한다(PATH 에 폴백 적용)
  out=$(run_env MARU_TOOL_DIRS="$T/good" MARU_HOME="$REPO" -- bash -c '. "$1/scripts/lib.sh"; . "$1/scripts/launchd.sh"; plist_preflight "$1/launchd/com.maru.dream.plist.template" && echo preflight-ok' _ "$REPO")
  check "dream 템플릿 사전 검증 통과" has "$out" "preflight-ok"
fi

echo "== (iv) agent-state.sh: 상태 JSON·서브에이전트 파일(복사본으로 임시 data/ 에만 쓴다)"
AS=$T/asrepo; mkdir -p "$AS/scripts"; cp "$REPO/scripts/agent-state.sh" "$AS/scripts/"; chmod +x "$AS/scripts/agent-state.sh"
SID=abcd1234-aaaa-bbbb; SD=$AS/data/state/app
as_run() { local json=$1; shift; printf '%s' "$json" | env -i HOME="$FAKE_HOME" PATH="$BASEPATH" MARU_TOOL_DIRS="${ASDIRS-$T/good}" ${ASENV[@]+"${ASENV[@]}"} "$AS/scripts/agent-state.sh" "$@" >/dev/null 2>&1; echo $?; }
ASENV=(MARU_APP_SESSION=$SID)
check "세션 없으면 아무것도 안 함(exit 0)" sh -c '[ "$(printf "{}" | env -i PATH="$1" "$2" busy >/dev/null 2>&1; echo $?)" = 0 ] && [ ! -e "$3/data" ]' _ "$BASEPATH" "$AS/scripts/agent-state.sh" "$AS"
if [ -n "$HAVE_REAL" ]; then
  rc=$(as_run '{"transcript_path":"/h/.claude/projects/x/s.jsonl","model":{"id":"claude-opus-4-1"},"prompt":"비밀 내용"}' busy)
  check "busy: exit 0" [ "$rc" = 0 ]
  st=$(cat "$SD/$SID.json" 2>/dev/null)
  check "busy: transcript_path·model 기록, 다른 내용은 저장 안 함" sh -c 'echo "$1" | grep -q "\"transcript_path\":\"/h/.claude/projects/x/s.jsonl\"" && echo "$1" | grep -q "\"model\":\"claude-opus-4-1\"" && ! echo "$1" | grep -q "비밀"' _ "$st"
  check "상태 JSON 이 유효" "$REAL_PY" -c 'import json,sys;o=json.loads(sys.argv[1]);assert o["state"]=="busy" and "at" in o' "$st"
  as_run '{"transcript_path":"rel/s.jsonl","model":"bad model"}' idle >/dev/null
  st=$(cat "$SD/$SID.json")
  check "검증 실패 값은 생략(상태만)" sh -c 'echo "$1" | grep -q "\"state\":\"idle\"" && ! echo "$1" | grep -q "transcript_path\|model"' _ "$st"
  as_run '{"transcript_path":"/a/\"q\\b.jsonl"}' waiting >/dev/null
  check "따옴표·역슬래시가 있는 경로도 유효한 JSON" "$REAL_PY" -c 'import json,sys;json.loads(open(sys.argv[1]).read())' "$SD/$SID.json"
  # 서브에이전트
  as_run '{"agent_id":"a1b2","agent_type":"worker","extra":"x"}' sub-start >/dev/null
  check "sub-start: 파일 생성(내용은 종류 한 줄)" [ "$(cat "$SD/$SID.subs/a1b2" 2>/dev/null)" = worker ]
  as_run '{"agent_id":"c3","subagent_type":"general-purpose"}' sub-start >/dev/null
  check "sub-start: subagent_type 도 읽음" [ "$(cat "$SD/$SID.subs/c3" 2>/dev/null)" = general-purpose ]
  as_run '{"agent_id":"../evil","agent_type":"worker"}' sub-start >/dev/null
  as_run '{"agent_id":"ok1","agent_type":"bad type!"}' sub-start >/dev/null
  as_run '{"agent_id":"'"$(printf 'a%.0s' $(seq 65))"'","agent_type":"worker"}' sub-start >/dev/null
  check "형식이 틀린 id·type 은 만들지 않음" [ "$(ls "$SD/$SID.subs" | tr '\n' ' ')" = "a1b2 c3 " ]
  as_run '{"agent_id":"a1b2"}' sub-stop >/dev/null
  check "sub-stop: 해당 파일만 지움" [ ! -e "$SD/$SID.subs/a1b2" ] && [ -e "$SD/$SID.subs/c3" ]
  check "임시 파일 잔여 없음" [ -z "$(ls -A "$SD/$SID.subs" | grep '^\.')" ]
  # 정규 파일이 아닌 것이 이미 있으면 건드리지 않는다
  mkdir -p "$T/target"; echo keep > "$T/target/f"; ln -s "$T/target/f" "$SD/$SID.subs/lnk1"
  as_run '{"agent_id":"lnk1","agent_type":"worker"}' sub-start >/dev/null
  check "sub-start: 링크가 있는 자리는 덮지 않음" [ -L "$SD/$SID.subs/lnk1" ] && [ "$(cat "$T/target/f")" = keep ]
  rm -f "$SD/$SID.subs/lnk1"
  # Stop(idle) 은 이 세션의 .subs 안 정규 파일을 비운다
  as_run '{}' idle >/dev/null
  check "idle: .subs 안 파일을 비움(폴더·상태 JSON 은 유지)" [ -z "$(ls -A "$SD/$SID.subs")" ] && [ -f "$SD/$SID.json" ]
  as_run '{"agent_id":"d4","agent_type":"worker"}' sub-start >/dev/null
  ln -s "$T/target/f" "$SD/$SID.subs/lnk2"; as_run '{}' idle >/dev/null
  check "idle: 링크는 따라가지 않음" [ "$(cat "$T/target/f")" = keep ] && [ ! -e "$SD/$SID.subs/d4" ]
  rm -f "$SD/$SID.subs/lnk2"
  has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
  hasnt() { case "$1" in *"$2"*) return 1;; *) return 0;; esac; }
  checkall() { local name=$1 a okk=1; shift; local cur=(); for a in "$@" "&&"; do if [ "$a" = "&&" ]; then if [ ${#cur[@]} -gt 0 ]; then "${cur[@]}" || okk=0; fi; cur=(); else cur+=("$a"); fi; done; if [ $okk = 1 ]; then ok "$name"; else bad "$name"; fi; }
  # 백그라운드 서브에이전트: Stop 의 background_tasks 에 running 이 있으면 bg 를 적고 .subs 를 비우지 않는다
  bgnum() { "$REAL_PY" -c 'import json,sys;o=json.load(open(sys.argv[1]));print(o.get("bg","-"))' "$SD/$SID.json"; }
  as_run '{"agent_id":"bg1","agent_type":"worker"}' sub-start >/dev/null
  as_run '{"hook_event_name":"Stop","transcript_path":"/h/.claude/projects/x/s.jsonl","background_tasks":[{"type":"subagent","status":"running","id":"bg1","secret":"x"},{"type":"shell","status":"completed"},"junk",7,null]}' idle >/dev/null
  st=$(cat "$SD/$SID.json")
  checkall "Stop + running 1개: bg=1·상태 idle·파일 유지·다른 내용은 저장 안 함" [ "$(bgnum)" = 1 ] '&&' [ -e "$SD/$SID.subs/bg1" ] '&&' has "$st" '"state":"idle"' '&&' has "$st" '"transcript_path"' '&&' hasnt "$st" secret
  as_run '{"hook_event_name":"SubagentStop","agent_id":"bg1"}' sub-stop >/dev/null
  as_run '{"hook_event_name":"Stop","background_tasks":[]}' idle >/dev/null
  checkall "마지막 Stop(빈 목록): bg 없음·파일 비움" [ "$(bgnum)" = - ] '&&' [ -z "$(ls -A "$SD/$SID.subs")" ]
  for bad in '"background_tasks":"running"' '"background_tasks":{"status":"running"}' '"background_tasks":[{"type":"x"},{"status":"done"},{"status":1}]' '"background_tasks":[{"status":"running"}'$(printf ',{"status":"running"}%.0s' $(seq 1001))']' '"background_tasks":null' '"x":1'; do
    as_run '{"agent_id":"bg2","agent_type":"worker"}' sub-start >/dev/null
    as_run '{"hook_event_name":"Stop",'"$bad"'}' idle >/dev/null
    checkall "형식이 틀린 background_tasks(${bad:0:40}…)는 예전처럼: bg 없음·파일 비움" [ "$(bgnum)" = - ] '&&' [ -z "$(ls -A "$SD/$SID.subs")" ]
  done
  as_run '{"agent_id":"bg3","agent_type":"worker"}' sub-start >/dev/null
  as_run '{"hook_event_name":"StopFailure","background_tasks":[{"status":"running"}]}' idle >/dev/null
  checkall "StopFailure 는 예전과 같다(bg 없음·파일 비움)" [ "$(bgnum)" = - ] '&&' [ -z "$(ls -A "$SD/$SID.subs")" ]
  as_run '{"hook_event_name":"Stop","background_tasks":['"$(printf '{"status":"running"},%.0s' $(seq 150))"'{"status":"running"}]}' idle >/dev/null
  check "running 이 150개여도 bg 는 99 까지" [ "$(bgnum)" = 99 ]
  as_run '{"hook_event_name":"Stop","background_tasks":[{"status":"running"},{"status":"running"}]}' busy >/dev/null
  check "idle 이 아닌 상태(busy)에는 bg 를 쓰지 않음" [ "$(bgnum)" = - ]
  # 심볼릭 링크 폴더면 아무것도 안 함
  mkdir -p "$T/elsewhere"; ln -s "$T/elsewhere" "$SD/zzzz1234-aaaa.subs"
  ASENV=(MARU_APP_SESSION=zzzz1234-aaaa); as_run '{"agent_id":"x1","agent_type":"worker"}' sub-start >/dev/null
  check "subs 폴더가 심볼릭 링크면 쓰지 않음" [ -z "$(ls -A "$T/elsewhere")" ]
  echo x > "$T/elsewhere/keepme"; as_run '{}' idle >/dev/null
  check "idle: subs 폴더가 링크면 아무것도 지우지 않음" [ -f "$T/elsewhere/keepme" ]
  ASENV=(MARU_APP_SESSION=$SID)
fi
ASDIRS="$T/nodir"; rc=$(as_run '{"transcript_path":"/a/b.jsonl"}' busy)
check "python 이 없거나 고장나도 상태는 쓰고 exit 0" sh -c '[ "$1" = 0 ] && grep -q "\"state\":\"busy\"" "$2" && ! grep -q transcript "$2"' _ "$rc" "$SD/$SID.json"
rc=$(as_run '{"agent_id":"a9","agent_type":"worker"}' sub-start); check "python 없으면 sub-start 는 조용히 건너뜀" sh -c '[ "$1" = 0 ] && [ ! -e "$2/a9" ]' _ "$rc" "$SD/$SID.subs"
unset ASDIRS ASENV

echo "== 가드 확인"
check "진짜 launchctl 은 호출되지 않음" [ ! -e "$T/real-launchctl.called" ]
# 실제 회고·정리 훅(이 시험과 동시에 돌 수 있음)이 만지는 경로(logs·state·digests·stage·history.git·할 일·추천·프로젝트 목록 등)는 감시에서 뺀다.
# 시험 프로세스는 모두 MARU_DATA 가 임시 폴더로 강제돼 있고(맨 위 가드), 아래는 그 밖의 파일(maru.conf·profile.json·mac-inventory.md 등)이 바뀌지 않았는지 본다.
check "실제 data/ 에 쓰지 않음(훅이 만지는 경로 제외)" [ -z "$(find "$REPO/data" -type f -newer "$T/stamp" ! -path "*/logs/*" ! -path "*/state/*" ! -path "*/digests/*" ! -path "*/stage/*" ! -path "*/history.git/*" ! -path "*/skills-view/*" ! -path "*/backups/*" ! -path "*/skill-proposals/*" ! -name todos.txt ! -name suggestions.txt ! -name projects.txt ! -name "projects.txt.bak" ! -name project-state.json ! -name workspaces.json ! -name ".*.??????" 2>/dev/null | head -1)" ]
check "maru.conf 는 바뀌지 않음" [ -z "$(find "$REPO/data" -type f -newer "$T/stamp" -name maru.conf 2>/dev/null)" ]

echo
if [ "$FAIL" = 0 ]; then echo "test-env: OK ($N 항목)"; exit 0; else echo "test-env: $FAIL/$N 실패"; exit 1; fi
