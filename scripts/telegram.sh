#!/bin/bash
# 텔레그램으로 지시를 받는 상시 세션(tmux 안의 claude --channels). 사용: telegram.sh start|stop|status|attach|logs [줄 수]
# 설치·토큰 입력·페어링은 사용자가 직접 한다(README 「텔레그램으로 지시하기」). 이 스크립트는 아무것도 설치하지 않는다.
set -u
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")
. "$(dirname "$SELF")/lib.sh"
SESS=$MARU_TELEGRAM_SESSION
CHANNEL=plugin:telegram@claude-plugins-official
RST_FILE=$STATE/telegram.restarts

die() { echo "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
running() { have tmux && tmux has-session -t "=$SESS" 2>/dev/null; }

# 권한 모드 검증: 우회 모드는 어떤 경로로도 허용하지 않는다.
check_mode() {
  case "$MARU_TELEGRAM_PERMISSION_MODE" in
    ""|acceptEdits|auto|plan|manual|dontAsk) return 0;;
    *) echo "MARU_TELEGRAM_PERMISSION_MODE='$MARU_TELEGRAM_PERMISSION_MODE' 는 허용되지 않습니다(허용: acceptEdits auto plan manual dontAsk 또는 비움). bypassPermissions/--dangerously-skip-permissions 는 쓰지 않습니다." >&2; return 1;;
  esac
}

# tmux 안에서 도는 루프(내부용). claude 가 비정상 종료하면 백오프 후 재시작, 1시간에 N회 넘으면 알림 후 중단.
loop() {
  check_mode || exit 1
  mkdir -p "$STATE"; : > "$RST_FILE"
  local args=(--channels "$CHANNEL") rc now n delay times t
  [ -n "$MARU_TELEGRAM_PERMISSION_MODE" ] && args+=(--permission-mode "$MARU_TELEGRAM_PERMISSION_MODE")
  cd "$MARU_HOME" || exit 1
  while :; do
    caffeinate -i claude "${args[@]}"; rc=$?
    # 사용자가 attach 해서 정상 종료(/exit)했다면 되살리지 않는다.
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
    echo "[마루] claude 종료(코드 $rc) — ${delay}초 뒤 재시작($((n + 1))/$MARU_TELEGRAM_MAX_RESTARTS)"
    sleep "$delay"
  done
}

cmd_start() {
  local miss=0
  check_mode || exit 1
  have claude || { echo "claude 가 없습니다. Claude Code 를 먼저 설치하세요." >&2; miss=1; }
  have bun || { echo "bun 이 없습니다(텔레그램 플러그인 실행에 필요). 설치: brew install oven-sh/bun/bun  (또는 curl -fsSL https://bun.sh/install | bash)" >&2; miss=1; }
  have tmux || { echo "tmux 가 없습니다. 설치: brew install tmux" >&2; miss=1; }
  have caffeinate || { echo "caffeinate 가 없습니다(macOS 기본 도구인데 PATH 에 없음)." >&2; miss=1; }
  [ "$miss" = 0 ] || die "필요한 도구를 직접 설치한 뒤 다시 실행하세요. 이 스크립트는 아무것도 설치하지 않습니다."
  claude plugin list 2>&1 | grep -q 'telegram@claude-plugins-official' \
    || die "텔레그램 플러그인이 설치되어 있지 않습니다. README 「텔레그램으로 지시하기」의 1회 설정(claude 안에서 /plugin install telegram@claude-plugins-official)을 먼저 하세요."
  running && die "이미 실행 중입니다(tmux 세션 $SESS). 상태: $0 status"
  tmux new-session -d -s "$SESS" -c "$MARU_HOME" "bash '$SELF' _loop" || die "tmux 세션을 만들지 못했습니다."
  echo "시작했습니다: tmux 세션 $SESS (화면 보기: $0 attach, 빠져나오기: Ctrl-b d)"
  echo "처음이면 attach 해서 채널 안내·승인 화면이 있는지 확인하세요."
}

cmd_stop() {
  running || { echo "실행 중이 아닙니다."; return 0; }
  tmux kill-session -t "=$SESS" && echo "중지했습니다: $SESS"
}

cmd_status() {
  if ! have tmux; then echo "실행 중 아님 (tmux 가 설치되어 있지 않음)"; return 1; fi
  if ! running; then echo "실행 중 아님"; return 1; fi
  local c; c=$(tmux display-message -p -t "=$SESS" '#{session_created}' 2>/dev/null)
  echo "실행 중: tmux 세션 $SESS (시작: $(date -r "${c:-0}" '+%Y-%m-%d %H:%M:%S'))"
  echo "--- 화면 마지막 줄 ---"
  tmux capture-pane -p -t "=$SESS" | grep . | tail -n 8
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
  tmux capture-pane -p -t "=$SESS" -S "-$n"   # 화면에만 출력한다. 파일로 저장하지 않는다(메시지 내용 보호).
}

case "${1:-}" in
  start) cmd_start;;
  stop) cmd_stop;;
  status) cmd_status;;
  attach) cmd_attach;;
  logs) shift; cmd_logs "$@";;
  _loop) loop;;
  *) echo "사용: $0 start|stop|status|attach|logs [줄 수]" >&2; exit 2;;
esac
