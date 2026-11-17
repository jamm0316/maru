#!/bin/bash
# reflect.sh / dream.sh / hist 공용 설정과 함수 (source 전용). 호출 쪽이 log() 를 정의해 둬야 한다.
# 끝부분의 "환경 해석"이 python3/git 를 실제로 실행해 보고(필요하면 폴백 경로를 PATH 앞에 둔다) 기억 폴더(MEM)를
# 계산·검증한다. 실패하면 MEM 을 지우고 즉시 종료(exit 69)한다. 호출 쪽이 직접 처리하려면 source 전에
# MARU_LIB_SOFT=1 을 두면 종료 대신 return 1 한다(그때 MARU_ENV_ERR 에 원인이 있다).
# 시험용: MARU_TOOL_DIRS(폴백 후보 디렉터리, ':' 구분)로 후보 목록을 바꿀 수 있다.

# ===== 설정 블록 ==============================================================
# 우선순위: 환경변수 > $MARU_DATA/maru.conf > 기본값. maru.conf 는 `VAR=${VAR:-값}` 형식으로 쓴다.
_maru_lib=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
MARU_HOME=${MARU_HOME:-$(dirname "$_maru_lib")}            # 저장소 위치 (이 파일 기준으로 계산)
MARU_DATA=${MARU_DATA:-$MARU_HOME/data}                    # 개인 데이터(gitignore 대상)
# shellcheck disable=SC1091
[ -f "$MARU_DATA/maru.conf" ] && . "$MARU_DATA/maru.conf"
CLAUDE_DIR=${CLAUDE_CONFIG_DIR:-$HOME/.claude}             # Claude Code 설정 폴더
PROJECTS=${PROJECTS:-$CLAUDE_DIR/projects}                 # 대화 기록(transcript) 폴더
SKILLS=${SKILLS:-$CLAUDE_DIR/skills}                       # 전역 스킬 폴더(읽기 전용으로만 쓴다)

STATE=${MARU_STATE:-$MARU_DATA/state}
LOGS=${MARU_LOGS:-$MARU_DATA/logs}
DIGESTS=${MARU_DIGESTS:-$MARU_DATA/digests}
PROPOSALS=${MARU_PROPOSALS:-$MARU_DATA/skill-proposals}    # 스킬 제안만 쌓는다. 자동 설치 없음
SQUAD_PROPOSALS=${MARU_SQUAD_PROPOSALS:-$MARU_DATA/squad-proposals}   # 스쿼드 제안만 쌓는다(squads.py propose 가 검증해 옮김). 자동 설치 없음
STAGE=${MARU_STAGE:-$MARU_DATA/stage}                      # 헤드리스 모델이 쓸 수 있는 임시 폴더(memory 외 유일)
# 헤드리스 실행의 cwd. 저장소(git 루트) 밖의 빈 폴더여야 한다: 저장소 안이면 프로젝트 설정
# (홈 전체 접근 허용)과 CLAUDE.md 가 읽히고, cwd 아래 읽기는 자동 허용되기 때문이다.
MARU_WORK=${MARU_WORK:-$HOME/.maru-work}
MARU_SKILL_AUTOINSTALL=${MARU_SKILL_AUTOINSTALL:-}         # 1이면 install.sh 가 "검토 후 문제 없으면 에이전트가 직접 설치" 문구를 쓴다(기본: 사용자 동의 후 설치)
MAX_DELETE=${MAX_DELETE:-5}                                # 한 번에 삭제 가능한 최대 기억 파일 수(비율 20%와 함께 적용)
SKILLS_VIEW=${MARU_SKILLS_VIEW:-$MARU_DATA/skills-view}    # 헤드리스 모델이 읽는 스킬 복사본(심볼릭 링크 우회 방지)
# 텔레그램 상시 세션(scripts/telegram.sh). 값은 환경변수 또는 data/maru.conf 로 덮어쓴다.
MARU_TELEGRAM_SESSION=${MARU_TELEGRAM_SESSION:-maru-telegram}   # tmux 세션 이름
# 세션의 --permission-mode. 항상 명시적으로 넘긴다(사용자 전역 기본 모드가 암묵 적용되지 않게).
# 허용 목록: default(매 승인마다 멈춤, 가장 보수적) / acceptEdits / plan / auto. 그 외(빈 값·bypassPermissions·dontAsk 포함)는 거부. 장단점은 README.
MARU_TELEGRAM_PERMISSION_MODE=${MARU_TELEGRAM_PERMISSION_MODE-default}
MARU_TELEGRAM_MAX_RESTARTS=${MARU_TELEGRAM_MAX_RESTARTS:-5}      # 1시간 안에 허용하는 자동 재시작 횟수(양의 정수)
# PATH 앞에 둘 디렉터리(시험에서는 MARU_PATH_PREFIX= 로 비울 수 있다)
MARU_PATH_PREFIX=${MARU_PATH_PREFIX-/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.bun/bin}
[ -z "$MARU_PATH_PREFIX" ] || PATH="$MARU_PATH_PREFIX:$PATH"
export PATH
# ==============================================================================

# 로그 1MB 초과 시 .1로 회전: rotate_log <파일>
rotate_log() {
  if [ "$(stat -f %z "$1" 2>/dev/null || echo 0)" -gt 1048576 ]; then mv -f "$1" "$1.1"; fi
}

# 잠금: mkdir 성공한 쪽만 소유. PID를 기록한다.
# stale = (PID 사망) 또는 (PID 기록 전에 죽은 1분 넘은 빈 잠금) 또는 (PID와 무관하게 2시간 초과).
# stale 인수는 잠금 디렉터리를 고유 이름으로 mv 한 뒤 지워서 두 대기자가 동시에 이기지 못하게 한다.
# acquire_lock <잠금디렉터리> <최대 시도(5초 간격)>. 성공 0 / 실패 1
acquire_lock() {
  local lock=$1 tries=$2 i=1 opid stale d
  while :; do
    if mkdir "$lock" 2>/dev/null; then echo $$ > "$lock/pid"; return 0; fi
    opid=$(cat "$lock/pid" 2>/dev/null); stale=0
    if [ -n "$(find "$lock" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then stale=1
    elif [ -n "$opid" ]; then kill -0 "$opid" 2>/dev/null || stale=1
    elif [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then stale=1
    fi
    if [ "$stale" = 1 ]; then
      d="$lock.stale.$$.$RANDOM"
      if mv "$lock" "$d" 2>/dev/null; then
        # 내가 본 그 잠금이 맞는지 확인(그 사이 누가 새로 잡은 살아있는 잠금을 옮겼다면 되돌림)
        if [ "$(cat "$d/pid" 2>/dev/null)" = "$opid" ] || [ -n "$(find "$d" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
          rm -rf "$d"
        else
          mv "$d" "$lock" 2>/dev/null || rm -rf "$d"
        fi
      fi
      continue   # stale 정리는 시도 횟수를 쓰지 않음
    fi
    [ "$i" -ge "$tries" ] && return 1
    i=$((i+1)); sleep 5
  done
}

# memory 디렉터리 스냅샷(파일별 md5): mem_snap <memdir>
mem_snap() { (cd "$1" 2>/dev/null && find . -type f -print0 | xargs -0 md5 -r 2>/dev/null | sort); }

# ---- 트랜잭션: 모델 실행 직전 memory 를 복사하고 파일별 체크섬 목록 A 를 만든다.
# 모델 종료 직후 목록 B 를 만든다. 되돌릴 대상은 diff(A,B), 즉 "이번 실행이 바꾼 경로"뿐이다.
# 알려진 한계: 세션 도중(journal-tick) 회고가 실패해 되돌려질 때, 그 실행 시간대에 다른 살아 있는 세션이 쓴 기억 파일도 함께 되돌려질 수 있다.
# 한계(남는 경합): A~B 사이 약 수십 초 동안 같은 파일을 다른 세션이 고치면 그 변경도 이번 실행의 것으로 보고 되돌린다.
# 그 밖의 시간대·다른 파일에 대한 쓰기는 보존된다. 그래서 txn_begin 은 모델 호출 직전에, txn_after 는 직후에 부른다.
# txn_begin <memdir> <snapdir> / txn_after <memdir> <snapdir> / txn_restore <memdir> <snapdir> / txn_end <snapdir>
txn_begin() { rm -rf "$2" "$2.A" "$2.B"; mkdir -p "$2" && cp -Rp "$1/." "$2/" && mem_snap "$1" > "$2.A"; }
txn_after() { mem_snap "$1" > "$2.B"; }
txn_restore() {
  [ -f "$2.B" ] || txn_after "$1" "$2"
  python3 -I - "$1" "$2" <<'PY'
import os, shutil, sys
mem, snap = sys.argv[1:3]
def load(f):
    d = {}
    for line in open(f, encoding="utf-8", errors="surrogateescape"):
        line = line.rstrip("\n")
        if line: h, p = line.split(" ", 1); d[p] = h
    return d
A, B = load(snap + ".A"), load(snap + ".B")
for p in sorted(set(A) | set(B)):
    if A.get(p) == B.get(p): continue
    dst, src = os.path.join(mem, p), os.path.join(snap, p)
    if p in A:
        os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(src, dst)
    elif os.path.lexists(dst):
        os.remove(dst)
PY
}
txn_end() { rm -rf "$1" "$1.A" "$1.B"; }

# memory 폴더 검증. 문제가 있으면 이유를 한 줄 출력하고 1 반환.
# mem_validate <memdir> <실행 전 파일 수(MEMORY.md 제외)>
mem_validate() {
  local mem=$1 before=$2 f n after name
  [ -s "$mem/MEMORY.md" ] || { echo "MEMORY.md 없음/비어 있음"; return 1; }
  [ "$(wc -l < "$mem/MEMORY.md" | tr -d ' ')" -le 200 ] || { echo "MEMORY.md 가 200줄 초과"; return 1; }
  [ "$(wc -c < "$mem/MEMORY.md" | tr -d ' ')" -le 25600 ] || { echo "MEMORY.md 가 25KB 초과"; return 1; }
  after=0
  for f in "$mem"/*.md; do
    [ -e "$f" ] || continue
    name=$(basename "$f"); [ "$name" = MEMORY.md ] && continue
    after=$((after+1))
    [ -s "$f" ] || { echo "빈 파일: $name"; return 1; }
    awk 'NR==1{ if($0!="---") exit 1; next } /^---[[:space:]]*$/{exit (n?0:1)} /^name:/{n=1} END{exit (n?0:1)}' "$f" \
      || { echo "frontmatter(--- / name:) 없음: $name"; return 1; }
    grep -qF "($name)" "$mem/MEMORY.md" || { echo "MEMORY.md에 없음: $name"; return 1; }
  done
  for n in $(grep -o '([a-z0-9][a-z0-9-]*\.md)' "$mem/MEMORY.md" | tr -d '()' | sort -u); do
    [ -f "$mem/$n" ] || { echo "색인이 없는 파일을 가리킴: $n"; return 1; }
  done
  if [ $((before - after)) -gt 5 ] || [ $(((before - after) * 5)) -gt "$before" ]; then
    echo "기억 파일 수 급감($before→$after)"; return 1
  fi
  return 0
}

# ---- 연속 실패 알림: fail_bump <이름> [env] / fail_reset <이름>
# 일반 실패는 2번째 연속 실패에서, 환경 실패(env: 도구 실행 불가·기억 폴더 계산 실패 등 재시도해도 같은 결과)는
# 첫 실패에서 macOS 알림을 한 번만 낸다. 성공(fail_reset)이 있기 전에는 다시 알리지 않는다.
# osascript가 없거나 실패·지연돼도 스크립트에는 영향이 없다.
notify_fail() {
  command -v osascript >/dev/null 2>&1 || return 0
  local msg="회고/정리가 연속 실패했습니다. 로그인 만료 여부를 확인하세요: claude auth login"
  [ "${1:-}" = env ] && msg="도구 실행 또는 기억 폴더 문제로 회고/정리가 실패했습니다. 터미널에서 maru doctor 를 실행해 확인하세요."
  perl -e 'alarm 10; exec @ARGV' osascript -e 'on run argv
display notification (item 1 of argv) with title "마루"
end run' "$msg" >/dev/null 2>&1 </dev/null || true
  return 0
}
# 임의 문구 macOS 알림: notify_text <문구>. 실패해도 스크립트에는 영향 없음.
notify_text() {
  command -v osascript >/dev/null 2>&1 || return 0
  perl -e 'alarm 10; exec @ARGV' osascript -e 'on run argv
display notification (item 1 of argv) with title "마루"
end run' "$1" >/dev/null 2>&1 </dev/null || true
  return 0
}
fail_bump() {
  local f="$STATE/fail.$1" n thr=2
  [ "${2:-}" = env ] && thr=1
  mkdir -p "$STATE" 2>/dev/null
  n=$(cat "$f" 2>/dev/null); [[ "$n" =~ ^[0-9]+$ ]] || n=0
  n=$((n+1)); echo "$n" > "$f"
  if [ "$n" -ge "$thr" ] && [ ! -e "$f.notified" ]; then
    : > "$f.notified"; notify_fail "${2:-}"
    type log >/dev/null 2>&1 && log "연속 실패 $n회($1) — 알림 시도"
  fi
  return 0
}
fail_reset() { rm -f "$STATE/fail.$1" "$STATE/fail.$1.notified"; }

# ---- 삭제 가드(reflect·dream 공용): apply_deletions <memdir> <list>. 항목 하나라도 거부되거나 한도를 넘으면
# 아무것도 지우지 않고 1을 반환한다(호출 쪽이 run 전체를 되돌림). 전부 통과하면 지우고 0.
apply_deletions() {
  local mem=$1 list=$2 n total name stem other bad=0
  [ -f "$list" ] && [ ! -L "$list" ] || return 0
  local ok=()
  while IFS= read -r name || [ -n "$name" ]; do
    name=${name%$'\r'}
    [ -n "${name//[[:space:]]/}" ] || continue
    case " ${ok[*]} " in *" $name "*) continue;; esac   # 중복 무시
    if ! [[ "$name" =~ ^[a-z0-9][a-z0-9-]*\.md$ ]]; then log "삭제 거부(이름 형식): $name"; bad=1; continue; fi
    if [ -L "$mem/$name" ] || [ ! -f "$mem/$name" ]; then log "삭제 거부(일반 파일 아님/없음): $name"; bad=1; continue; fi
    stem=${name%.md}
    if grep -qF -e "($name)" -e "$name" -e "[[$stem]]" "$mem/MEMORY.md" 2>/dev/null; then
      log "삭제 거부(MEMORY.md에 아직 있음): $name"; bad=1; continue
    fi
    other=$(grep -lF "[[$stem]]" "$mem"/*.md 2>/dev/null | grep -v "/$name$" | head -1)
    if [ -n "$other" ]; then log "삭제 거부(다른 기억 $(basename "$other")이 [[${stem}]] 링크): $name"; bad=1; continue; fi
    ok+=("$name")
  done < "$list"
  n=${#ok[@]}
  total=$(find "$mem" -maxdepth 1 -type f -name '*.md' ! -name MEMORY.md | wc -l | tr -d ' ')
  if [ "$n" -gt "$MAX_DELETE" ] || [ $((n * 5)) -gt "$total" ]; then
    log "삭제 목록 거부(${n}개 > 한도: 최대 ${MAX_DELETE}개·${total}개의 20%)"; bad=1
  fi
  if [ "$bad" = 1 ]; then log "삭제 목록 전체 거부 — 아무것도 지우지 않음"; return 1; fi
  for name in "${ok[@]}"; do rm -f -- "$mem/$name" && log "삭제: $name"; done
  return 0
}

# ---- 추천 목록(기억 트랜잭션과 독립): apply_suggestions <stage의 suggestions.txt>
# 모델이 쓴 후보를 검증해 $MARU_DATA/suggestions.txt 로 원자적 교체한다. 항상 0을 반환한다(실패는 로그만, 기존 목록 유지).
# 검증: 일반 파일(심볼릭 링크 거부)·64KB 이하·UTF-8 / 줄마다 앞뒤 공백 제거, 빈 줄 제거, 120자 초과 줄 버림,
# 제어·서식(bidi/zero-width 포함)·사설/미할당 문자, 줄 구분자, 한글 채움 문자가 든 줄 버림, 중복 제거, 앞에서 8줄까지.
# 남은 줄이 하나도 없으면 기존 목록을 그대로 둔다.
apply_suggestions() {
  local src=$1 dst=$MARU_DATA/suggestions.txt tmp res
  [ -e "$src" ] || [ -L "$src" ] || return 0     # 파일이 없으면 모델이 쓸 게 없다고 판단한 것
  mkdir -p "$MARU_DATA" 2>/dev/null || { type log >/dev/null 2>&1 && log "추천 목록: data 폴더 없음 — 건너뜀"; return 0; }
  tmp=$(mktemp "$MARU_DATA/.suggestions.XXXXXX" 2>/dev/null) || { type log >/dev/null 2>&1 && log "추천 목록: 임시 파일 실패 — 건너뜀"; return 0; }
  res=$(python3 -I - "$src" "$tmp" "$_maru_lib" <<'PY' 2>&1
import os, stat, sys
src, tmp = sys.argv[1:3]
sys.path.insert(0, sys.argv[3])
from textclean import has_bad, safe_start   # 제어·서식·보이지 않는 문자 판정(apply_journal 과 공용)
MAX_BYTES, MAX_LINES, MAX_CHARS = 65536, 8, 120
try:
    st = os.lstat(src)
    if not stat.S_ISREG(st.st_mode): print("거부: 일반 파일 아님(심볼릭 링크 등)"); sys.exit(1)
    if st.st_size > MAX_BYTES: print("거부: 크기 초과(%d바이트)" % st.st_size); sys.exit(1)
    with open(src, "rb") as f: raw = f.read(MAX_BYTES + 1)
    text = raw.decode("utf-8")
except (OSError, UnicodeDecodeError) as e:
    print("거부: 읽기 실패(%s)" % type(e).__name__); sys.exit(1)
out, seen, dropped = [], set(), 0
for line in text.split("\n"):
    if line.endswith("\r"): line = line[:-1]
    line = line.strip(" ")
    if not line: continue
    if len(line) > MAX_CHARS or has_bad(line) or not safe_start(line):   # 숫자·!·/ 로 시작하는 줄은 선택 프롬프트·셸·슬래시 명령으로 오해될 수 있어 버림
        dropped += 1; continue
    if line in seen: continue
    seen.add(line); out.append(line)
if not out: print("거부: 유효한 줄 없음(버린 줄 %d)" % dropped); sys.exit(1)
over = max(0, len(out) - MAX_LINES)
with open(tmp, "w", encoding="utf-8") as f: f.write("\n".join(out[:MAX_LINES]) + "\n")
print("ok %d줄(버린 줄 %d, 상한 초과 %d)" % (len(out[:MAX_LINES]), dropped, over))
PY
  ) && [ -s "$tmp" ] && chmod 600 "$tmp" && mv -f "$tmp" "$dst" 2>/dev/null
  if [ $? -eq 0 ]; then type log >/dev/null 2>&1 && log "추천 목록 갱신: $res"
  else rm -f "$tmp"; type log >/dev/null 2>&1 && log "추천 목록 유지(기존 목록 그대로): ${res:-반영 실패}"; fi
  return 0
}

# ---- 오늘 할 일: apply_todos <stage의 todos.txt> [merge|replace]
# 모델이 쓴 `<태그>|<중요도>|<제목>|<프롬프트>` 줄을 검증해 $MARU_DATA/todos.txt 로 원자적으로 반영한다. 항상 0을 반환한다(실패는 로그만, 기존 목록 유지).
# 파일이 없으면 기존 목록을 그대로 둔다. 검증: 일반 파일(심볼릭 링크 거부)·32KB 이하·UTF-8 / 줄은 정확히 4칸(`|` 3개) /
# 태그 1~12자 [0-9A-Za-z가-힣-](뒤에 `/슬러그` 를 붙여 프로젝트를 가리킬 수 있다: 슬러그 [0-9a-z가-힣-]{1,24}, 형식이 틀리거나
# data/projects.txt 에 없으면 줄은 두고 슬러그만 뗀다), 중요도 1~10, 제목 1~60자, 프롬프트 0~120자(비면 사용자가 직접 할 일) / 제어·서식 문자 제거,
# 제목·프롬프트는 neutralize_body 로 무해화(일지와 같은 함수) / 비밀값처럼 보이는 줄·제목 중복은 버림.
# 모드(기본 replace):
#  - replace(dream.sh: 전체를 보고 목록 전체를 낸다): 7개를 넘으면 중요도 높은 순(안정)으로 7개만 남기고 기존 목록을 통째로 교체한다. 유효한 줄이 없으면 기존 목록 유지.
#  - merge(reflect.sh: 한 세션만 본다): 새 목록(최대 7줄)에 등장한 태그(슬러그 뗀 태그 기준)의 기존 항목은 새 것으로 바꾸고, 없는 태그의 기존 항목은 보존한다.
#    기존 data/todos.txt 는 신뢰하지 않고 같은 검증을 다시 거쳐 읽는다(읽기 실패·링크·크기 초과면 보존분 없이 새 것만). 제목이 겹치면 새 것이 이긴다.
#    `<태그>|0||`(중요도 0·빈 제목·빈 프롬프트)는 "그 태그의 할 일을 비운다" 표지로만 해석한다(목록에 안 들어감, 한 실행에 최대 3개, 태그 검증 동일; replace 에서는 무시).
#    표지 줄에 제목·프롬프트가 붙으면 중요도 0 이 범위 밖이라 일반 줄 검증에서 버려진다. 병합 결과는 최대 12줄이고 넘으면 보존된(옛) 항목 중 중요도 낮은 것부터 뺀다(새 항목은 안 뺀다).
# 완료 표시(data/todo-done.txt, 최근 7일): 최상위 태그(`/` 앞)와 제목 키가 모두 같은 항목은 새 항목·기존 항목 모두에서 먼저 뺀 뒤(상위 7개 선택·병합·상한 계산 전) 나머지로 계산한다.
# 제목만 같고 태그가 다르면 가리지 않는다(앱도 같은 규칙).
# 정렬: 태그 묶음을 묶음 안 최고 중요도 내림차순으로, 묶음 안은 중요도 내림차순(안정). 성공하면 비어 있지 않은 프롬프트로 data/suggestions.txt 도 병합 결과로 다시 만든다
# (apply_suggestions 의 검증 규칙을 그대로 거친다; 프롬프트가 하나도 없으면 빈 파일).
apply_todos() {
  local src=$1 mode=${2:-replace} dst=$MARU_DATA/todos.txt tmp stg res
  [ "$mode" = merge ] || mode=replace
  [ -e "$src" ] || [ -L "$src" ] || return 0     # 파일이 없으면 모델이 쓸 게 없다고 판단한 것
  mkdir -p "$MARU_DATA" 2>/dev/null || { type log >/dev/null 2>&1 && log "할 일 목록: data 폴더 없음 — 건너뜀"; return 0; }
  tmp=$(mktemp "$MARU_DATA/.todos.XXXXXX" 2>/dev/null) || { type log >/dev/null 2>&1 && log "할 일 목록: 임시 파일 실패 — 건너뜀"; return 0; }
  stg=$(mktemp "$MARU_DATA/.todos-sug.XXXXXX" 2>/dev/null) || { rm -f "$tmp"; type log >/dev/null 2>&1 && log "할 일 목록: 임시 파일 실패 — 건너뜀"; return 0; }
  res=$(python3 -I - "$src" "$tmp" "$stg" "$_maru_lib" "$MARU_DATA/projects.txt" "$mode" "$dst" "$MARU_DATA/todo-done.txt" "$(date +%s)" <<'PY' 2>&1
import os, re, stat, sys
src, tmp, stg, libdir, regpath, mode, dstpath, donepath, nowstr = sys.argv[1:10]
sys.path.insert(0, libdir)
from textclean import strip_bad, neutralize_body, looks_secret, valid_tag, safe_start, split_project, read_projects, read_todo_done, title_key
MAX_BYTES, MAX_NEW, MAX_TOTAL, MAX_MARKERS, MAX_TITLE, MAX_PROMPT = 32768, 7, 12, 3, 60, 120
merge = mode == "merge"
registry = {(t, s) for t, s, _ in read_projects(regpath)}   # 등록된 프로젝트만 참조할 수 있다

def read_text(path):
    st = os.lstat(path)
    if not stat.S_ISREG(st.st_mode): raise ValueError("일반 파일 아님(심볼릭 링크 등)")
    if st.st_size > MAX_BYTES: raise ValueError("크기 초과(%d바이트)" % st.st_size)
    with open(path, "rb") as f: return f.read(MAX_BYTES + 1).decode("utf-8")

def why(e):
    return str(e) if type(e) is ValueError else "읽기 실패(%s)" % type(e).__name__

def parse(text, markers_ok):
    """검증을 통과한 줄 -> (항목 [(태그, 슬러그, 중요도, 제목, 프롬프트)], 비우기 표지 태그 목록, 버린 줄 수). 제목 중복은 먼저 나온 것만."""
    items, markers, seen, dropped = [], [], set(), 0
    for line in text.split("\n"):
        line = strip_bad(line.rstrip("\r")).strip(" ")
        if not line: continue
        parts = line.split("|")
        if len(parts) != 4: dropped += 1; continue
        tag, imp, title, prompt = [p.strip(" ") for p in parts]
        tag, slug = split_project(tag)
        if looks_secret("|".join((tag, imp, title, prompt))): dropped += 1; continue   # 틀린 슬러그(길면 비밀값처럼 보일 수 있다)는 이미 떼었으므로 줄을 버리지 않는다
        if imp == "0" and not title and not prompt:   # `태그|0||` = 그 태그 비우기 표지(merge 에서만 의미)
            if not markers_ok: continue
            if not valid_tag(tag) or len(markers) >= MAX_MARKERS: dropped += 1; continue
            if tag not in markers: markers.append(tag)
            continue
        if not valid_tag(tag) or not re.fullmatch("[0-9]{1,2}", imp) or not 1 <= int(imp) <= 10: dropped += 1; continue
        if slug and (tag, slug) not in registry: slug = None
        if not title or len(title) > MAX_TITLE or len(prompt) > MAX_PROMPT: dropped += 1; continue
        title, prompt = neutralize_body(title), neutralize_body(prompt)
        if not title or len(title) > MAX_TITLE or len(prompt) > MAX_PROMPT: dropped += 1; continue
        if prompt and not safe_start(prompt): prompt = ""   # 숫자·!·/ 로 시작하는 프롬프트는 비운다(직접 할 일로 남김)
        key = " ".join(title.split()).casefold()
        if key in seen: continue
        seen.add(key); items.append((tag, slug, int(imp), title, prompt))
    return items, markers, dropped

try:
    text = read_text(src)
except (OSError, UnicodeDecodeError, ValueError) as e:
    print("거부: %s" % why(e)); sys.exit(1)
items, markers, dropped = parse(text, merge)
if not items and not markers: print("거부: 유효한 줄 없음(버린 줄 %d)" % dropped); sys.exit(1)
# 사용자가 최근 7일 안에 완료/안 함으로 표시한 할 일은 (최상위 태그, 제목 키)가 모두 같으면 뺀다(슬러그는 비교하지 않는다; 제목만 같고 태그가 다르면 안 뺀다).
# 앱 소유 파일을 읽기만 한다. 상위 7개 선택·병합·자리 계산보다 먼저, 새 항목과 기존 항목 모두에 적용한다(가려질 항목이 자리를 차지하지 않게).
try: now = int(nowstr)
except ValueError: now = 0
donepairs = {(m[2], m[5]) for m in read_todo_done(donepath, now)} if now else set()
def notdone(x): return (x[0], title_key(x[3])) not in donepairs
newtags_all = {x[0] for x in items} | set(markers)   # 태그 교체 판단은 모델이 낸 줄 기준(표시로 가려진 줄도 그 태그를 새로 냈다는 뜻)
n_hidden = len(items)
items = [x for x in items if notdone(x)]
n_hidden -= len(items)
over = max(0, len(items) - MAX_NEW)
keep = sorted(range(len(items)), key=lambda i: (-items[i][2], i))[:MAX_NEW]   # 중요도 높은 순(안정)으로 7개
items = [items[i] for i in sorted(keep)]
note = ""
if merge:
    old, oldnote = [], "기존 목록 없음"
    try:
        old = parse(read_text(dstpath), False)[0]
        oldnote = ""
        n_old = len(old)
        old = [x for x in old if notdone(x)]
        n_hidden += n_old - len(old)
    except FileNotFoundError: pass
    except (OSError, UnicodeDecodeError, ValueError) as e: oldnote = "기존 목록을 읽을 수 없어 보존분 없음(%s)" % why(e)
    newtags = newtags_all
    newtitles = {" ".join(x[3].split()).casefold() for x in items}
    kept = [x for x in old if x[0] not in newtags and " ".join(x[3].split()).casefold() not in newtitles]
    replaced = len(old) - len(kept)
    room = MAX_TOTAL - len(items)
    trimmed = 0
    if len(kept) > room:   # 보존된(옛) 항목 중 중요도 낮은 것부터 뺀다(같으면 뒤쪽부터). 새 항목은 빼지 않는다
        keepidx = sorted(sorted(range(len(kept)), key=lambda i: (-kept[i][2], i))[:max(room, 0)])
        trimmed = len(kept) - len(keepidx)
        kept = [kept[i] for i in keepidx]
    items = kept + items
    note = ", 보존 %d·교체 %d·상한으로 뺌 %d·비우기 표지 %d%s" % (len(kept), replaced, trimmed, len(markers), (", " + oldnote) if oldnote else "")
if n_hidden: note += ", 완료 표시로 뺌 %d" % n_hidden
groups, order = {}, []
for it in items:
    if it[0] not in groups: groups[it[0]] = []; order.append(it[0])
    groups[it[0]].append(it)
order.sort(key=lambda t: -max(x[2] for x in groups[t]))                    # 안정 정렬: 동률이면 먼저 나온 묶음(묶음은 태그 기준)
out = []
for t in order: out.extend(sorted(groups[t], key=lambda x: -x[2]))         # 안정 정렬
with open(tmp, "w", encoding="utf-8") as f: f.write("".join("%s|%d|%s|%s\n" % (x[0] + ("/" + x[1] if x[1] else ""), x[2], x[3], x[4]) for x in out))
with open(stg, "w", encoding="utf-8") as f: f.write("".join(x[4] + "\n" for x in out if x[4]))
print("ok %d줄(버린 줄 %d, 상한 초과 %d%s)" % (len(out), dropped, over, note))
PY
  ) && [ -f "$tmp" ] && chmod 600 "$tmp" && mv -f "$tmp" "$dst" 2>/dev/null
  if [ $? -eq 0 ]; then
    type log >/dev/null 2>&1 && log "할 일 목록 갱신($mode): $res"
    if [ -s "$stg" ]; then apply_suggestions "$stg"
    else : > "$stg" && chmod 600 "$stg" && mv -f "$stg" "$MARU_DATA/suggestions.txt" 2>/dev/null   # 프롬프트가 있는 할 일이 없으면 추천도 비운다
    fi
  else rm -f "$tmp"; type log >/dev/null 2>&1 && log "할 일 목록 유지(기존 목록 그대로): ${res:-반영 실패}"; fi
  rm -f "$stg"
  return 0
}

# ---- 프로젝트 레지스트리: apply_projects <stage의 projects.txt>
# 모델이 쓴 `<태그>|<슬러그>|<제목>` 줄을 검증해 $MARU_DATA/projects.txt 에 병합한다(셸 소유; 앱은 읽기만, 사용자 상태는 앱 소유의 data/project-state.json).
# 검증: 일반 파일(심볼릭 링크 거부)·32KB 이하·UTF-8 / 줄은 정확히 3칸 / 태그 1~12자 [0-9A-Za-z가-힣-], 슬러그 1~24자 [0-9a-z가-힣-],
# 제목 1~40자 — 제어·서식·보이지 않는 문자가 든 줄은 거부(지우지 않는다), 비밀값처럼 보이는 줄은 거부, 제목은 clean_title(textclean.py: 무해화 + 공백 접기 +
# 한글·영숫자·공백과 `. , - _ / ( ) : · + # &` 만 허용; 앱 cleanProjectTitle 과 같은 규칙)을 거쳐야 하고 통과하지 못하면 줄을 버린다.
# 같은 `태그/슬러그` 는 처음 등록한 제목을 유지한다(모델이 제목을 덮어쓰지 못한다).
# 상한: 한 번에 새 등록 최대 3줄 / 열린(완료·합쳐진 것을 뺀) 프로젝트 200개 / 파일 전체 1000줄.
# 기존 data/projects.txt 가 있는데 읽을 수 없으면(링크·크기 초과·UTF-8 아님) 병합을 거부하고 파일을 그대로 둔다(로그에 이유).
# 다시 쓰기 전에 기존 파일을 projects.txt.bak 으로 남긴다(형식이 틀린 기존 줄이 조용히 사라지지 않게). 유효한 새 줄이 없으면 기존 파일을 그대로 둔다.
# 항상 0 을 반환한다(실패는 로그만). 일지·할 일 적용보다 먼저 불러야 같은 실행의 새 슬러그가 인정된다.
# 병합 본체(apply_projects 와 maru project add 가 함께 쓴다 — 규칙은 한 곳). _PROJ_RES 에 결과 문장을 두고 0=병합함 / 1=거부·새 줄 없음 / 2=환경 실패.
_projects_merge() {
  local src=$1 dst=$MARU_DATA/projects.txt tmp res
  _PROJ_RES=""
  mkdir -p "$MARU_DATA" 2>/dev/null || { _PROJ_RES="data 폴더 없음 — 건너뜀"; return 2; }
  tmp=$(mktemp "$MARU_DATA/.projects.XXXXXX" 2>/dev/null) || { _PROJ_RES="임시 파일 실패 — 건너뜀"; return 2; }
  res=$(python3 -I - "$src" "$tmp" "$dst" "$_maru_lib" "$MARU_DATA/project-state.json" <<'PY' 2>&1
import os, stat, sys
src, tmp, dst, libdir, statepath = sys.argv[1:6]
sys.path.insert(0, libdir)
from textclean import (has_bad, looks_secret, valid_tag, valid_slug, clean_title, read_projects_checked, load_state, project_inactive,
                       PROJECT_ACTIVE_MAX, PROJECT_FILE_LINES, PROJECT_NEW_MAX)
MAX_BYTES = 32768
try:
    st = os.lstat(src)
    if not stat.S_ISREG(st.st_mode): print("거부: 일반 파일 아님(심볼릭 링크 등)"); sys.exit(1)
    if st.st_size > MAX_BYTES: print("거부: 크기 초과(%d바이트)" % st.st_size); sys.exit(1)
    with open(src, "rb") as f: raw = f.read(MAX_BYTES + 1)
    text = raw.decode("utf-8")
except (OSError, UnicodeDecodeError) as e:
    print("거부: 읽기 실패(%s)" % type(e).__name__); sys.exit(1)
cur, err = read_projects_checked(dst)
if err: print("거부: 기존 projects.txt 를 읽을 수 없어 병합하지 않음 — %s" % err); sys.exit(1)
keys = {(t, s) for t, s, _ in cur}
state = load_state(statepath)
regkeys = {t + "/" + s for t, s, _ in cur}
active = sum(1 for t, s, _ in cur if not project_inactive(state, regkeys, t + "/" + s))
added, dropped, dup, over = [], 0, 0, 0
for line in text.split("\n"):
    line = line.rstrip("\r").strip(" ")
    if not line: continue
    if has_bad(line) or looks_secret(line): dropped += 1; continue   # 제어·서식 문자나 비밀값 모양은 고쳐 쓰지 않고 거부
    parts = line.split("|")
    if len(parts) != 3: dropped += 1; continue
    tag, slug, title = [p.strip(" ") for p in parts]
    if not valid_tag(tag) or not valid_slug(slug): dropped += 1; continue
    title = clean_title(title)
    if not title: dropped += 1; continue
    if (tag, slug) in keys: dup += 1; continue                          # 첫 등록 제목 유지
    if len(added) >= PROJECT_NEW_MAX or active + len(added) >= PROJECT_ACTIVE_MAX or len(cur) + len(added) >= PROJECT_FILE_LINES: over += 1; continue
    keys.add((tag, slug)); added.append((tag, slug, title))
if not added: print("유효한 새 줄 없음(버린 줄 %d, 이미 있음 %d, 상한 초과 %d)" % (dropped, dup, over)); sys.exit(1)
with open(tmp, "w", encoding="utf-8") as f: f.write("".join("%s|%s|%s\n" % x for x in cur + added))
print("ok 새 %d줄 → 전체 %d줄(버린 줄 %d, 이미 있음 %d, 상한 초과 %d)" % (len(added), len(cur) + len(added), dropped, dup, over))
PY
  ) && [ -s "$tmp" ] && chmod 600 "$tmp" \
    && { [ ! -e "$dst" ] && [ ! -L "$dst" ] || { rm -f "$dst.bak" && cp -p "$dst" "$dst.bak"; }; } \
    && mv -f "$tmp" "$dst" 2>/dev/null
  if [ $? -eq 0 ]; then _PROJ_RES=$res; return 0
  else rm -f "$tmp"; _PROJ_RES=${res:-반영 실패}; return 1; fi
}

apply_projects() {
  local src=$1
  [ -e "$src" ] || [ -L "$src" ] || return 0     # 파일이 없으면 모델이 쓸 게 없다고 판단한 것
  _projects_merge "$src"
  case $? in
    0) type log >/dev/null 2>&1 && log "프로젝트 목록 갱신: $_PROJ_RES" ;;
    2) type log >/dev/null 2>&1 && log "프로젝트 목록: $_PROJ_RES" ;;
    *) type log >/dev/null 2>&1 && log "프로젝트 목록 유지(기존 그대로): $_PROJ_RES" ;;
  esac
  return 0
}

# ---- maru project list | add <태그> <슬러그> <제목>
# add 는 한 줄짜리 stage 를 만들어 위 병합 본체에 넘긴다(검증·중복·상한 규칙은 apply_projects 와 같다). 회고와 같은 잠금($STATE/lock.d)을 잡고 쓴다.
# 종료 코드: 0 등록함 또는 이미 있음 / 2 입력 거부(형식·제어문자·비밀값 모양) / 3 열린 프로젝트 상한 / 4 잠금 못 잡음(회고가 기억을 갱신 중) / 1 그 밖의 실패.
# 환경변수 MARU_PROJECT_LOCK_TRIES(1~12, 기본 6; 5초 간격)로 잠금 대기 횟수를 줄일 수 있다.
project_list() {
  local out
  out=$(open_projects_text)
  [ "$out" = "(없음)" ] && out=$(T "(없음)" "(none)")
  printf '%s\n' "$out"
}
project_add() {
  local tag=${1-} slug=${2-} title=${3-} a stage tries lock rc last
  [ $# -eq 3 ] || { T "사용법: maru project add <태그> <슬러그> <제목>" "Usage: maru project add <tag> <slug> <title>" >&2; echo >&2; return 2; }
  for a in "$tag" "$slug" "$title"; do
    case "$a" in
      "") ;;
      -*) a="" ;;   # 옵션처럼 보이는 인자는 받지 않는다(인자는 정확히 세 개, 쓰는 위치는 고정)
      *'|'*|*$'\n'*|*$'\r'*) a="" ;;
    esac
    [ -n "$a" ] || { T "등록 거부: 입력이 올바르지 않습니다(빈 칸·줄바꿈·|·앞의 - 는 쓸 수 없음)" "Rejected: invalid input (empty fields, newlines, | and a leading - are not allowed)" >&2; echo >&2; return 2; }
  done
  stage=$(mktemp "${TMPDIR:-/tmp}/maru-project.XXXXXX" 2>/dev/null) || { T "등록 실패: 임시 파일을 만들 수 없음" "Failed: cannot create a temporary file" >&2; echo >&2; return 1; }
  printf '%s|%s|%s\n' "$tag" "$slug" "$title" > "$stage" || { rm -f "$stage"; return 1; }
  tries=${MARU_PROJECT_LOCK_TRIES:-6}
  case "$tries" in ''|*[!0-9]*) tries=6;; esac
  [ "$tries" -ge 1 ] || tries=1; [ "$tries" -le 12 ] || tries=12
  lock=$STATE/lock.d
  mkdir -p "$STATE" 2>/dev/null
  if ! acquire_lock "$lock" "$tries"; then
    rm -f "$stage"
    T "등록 보류: 다른 회고가 기억을 갱신 중입니다. 잠시 뒤 다시 시도하세요" "Not registered: a reflection is updating memory right now. Try again shortly" >&2; echo >&2
    return 4
  fi
  _projects_merge "$stage"; rc=$?
  last=$(tail -n 1 "$MARU_DATA/projects.txt" 2>/dev/null)
  rm -rf "$lock"; rm -f "$stage"
  if [ $rc -eq 0 ]; then
    printf '%s\n' "$(T "프로젝트 등록: " "Project registered: ")${tag}/${slug} — ${last#*|*|}"
    return 0
  fi
  # 결과 문장(lib 의 python 이 만든 "버린 줄 N, 이미 있음 M, 상한 초과 K")으로 이유를 가른다
  case "$_PROJ_RES" in
    *"이미 있음 "[1-9]*) printf '%s\n' "$(T "이미 있는 프로젝트입니다: " "Already registered: ")${tag}/${slug}$(T " (처음 등록한 제목을 유지합니다)" " (the first title is kept)")"; return 0 ;;
    *"상한 초과 "[1-9]*) T "등록 거부: 열린 프로젝트가 상한에 도달했습니다(완료·합침 정리 필요)" "Rejected: the open-project limit has been reached (finish or merge some first)" >&2; echo >&2; return 3 ;;
    *"버린 줄 "[1-9]*) T "등록 거부: 입력이 올바르지 않습니다(태그 1~12자·슬러그 1~24자 소문자·제목 1~40자 한글/영숫자/공백과 . , - _ / ( ) : · + # &)" "Rejected: invalid input (tag 1-12 chars, slug 1-24 lowercase chars, title 1-40 chars of letters, digits, spaces and . , - _ / ( ) : · + # &)" >&2; echo >&2; return 2 ;;
  esac
  T "등록 실패: 프로젝트 목록을 갱신하지 못했습니다" "Failed: could not update the project list" >&2; echo >&2
  return 1
}

# 회고·정리 프롬프트에 넣을 "열린 프로젝트" 목록(`태그/슬러그 — 제목` 줄, 최대 50줄; 없으면 `(없음)`).
# data/project-state.json 에서 done·합쳐진 것은 뺀다(읽기만). 일지에 최근 기록이 있는 순으로 고르고, 기록 없는 것은 최근 등록순.
# 실패해도 `(없음)` 을 출력하고 0 을 반환한다. render_template 에는 반드시 다른 키보다 뒤에 넘긴다(값 안의 {{키}} 가 다시 치환되지 않게).
open_projects_text() {
  local out
  out=$(python3 -I - "$MARU_DATA/projects.txt" "$MARU_DATA/project-state.json" "$MEM/journal" "$_maru_lib" <<'PY' 2>/dev/null
import sys
sys.path.insert(0, sys.argv[4])
from textclean import open_project_lines
print("\n".join(open_project_lines(sys.argv[1], sys.argv[2], sys.argv[3], 50)))
PY
  )
  [ -n "$out" ] && printf '%s\n' "$out" || printf '(없음)\n'
  return 0
}

# 회고·정리 프롬프트에 넣을 "최근 사용자가 완료/안 함으로 표시한 할 일"(`완료|안 함: 제목` 줄, 최대 30줄, 최근 것 먼저; 없으면 `(없음)`).
# data/todo-done.txt(앱 소유, 신뢰하지 않음)를 textclean.read_todo_done 로 검증해 읽는다. 값 안의 {{키}} 가 치환되지 않도록 중괄호는 괄호로 바꾼다. 항상 0.
recent_marks_text() {
  local out
  out=$(python3 -I - "$MARU_DATA/todo-done.txt" "$_maru_lib" "$(date +%s)" <<'PY' 2>/dev/null
import sys
sys.path.insert(0, sys.argv[2])
from textclean import read_todo_done
rows = read_todo_done(sys.argv[1], int(sys.argv[3]))[::-1][:30]
print("\n".join(("완료: " if r[1] == "done" else "안 함: ") + r[4].replace("{", "(").replace("}", ")") for r in rows))
PY
  )
  [ -n "$out" ] && printf '%s\n' "$out" || printf '(없음)\n'
  return 0
}

# 사용자가 표시한 완료/안 함(data/todo-done.txt, 최근 7일, 파일에 남아 있는 줄만)을 일지에 한 번씩만 덧붙인다: apply_todo_marks
# done -> `[한 일] (5) @태그[/슬러그] 제목 (사용자가 완료 표시)`, skip -> `[결정] (4) @태그[/슬러그] 제목 — 하지 않기로 함`. 라벨은 고정 `사용자 표시`.
# 검증·슬러그 처리는 apply_journal 을 그대로 탄다(한 번에 최대 8줄, 나머지는 다음에). 이미 옮긴 표시는 $STATE/todo-done.seen
# (줄마다 `epoch 해시16`, 해시 = sha256(epoch|종류|제목 키), 최대 400줄)으로 가린다. apply_journal 이 성공해야 seen 에 적는다.
# 호출 쪽이 기억 쓰기 잠금을 쥔 상태에서 성공 경로에서만 부른다(reflect.sh·dream.sh). 일지에 덧붙였으면 0, 아니면 1.
apply_todo_marks() {
  local f=$MARU_DATA/todo-done.txt tmp n
  [ -e "$f" ] || [ -L "$f" ] || return 1
  mkdir -p "$STATE" 2>/dev/null || return 1
  tmp=$(mktemp "$STATE/.marks.XXXXXX" 2>/dev/null) || return 1
  n=$(python3 -I - collect "$f" "$tmp" "$STATE/todo-done.seen" "$_maru_lib" "$(date +%s)" <<'PY' 2>/dev/null
import hashlib, os, sys
_, f, tmp, seenpath, libdir, nowstr = sys.argv[1:7]
sys.path.insert(0, libdir)
from textclean import read_todo_done
def h(m): return hashlib.sha256(("%d|%s|%s" % (m[0], m[1], m[5])).encode("utf-8")).hexdigest()[:16]
seen = set()
try:
    for l in open(seenpath, encoding="utf-8", errors="replace").read().split("\n")[-400:]:   # 깨진 바이트가 있어도 죽지 않는다(죽으면 일지 반영이 영원히 멈춘다)
        p = l.split(" ")
        if len(p) == 2: seen.add(p[1])
except OSError: pass
lines, ids = [], []
for m in read_todo_done(f, int(nowstr)):
    if h(m) in seen: continue
    tag = m[2] + ("/" + m[3] if m[3] else "")
    lines.append("done|5|%s|%s (사용자가 완료 표시)" % (tag, m[4]) if m[1] == "done" else "decision|4|%s|%s — 하지 않기로 함" % (tag, m[4]))
    ids.append("%d %s" % (m[0], h(m)))
    if len(lines) >= 8: break
if lines:
    with open(tmp, "w", encoding="utf-8") as o: o.write("\n".join(lines) + "\n")
    with open(tmp + ".ids", "w", encoding="utf-8") as o: o.write("\n".join(ids) + "\n")
print(len(lines))
PY
  )
  if [ "${n:-0}" -gt 0 ] 2>/dev/null && apply_journal "$tmp" todo "사용자 표시"; then
    python3 -I - "$tmp.ids" "$STATE/todo-done.seen" <<'PY' 2>/dev/null
import os, sys
new = [l for l in open(sys.argv[1], encoding="utf-8").read().split("\n") if l]
old = []
try: old = [l for l in open(sys.argv[2], encoding="utf-8", errors="replace").read().split("\n") if l]
except OSError: pass
tmp = sys.argv[2] + ".tmp"
with open(tmp, "w", encoding="utf-8") as o: o.write("\n".join((old + new)[-400:]) + "\n")
os.replace(tmp, sys.argv[2])
PY
    rm -f "$tmp" "$tmp.ids"; return 0
  fi
  rm -f "$tmp" "$tmp.ids"; return 1
}

# ---- 일지(journal): apply_journal <stage의 journal.txt> <세션 id 앞 8자> <프로젝트 라벨(없으면 빈 문자열)>
# 모델이 쓴 `<kind>|<중요도>|<태그>|<문장>` 줄(kind=done|decision|todo, 중요도 1~10, 태그 1~12자 [0-9A-Za-z가-힣-], 없으면 빈 칸 — 정확히 4칸, 문장 160자 이하; 날짜 파일에는 `@태그 ` 접두로 기록)을 검증해 $MEM/journal/YYYY-MM-DD.md
# 태그 칸은 `태그/슬러그` 로 프로젝트를 가리킬 수 있다(슬러그 [0-9a-z가-힣-]{1,24}). 슬러그가 틀리거나 data/projects.txt 에 없으면 줄은 두고 슬러그만 뗀다(`@태그/슬러그 문장`).
# 에 블록으로 덧붙인다(헤더는 셸이 쓴다). 검증: 일반 파일(심볼릭 링크 거부)·32KB 이하·UTF-8 / 제어·서식·보이지 않는 문자는 제거
# (textclean.py, apply_suggestions 와 공용) / 문장은 neutralize_body 로 무해화(백틱 제거, < > [ ] 치환, 앞쪽 # 제거) /
# 형식에 안 맞는 줄·비밀값처럼 보이는 줄(sk-…, 16진수 32자+, base64 40자+)·중복 줄은 버림 / 앞에서 8줄까지.
# journal 이 심볼릭 링크이거나 일반 폴더가 아니면 거부. 임시 파일에 쓰고 rename 하므로 읽는 쪽은 반쪽 블록을 보지 않는다.
# 호출 쪽이 기억 쓰기 잠금을 쥔 상태에서, 기억 트랜잭션이 성공으로 끝난 뒤에만 부른다(reflect.sh). 덧붙였으면 0, 아니면 1(로그만 남김).
apply_journal() {
  local src=$1 sid8=$2 label=${3:-} res rc
  [ -e "$src" ] || [ -L "$src" ] || return 1     # 파일이 없으면 모델이 쓸 게 없다고 판단한 것
  res=$(python3 -I - "$src" "$MEM" "$(date +%F)" "$(date +%H:%M)" "$sid8" "$label" "$_maru_lib" "$MARU_DATA/projects.txt" <<'PY' 2>&1
import os, re, stat, sys, tempfile
src, mem, day, hhmm, sid8, label, libdir, regpath = sys.argv[1:9]
sys.path.insert(0, libdir)
from textclean import strip_bad, neutralize_body, looks_secret, valid_tag, split_project, read_projects
MAX_BYTES, MAX_LINES, MAX_CHARS = 32768, 8, 160
registry = {(t, s) for t, s, _ in read_projects(regpath)}   # 등록된 프로젝트만 참조할 수 있다
KINDS = {"done": "한 일", "decision": "결정", "todo": "남은 일"}
# 정확히 4칸 kind|중요도|태그|문장. 태그 칸은 비어도 되지만(태그 없음) 비어 있지 않은데 태그 형식이 틀리면 줄을 버린다(슬러그만 틀리면 슬러그만 뗀다).
LINE = re.compile(r"^(done|decision|todo)[ ]*\|[ ]*([0-9]{1,2})[ ]*\|[ ]*([^|]*?)[ ]*\|[ ]*(.+?)[ ]*$")
try:
    st = os.lstat(src)
    if not stat.S_ISREG(st.st_mode): print("거부: 일반 파일 아님(심볼릭 링크 등)"); sys.exit(1)
    if st.st_size > MAX_BYTES: print("거부: 크기 초과(%d바이트)" % st.st_size); sys.exit(1)
    with open(src, "rb") as f: raw = f.read(MAX_BYTES + 1)
    text = raw.decode("utf-8")
except (OSError, UnicodeDecodeError) as e:
    print("거부: 읽기 실패(%s)" % type(e).__name__); sys.exit(1)
out, seen, dropped = [], set(), 0
for line in text.split("\n"):
    line = strip_bad(line.rstrip("\r")).strip(" ")
    if not line: continue
    m = LINE.match(line)
    if not m: dropped += 1; continue
    kind, imp, tfield, body = m.group(1), int(m.group(2)), m.group(3), m.group(4)
    tag, slug = split_project(tfield) if tfield else ("", None)
    if tfield and not valid_tag(tag): dropped += 1; continue   # 태그 칸이 비어 있지 않은데 태그 형식이 틀리면(`/슬러그` 만 있는 경우 포함) 줄을 버린다
    if slug and (tag, slug) not in registry: slug = None
    if slug: tag = tag + "/" + slug
    if len(body) > MAX_CHARS or looks_secret(body): dropped += 1; continue   # 원문 기준: 길이·비밀값 모양
    body = neutralize_body(body)   # 백틱 제거, < > [ ] 치환, 앞쪽 # 제거(읽을 때도 같은 함수)
    if not 1 <= imp <= 10 or not body or len(body) > MAX_CHARS:
        dropped += 1; continue
    key = (kind, body)
    if key in seen: continue
    seen.add(key); out.append((kind, imp, tag, body))
if not out: print("거부: 유효한 줄 없음(버린 줄 %d)" % dropped); sys.exit(1)
over = max(0, len(out) - MAX_LINES)
out = out[:MAX_LINES]
out.sort(key=lambda t: list(KINDS).index(t[0]))   # 안정 정렬: 한 일 → 결정 → 남은 일
lab = re.sub(r"[^0-9A-Za-z가-힣._-]+", "-", label).strip("-._")[:24]
header = "## %s %s(%s)" % (hhmm, lab + " " if lab else "", sid8)
block = header + "\n" + "".join("- [%s] (%d) %s%s\n" % (KINDS[k], i, "@" + t + " " if t else "", b) for k, i, t, b in out)
jd = os.path.join(mem, "journal")
try:
    if os.path.islink(jd) or (os.path.lexists(jd) and not os.path.isdir(jd)):
        print("거부: journal 이 심볼릭 링크이거나 폴더가 아님"); sys.exit(1)
    os.makedirs(jd, mode=0o700, exist_ok=True)
    os.chmod(jd, 0o700)
    dst = os.path.join(jd, day + ".md")
    if os.path.lexists(dst):
        dst_st = os.lstat(dst)
        if not stat.S_ISREG(dst_st.st_mode): print("거부: 날짜 파일이 일반 파일 아님"); sys.exit(1)
        with open(dst, "rb") as f: old = f.read()
        if not old.endswith(b"\n"): old += b"\n"
    else:
        old = ("# %s 일지\n" % day).encode("utf-8")
    fd, tmp = tempfile.mkstemp(prefix=".tmp.", dir=jd)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(old + b"\n" + block.encode("utf-8")); f.flush(); os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, dst)
    except BaseException:
        if os.path.exists(tmp): os.unlink(tmp)
        raise
except OSError as e:
    print("거부: 쓰기 실패(%s)" % type(e).__name__); sys.exit(1)
print("ok %d줄 → journal/%s.md(버린 줄 %d, 상한 초과 %d)" % (len(out), day, dropped, over))
PY
  ); rc=$?
  type log >/dev/null 2>&1 && log "일지: ${res:-반영 실패}"
  return $((rc != 0))
}

# ---- 일지 보관: archive_journal [일수=14]
# journal/ 최상위의 날짜 파일(YYYY-MM-DD.md) 중 오늘보다 일수를 넘게 오래된 것을 journal/archive/ 로 옮긴다(삭제 없음).
# 심볼릭 링크·일반 파일이 아닌 것은 건드리지 않고, journal 이나 archive 가 링크/폴더가 아니면 거부한다. 폴더 700·파일 600.
# 호출 쪽이 기억 쓰기 잠금을 쥔 상태에서, 모델 실행의 journal 변조 검사가 끝난 뒤에만 부른다(dream.sh). 항상 0.
archive_journal() {
  local res
  res=$(python3 -I - "$MEM/journal" "${1:-14}" <<'PY' 2>&1
import datetime, os, re, stat, sys
jd, days = sys.argv[1], int(sys.argv[2])
if not os.path.lexists(jd): sys.exit(0)
if os.path.islink(jd) or not os.path.isdir(jd): print("거부: journal 이 심볼릭 링크이거나 폴더가 아님"); sys.exit(0)
today = datetime.date.today(); ad = os.path.join(jd, "archive"); moved = refused = 0
for n in sorted(os.listdir(jd)):
    m = re.fullmatch(r"([0-9]{4}-[0-9]{2}-[0-9]{2})\.md", n)
    if not m: continue
    try: d = datetime.date.fromisoformat(m.group(1))
    except ValueError: continue
    if (today - d).days <= days: continue
    p = os.path.join(jd, n)
    try:
        if not stat.S_ISREG(os.lstat(p).st_mode): refused += 1; continue   # 심볼릭 링크 등
        if os.path.islink(ad) or (os.path.lexists(ad) and not os.path.isdir(ad)): print("거부: archive 가 심볼릭 링크이거나 폴더가 아님"); break
        os.makedirs(ad, mode=0o700, exist_ok=True)
        if not stat.S_ISDIR(os.lstat(ad).st_mode): print("거부: archive 가 폴더가 아님"); break
        os.chmod(ad, 0o700)
        dst, k = os.path.join(ad, n), 1
        while os.path.lexists(dst):   # 이름이 겹치면 숫자 접미사(YYYY-MM-DD.1.md …)를 붙인다. 덮어쓰지도, 원본을 남겨 두지도 않는다
            k += 1; dst = os.path.join(ad, "%s.%d.md" % (n[:-3], k - 1))
        os.rename(p, dst)
        if stat.S_ISREG(os.lstat(dst).st_mode): os.chmod(dst, 0o600)   # 링크를 따라가 chmod 하지 않는다
        moved += 1
    except OSError as e:
        refused += 1
print("보관 %d개 이동(거부·건너뜀 %d)" % (moved, refused) if moved or refused else "")
PY
  )
  [ -z "$res" ] || { type log >/dev/null 2>&1 && log "일지 보관: $res"; }
  return 0
}

# 프롬프트 템플릿의 {{키}} 를 값으로 치환(경로에 어떤 문자가 있어도 안전): render_template <파일> 키=값...
render_template() {
  python3 -I -c '
import sys
t = open(sys.argv[1], encoding="utf-8").read()
for kv in sys.argv[2:]:
    k, v = kv.split("=", 1); t = t.replace("{{" + k + "}}", v)
sys.stdout.write(t)' "$@"
}

# 스킬 읽기용 복사본: 실제 디렉터리이고 realpath 가 스킬 폴더 안이며 SKILL.md 가 일반 파일인 것만 복사한다.
# 모델에겐 이 복사본만 읽게 하므로 스킬 폴더 안 심볼릭 링크로 밖을 읽는 우회가 불가능하다.
build_skills_view() {
  rm -rf "$SKILLS_VIEW"; mkdir -p "$SKILLS_VIEW"
  python3 -I - "$SKILLS" "$SKILLS_VIEW" <<'PY'
import os, shutil, sys
root, out = os.path.realpath(sys.argv[1]), sys.argv[2]
if os.path.isdir(root):
    for n in sorted(os.listdir(root)):
        d = os.path.join(root, n); f = os.path.join(d, "SKILL.md")
        if os.path.islink(d) or not os.path.isdir(d) or not os.path.realpath(d).startswith(root + os.sep): continue
        if os.path.islink(f) or not os.path.isfile(f): continue
        os.makedirs(os.path.join(out, n)); shutil.copyfile(f, os.path.join(out, n, "SKILL.md"))
PY
}

# 변경 이력(기억 폴더만 추적하는 별도 git). scripts/hist 는 읽기 전용 명령만 열어 주고, 쓰기는 이 함수로만 한다.
# git-dir: $MARU_DATA/history.git, work-tree: Claude 설정 폴더. 허용 목록(info/exclude)은 매번 재생성한다.
# 스킬 제안 폴더는 maru 저장소 안(중첩 .git)이라 추적할 수 없다.
hist_git() {
  local gd="$MARU_DATA/history.git"
  if [ ! -d "$gd" ]; then
    mkdir -p "$MARU_DATA" && git init -q --bare "$gd" && git --git-dir="$gd" symbolic-ref HEAD refs/heads/main
    git --git-dir="$gd" config user.name maru; git --git-dir="$gd" config user.email maru@localhost
  fi
  python3 -I - "$CLAUDE_DIR" "$gd/info/exclude" "$MEM" <<'PY'
import os, sys
wt, out = os.path.realpath(sys.argv[1]), sys.argv[2]
lines, seen = ["# 자동 생성(hist). 허용 목록 방식: 아래 경로만 추적", "/*"], set()
for p in sys.argv[3:]:
    rel = os.path.relpath(os.path.realpath(p), wt)
    if rel.startswith(".."): continue  # work-tree 밖 경로는 추적하지 않는다
    parts = rel.split(os.sep)
    for i in range(len(parts)):
        cur = "/" + "/".join(parts[:i + 1])
        if i < len(parts) - 1:
            for x in (f"!{cur}/", f"{cur}/*"):
                if x not in seen: seen.add(x); lines.append(x)
        else:
            lines.append(f"!{cur}/")
lines.append(".DS_Store")
os.makedirs(os.path.dirname(out), exist_ok=True)
new = "\n".join(lines) + "\n"
if not os.path.exists(out) or open(out).read() != new:
    open(out, "w").write(new)
PY
  git --git-dir="$gd" --work-tree="$CLAUDE_DIR" "$@"
}

# ============ 환경 해석(파일 맨 끝, source 시 1회 실행) ========================
# 1) python3/git 를 실제로 실행해 본다(출력은 버리고 종료 코드만). Xcode 라이선스 미동의 등으로 /usr/bin 셔임이
#    실패하면 후보 디렉터리에서 동작하는 것을 찾아 그 디렉터리를 PATH 앞에 둔다(자식 프로세스도 같이 쓴다).
# 2) 기억 폴더 MEM 을 $PROJECTS/<slug>/memory 로 계산하고 검증한다. 하나라도 이상하면 진행하지 않는다.
MARU_TOOL_DIRS=${MARU_TOOL_DIRS-/Library/Developer/CommandLineTools/usr/bin:/opt/homebrew/bin:/usr/local/bin}
MARU_ENV_ERR=""
MARU_PY_FALLBACK=""; MARU_PY_WHY=""; MARU_GIT_FALLBACK=""; MARU_GIT_WHY=""

# 도구 하나를 실제로 실행해 성공 여부만 본다: _maru_probe <python3|git> [디렉터리]
_maru_probe() {
  local t=$1 d=${2:-} bin
  if [ -n "$d" ]; then bin=$d/$t; [ -x "$bin" ] || return 1; else bin=$t; fi
  case $t in
    python3) "$bin" -c 'pass' >/dev/null 2>&1 </dev/null ;;
    git)     "$bin" --version >/dev/null 2>&1 </dev/null ;;
    *)       return 1 ;;
  esac
}
# 실패 원인 한 줄(진단용): _maru_why <도구>
_maru_why() {
  local o
  case $1 in
    python3) o=$(python3 -c 'pass' 2>&1 </dev/null) ;;
    git)     o=$(git --version 2>&1 </dev/null) ;;
  esac
  o=$(printf '%s' "$o" | head -n 1 | cut -c1-200)
  printf '%s' "${o:-실행 실패}"
}
# _maru_resolve_tool <도구> <처음 실행 실패 원인(비어 있으면 처음부터 동작)>
# 동작하면 0. 아니면 폴백을 찾아 PATH 앞에 두고, 없으면 MARU_ENV_ERR 를 채우고 1.
_maru_resolve_tool() {
  local t=$1 why=$2 d dirs
  [ -n "$why" ] || return 0
  IFS=: read -r -a dirs <<< "$MARU_TOOL_DIRS"
  for d in ${dirs[@]+"${dirs[@]}"}; do
    [ -n "$d" ] || continue
    if _maru_probe "$t" "$d"; then
      case ":$PATH:" in ":$d:"*) ;; *) PATH="$d:$PATH"; export PATH ;; esac
      if _maru_probe "$t"; then   # PATH 앞에 둔 뒤 실제로 이것이 선택되는지 재확인
        case $t in
          python3) MARU_PY_FALLBACK=$d; MARU_PY_WHY=$why ;;
          git)     MARU_GIT_FALLBACK=$d; MARU_GIT_WHY=$why ;;
        esac
        return 0
      fi
    fi
  done
  MARU_ENV_ERR="마루: $t 를 실행할 수 없습니다(원인: $why). 폴백 후보(${MARU_TOOL_DIRS:-없음})에도 동작하는 것이 없습니다."
  case $why in
    *license*|*xcodebuild*) MARU_ENV_ERR="$MARU_ENV_ERR Xcode 라이선스 미동의로 보입니다 -> 터미널에서: sudo xcodebuild -license" ;;
    *) MARU_ENV_ERR="$MARU_ENV_ERR Command Line Tools(xcode-select --install) 또는 Homebrew 로 $t 를 설치하세요." ;;
  esac
  return 1
}

# Claude Code의 프로젝트 슬러그 규칙: 실제 경로에서 영숫자가 아닌 문자를 모두 '-'로 바꾼다. 실패하면 비어 있는 채로 1.
maru_slug() { python3 -c 'import os,re,sys;print(re.sub(r"[^A-Za-z0-9]","-",os.path.realpath(sys.argv[1])))' "$1" 2>/dev/null; }

# 기억 폴더 경로 검증: maru_mem_check <경로>. 문제면 이유를 한 줄 출력하고 1.
# 허용 형태는 오직 <PROJECTS>/<slug>/memory (slug 는 비어 있지 않은 한 단계 이름).
maru_mem_check() {
  local m=${1:-} p=${PROJECTS:-} rest slug
  [ -n "$p" ] || { echo "PROJECTS 가 비어 있음"; return 1; }
  case $p in /*) ;; *) echo "PROJECTS 가 절대 경로가 아님: $p"; return 1;; esac
  case $p in *//*|*/../*|*/..) echo "PROJECTS 경로가 이상함: $p"; return 1;; esac
  [ -n "$m" ] || { echo "기억 폴더 경로가 비어 있음"; return 1; }
  case $m in /*) ;; *) echo "기억 폴더가 절대 경로가 아님: $m"; return 1;; esac
  case $m in *//*) echo "기억 폴더 경로에 // 가 있음: $m"; return 1;; esac
  case $m in */../*|*/..) echo "기억 폴더 경로에 .. 가 있음: $m"; return 1;; esac
  rest=${m#"$p"/}
  [ "$rest" != "$m" ] || { echo "기억 폴더가 projects/ 아래가 아님: $m"; return 1; }
  slug=${rest%/memory}
  { [ "$slug" != "$rest" ] && [ -n "$slug" ]; } || { echo "기억 폴더가 projects/<slug>/memory 형태가 아님: $m"; return 1; }
  case $slug in */*) echo "기억 폴더가 projects/<slug>/memory 형태가 아님: $m"; return 1;; esac
  return 0
}

_maru_resolve_env() {
  local s why pw="" gw=""
  PROJECTS=${PROJECTS%/}
  # 둘 다 PATH 를 건드리기 전에 먼저 실행해 본다(원인을 정확히 남기기 위해)
  _maru_probe python3 || pw=$(_maru_why python3)
  _maru_probe git || gw=$(_maru_why git)
  _maru_resolve_tool python3 "$pw" || return 1
  _maru_resolve_tool git "$gw" || return 1
  if [ -z "${MEM:-}" ]; then
    s=$(maru_slug "$MARU_HOME") || s=""
    if [ -z "$s" ]; then MARU_ENV_ERR="마루: 기억 폴더 slug 계산 실패(python3 출력이 비어 있음, MARU_HOME=$MARU_HOME)"; return 1; fi
    MEM=$PROJECTS/$s/memory
  fi
  if ! why=$(maru_mem_check "$MEM"); then MARU_ENV_ERR="마루: 기억 폴더 계산 결과가 올바르지 않음 — $why"; return 1; fi
  return 0
}

# ---- 언어(MARU_LANG = ko|en) 해석
# 우선순위: 환경변수 MARU_LANG(정확히 ko 또는 en; data/maru.conf 에서 `MARU_LANG=${MARU_LANG:-en}` 으로 정해도 같다) >
# $MARU_DATA/profile.json 의 lang(앱이 쓴다) > ko. 로캘은 보지 않는다(launchd 처럼 LANG 이 없는 환경에서 기존 한국어 사용자가 바뀌지 않게).
# 프로필은 믿지 않는 입력: O_NOFOLLOW|O_NONBLOCK 으로 열어 일반 파일인지 fstat 로 확인하고(FIFO·링크에 멈추지 않는다) 4096바이트 이하만 읽는다.
# MARU_LANG 이 이미 유효하면 python 을 띄우지 않는다.
maru_resolve_lang() {
  local l=""
  case "${MARU_LANG:-}" in ko|en) return 0;; esac
  l=$(python3 -I - "$MARU_DATA/profile.json" <<'PY' 2>/dev/null
import json, os, stat, sys
try:
    fd = os.open(sys.argv[1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > 4096: sys.exit(0)
        raw = os.read(fd, 4097)
    finally:
        os.close(fd)
    if len(raw) > 4096: sys.exit(0)
    o = json.loads(raw.decode("utf-8"))
    v = o.get("lang") if isinstance(o, dict) else None
    if v in ("ko", "en"): print(v)
except Exception:
    pass
PY
  )
  case "$l" in ko|en) MARU_LANG=$l;; *) MARU_LANG=ko;; esac
  return 0
}
# T <한국어> <영어>: MARU_LANG 이 en 이면 영어, 아니면 한국어 문구(호출 시점에 읽는다)
type T >/dev/null 2>&1 || T() { if [ "${MARU_LANG:-ko}" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
# 언어별 파일 고르기: maru_localized <경로.md> -> en 이고 <경로>.en.md 가 일반 파일이면 그것, 아니면 원래 파일
maru_localized() {
  local f=$1 e=${1%.md}.en.md
  if [ "${MARU_LANG:-}" = en ] && [ -f "$e" ] && [ ! -L "$e" ]; then printf '%s' "$e"; else printf '%s' "$f"; fi
}

if _maru_resolve_env; then
  maru_resolve_lang
  export MARU_LANG
  # ~/.claude 아래 쓰기는 허용 규칙만으로는 막히므로, 헤드리스 실행에는 이 기억 폴더를 "자동 기억 폴더"로 지정해
  # 쓰기를 허용한다(실측: 이 설정 + cwd가 저장소 밖이면 memory 쓰기만 허용되고 다른 곳은 거부된다).
  MEM_SETTINGS=$(jq -nc --arg m "$MEM" '{autoMemoryDirectory:$m}' 2>/dev/null) || MEM_SETTINGS=""
else
  unset MEM MEM_SETTINGS
  echo "$MARU_ENV_ERR" >&2
  if [ -n "${MARU_LIB_SOFT:-}" ]; then return 1; fi
  exit 69
fi
