#!/bin/bash
# 매일 1회 정리(dream): 놓친 세션 회고(sweep) → 기억 정리(consolidate) → 커밋
# 테스트용: dream.sh --apply-deletions <memdir> <delete.txt>  (삭제 가드만 실행)
MODEL="${DREAM_MODEL:-sonnet}"            # 정리에 쓸 모델
CLAUDE_TIMEOUT="${DREAM_TIMEOUT:-600}"    # claude -p 하드 제한(초)
MAX_SWEEP="${DREAM_MAX_SWEEP:-8}"         # 한 번에 회고할 최대 세션 수
SWEEP_HOURS=${MARU_SWEEP_HOURS:-36}       # 최근 이 시간 안에 수정된 transcript만(기본 36). 놓친 세션 보충용으로 MARU_SWEEP_HOURS=96 처럼 일시 확장(1~720)
IDLE_MIN=60                               # 이 분 안에 수정된 건 진행 중일 수 있어 제외
SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# lib.sh 가 도구·기억 폴더 검증에 실패하면 여기서 로그·알림 처리 후 종료한다(조용히 넘어가지 않는다)
MARU_LIB_SOFT=1 . "$SCRIPTS/lib.sh"; lib_rc=$?   # MARU_HOME/MARU_DATA/MEM/STAGE 등 설정
unset MARU_LIB_SOFT
LOG=$LOGS/dream.log
MARKER=$STATE/dream.marker
mkdir -p "$LOGS" "$STATE" "$MARU_DATA/backups" 2>/dev/null
log() { echo "$(date '+%F %T') [dream] $*" >> "$LOG"; }

# 삭제 가드 apply_deletions 는 lib.sh 에 있다(reflect 와 공용)

if [ "${1:-}" = "--apply-deletions" ]; then apply_deletions "$2" "$3"; exit $?; fi

# 환경 오류: 로그 + 실패 횟수(첫 번째에 알림) 후 종료. 이 경우 어떤 세션도 처리 완료로 표시하지 않는다.
env_fail() { log "환경 오류: $*"; echo "마루 dream: $*" >&2; fail_bump dream env; }
envreason=""
if [ "$lib_rc" -ne 0 ]; then envreason=${MARU_ENV_ERR:-도구/기억 폴더 확인 실패}
elif [ -z "${MEM_SETTINGS:-}" ]; then envreason="jq 로 설정 JSON 을 만들지 못함(jq 실행 불가?)"
elif [ ! -d "$MEM" ]; then envreason="기억 폴더가 없음: $MEM"
fi
if [ -n "$envreason" ]; then env_fail "$envreason — 정리 중단(sweep 도 하지 않음)"; exit 1; fi

# sweep 시간 창 검증: 1~720 정수만(앞의 0은 10진수로 취급)
case $SWEEP_HOURS in ''|*[!0-9]*) SWEEP_HOURS=bad ;; esac
if [ "$SWEEP_HOURS" != bad ] && [ ${#SWEEP_HOURS} -le 4 ]; then SWEEP_HOURS=$((10#$SWEEP_HOURS)); else SWEEP_HOURS=bad; fi
if [ "$SWEEP_HOURS" = bad ] || [ "$SWEEP_HOURS" -lt 1 ] || [ "$SWEEP_HOURS" -gt 720 ]; then
  log "MARU_SWEEP_HOURS 값이 올바르지 않음(1~720 정수): ${MARU_SWEEP_HOURS:-} — 종료"
  echo "MARU_SWEEP_HOURS 는 1~720 사이 정수여야 합니다: ${MARU_SWEEP_HOURS:-}" >&2
  exit 2
fi

# 잠금: 동시에 둘째 dream은 즉시 종료
DLOCK=$STATE/dream.lock.d
acquire_lock "$DLOCK" 1 || { log "이미 실행 중 — 종료"; exit 0; }
trap 'rm -rf "$DLOCK"; rotate_log "$LOG"' EXIT
log "시작 (model=$MODEL, sweep 최대 $MAX_SWEEP, 시간 창 ${SWEEP_HOURS}시간)"

# ---- a. Sweep: SessionEnd가 안 울린 세션 회고
# 일이 필요한 것만 상한에 센다: UUID 이름이 아니거나, 이미 끝까지 처리했거나(state/<sid>.lines),
# 이미 한 번 시도했거나(state/<sid>.swept) 하면 세지 않고 건너뜀. 오래된 것부터 처리해 시간 창(기본 36시간) 밖으로 밀려나지 않게 한다.
cands=$(find "$PROJECTS" -maxdepth 2 -name '*.jsonl' -type f -mmin -$((SWEEP_HOURS*60)) -mmin +$IDLE_MIN \
  -exec stat -f '%m %N' {} + 2>/dev/null | sort -n | cut -d' ' -f2-)
found=0; cnt=0; skipped=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  found=$((found+1))
  sid=$(basename "$f" .jsonl)
  if ! [[ "$sid" =~ ^[0-9a-fA-F-]{36}$ ]]; then skipped=$((skipped+1)); continue; fi
  total=$(wc -l < "$f" | tr -d ' ')
  done_l=$(cat "$STATE/$sid.lines" 2>/dev/null); [[ "$done_l" =~ ^[0-9]+$ ]] || done_l=0
  done_s=$(cat "$STATE/$sid.swept" 2>/dev/null); [[ "$done_s" =~ ^[0-9]+$ ]] || done_s=0
  if [ "$done_l" -ge "$total" ] || [ "$done_s" -ge "$total" ]; then skipped=$((skipped+1)); continue; fi
  [ "$cnt" -ge "$MAX_SWEEP" ] && break
  cnt=$((cnt+1))
  log "sweep $cnt: ${sid:0:8} (줄 ${done_l}→${total})"
  bash "$SCRIPTS/reflect.sh" --run "$f" "$sid" >> "$LOGS/reflect.log" 2>&1 </dev/null
  rrc=$?
  # 성공(0)이거나 의도적 건너뜀(10)일 때만 처리 완료로 표시한다. 실패(11)·잠금 시간 초과(12)는 다음 실행에서 재시도.
  case $rrc in
    0|10) echo "$total" > "$STATE/$sid.swept" ;;
    *) log "sweep ${sid:0:8}: reflect rc=$rrc — 처리 완료로 표시하지 않음(다음에 재시도)" ;;
  esac
done <<< "$cands"
log "sweep 끝: 후보 ${found}개, 건너뜀 ${skipped}개, 처리 ${cnt}개(상한 $MAX_SWEEP)"

# ---- b. Consolidate: 마지막 정리 이후 기억이 안 바뀌었으면 건너뜀
cur=$(mem_snap "$MEM" | md5 -q)
if [ "$cur" = "$(cat "$MARKER" 2>/dev/null)" ]; then log "기억 변경 없음 — 정리 건너뜀"; exit 0; fi

# 기억 쓰기는 reflect와 같은 잠금을 쥐고 한다(최대 15분 대기)
RLOCK=$STATE/lock.d
acquire_lock "$RLOCK" 180 || { log "reflect 잠금 실패 — 정리 건너뜀"; exit 0; }
trap 'rm -rf "$RLOCK" "$DLOCK"; rotate_log "$LOG"' EXIT
rm -rf "$STAGE"; mkdir -p "$STAGE"
TXN=$STATE/txn.dream
before_n=$(find "$MEM" -maxdepth 1 -type f -name '*.md' ! -name MEMORY.md | wc -l | tr -d ' ')
prompt="$(render_template "$MARU_HOME/prompts/consolidate-prompt.md" MEMORY_DIR="$MEM" STAGE_DIR="$STAGE")"
mkdir -p "$MARU_WORK" && cd "$MARU_WORK" || { env_fail "작업 폴더를 만들 수 없음: $MARU_WORK"; exit 1; }
# 되돌림 창을 최소화하려고 스냅샷은 모델 호출 직전에 뜬다(lib.sh txn_begin 설명 참고)
txn_begin "$MEM" "$TXN" || { env_fail "기억 폴더 스냅샷 실패 — 정리 건너뜀(MEM 경로·권한 확인)"; txn_end "$TXN"; exit 1; }
log "정리 시작"
# 테스트 훅: DREAM_FAKE_MODEL(스크립트 경로)이 claude 호출을 대신한다. 사고 방지를 위해
# DREAM_ALLOW_FAKE=yes-i-am-testing 도 함께 있어야만 동작한다. launchd plist·훅 환경에는 둘 다 없다.
if [ -n "$DREAM_FAKE_MODEL" ] && [ "$DREAM_ALLOW_FAKE" = "yes-i-am-testing" ]; then
  log "!! 테스트 훅 사용: $DREAM_FAKE_MODEL"
  out=$(AGENT_REFLECTING=1 perl -e 'alarm shift; exec @ARGV' "$CLAUDE_TIMEOUT" "$DREAM_FAKE_MODEL" </dev/null 2>&1)
else
out=$(AGENT_REFLECTING=1 perl -e 'alarm shift; exec @ARGV' "$CLAUDE_TIMEOUT" \
  claude -p "$prompt" --model "$MODEL" \
  --no-session-persistence --permission-mode dontAsk \
  --settings "$MEM_SETTINGS" \
  --tools Read,Grep,Glob,Write,Edit \
  --allowedTools "Read(/$MEM/**)" "Grep(/$MEM/**)" "Glob(/$MEM/**)" \
    "Edit(/$MEM/**)" "Edit(/$STAGE/**)" \
  </dev/null 2>&1)
fi
rc=$?
txn_after "$MEM" "$TXN"
[ $rc -eq 142 ] && log "claude ${CLAUDE_TIMEOUT}s 초과 — 강제 종료"
log "claude 종료 rc=$rc"
printf '%s\n' "$out" | grep -v '^Warning: this sign-in' >> "$LOG"

reason=""
if [ $rc -ne 0 ]; then reason="모델 rc=$rc"
elif ! apply_deletions "$MEM" "$STAGE/delete.txt"; then reason="삭제 목록 거부"
elif comm -3 "$TXN.A" "$TXN.B" | grep -Eq ' \./journal(/|$)'; then reason="모델이 journal/ 을 건드림"
else reason=$(mem_validate "$MEM" "$before_n") || true
fi
if [ -n "$reason" ]; then
  txn_restore "$MEM" "$TXN"
  log "되돌림(변경 폐기, 커밋·삭제 없음): $reason"
  fail_bump dream
else
  # 모델의 journal/ 변조 검사가 끝난 뒤에 셸이 오래된 일지를 archive/ 로 옮긴다(검사에 걸리지 않는 순서). 보관 뒤 스냅샷으로 마커를 기록한다.
  archive_journal 14
  mem_snap "$MEM" | md5 -q > "$MARKER"
  fail_reset dream
fi
txn_end "$TXN"
if [ -z "$reason" ]; then   # 추천·할 일 목록: 기억 트랜잭션과 독립(lib.sh)
  apply_suggestions "$STAGE/suggestions.txt"   # (옛 방식)
  apply_todos "$STAGE/todos.txt"               # 옛 추천보다 우선
fi
rm -rf "$STAGE"
[ -n "$reason" ] && exit 0

# ---- c. Commit: 기억 폴더만
summary=$(printf '%s\n' "$out" | grep -v '^Warning: this sign-in' | grep -v '^$' | head -1 \
  | python3 -c 'import sys;print(sys.stdin.read().strip()[:100])')
# 일지 승격으로 만들거나 고친 기억 파일 목록(요약 출력의 `승격:` 줄, 모델이 쓴 그대로 — 검증하지 않은 로그용)
promoted=$(printf '%s\n' "$out" | grep -m1 '^승격:' | cut -c1-300)
[ -n "$promoted" ] && log "일지 승격 보고 — $promoted"
hist_git add -A -- "$MEM" >> "$LOG" 2>&1
if ! hist_git diff --cached --quiet -- "$MEM" 2>/dev/null; then
  hist_git commit -q -m "dream: $(date +%F) — ${summary:-정리}" -- "$MEM" >> "$LOG" 2>&1 && log "커밋 완료"
else
  log "변경 없음(커밋 안 함)"
fi
