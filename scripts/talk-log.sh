#!/bin/bash
# Claude Code 훅에서 호출: 마루 앱이 띄운 세션의 질문과 최종 답변을 data/state/app/<session_id>.talk.jsonl 에 한 줄씩 덧붙인다(앱 읽기 화면용).
#   파일 이름은 훅 입력 JSON 의 session_id(Claude 세션 id)다. 영문·숫자·- 만, 8~64자일 때만 쓴다(없거나 형식이 틀리면 아무것도 쓰지 않는다).
#   그래서 앱을 다시 켜거나 터미널을 다시 시작해 같은 Claude 세션을 이어 열어도 같은 파일에 이어 쓴다.
#   입력이 상한에서 잘려 JSON 해석에 실패하면 원문에서 정규식 "session_id"\s*:\s*"([A-Za-z0-9-]{8,64})" 로 값을 찾고, 못 찾으면 쓰지 않는다.
#   talk-log.sh user      : UserPromptSubmit 훅. 훅 JSON 의 prompt 를 쓴다.
#   talk-log.sh assistant : Stop 훅. 훅 JSON 의 last_assistant_message 를 쓴다.
# 한 줄: {"v":1,"at":<epoch 초>,"role":"user"|"assistant","text":"<글>"[,"cut":true]}   (파일 모드 600)
#   text 는 65536자까지(파이썬 문자열의 코드포인트 단위로 자르므로 짝 없는 서로게이트가 남지 않는다. 넘으면 자르고 cut 을 더한다).
#   문자열이 아니거나 공백뿐인 글은 아무것도 쓰지 않는다.
#   입력은 1048576바이트까지 읽는다. 그 상한에 닿아 JSON 파싱에 실패하면(입력이 잘림) 글을 알 수 없으므로
#   {"v":1,"at":…,"role":…,"text":"","lost":true} 한 줄을 쓴다(앱이 "너무 길어 기록하지 못함"으로 보여 주는 표지).
#   상한에 닿지 않았는데 JSON 이 깨졌으면 아무것도 쓰지 않는다. 바로 앞 줄이 같은 role 의 lost 줄이면 lost 줄을 다시 쓰지 않는다.
#   파일의 마지막 줄과 role·text 가 같으면 다시 쓰지 않는다(Stop 이 같은 답변으로 두 번 불릴 수 있다).
#   평소에는 O_APPEND 로 한 번의 write 로 덧붙인다. 덧붙인 뒤 줄 수가 240 을 넘거나 크기가 8MB 를 넘으면 정리한다:
#   새 줄부터 거꾸로 모아 200줄 이하·합계 6MB 이하만 남기고(가장 최근 줄 하나는 크기와 무관하게 남긴다) 순서는 그대로 두며,
#   임시 파일에 써서 os.replace 로 바꾼다(쓰다 실패하면 임시 파일을 지운다).
#   파일이 64MB 를 넘는 비정상 상태면 읽지 않고 새 줄 하나만 든 파일로 바꾼다. 그래서 "이 세션은 다시 기록하지 않는다"는 상태가 생기지 않는다.
#   기록 파일이 심볼릭 링크이거나 일반 파일이 아니면 쓰지 않는다. role·text·at·v·cut·lost 외에는 저장하지 않는다(세션 값·폴더·경로 없음).
# MARU_APP_SESSION 은 "앱이 띄운 세션인가"를 가리는 문이다: 없거나 형식이 틀리면 아무것도 하지 않는다(앱 밖 세션 영향 없음). 파일 이름에는 쓰지 않는다. MARU_NO_TALK_LOG=1 이면 끈다.
# 중첩 실행 방지: 앱 세션 안에서 Bash 로 돌린 화면 없는 실행(claude -p)은 MARU_APP_SESSION 을 물려받아 그 질문·답이 부모 세션 기록에 섞인다.
#   그 실행의 훅 환경에는 CLAUDE_CODE_ENTRYPOINT=sdk-cli 가 있으므로, 정확히 이 값이면 아무것도 하지 않는다(다른 값이나 없음은 기록한다. 허용 목록이 아니라 이 한 값만 거른다).
# 재귀 방지: 회고·정리의 헤드리스 claude -p 는 AGENT_REFLECTING=1 로 돈다. 그 안에서는 아무것도 하지 않는다.
# 표준출력·표준오류에는 아무것도 쓰지 않는다(UserPromptSubmit 훅의 표준출력은 세션 컨텍스트에 들어간다). 항상 exit 0.
# JSON 처리에는 python3 를 쓴다(/usr/bin 의 고장난 셔임을 피해 폴백 디렉터리를 먼저 본다). 없으면 조용히 끝난다.
role=${1:-}
id=${MARU_APP_SESSION:-}
exec 2>/dev/null
[ -n "$id" ] || exit 0
[ -n "${AGENT_REFLECTING:-}" ] && exit 0
[ "${MARU_NO_TALK_LOG:-}" = 1 ] && exit 0
[ "${CLAUDE_CODE_ENTRYPOINT:-}" = sdk-cli ] && exit 0
input=""; hitlimit=0
if [ ! -t 0 ]; then
  # 끝에 x 를 붙여 마지막 줄바꿈이 깎이지 않게 하고, 바이트 수로 상한(1048576)에 닿았는지 본다
  { input=$(head -c 1048576 2>/dev/null; printf x); cat >/dev/null 2>&1; } 2>/dev/null
  input=${input%x}
  [ "$(printf '%s' "$input" | LC_ALL=C wc -c | tr -d ' ')" -ge 1048576 ] 2>/dev/null && hitlimit=1
fi
case "$role" in user|assistant) ;; *) exit 0 ;; esac
case "$id" in *[!A-Za-z0-9-]*) exit 0 ;; esac
[ "${#id}" -ge 8 ] && [ "${#id}" -le 64 ] || exit 0
[ -n "$input" ] || exit 0
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P) || exit 0
dir=$here/../data/state/app
[ -L "$dir" ] && exit 0
mkdir -p "$dir" 2>/dev/null || exit 0
[ -L "$dir" ] && exit 0

# python3 찾기: 폴백 후보 디렉터리 먼저, 없으면 PATH. 못 찾으면 조용히 끝난다.
py=""
IFS=: read -r -a _dirs <<< "${MARU_TOOL_DIRS-/Library/Developer/CommandLineTools/usr/bin:/opt/homebrew/bin:/usr/local/bin}"
for _d in ${_dirs[@]+"${_dirs[@]}"}; do
  # /usr/bin/python3 는 CLT 가 없는 맥에서 설치 창을 띄우는 셔임이라 후보에서 뺀다
  [ -n "$_d" ] && [ "$_d" != /usr/bin ] && [ -x "$_d/python3" ] && { py=$_d/python3; break; }
done
if [ -z "$py" ]; then py=$(command -v python3 2>/dev/null); [ "$py" != /usr/bin/python3 ] || py=""; fi
[ -n "$py" ] || exit 0

printf '%s' "$input" | "$py" -I -c '
import json, os, re, stat, sys, time
role, dirpath, hit = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
SID_RE = re.compile(r"[A-Za-z0-9-]{8,64}")
SID_FIND = re.compile(r"\"session_id\"\s*:\s*\"([A-Za-z0-9-]{8,64})\"")
MAXTEXT, MAXREAD, HIGH, KEEP = 65536, 64 * 1024 * 1024, 240, 200
BIG, KEEPBYTES = 8 * 1024 * 1024, 6 * 1024 * 1024
lost = False
raw = sys.stdin.buffer.read()
try:
    o = json.loads(raw)
except Exception:
    if not hit:
        sys.exit(0)
    lost = True   # 입력이 상한에서 잘려 글을 알 수 없다: 표지 줄만 쓴다
sid = None
if lost:
    m = SID_FIND.search(raw.decode("utf-8", "replace"))   # 잘린 입력: 원문에서 session_id 값을 찾는다
    sid = m.group(1) if m else None
elif isinstance(o, dict):
    v = o.get("session_id")
    sid = v if isinstance(v, str) and SID_RE.fullmatch(v) else None
if sid is None:
    sys.exit(0)   # 세션 id 가 없거나 형식이 틀리면 쓰지 않는다
path = os.path.join(dirpath, sid + ".talk.jsonl")
rec = {"v": 1, "at": int(time.time()), "role": role}
if lost:
    t = ""
    rec["text"] = ""
    rec["lost"] = True
else:
    if not isinstance(o, dict):
        sys.exit(0)
    t = o.get("prompt" if role == "user" else "last_assistant_message")
    if not isinstance(t, str) or not t.strip():
        sys.exit(0)
    t = t.encode("utf-8", "replace").decode("utf-8")   # JSON 의 \ud800 같은 짝 없는 서로게이트는 ? 로 바꾼다(UTF-8 로 쓸 수 있게)
    cut = len(t) > MAXTEXT
    if cut:
        t = t[:MAXTEXT]   # 코드포인트 단위라 서로게이트 쌍이 갈라지지 않는다
    rec["text"] = t
    if cut:
        rec["cut"] = True
data = (json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")

def write_all(fd, b):
    mv = memoryview(b)
    while len(mv):
        n = os.write(fd, mv)
        mv = mv[n:]

def replace_with(content):
    tmp = "%s.tmp.%d" % (path, os.getpid())
    try:
        os.unlink(tmp)
    except OSError:
        pass
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        try:
            write_all(fd, content)
        finally:
            os.close(fd)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)   # 쓰다 실패하면 임시 파일을 지운다
        except OSError:
            pass
        raise

old = b""
try:
    st = os.lstat(path)
except FileNotFoundError:
    st = None
if st is not None:
    if not stat.S_ISREG(st.st_mode):
        sys.exit(0)
    if st.st_size > MAXREAD:
        # 비정상으로 큰 파일: 읽지 않고 새 줄 하나만 든 파일로 바꾼다
        try:
            replace_with(data)
        except Exception:
            pass
        sys.exit(0)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        old = os.read(fd, 1048576)
        while len(old) <= MAXREAD:
            more = os.read(fd, 1048576)
            if not more:
                break
            old += more
    finally:
        os.close(fd)
    if len(old) > MAXREAD:
        try:
            replace_with(data)
        except Exception:
            pass
        sys.exit(0)
    lines = old.split(b"\n")
    if lines and lines[-1] == b"":
        lines.pop()
    if lines:
        try:
            last = json.loads(lines[-1])
        except Exception:
            last = None
        if isinstance(last, dict) and last.get("role") == role:
            if lost:
                if last.get("lost") is True:
                    sys.exit(0)   # lost 줄 거듭 쓰기 방지
            elif last.get("text") == t:
                sys.exit(0)   # 같은 내용 거듭 쓰기 방지
    if len(lines) + 1 > HIGH or len(old) + len(data) > BIG:
        # 새 줄부터 거꾸로 모은다: 200줄 이하, 합계 6MB 이하(가장 최근 줄 하나는 크기와 무관하게 남김)
        kept = [data]
        total = len(data)
        for ln in reversed(lines):
            if not ln:
                continue
            if len(kept) >= KEEP or total + len(ln) + 1 > KEEPBYTES:
                break
            kept.append(ln + b"\n")
            total += len(ln) + 1
        kept.reverse()
        try:
            replace_with(b"".join(kept))
            sys.exit(0)
        except Exception:
            pass   # 정리에 실패해도 기록은 멈추지 않는다: 아래에서 덧붙인다
    if old and not old.endswith(b"\n"):
        data = b"\n" + data   # 끊긴 마지막 줄 뒤에서 줄을 바꾼다
fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
try:
    os.fchmod(fd, 0o600)
    os.write(fd, data)
finally:
    os.close(fd)
' "$role" "$dir" "$hitlimit" >/dev/null 2>&1
exit 0
