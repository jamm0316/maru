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
MARU_SKILL_AUTOINSTALL=${MARU_SKILL_AUTOINSTALL:-}         # 1이면 install.sh 가 "검토 후 문제 없으면 에이전트가 직접 설치" 문구를 쓴다(기본: 사용자 동의 후 설치)
MAX_DELETE=${MAX_DELETE:-5}                                # 한 번에 삭제 가능한 최대 기억 파일 수(비율 20%와 함께 적용)
SKILLS_VIEW=${MARU_SKILLS_VIEW:-$MARU_DATA/skills-view}    # 헤드리스 모델이 읽는 스킬 복사본(심볼릭 링크 우회 방지)
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

# ---- 트랜잭션: 모델 실행 직전 memory 를 복사하고 파일별 체크섬 목록 A 를 만든다.
# 모델 종료 직후 목록 B 를 만든다. 되돌릴 대상은 diff(A,B), 즉 "이번 실행이 바꾼 경로"뿐이다.
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
