#!/bin/bash
# Claude Code 훅에서 호출: 마루 앱이 띄운 세션의 질문과 최종 답변을 data/state/app/<session_id>.talk.jsonl 에 한 줄씩 덧붙인다(앱 읽기 화면용).
#   파일 이름은 훅 입력 JSON 의 session_id(Claude 세션 id)다. 영문·숫자·- 만, 8~64자일 때만 쓴다(없거나 형식이 틀리면 아무것도 쓰지 않는다).
#   그래서 앱을 다시 켜거나 터미널을 다시 시작해 같은 Claude 세션을 이어 열어도 같은 파일에 이어 쓴다.
#   입력이 상한에서 잘려 JSON 해석에 실패하면 원문에서 정규식 "session_id"\s*:\s*"([A-Za-z0-9-]{8,64})" 로 값을 찾고, 못 찾으면 쓰지 않는다.
#   talk-log.sh user      : UserPromptSubmit 훅. 훅 JSON 의 prompt 를 쓴다.
#   talk-log.sh assistant : Stop 훅. 훅 JSON 의 last_assistant_message 를 쓴다.
#   talk-log.sh pre | post : PreToolUse·PostToolUse 훅. 활동 기록 data/state/app/<session_id>.act.jsonl 에 한 줄을 덧붙인다(docs/plans/surface-panel.md 14.3).
#     {"v":1,"at":<초, 소수 3자리>,"k":"pre","id":"<tool_use_id>","tool":"<tool_name>","sum":"<요약 160자까지>"}
#     {"v":1,"at":…,"k":"post","id":…,"tool":…[,"ms":<duration_ms 정수 0~86400000>][,"err":true]}   (err: tool_response 의 is_error 또는 interrupted 가 true)
#     id 는 [A-Za-z0-9_-]{1,80}, tool 은 [A-Za-z0-9_.:-]{1,80} 만 받는다(아니면 쓰지 않는다). 요약은 도구별로 정한 칸만 쓴다(명령 전체·파일 내용·도구 결과는 쓰지 않는다):
#     Bash=description(없으면 shlex 로 나눠 앞의 NAME=값 을 건너뛴 첫 낱말의 마지막 경로 마디. [A-Za-z0-9_.+-]{1,32} 에 전부 맞을 때만, 아니면 빈 글),
#     Read·Edit·Write·NotebookEdit=경로 마지막 두 마디, Grep·Glob=pattern(80자까지), WebFetch=호스트 이름, WebSearch=query(80자까지),
#     Agent·Task=description, Skill=skill, 그 밖=빈 글. 제어 문자·줄바꿈은 공백, 방향 제어·보이지 않는 글자는 지운다.
#     비밀값처럼 보이는 글(공백 없는 영숫자·_·- 24자 이상 덩어리에 숫자와 글자가 모두 있음)은 Bash(description·첫 낱말)·Grep·Glob·WebSearch·Agent·Task 에서 빈 글로 한다.
#     입력은 python 이 직접 1048577바이트까지 읽는다. 1MB 이상이라 JSON 해석이 실패하면 앞쪽에서 session_id·tool_use_id·tool_name 을 정규식으로 찾아,
#     셋 다 찾으면 sum 이 빈 pre 줄 또는 ms 없는 post 줄을 쓰고 못 찾으면 쓰지 않는다. 1MB 미만의 깨진 JSON 은 쓰지 않는다.
#     평소에는 파일을 읽지 않고 O_APPEND 로 한 줄만 덧붙인다. 크기가 16KB(이 스크립트의 가장 짧은 줄 59바이트 x 300줄 보다 작은 값)를 넘을 때만 잠금을 잡고 읽어
#     300줄 또는 256KB 를 넘으면 앞에서부터 버려 250줄·200KB 이하로 줄인다. 잠금은 <세션 id>.act.lock(모드 600, 링크 거부, flock LOCK_EX|LOCK_NB 를 0.5초까지 재시도).
#     못 잡으면 줄이기를 건너뛰고 덧붙이기만 한다. user 동작은 같은 잠금을 잡고(못 잡아도 진행) 그 세션의 .act.jsonl 을 비운다(없으면 만들지 않음). 잠금 파일은 지우지 않는다.
#     쓰는 조건·모드 600·링크 거부·조용한 종료는 talk 와 같다.
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
case "$role" in user|assistant|pre|post|start|compact) ;; *) exit 0 ;; esac
case "$id" in *[!A-Za-z0-9-]*) exit 0 ;; esac
[ "${#id}" -ge 8 ] && [ "${#id}" -le 64 ] || exit 0
[ ! -t 0 ] || exit 0
# 스크립트 폴더(외부 명령 dirname 을 쓰지 않는다: pre·post 는 도구 호출마다 돈다)
_self=${BASH_SOURCE[0]}
case "$_self" in */*) _sd=${_self%/*} ;; *) _sd=. ;; esac
here=$(cd "$_sd" 2>/dev/null && pwd -P) || exit 0
dir=$here/../data/state/app
[ -L "$dir" ] && exit 0
[ -d "$dir" ] || mkdir -p "$dir" 2>/dev/null || exit 0
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

if [ "$role" = start ] || [ "$role" = compact ]; then
  # 세션 시작 표지(start·compact): data/state/app/<MARU_APP_SESSION 값>.sess 를 한 줄로 통째로 바꿔 쓴다(docs/plans/surface-panel.md 16.2).
  #   {"v":1,"at":<초, 소수 3자리>,"sid":"<session_id>","source":"startup"|"resume"|"clear"|"compact"|"precompact"}
  #   start 는 SessionStart 훅(source 가 위 네 값일 때만 쓴다), compact 는 PreCompact 훅(source 는 precompact). 아무것도 지우지 않는다.
  #   임시 파일에 써서 rename 으로 바꾼다(모드 600). 대상이 심볼릭 링크이거나 일반 파일이 아니면 쓰지 않는다.
  #   SessionStart 훅의 표준출력은 세션 컨텍스트에 들어가므로 어떤 경우에도 아무것도 출력하지 않는다.
  SESS=""
  read -r -d '' SESS <<'EOF_SESS'
import json, os, re, stat, sys, time
kind, dirpath, appid = sys.argv[1], sys.argv[2], sys.argv[3]
raw = sys.stdin.buffer.read(1048577)
if len(raw) > 1048576:
    sys.exit(0)
try:
    o = json.loads(raw)
except Exception:
    sys.exit(0)
if not isinstance(o, dict):
    sys.exit(0)
sid = o.get("session_id")
if not (isinstance(sid, str) and re.fullmatch(r"[A-Za-z0-9-]{8,64}", sid)):
    sys.exit(0)
if kind == "compact":
    source = "precompact"
else:
    source = o.get("source")
    if source not in ("startup", "resume", "clear", "compact"):
        sys.exit(0)
path = os.path.join(dirpath, appid + ".sess")
try:
    st = os.lstat(path)
    if not stat.S_ISREG(st.st_mode):
        sys.exit(0)
except FileNotFoundError:
    pass
data = ('{"v":1,"at":%.3f,"sid":%s,"source":%s}\n' % (time.time(), json.dumps(sid), json.dumps(source))).encode("utf-8")
tmp = "%s.tmp.%d" % (path, os.getpid())
try:
    os.unlink(tmp)
except OSError:
    pass
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
try:
    try:
        mv = memoryview(data)
        while len(mv):
            mv = mv[os.write(fd, mv):]
    finally:
        os.close(fd)
    os.replace(tmp, path)
except BaseException:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
EOF_SESS
  "$py" -I -S -c "$SESS" "$role" "$dir" "$id" >/dev/null 2>&1
  exit 0
fi

if [ "$role" = pre ] || [ "$role" = post ]; then
  # 활동 기록(pre·post): 아래 파이썬이 data/state/app/<session_id>.act.jsonl 에 한 줄을 덧붙인다
  # 표준 라이브러리만 쓰므로 python 은 -I -S 로 띄운다(site 를 읽지 않아 시작이 빠르다). 입력은 python 이 직접 1048577바이트까지 읽는다.
  ACT=""
  read -r -d '' ACT <<'EOF_ACT'
import json, os, re, stat, sys, time, unicodedata, fcntl
kind, dirpath = sys.argv[1], sys.argv[2]
SID_RE = re.compile(r"[A-Za-z0-9-]{8,64}")
ID_RE = re.compile(r"[A-Za-z0-9_-]{1,80}")
TOOL_RE = re.compile(r"[A-Za-z0-9_.:-]{1,80}")
SID_FIND = re.compile(r'"session_id"\s*:\s*"([A-Za-z0-9-]{8,64})"')
TID_FIND = re.compile(r'"tool_use_id"\s*:\s*"([A-Za-z0-9_-]{1,80})"')
TOOL_FIND = re.compile(r'"tool_name"\s*:\s*"([A-Za-z0-9_.:-]{1,80})"')
ASSIGN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=")
WORD_RE = re.compile(r"[A-Za-z0-9_.+-]{1,32}")
SECRET_RE = re.compile(r"[A-Za-z0-9_-]{24,}")
MAXIN, MAXREAD, HIGH, KEEP, BIG, KEEPBYTES = 1048576, 64 * 1024 * 1024, 300, 250, 256 * 1024, 200 * 1024
# 이 크기 이하면 파일을 읽지 않고 덧붙이기만 한다. 이 스크립트가 쓰는 한 줄은 가장 짧아도 59바이트(post)라
# 300줄이면 17700바이트를 넘는다. 그래서 16KB 를 넘을 때만 읽어도 300줄 제한이 늦게 걸리지 않는다.
SMALL = 16 * 1024
raw = sys.stdin.buffer.read(MAXIN + 1)
hit = len(raw) >= MAXIN
if hit:
    try:
        while sys.stdin.buffer.read(65536):
            pass   # 나머지는 버린다(쓰는 쪽이 끊기지 않게)
    except Exception:
        pass
trunc = False
try:
    o = json.loads(raw)
except Exception:
    if not hit:
        sys.exit(0)   # 상한에 닿지 않았는데 깨진 JSON: 아무것도 쓰지 않는다
    trunc = True
if trunc:
    # 잘린 입력: 앞쪽에서 세 값을 정규식으로 찾는다. 하나라도 못 찾으면 쓰지 않는다.
    txt = raw.decode("utf-8", "replace")
    ms_, mt_, mo_ = SID_FIND.search(txt), TID_FIND.search(txt), TOOL_FIND.search(txt)
    if not (ms_ and mt_ and mo_):
        sys.exit(0)
    sid, tid, tool = ms_.group(1), mt_.group(1), mo_.group(1)
    o = {}
else:
    if not isinstance(o, dict):
        sys.exit(0)
    sid, tid, tool = o.get("session_id"), o.get("tool_use_id"), o.get("tool_name")
    if not (isinstance(sid, str) and SID_RE.fullmatch(sid)):
        sys.exit(0)
    if not (isinstance(tid, str) and ID_RE.fullmatch(tid)):
        sys.exit(0)
    if not (isinstance(tool, str) and TOOL_RE.fullmatch(tool)):
        sys.exit(0)
path = os.path.join(dirpath, sid + ".act.jsonl")

def clean(s):
    out = []
    for c in s:
        cat = unicodedata.category(c)
        if cat == "Cf":
            continue   # 방향 제어·보이지 않는 글자는 지운다
        out.append(" " if cat in ("Cc", "Zl", "Zp") else c)   # 제어 문자·줄바꿈은 공백
    return "".join(out).strip()

def last2(p):
    parts = [x for x in p.split("/") if x]
    return "/".join(parts[-2:])

def secretish(t):
    # 비밀값처럼 보이는 글: 공백 없는 영숫자·_·- 가 24자 이상 이어진 덩어리에 숫자와 글자가 모두 있다.
    for m in SECRET_RE.finditer(t):
        g = m.group(0)
        if any(c.isdigit() for c in g) and any(c.isalpha() for c in g):
            return True
    return False

def safe(text, limit):
    # 제어 문자를 정리한 글이 비밀값처럼 보이면 빈 글, 아니면 limit 자까지. (정리 비용을 막으려고 앞 1000자만 본다)
    t = clean(text[:1000])
    return "" if secretish(t) else t[:limit]

def bash_word(c):
    # 명령의 첫 낱말: shlex 로 나눠 앞의 NAME=값 낱말을 건너뛴 첫 낱말의 마지막 경로 마디.
    # [A-Za-z0-9_.+-]{1,32} 에 전부 맞지 않거나 비밀값처럼 보이면 빈 글. (긴 명령은 앞 4096자만 나눈다)
    import shlex
    try:
        words = shlex.split(c[:4096], posix=True)
    except Exception:
        return ""
    for w in words:
        if ASSIGN_RE.match(w):
            continue   # 앞에 붙은 NAME=값 은 비밀값일 수 있어 건너뛴다
        base = w.rstrip("/").rsplit("/", 1)[-1]
        if not WORD_RE.fullmatch(base) or secretish(base):
            return ""
        return base
    return ""

def summary(inp):
    # 14.3 표의 칸만 쓴다. 명령 전체·파일 내용·도구 결과는 쓰지 않는다.
    if not isinstance(inp, dict):
        return ""
    def s(k):
        v = inp.get(k)
        return v if isinstance(v, str) else None
    if tool == "Bash":
        d = s("description")
        if d is not None and clean(d[:1000]):
            return safe(d, 160)
        c = s("command")
        return bash_word(c) if c is not None else ""
    if tool in ("Read", "Edit", "Write", "NotebookEdit"):
        p = s("file_path")
        if p is None:
            p = s("notebook_path")
        return last2(p) if p else ""
    if tool in ("Grep", "Glob"):
        return safe(s("pattern") or "", 80)
    if tool == "WebFetch":
        u = s("url")
        if not u:
            return ""
        try:
            from urllib.parse import urlparse
            return urlparse(u).hostname or ""
        except Exception:
            return ""
    if tool == "WebSearch":
        return safe(s("query") or "", 80)
    if tool in ("Agent", "Task"):
        return safe(s("description") or "", 160)
    if tool == "Skill":
        return s("skill") or ""
    return ""

at = "%.3f" % time.time()
parts = ['"v":1', '"at":' + at, '"k":' + json.dumps(kind), '"id":' + json.dumps(tid), '"tool":' + json.dumps(tool)]
if kind == "pre":
    sm = clean(summary(o.get("tool_input")).encode("utf-8", "replace").decode("utf-8"))[:160].strip()
    parts.append('"sum":' + json.dumps(sm, ensure_ascii=False))
else:
    ms = o.get("duration_ms")
    if type(ms) is int and 0 <= ms <= 86400000:
        parts.append('"ms":%d' % ms)
    r = o.get("tool_response")
    if isinstance(r, dict) and (r.get("is_error") is True or r.get("interrupted") is True):
        parts.append('"err":true')
data = ("{" + ",".join(parts) + "}\n").encode("utf-8")

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
            os.unlink(tmp)
        except OSError:
            pass
        raise

def lock_act():
    # <세션 id>.act.lock 에 배타 잠금을 건다(LOCK_NB 로 0.5초까지 다시 시도). 못 잡으면 None. 잠금 파일은 모드 600, 링크는 거부한다.
    try:
        fd = os.open(os.path.join(dirpath, sid + ".act.lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    except OSError:
        return None
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise OSError("not regular")
        os.fchmod(fd, 0o600)
        end = time.time() + 0.5
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return fd
            except OSError:
                if time.time() >= end:
                    raise
                time.sleep(0.01)
    except Exception:
        os.close(fd)
        return None

def shrink():
    # 잠금을 쥔 채로 부른다. 줄이면 True(새 줄까지 담김), 줄일 필요가 없거나 못 줄이면 False(호출한 쪽이 덧붙인다).
    for attempt in range(3):
        try:
            st = os.lstat(path)
        except FileNotFoundError:
            return False
        if not stat.S_ISREG(st.st_mode):
            sys.exit(0)
        if st.st_size > MAXREAD:
            try:
                replace_with(data)   # 비정상으로 큰 파일: 읽지 않고 새 줄 하나만 든 파일로 바꾼다
            except Exception:
                pass
            return True
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            chunks = []
            while True:
                b = os.read(fd, 1048576)
                if not b:
                    break
                chunks.append(b)
            old = b"".join(chunks)
        finally:
            os.close(fd)
        lines = [x for x in old.split(b"\n") if x]
        if len(lines) + 1 <= HIGH and len(old) + len(data) <= BIG:
            return False
        # 새 줄부터 거꾸로 모은다: 250줄 이하, 합계 200KB 이하(가장 최근 줄 하나는 크기와 무관하게 남김)
        kept, total = [data], len(data)
        for ln in reversed(lines):
            if len(kept) >= KEEP or total + len(ln) + 1 > KEEPBYTES:
                break
            kept.append(ln + b"\n")
            total += len(ln) + 1
        kept.reverse()
        try:
            now = os.lstat(path).st_size
        except OSError:
            now = -1
        if now != len(old) and attempt < 2:
            continue   # 읽는 사이에 다른 훅이 덧붙였다: 다시 읽는다
        try:
            replace_with(b"".join(kept))
            return True
        except Exception:
            return False
    return False

try:
    st = os.lstat(path)
except FileNotFoundError:
    st = None
if st is not None:
    if not stat.S_ISREG(st.st_mode):
        sys.exit(0)
    if st.st_size > SMALL:
        # 줄이기는 잠금 안에서만 한다. 못 잡으면(0.5초) 줄이기를 건너뛰고 덧붙이기만 한다.
        lfd = lock_act()
        if lfd is not None:
            try:
                if shrink():
                    sys.exit(0)
            finally:
                os.close(lfd)   # 닫으면 잠금도 풀린다
# 평소: 파일을 읽지 않고 O_APPEND 로 한 줄만 덧붙인다
fd = os.open(path, os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
try:
    os.fchmod(fd, 0o600)
    size = os.fstat(fd).st_size
    if size > 0 and os.pread(fd, 1, size - 1) != b"\n":
        data = b"\n" + data   # 끊긴 마지막 줄 뒤에서 줄을 바꾼다
    os.write(fd, data)
finally:
    os.close(fd)
EOF_ACT
  "$py" -I -S -c "$ACT" "$role" "$dir" >/dev/null 2>&1
  exit 0
fi

# user·assistant: 입력을 1048576바이트까지 읽는다(끝에 x 를 붙여 마지막 줄바꿈이 깎이지 않게 하고, 바이트 수로 상한에 닿았는지 본다)
input=""; hitlimit=0
{ input=$(head -c 1048576 2>/dev/null; printf x); cat >/dev/null 2>&1; } 2>/dev/null
input=${input%x}
[ "$(printf '%s' "$input" | LC_ALL=C wc -c | tr -d ' ')" -ge 1048576 ] 2>/dev/null && hitlimit=1
[ -n "$input" ] || exit 0
printf '%s' "$input" | "$py" -I -c '
import json, os, re, stat, sys, time, fcntl
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

if role == "user":
    # 새 질문이 오면 그 세션의 활동 기록(.act.jsonl)을 비운다(한 턴의 활동만 담는다). 없으면 만들지 않고, 링크·일반 파일이 아니면 건드리지 않는다.
    # 줄이기(pre·post)와 겹치지 않게 <세션 id>.act.lock 에 잠금을 건다(0.5초까지 다시 시도, 못 잡아도 비운다). 잠금 파일은 지우지 않고 둔다(크기 0).
    apath = os.path.join(dirpath, sid + ".act.jsonl")
    lfd = None
    try:
        if stat.S_ISREG(os.lstat(apath).st_mode):
            try:
                lfd = os.open(os.path.join(dirpath, sid + ".act.lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
                if not stat.S_ISREG(os.fstat(lfd).st_mode):
                    raise OSError("not regular")
                os.fchmod(lfd, 0o600)
                end = time.time() + 0.5
                while True:
                    try:
                        fcntl.flock(lfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except OSError:
                        if time.time() >= end:
                            break
                        time.sleep(0.01)
            except Exception:
                pass
            os.close(os.open(apath, os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW))
    except Exception:
        pass
    finally:
        if lfd is not None:
            try:
                os.close(lfd)
            except Exception:
                pass

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
