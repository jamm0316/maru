#!/bin/bash
# 텔레그램으로 지시를 받는 상시 세션(tmux 안의 claude --channels).
# 사용: telegram.sh start [--unattended] | stop | status | attach | logs [줄 수]
# 설치·토큰 입력·페어링은 사용자가 직접 한다(README 「텔레그램으로 지시하기」). 이 스크립트는 아무것도 설치하지 않고 토큰 파일을 읽지 않는다.
set -u
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")
. "$(dirname "$SELF")/lib.sh"
SESS=$MARU_TELEGRAM_SESSION
CHANNEL=plugin:telegram@claude-plugins-official
RST_FILE=$STATE/telegram.restarts
STOP_FILE=$STATE/telegram.stop
# 접근 목록(access.json): 플러그인 server.ts 기준 ${TELEGRAM_STATE_DIR:-$CLAUDE_DIR/channels/telegram}/access.json.
# 읽는 필드는 dmPolicy, allowFrom(개수만), groups(개수만)뿐. 토큰이 있는 .env 는 읽지 않는다.
ACCESS_FILE=${TELEGRAM_STATE_DIR:-$CLAUDE_DIR/channels/telegram}/access.json
# 테스트 전용 스위치(reflect.sh 와 같은 방식): 둘 다 있고 세션 이름이 maru-test 로 시작할 때만 유효. 평소·launchd 환경엔 없다.
FAKE_CMD=""
if [ "${MARU_TELEGRAM_ALLOW_FAKE:-}" = "yes-i-am-testing" ] && [[ "$SESS" == maru-test* ]]; then
  FAKE_CMD=${MARU_TELEGRAM_FAKE_CMD:-}
  [ -n "${MARU_TELEGRAM_FAKE_ACCESS:-}" ] && ACCESS_FILE=$MARU_TELEGRAM_FAKE_ACCESS
fi

die() { echo "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
running() { have tmux && tmux has-session -t "=$SESS" 2>/dev/null; }

# 설정 검증: 권한 모드는 허용 목록 방식, 숫자는 양의 정수.
check_config() {
  case "$MARU_TELEGRAM_PERMISSION_MODE" in
    default|acceptEdits|plan|auto) ;;
    *) echo "MARU_TELEGRAM_PERMISSION_MODE='$MARU_TELEGRAM_PERMISSION_MODE' 는 허용되지 않습니다. 허용: default acceptEdits plan auto (빈 값·bypassPermissions·dontAsk 불가)." >&2; return 1;;
  esac
  [[ "$MARU_TELEGRAM_MAX_RESTARTS" =~ ^[1-9][0-9]{0,2}$ ]] \
    || { echo "MARU_TELEGRAM_MAX_RESTARTS='$MARU_TELEGRAM_MAX_RESTARTS' 는 1~999 의 정수여야 합니다." >&2; return 1; }
  return 0
}

# access.json 상태: 0=allowlist 이고 허용 발신자 1명 이상·허용 그룹 없음, 1=그 외. 이유는 ACCESS_WHY 에.
ACCESS_WHY=""
access_ready() {
  have jq || { ACCESS_WHY="jq 가 없어 접근 설정을 확인할 수 없음"; return 1; }
  [ -f "$ACCESS_FILE" ] || { ACCESS_WHY="접근 파일 없음(아직 페어링 전)"; return 1; }
  local pol n g
  pol=$(jq -r '.dmPolicy // "pairing"' "$ACCESS_FILE" 2>/dev/null) || { ACCESS_WHY="접근 파일을 읽지 못함"; return 1; }
  n=$(jq -r '(.allowFrom // []) | length' "$ACCESS_FILE" 2>/dev/null); g=$(jq -r '(.groups // {}) | length' "$ACCESS_FILE" 2>/dev/null)
  [ "$pol" = allowlist ] || { ACCESS_WHY="접근 정책이 allowlist 가 아님($pol)"; return 1; }
  [ "${n:-0}" -ge 1 ] 2>/dev/null || { ACCESS_WHY="허용된 발신자가 없음"; return 1; }
  [ "${g:-0}" = 0 ] || { ACCESS_WHY="허용된 그룹이 있음(본인 DM 만 허용해야 함)"; return 1; }
  return 0
}

# claude 플러그인 설치 범위 확인(maru 폴더에서 실행). 출력: 범위(local|project|user) 또는 빈 값
plugin_scope() {
  (cd "$MARU_HOME" && claude plugin list 2>/dev/null) | awk '
    /^ *❯ /{ on = ($0 ~ /telegram@claude-plugins-official/) }
    on && /Scope:/{ sub(/.*Scope: */,""); print; exit }'
}

# 막힌 화면 감지. 화면 내용은 파일에 쓰지 않고 안내 문구만 출력. 막힘이 있으면 0.
pane_blockers() {
  local t found=1
  t=$(tmux capture-pane -p -t "=$SESS:" 2>/dev/null) || return 1
  if grep -qiE 'not logged in|please run /login|invalid api key|sign-in (has )?expired|session expired|run claude auth login' <<<"$t"; then echo "  막힘: 로그인 만료/필요 — attach 해서 /login 하세요(claude auth login)"; found=0; fi
  if grep -qiE 'trust this folder|do you trust|new mcp server found|use this mcp server|i am using this for local development' <<<"$t"; then echo "  막힘: 신뢰/동의 화면이 응답을 기다림 — attach 해서 직접 선택하세요"; found=0; fi
  if grep -qiE 'telegram_bot_token|/telegram:configure|not configured|no bot token' <<<"$t"; then echo "  막힘: 텔레그램 플러그인이 설정되지 않음(토큰) — README 1회 설정 참고"; found=0; fi
  if grep -qiE 'blocked by org policy|not on the approved|channels? (are|is) not enabled|channels.*(disabled|blocked)' <<<"$t"; then echo "  막힘: 채널이 조직 정책/승인 목록으로 차단됨"; found=0; fi
  return $found
}

# 프로세스 트리: desc <pid> 는 모든 자손 pid 를 출력
desc() { local c; for c in $(pgrep -P "$1" 2>/dev/null); do echo "$c"; desc "$c"; done; }

# tmux 안에서 도는 루프(내부용).
loop() {
  check_config || exit 1
  mkdir -p "$STATE"; : > "$RST_FILE"
  local rc now n delay times t
  local cmd=(claude --channels "$CHANNEL" --permission-mode "$MARU_TELEGRAM_PERMISSION_MODE")
  [ -n "$FAKE_CMD" ] && cmd=(bash -c "$FAKE_CMD")
  cd "$MARU_HOME" || exit 1
  while :; do
    [ -e "$STOP_FILE" ] && break
    caffeinate -i "${cmd[@]}"; rc=$?
    [ -e "$STOP_FILE" ] && break
    [ "$rc" -eq 0 ] && { echo "[마루] claude 정상 종료 — 세션을 끝냅니다."; break; }
    now=$(date +%s); times=""
    for t in $(cat "$RST_FILE" 2>/dev/null); do [ $((now - t)) -lt 3600 ] && times="$times $t"; done
    n=$(echo $times | wc -w | tr -d ' ')
    if [ "$n" -ge "$MARU_TELEGRAM_MAX_RESTARTS" ]; then
      echo "[마루] 1시간 안에 ${n}회 재시작해 중단합니다. 원인을 확인한 뒤 telegram.sh start 로 다시 시작하세요."
      notify_text "텔레그램 세션이 반복 종료되어 멈췄습니다. telegram.sh logs 로 확인하세요."
      break
    fi
    echo "$times $now" | tr ' ' '\n' | grep . > "$RST_FILE"
    delay=$((10 * (1 << n))); [ "$delay" -gt 300 ] && delay=300
    [ -n "${MARU_TELEGRAM_TEST_BACKOFF:-}" ] && [ -n "$FAKE_CMD" ] && delay=$MARU_TELEGRAM_TEST_BACKOFF
    echo "[마루] claude 종료(코드 $rc) — ${delay}초 뒤 재시작($((n + 1))/$MARU_TELEGRAM_MAX_RESTARTS)"
    sleep "$delay"
  done
}

cmd_start() {
  local unattended=0 miss=0 sc
  case "${1:-}" in "") ;; --unattended) unattended=1;; *) die "알 수 없는 옵션: $1";; esac
  check_config || exit 1
  if [ -z "$FAKE_CMD" ]; then
    have claude || { echo "claude 가 없습니다. Claude Code 를 먼저 설치하세요." >&2; miss=1; }
    have bun || { echo "bun 이 없습니다(텔레그램 플러그인 실행에 필요). 설치: brew install oven-sh/bun/bun" >&2; miss=1; }
  fi
  have tmux || { echo "tmux 가 없습니다. 설치: brew install tmux" >&2; miss=1; }
  have caffeinate || { echo "caffeinate 가 없습니다(macOS 기본 도구인데 PATH 에 없음)." >&2; miss=1; }
  [ "$miss" = 0 ] || die "필요한 도구를 직접 설치한 뒤 다시 실행하세요. 이 스크립트는 아무것도 설치하지 않습니다."
  if [ -z "$FAKE_CMD" ]; then
    sc=$(plugin_scope)
    case "$sc" in
      local|project) ;;
      user) die "텔레그램 플러그인이 user 범위로 설치되어 있습니다(모든 세션에서 로드되어 봇 폴러가 중복될 수 있음). README 의 범위 이동 절차(user 제거 후 maru 폴더에서 --scope local 설치)를 따르세요." ;;
      *) die "텔레그램 플러그인이 설치되어 있지 않습니다. README 「텔레그램으로 지시하기」의 1회 설정(maru 폴더에서 claude plugin install telegram@claude-plugins-official --scope local)을 먼저 하세요." ;;
    esac
  fi
  if ! access_ready; then
    if [ "$unattended" = 1 ]; then
      notify_text "텔레그램 자동 시작 거부: $ACCESS_WHY"
      die "--unattended 는 allowlist 정책과 허용 발신자 1명 이상이 있어야 시작합니다: $ACCESS_WHY. 먼저 수동으로 start 후 attach 해서 페어링하세요."
    fi
    echo "################################################################" >&2
    echo "# 경고: 접근 설정이 안전하지 않습니다 — $ACCESS_WHY" >&2
    echo "# 페어링 전/정책이 pairing 인 동안 봇에 메시지를 보낸 아무에게나 페어링 코드가 나갑니다." >&2
    echo "# attach 해서 /telegram:access pair <코드> 후 /telegram:access policy allowlist 를 바로 실행하세요." >&2
    echo "################################################################" >&2
  fi
  running && die "이미 실행 중입니다(tmux 세션 $SESS). 상태: $0 status"
  rm -f "$STOP_FILE"; mkdir -p "$STATE"
  tmux new-session -d -s "$SESS" -c "$MARU_HOME" "bash '$SELF' _loop" || die "tmux 세션을 만들지 못했습니다."
  echo "시작했습니다: tmux 세션 $SESS, 권한 모드 $MARU_TELEGRAM_PERMISSION_MODE (화면 보기: $0 attach, 빠져나오기: Ctrl-b d)"
  sleep "${MARU_TELEGRAM_START_WAIT:-8}"
  if ! running; then
    echo "세션이 바로 종료되었습니다. 원인을 확인하세요." >&2; [ "$unattended" = 1 ] && notify_text "텔레그램 세션이 시작 직후 종료되었습니다."; exit 1
  fi
  local b; b=$(pane_blockers)
  if [ -n "$b" ]; then
    echo "주의: 세션은 떠 있지만 사용자 입력을 기다리는 화면입니다."; echo "$b"
    [ "$unattended" = 1 ] && notify_text "텔레그램 세션이 입력(로그인/동의/설정)을 기다리고 있습니다. telegram.sh status 로 확인하세요."
  fi
  return 0
}

cmd_stop() {
  have tmux || { echo "실행 중이 아닙니다(tmux 없음)."; return 0; }
  running || { echo "실행 중이 아닙니다."; return 0; }
  mkdir -p "$STATE"; : > "$STOP_FILE"                      # 재시작 루프가 되살리지 못하게
  local pp pids i left=""
  pp=$(tmux list-panes -t "=$SESS" -F '#{pane_pid}' 2>/dev/null | head -1)
  pids=""; if [ -n "$pp" ]; then pids="$pp $(desc "$pp" | tr '\n' ' ')"; fi
  [ -n "$pp" ] && kill -TERM "$pp" 2>/dev/null          # 루프 셸 먼저
  for p in $pids; do kill -TERM "$p" 2>/dev/null; done
  tmux kill-session -t "=$SESS" 2>/dev/null
  for i in 1 2 3 4 5 6 7 8 9 10; do
    left=""; for p in $pids; do kill -0 "$p" 2>/dev/null && left="$left $p"; done
    [ -z "$left" ] && break; sleep 0.5
  done
  if [ -n "$left" ]; then for p in $left; do kill -KILL "$p" 2>/dev/null; done; sleep 0.5; fi
  left=""; for p in $pids; do kill -0 "$p" 2>/dev/null && left="$left $p"; done
  if running || [ -n "$left" ]; then echo "중지 실패: 남은 프로세스 확인 필요(pid:$left)" >&2; return 1; fi
  echo "중지했습니다: $SESS (하위 프로세스 모두 종료 확인)"
}

cmd_status() {
  if ! have tmux; then echo "실행 중 아님 (tmux 가 설치되어 있지 않음)"; return 1; fi
  if ! running; then echo "실행 중 아님"; return 1; fi
  local c b; c=$(tmux display-message -p -t "=$SESS:" '#{session_created}' 2>/dev/null)
  echo "실행 중: tmux 세션 $SESS (시작: $(date -r "${c:-0}" '+%Y-%m-%d %H:%M:%S'), 권한 모드 $MARU_TELEGRAM_PERMISSION_MODE)"
  if access_ready; then echo "접근 설정: allowlist, 허용 발신자 있음"; else echo "접근 설정 주의: $ACCESS_WHY"; fi
  b=$(pane_blockers); [ -n "$b" ] && { echo "막힌 화면 감지:"; echo "$b"; }
  echo "--- 화면 마지막 줄 ---"
  tmux capture-pane -p -t "=$SESS:" | grep . | tail -n 8
}

cmd_attach() {
  have tmux || die "tmux 가 없습니다. 설치: brew install tmux"
  running || die "실행 중이 아닙니다. 먼저: $0 start"
  exec tmux attach -t "=$SESS"
}

cmd_logs() {
  have tmux || die "tmux 가 없습니다. 설치: brew install tmux"
  running || die "실행 중이 아닙니다."
  local n=${1:-100}; [[ "$n" =~ ^[0-9]+$ ]] || die "줄 수는 숫자여야 합니다."
  tmux capture-pane -p -t "=$SESS:" -S "-$n" | awk 'NF{l=NR} {a[NR]=$0} END{for(i=1;i<=l;i++)print a[i]}'   # 화면에만 출력한다. 파일로 저장하지 않는다(메시지 내용 보호).
}

case "${1:-}" in
  start) shift; cmd_start "$@";;
  stop) cmd_stop;;
  status) cmd_status;;
  attach) cmd_attach;;
  logs) shift; cmd_logs "$@";;
  check-access) if access_ready; then echo "접근 설정 OK(allowlist, 허용 발신자 있음)"; else echo "$ACCESS_WHY" >&2; exit 1; fi;;
  _loop) loop;;
  *) echo "사용: $0 start [--unattended]|stop|status|attach|logs [줄 수]" >&2; exit 2;;
esac
