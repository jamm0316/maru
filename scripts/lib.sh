#!/bin/bash
# reflect.sh / dream.sh / hist 공용 설정과 함수 (source 전용). 호출 쪽이 log() 를 정의해 둬야 한다.

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

# Claude Code의 프로젝트 슬러그 규칙: 실제 경로에서 영숫자가 아닌 문자를 모두 '-'로 바꾼다.
maru_slug() { python3 -c 'import os,re,sys;print(re.sub(r"[^A-Za-z0-9]","-",os.path.realpath(sys.argv[1])))' "$1"; }
MEM=${MEM:-$PROJECTS/$(maru_slug "$MARU_HOME")/memory}    # 자동 기억 폴더(maru 프로젝트용)

# ~/.claude 아래 쓰기는 허용 규칙만으로는 막히므로, 헤드리스 실행에는 이 기억 폴더를 "자동 기억 폴더"로 지정해
# 쓰기를 허용한다(실측: 이 설정 + cwd가 저장소 밖이면 memory 쓰기만 허용되고 다른 곳은 거부된다).
MEM_SETTINGS=$(jq -nc --arg m "$MEM" '{autoMemoryDirectory:$m}')

STATE=${MARU_STATE:-$MARU_DATA/state}
LOGS=${MARU_LOGS:-$MARU_DATA/logs}
DIGESTS=${MARU_DIGESTS:-$MARU_DATA/digests}
PROPOSALS=${MARU_PROPOSALS:-$MARU_DATA/skill-proposals}    # 스킬 제안만 쌓는다. 자동 설치 없음
STAGE=${MARU_STAGE:-$MARU_DATA/stage}                      # 헤드리스 모델이 쓸 수 있는 임시 폴더(memory 외 유일)
# 헤드리스 실행의 cwd. 저장소(git 루트) 밖의 빈 폴더여야 한다: 저장소 안이면 프로젝트 설정
# (홈 전체 접근 허용)과 CLAUDE.md 가 읽히고, cwd 아래 읽기는 자동 허용되기 때문이다.
MARU_WORK=${MARU_WORK:-$HOME/.maru-work}
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
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

# ---- 트랜잭션: 모델 실행 전 memory 전체를 복사해 두고, 실패 시 정확히 되돌린다
# txn_begin <memdir> <snapdir>
txn_begin() { rm -rf "$2"; mkdir -p "$2" && cp -Rp "$1/." "$2/"; }
# txn_restore <memdir> <snapdir>: 실행 중 추가된 파일 삭제, 바뀐/지워진 파일 복원
txn_restore() { rsync -a --delete "$2/" "$1/"; }
txn_end() { rm -rf "$1"; }

# memory 폴더 검증. 문제가 있으면 이유를 한 줄 출력하고 1 반환.
# mem_validate <memdir> <실행 전 파일 수(MEMORY.md 제외)>
mem_validate() {
  local mem=$1 before=$2 f n after name
  [ -s "$mem/MEMORY.md" ] || { echo "MEMORY.md 없음/비어 있음"; return 1; }
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

# ---- 연속 실패 알림: fail_bump <이름> / fail_reset <이름>
# 2번째 연속 실패에서 딱 한 번 macOS 알림. 성공(fail_reset)이 있기 전에는 다시 알리지 않는다.
# osascript가 없거나 실패·지연돼도 스크립트에는 영향이 없다.
notify_fail() {
  command -v osascript >/dev/null 2>&1 || return 0
  perl -e 'alarm 10; exec @ARGV' osascript -e \
    'display notification "회고/정리가 연속 실패했습니다. 로그인 만료 여부를 확인하세요: claude auth login" with title "마루"' \
    >/dev/null 2>&1 </dev/null || true
  return 0
}
fail_bump() {
  local f="$STATE/fail.$1" n
  n=$(cat "$f" 2>/dev/null); [[ "$n" =~ ^[0-9]+$ ]] || n=0
  n=$((n+1)); echo "$n" > "$f"
  if [ "$n" -eq 2 ]; then notify_fail; type log >/dev/null 2>&1 && log "연속 실패 $n회($1) — 알림 시도"; fi
  return 0
}
fail_reset() { rm -f "$STATE/fail.$1"; }
