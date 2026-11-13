#!/bin/bash
# 매일 1회 정리(dream): 놓친 세션 회고(sweep) → 기억 정리(consolidate) → 커밋
# 테스트용: dream.sh --apply-deletions <memdir> <delete.txt>  (삭제 가드만 실행)
MODEL="${DREAM_MODEL:-sonnet}"            # 정리에 쓸 모델
CLAUDE_TIMEOUT="${DREAM_TIMEOUT:-600}"    # claude -p 하드 제한(초)
MAX_SWEEP="${DREAM_MAX_SWEEP:-8}"         # 한 번에 회고할 최대 세션 수
SWEEP_HOURS=36                            # 최근 이 시간 안에 수정된 transcript만
IDLE_MIN=60                               # 이 분 안에 수정된 건 진행 중일 수 있어 제외
MAX_DELETE=5                              # 한 번에 삭제 가능한 최대 파일 수(비율 20%와 함께 적용)
SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
. "$SCRIPTS/lib.sh"   # MARU_HOME/MARU_DATA/MEM/STAGE 등 설정
LOG=$LOGS/dream.log
MARKER=$STATE/dream.marker
mkdir -p "$LOGS" "$STATE" "$MARU_DATA/backups"
log() { echo "$(date '+%F %T') [dream] $*" >> "$LOG"; }

# 삭제 가드: apply_deletions <memdir> <list>. 항목 하나라도 거부되거나 한도를 넘으면
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

if [ "$1" = "--apply-deletions" ]; then apply_deletions "$2" "$3"; exit $?; fi

# 잠금: 동시에 둘째 dream은 즉시 종료
DLOCK=$STATE/dream.lock.d
acquire_lock "$DLOCK" 1 || { log "이미 실행 중 — 종료"; exit 0; }
trap 'rm -rf "$DLOCK"; rotate_log "$LOG"' EXIT
log "시작 (model=$MODEL, sweep 최대 $MAX_SWEEP)"

# ---- a. Sweep: SessionEnd가 안 울린 세션 회고
# 일이 필요한 것만 상한에 센다: UUID 이름이 아니거나, 이미 끝까지 처리했거나(state/<sid>.lines),
# 이미 한 번 시도했거나(state/<sid>.swept) 하면 세지 않고 건너뜀. 오래된 것부터 처리해 36시간 창 밖으로 밀려나지 않게 한다.
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
  echo "$total" > "$STATE/$sid.swept"
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
txn_begin "$MEM" "$TXN" || { log "스냅샷 실패 — 정리 건너뜀"; rm -rf "$TXN"; exit 0; }
prompt="$(sed -e "s#{{MEMORY_DIR}}#$MEM#g" -e "s#{{STAGE_DIR}}#$STAGE#g" "$MARU_HOME/prompts/consolidate-prompt.md")"
mkdir -p "$MARU_WORK" && cd "$MARU_WORK" || exit 0
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
[ $rc -eq 142 ] && log "claude ${CLAUDE_TIMEOUT}s 초과 — 강제 종료"
log "claude 종료 rc=$rc"
printf '%s\n' "$out" | grep -v '^Warning: this sign-in' >> "$LOG"

reason=""
if [ $rc -ne 0 ]; then reason="모델 rc=$rc"
elif ! apply_deletions "$MEM" "$STAGE/delete.txt"; then reason="삭제 목록 거부"
else reason=$(mem_validate "$MEM" "$before_n") || true
fi
if [ -n "$reason" ]; then
  txn_restore "$MEM" "$TXN"
  log "되돌림(변경 폐기, 커밋·삭제 없음): $reason"
  fail_bump dream
else
  mem_snap "$MEM" | md5 -q > "$MARKER"
  fail_reset dream
fi
txn_end "$TXN"; rm -rf "$STAGE"
[ -n "$reason" ] && exit 0

# ---- c. Commit: 기억 폴더만
summary=$(printf '%s\n' "$out" | grep -v '^Warning: this sign-in' | grep -v '^$' | head -1 \
  | python3 -c 'import sys;print(sys.stdin.read().strip()[:100])')
H="$SCRIPTS/hist"
"$H" add -A -- "$MEM" >> "$LOG" 2>&1
if ! "$H" diff --cached --quiet -- "$MEM" 2>/dev/null; then
  "$H" commit -q -m "dream: $(date +%F) — ${summary:-정리}" -- "$MEM" >> "$LOG" 2>&1 && log "커밋 완료"
else
  log "변경 없음(커밋 안 함)"
fi
