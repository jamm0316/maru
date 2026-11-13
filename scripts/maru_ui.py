#!/usr/bin/env python3
"""maru ui: cmux 우측 Dock 같은 좁은 터미널(40~60열)에서 쓰는 마루 상황판(curses, 표준 라이브러리만).

사용: maru_ui.py [--once | --selftest]
  (없음)      대화형 화면. 탭: 1 상태 / 2 기억 / 3 로그 / 4 제안 (Tab 으로 순환), q 종료
  --once      curses 없이 상태 탭 내용을 평문으로 한 번 출력
  --selftest  임시 디렉터리에서 로더·설치·거절 로직을 검증하고 0/1 로 종료

읽기 전용이 기본이다. 쓰기는 제안 탭의 설치(i, 정확히 yes 입력)와 거절(x, .rejected/ 로 이동)뿐이다.
네트워크·서버·포트를 쓰지 않는다. 제안 내용은 신뢰할 수 없는 데이터라 표시만 하고 실행하지 않는다.
"""
import hashlib
import os
import re
import stat
import subprocess
import sys
import time
import unicodedata

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_READ = 200 * 1024        # 파일 하나에서 읽는 최대 바이트(표시용)
MAX_SKILL = 100 * 1024       # 설치 가능한 SKILL.md 최대 크기(reflect.sh 와 같은 한계)
TAIL_BYTES = 256 * 1024
TAIL_LINES = 500
REFRESH_SEC = 30
LAUNCHD_LABEL = "com.maru.dream"


# ---------------------------------------------------------------- 경로
class Paths:
    """모든 경로를 한 곳에 모은다. 시험에서는 임시 경로를 직접 주입한다."""

    def __init__(self, home, data, mem, skills, launchd_label=LAUNCHD_LABEL):
        self.home = home
        self.data = data
        self.mem = mem
        self.skills = skills
        self.logs = os.path.join(data, "logs")
        self.proposals = os.path.join(data, "skill-proposals")
        self.state = os.path.join(data, "state")
        self.repo_skills = os.path.join(home, ".claude", "skills")   # 저장소 자체 스킬: 이름 사칭 방지용
        self.launchd_label = launchd_label

    @classmethod
    def from_env(cls):
        # lib.sh 와 같은 우선순위(환경변수 > 기본값). data/maru.conf 는 읽지 않는다(셸 문법이라).
        here = os.path.dirname(os.path.realpath(__file__))
        home = os.environ.get("MARU_HOME") or os.path.dirname(here)
        data = os.environ.get("MARU_DATA") or os.path.join(home, "data")
        claude = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
        projects = os.environ.get("PROJECTS") or os.path.join(claude, "projects")
        slug = re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(home))
        mem = os.environ.get("MEM") or os.path.join(projects, slug, "memory")
        skills = os.environ.get("SKILLS") or os.path.join(claude, "skills")
        p = cls(home, data, mem, skills)
        if os.environ.get("MARU_LOGS"):
            p.logs = os.environ["MARU_LOGS"]
        if os.environ.get("MARU_PROPOSALS"):
            p.proposals = os.environ["MARU_PROPOSALS"]
        if os.environ.get("MARU_STATE"):
            p.state = os.environ["MARU_STATE"]
        return p


# ---------------------------------------------------------------- 텍스트 유틸(한글 폭)
def cw(ch):
    if unicodedata.combining(ch):
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


def swidth(s):
    return sum(cw(c) for c in s)


def clip(s, w):
    """표시 폭 w 이하로 자른다."""
    out, used = [], 0
    for c in s:
        k = cw(c)
        if used + k > w:
            break
        out.append(c)
        used += k
    return "".join(out)


def wrap(s, w):
    """표시 폭 w 로 접는다(빈 줄은 빈 줄 하나)."""
    if w < 1:
        return [""]
    lines, cur, used = [], [], 0
    for c in s:
        k = cw(c)
        if used + k > w and cur:
            lines.append("".join(cur))
            cur, used = [], 0
        cur.append(c)
        used += k
    lines.append("".join(cur))
    return lines


def sanitize(s):
    """신뢰할 수 없는 텍스트에서 제어 문자(ESC 포함)를 제거한다. 탭은 공백 4칸, 줄바꿈은 유지."""
    out = []
    for c in s:
        if c == "\n":
            out.append(c)
        elif c == "\t":
            out.append("    ")
        elif c == "\r":
            continue
        elif unicodedata.category(c) in ("Cc", "Cf", "Cs", "Co") or c == "\x7f":
            out.append("?")
        else:
            out.append(c)
    return "".join(out)


def wrap_text(text, w):
    res = []
    for line in sanitize(text).split("\n"):
        res.extend(wrap(line, w))
    return res


# ---------------------------------------------------------------- 안전한 읽기
def read_text(path, limit=MAX_READ):
    """일반 파일만 읽는다. 없거나 실패하면 None. 길면 앞부분만."""
    try:
        if os.path.islink(path) or not os.path.isfile(path):
            return None
        with open(path, "rb") as f:
            data = f.read(limit + 1)
        text = data[:limit].decode("utf-8", errors="replace")
        if len(data) > limit:
            text += "\n…(이후 생략)"
        return text
    except OSError:
        return None


def tail_lines(path, n=TAIL_LINES, nbytes=TAIL_BYTES):
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            f.seek(max(0, size - nbytes))
            data = f.read()
    except OSError:
        return None
    lines = data.decode("utf-8", errors="replace").split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return lines[-n:]


def read_int(path):
    t = read_text(path, 64)
    try:
        return int((t or "").strip())
    except ValueError:
        return None


# ---------------------------------------------------------------- 기억 로더
def parse_frontmatter(text):
    """느슨한 frontmatter 파서. 깨졌으면 빈 dict. name/description/type 만 본다."""
    meta = {}
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return meta
    for line in lines[1:]:
        if line.strip() == "---":
            break
        m = re.match(r"^(\s*)([A-Za-z_][\w-]*):\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(2), m.group(3).strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        if key in ("name", "description", "type") and key not in meta and val:
            meta[key] = val
    return meta


def load_memories(mem_dir):
    """[{file,name,desc,type,path}] (MEMORY.md 제외). 디렉터리가 없으면 빈 목록."""
    items = []
    try:
        names = sorted(os.listdir(mem_dir))
    except OSError:
        return items
    for fn in names:
        if not fn.endswith(".md") or fn == "MEMORY.md" or fn.startswith("."):
            continue
        path = os.path.join(mem_dir, fn)
        text = read_text(path, 8192)
        if text is None:
            continue
        meta = parse_frontmatter(text)
        items.append({
            "file": fn,
            "path": path,
            "name": sanitize(meta.get("name") or fn[:-3]).replace("\n", " "),
            "desc": sanitize(meta.get("description", "")).replace("\n", " "),
            "type": sanitize(meta.get("type") or "기타").replace("\n", " "),
        })
    return items


def group_memories(items, flt=""):
    """type 별 묶음 행 목록: ('h', type) / ('i', item). 필터는 부분 문자열(대소문자 무시)."""
    f = flt.lower()
    sel = [i for i in items if not f or f in (i["name"] + " " + i["desc"] + " " + i["file"]).lower()]
    rows = []
    for t in sorted({i["type"] for i in sel}):
        rows.append(("h", t))
        rows.extend(("i", i) for i in sorted((x for x in sel if x["type"] == t), key=lambda x: x["name"]))
    return rows


# ---------------------------------------------------------------- 상태
START_RE = {"reflect": "회고 시작", "dream": r"\[dream\] 시작"}


def last_run(log_path, kind):
    """maru-status.sh 의 last_run 과 같은 규칙. (시각, 결과) 또는 None."""
    lines = tail_lines(log_path, 5000, 4 * 1024 * 1024)
    if not lines:
        return None
    start = re.compile(START_RE[kind])
    idx = None
    for i in range(len(lines) - 1, -1, -1):
        if start.search(lines[i]):
            idx = i
            break
    if idx is None:
        return None
    ts = lines[idx][:19]
    rb = fail = done = none = False
    for line in lines[idx + 1:]:
        if re.search(r"회고 시작|\[dream\] 시작", line):
            break
        rb |= "되돌림" in line
        fail |= bool(re.search(r"rc=[1-9][0-9]*", line))
        done |= "커밋 완료" in line
        none |= "변경 없음" in line
    res = ("되돌림(변경 폐기)" if rb else "실패" if fail else "커밋 완료(기억 갱신)" if done
           else "변경 없음" if none else "진행 중/불명")
    return ts, res


def count_proposals(prop_dir):
    try:
        return len([n for n in os.listdir(prop_dir) if not n.startswith(".")])
    except OSError:
        return None


def launchd_loaded(label, timeout=3):
    """True/False, 알 수 없으면 None. launchctl list <label> 은 읽기 전용이다."""
    try:
        r = subprocess.run(["launchctl", "list", label], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.returncode == 0


def load_status(p, check_launchd=True):
    mem_count = None
    if os.path.isdir(p.mem):
        mem_count = len([1 for n in os.listdir(p.mem)
                         if n.endswith(".md") and n != "MEMORY.md" and os.path.isfile(os.path.join(p.mem, n))])
    st = {
        "now": time.strftime("%Y-%m-%d %H:%M:%S"),
        "memory_files": mem_count,
        "reflect": last_run(os.path.join(p.logs, "reflect.log"), "reflect"),
        "dream": last_run(os.path.join(p.logs, "dream.log"), "dream"),
        "fail_reflect": read_int(os.path.join(p.state, "fail.reflect")),
        "fail_dream": read_int(os.path.join(p.state, "fail.dream")),
        "proposals": count_proposals(p.proposals),
        "launchd": launchd_loaded(p.launchd_label) if check_launchd else None,
    }
    return st


def status_lines(st):
    """상태 탭 평문. 앞 5줄 형식은 maru-status.sh --no-auth 와 같다."""
    out = ["마루 상태 (%s)" % st["now"]]
    if st["memory_files"] is not None:
        out.append("기억: %d개" % st["memory_files"])
    if st["reflect"]:
        out.append("마지막 회고: %s · %s" % st["reflect"])
    if st["dream"]:
        out.append("마지막 새벽 정리: %s · %s" % st["dream"])
    if st["proposals"] is not None:
        out.append("대기 중 스킬 제안: %d개" % st["proposals"])
    for key, label in (("fail_reflect", "회고"), ("fail_dream", "새벽 정리")):
        if st[key]:
            out.append("연속 실패: %s %d회" % (label, st[key]))
    if st["launchd"] is True:
        out.append("launchd %s: 로드됨" % LAUNCHD_LABEL)
    elif st["launchd"] is False:
        out.append("launchd %s: 로드 안 됨" % LAUNCHD_LABEL)
    return out


# ---------------------------------------------------------------- 제안: 목록·설치·거절
def list_proposals(prop_dir):
    """[{name,path,valid,has_skill,is_dir}]. 숨김 항목(.rejected 등)은 제외."""
    items = []
    try:
        names = sorted(os.listdir(prop_dir))
    except OSError:
        return items
    for n in names:
        if n.startswith("."):
            continue
        path = os.path.join(prop_dir, n)
        is_dir = os.path.isdir(path) and not os.path.islink(path)
        skill = os.path.join(path, "SKILL.md")
        items.append({
            "name": sanitize(n).replace("\n", " "),
            "raw": n,
            "path": path,
            "is_dir": is_dir,
            "valid": bool(NAME_RE.fullmatch(n)),
            "has_skill": is_dir and os.path.isfile(skill) and not os.path.islink(skill),
        })
    return items


def install_target(p, name):
    return os.path.join(p.skills, name)


def check_proposal(p, name):
    """설치·거절 공통 검증. 문제 없으면 None, 있으면 이유 문자열."""
    if not NAME_RE.fullmatch(name or ""):
        return "이름 형식 오류(소문자·숫자·하이픈, 64자 이하)"
    src = os.path.join(p.proposals, name)
    if os.path.islink(src):
        return "제안 디렉터리가 심볼릭 링크"
    if not os.path.isdir(src):
        return "제안 디렉터리가 아님/없음"
    root = os.path.realpath(p.proposals)
    if os.path.dirname(os.path.realpath(src)) != root:
        return "제안 폴더 밖을 가리킴"
    return None


def read_regular(path, limit):
    """(bytes|None, 오류|None). 마지막 구성요소가 심볼릭 링크면 거부(O_NOFOLLOW), 일반 파일·링크 수 1 만 허용,
    limit 초과는 거부(앞 limit 바이트는 data 로 돌려줘 표시에는 쓸 수 있다). 검사와 읽기가 같은 fd 라 바꿔치기 불가."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as e:
        return None, "열 수 없음(없거나 심볼릭 링크): %s" % (e.strerror or e)
    with os.fdopen(fd, "rb") as f:
        try:
            st = os.fstat(f.fileno())
            if not stat.S_ISREG(st.st_mode):
                return None, "일반 파일이 아님"
            if st.st_nlink != 1:
                return None, "하드링크(링크 수 %d)" % st.st_nlink
            data = f.read(limit + 1)
        except OSError as e:
            return None, "읽기 실패: %s" % (e.strerror or e)
    if len(data) > limit:
        return data[:limit], "%dKB 초과" % (limit // 1024)
    return data, None


HIDDEN_CHARS = {"\u3164", "\u115f", "\u1160", "\uffa0", "\u2800"}
ALLOWED_KEYS = ("name", "description")


def skill_frontmatter(text):
    """엄격한 단순 파서. (keys dict, 오류). frontmatter 가 없으면 ({}, None). 들여쓰기·목록·중복 키는 파싱 불가로 본다."""
    lines = text.split("\n")
    if lines[0] != "---":
        if lines[0].strip() == "---":
            return None, "frontmatter 시작줄이 '---' 가 아님"
        return {}, None
    keys = {}
    for line in lines[1:]:
        if line == "---":
            return keys, None
        if line.strip() == "":
            continue
        m = re.fullmatch(r"([A-Za-z_][\w-]*):[ ]*(.*)", line)
        if not m:
            return None, "frontmatter 파싱 불가: %r" % sanitize(line)[:40]
        if m.group(1) in keys:
            return None, "frontmatter 키 중복: %s" % m.group(1)
        val = m.group(2).strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        keys[m.group(1)] = val
    return None, "frontmatter 가 닫히지 않음"


def content_blockers(p, name, data):
    """설치 불가 사유 목록(내용 기준). data 는 스냅샷 바이트. 표시는 그대로 가능하다."""
    why = []
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return ["UTF-8 이 아닌 내용"]
    bad = sorted({"U+%04X" % ord(c) for c in text
                  if c in HIDDEN_CHARS or (c not in "\n\t" and unicodedata.category(c) in ("Cc", "Cf"))})
    if bad:
        why.append("숨김·제어 문자 포함: " + " ".join(bad))
    keys, err = skill_frontmatter(text)
    if err:
        why.append(err)
    else:
        extra = sorted(k for k in keys if k not in ALLOWED_KEYS)
        if extra:
            why.append("허용되지 않은 frontmatter 키: " + ", ".join(extra))
        if "name" in keys and keys["name"] != name:
            why.append("frontmatter name(%s)이 디렉터리 이름과 다름" % sanitize(keys["name"])[:40])
    try:
        taken = [n for n in os.listdir(p.repo_skills) if n.lower() == name.lower()]
    except OSError:
        taken = []
    if taken:
        why.append("저장소 스킬 이름과 겹침")
    return why


def snapshot_proposal(p, name):
    """보기를 열 때 한 번 호출: SKILL.md 바이트를 읽어 스냅샷으로 고정한다(표시·설치 모두 이것만 쓴다).
    항상 dict 를 돌려준다. blockers 가 비어 있지 않으면 설치 불가."""
    snap = {"name": name, "data": None, "sha": "", "proposal": None, "blockers": [], "truncated": False}
    why = check_proposal(p, name)
    if why:
        snap["blockers"].append(why)
        return snap
    src = os.path.join(p.proposals, name)
    data, err = read_regular(os.path.join(src, "SKILL.md"), MAX_SKILL)
    if data is not None:
        snap["data"] = data
        snap["sha"] = hashlib.sha256(data).hexdigest()
    if err:
        snap["blockers"].append("SKILL.md: " + err)
        snap["truncated"] = data is not None
    if data is not None and not err:
        snap["blockers"].extend(content_blockers(p, name, data))
    pdata, perr = read_regular(os.path.join(src, "PROPOSAL.md"), MAX_READ)
    if pdata is not None:
        snap["proposal"] = pdata.decode("utf-8", errors="replace") + ("\n…(이후 생략)" if perr else "")
    return snap


def install_proposal(p, name, snap):
    """(성공 여부, 메시지). 호출 쪽이 'yes' 확인을 이미 받았다고 가정한다. 덮어쓰기 없음.
    설치 내용은 snap 의 바이트뿐이다. 설치 직전에 디스크를 다시 읽어 sha256 이 다르면 거부한다."""
    why = check_proposal(p, name)
    if why:
        return False, "설치 거부: " + why
    if not snap or snap.get("name") != name:
        return False, "설치 거부: 검토한 내용(스냅샷)이 없음"
    if snap["blockers"]:
        return False, "설치 거부: " + "; ".join(snap["blockers"])
    if snap.get("data") is None:
        return False, "설치 거부: 검토한 내용(스냅샷)이 없음"
    data = snap["data"]
    cur, err = read_regular(os.path.join(p.proposals, name, "SKILL.md"), MAX_SKILL)
    if err:
        return False, "설치 거부: SKILL.md 재확인 실패(%s)" % err
    if hashlib.sha256(cur).hexdigest() != snap["sha"]:
        return False, "설치 거부: 검토 중 내용이 바뀌었습니다. 다시 읽어 주세요"
    blockers = content_blockers(p, name, data)   # 저장소 스킬 이름 등 검토 이후 바뀔 수 있는 조건 재확인
    if blockers:
        return False, "설치 거부: " + "; ".join(blockers)
    dest = install_target(p, name)
    if os.path.lexists(dest):
        return False, "설치 거부: 대상이 이미 있음(덮어쓰지 않음)"
    created_dir = False
    try:
        os.makedirs(p.skills, exist_ok=True)
        os.mkdir(dest)                       # 이미 있으면 FileExistsError: 덮어쓰기 불가
        created_dir = True
        fd = os.open(os.path.join(dest, "SKILL.md"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
    except FileExistsError:
        return False, "설치 거부: 대상이 이미 있음(덮어쓰지 않음)"
    except OSError as e:
        if created_dir:
            try:   # 우리가 방금 만든 빈 디렉터리만 정리
                os.remove(os.path.join(dest, "SKILL.md"))
            except OSError:
                pass
            try:
                os.rmdir(dest)
            except OSError:
                pass
        return False, "설치 실패: %s" % (e.strerror or e)
    note = ""
    try:   # 설치한 제안은 대기 목록에서 빼되 지우지 않고 .installed/ 로 옮긴다
        moved = _move_aside(p, name, ".installed")
        note = " (제안은 %s 로 이동)" % os.path.relpath(moved, p.proposals)
    except OSError:
        note = " (제안 폴더 이동 실패: 목록에 남아 있음)"
    return True, "설치됨: %s%s" % (dest, note)


def reject_proposal(p, name):
    why = check_proposal(p, name)
    if why:
        return False, "거절 불가: " + why
    try:
        moved = _move_aside(p, name, ".rejected")
    except OSError as e:
        return False, "거절 실패: %s" % (e.strerror or e)
    return True, "거절됨: %s 로 이동(삭제 안 함)" % os.path.relpath(moved, p.proposals)


def _move_aside(p, name, bucket):
    bdir = os.path.join(p.proposals, bucket)
    os.makedirs(bdir, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(bdir, "%s-%s" % (name, stamp))
    n = 1
    while os.path.lexists(dest):
        n += 1
        dest = os.path.join(bdir, "%s-%s-%d" % (name, stamp, n))
    os.rename(os.path.join(p.proposals, name), dest)
    return dest


READ_FIRST_MSG = "끝까지 읽어야 설치할 수 있습니다"


def review_lines(snap, w):
    """(줄 목록, skill_end). 설치될 SKILL.md 를 먼저, PROPOSAL.md 는 그 뒤에. skill_end 는 SKILL.md 구간의 줄 수."""
    head = ["== SKILL.md (설치될 내용, sha256 %s) ==" % (snap["sha"][:12] or "-")]
    if snap["blockers"]:
        head.append("설치 불가: " + "; ".join(snap["blockers"]))
    body = snap["data"].decode("utf-8", errors="replace") if snap["data"] is not None else "(없음 또는 읽을 수 없음)"
    if snap["truncated"]:
        body += "\n…(이후 생략)"
    skill = wrap_text("\n".join(head) + "\n" + body + "\n== SKILL.md 끝 ==", w)
    prop = snap["proposal"] if snap["proposal"] is not None else "(없음 또는 읽을 수 없음)"
    rest = wrap_text("\n== PROPOSAL.md (설치되지 않음, 참고용) ==\n" + prop, w)
    return skill + rest, len(skill)


def new_review(snap):
    return {"snap": snap, "scroll": 0, "read_end": False}


def note_scroll(rv, top, vis_h, skill_end):
    """화면 맨 위 줄 top 과 보이는 줄 수로 SKILL.md 끝까지 봤는지 기록한다(한 번 true 가 되면 유지)."""
    if top + vis_h >= skill_end:
        rv["read_end"] = True
    return rv["read_end"]


def press_install(p, rv):
    """i 키의 상태 전이. ('need-read'|'refused'|'confirm', 메시지)."""
    if not rv["read_end"]:
        return "need-read", READ_FIRST_MSG
    snap = rv["snap"]
    if snap["blockers"] or snap["data"] is None:
        return "refused", "설치 불가: " + "; ".join(snap["blockers"] or ["SKILL.md 없음"])
    if os.path.lexists(install_target(p, snap["name"])):
        return "refused", "설치 불가: 대상이 이미 있음"
    return "confirm", ""


# ---------------------------------------------------------------- 대화형 화면
TABS = ["상태", "기억", "로그", "제안"]
MIN_W, MIN_H = 30, 8


def run_ui(p):
    import curses
    import locale
    locale.setlocale(locale.LC_ALL, "")
    curses.wrapper(lambda scr: _ui(scr, p, curses))


def _ui(scr, p, curses):
    try:
        curses.curs_set(0)
    except curses.error:
        pass
    scr.timeout(1000)
    scr.keypad(True)

    S = {
        "tab": 0, "msg": "", "status": None, "status_at": 0.0,
        "mem": [], "mem_sel": 0, "mem_flt": "", "mem_view": None, "mem_scroll": 0,
        "log_kind": "reflect", "log_lines": None, "log_scroll": None,
        "props": [], "prop_sel": 0, "prop_view": None,   # prop_view: new_review() 결과(스냅샷 포함)
        "mode": "",      # '' | 'filter' | 'confirm-install' | 'confirm-reject'
        "input": "",
    }

    def refresh_all(force=True):
        S["status"] = load_status(p)
        S["status_at"] = time.time()
        S["mem"] = load_memories(p.mem)
        S["props"] = list_proposals(p.proposals)
        S["prop_sel"] = min(S["prop_sel"], max(0, len(S["props"]) - 1))
        S["log_lines"] = tail_lines(os.path.join(p.logs, S["log_kind"] + ".log"))
        S["log_scroll"] = None if force else S["log_scroll"]

    def put(y, x, s, attr=0, w=None):
        h, W = scr.getmaxyx()
        if y < 0 or y >= h:
            return
        w = (W - x) if w is None else min(w, W - x)
        if w <= 0:
            return
        try:
            scr.addstr(y, x, clip(s, w), attr)
        except curses.error:
            pass

    def viewport_lines(lines, scroll, h):
        scroll = max(0, min(scroll, max(0, len(lines) - h)))
        return scroll, lines[scroll:scroll + h]

    def scroll_key(k, scroll, total, h):
        page = max(1, h - 1)
        if k in (curses.KEY_DOWN, ord("j")):
            return scroll + 1
        if k in (curses.KEY_UP, ord("k")):
            return scroll - 1
        if k in (curses.KEY_NPAGE, ord(" ")):
            return scroll + page
        if k in (curses.KEY_PPAGE, ord("b")):
            return scroll - page
        if k in (curses.KEY_HOME, ord("g")):
            return 0
        if k in (curses.KEY_END, ord("G")):
            return total
        return scroll

    def draw():
        scr.erase()
        h, W = scr.getmaxyx()
        if W < MIN_W or h < MIN_H:
            put(0, 0, "터미널이 너무 좁습니다")
            put(1, 0, "최소 %d열 x %d줄 필요" % (MIN_W, MIN_H))
            put(2, 0, "현재 %dx%d" % (W, h))
            scr.refresh()
            return
        # 탭 줄
        x = 0
        for i, t in enumerate(TABS):
            label = " %d%s " % (i + 1, t)
            put(0, x, label, curses.A_REVERSE if i == S["tab"] else 0)
            x += swidth(label)
        reserve = 2 if S["mode"] == "confirm-install" else 0   # 확인 문구가 본문을 가리지 않게 본문 줄을 줄인다
        body_h = h - 2 - reserve
        tab = S["tab"]
        hint = ""
        if tab == 0:
            hint = "r 갱신  Tab 다음  q 종료"
            draw_status(1, body_h, W)
        elif tab == 1:
            hint = draw_memory(1, body_h, W)
        elif tab == 2:
            hint = draw_log(1, body_h, W)
        else:
            hint = draw_props(1, body_h, W)
        if S["mode"] == "filter":
            put(h - 1, 0, "필터> " + S["input"] + "_", curses.A_BOLD)
        elif S["mode"] == "confirm-install":
            rv = S["prop_view"]
            if rv:
                snap = rv["snap"]
                info = wrap("설치: %s -> %s (sha %s)" % (sanitize(snap["name"]), install_target(p, snap["name"]),
                                                      snap["sha"][:8]), W - 1)[-2:]
                for j, l in enumerate(info):
                    put(h - 3 + j, 0, l, curses.A_REVERSE)
            put(h - 1, 0, "정확히 yes 입력> " + S["input"] + "_", curses.A_BOLD)
        elif S["mode"] == "confirm-reject":
            put(h - 1, 0, "거절(.rejected 로 이동)? y/N", curses.A_BOLD)
        elif S["msg"]:
            put(h - 1, 0, S["msg"], curses.A_BOLD)
        else:
            put(h - 1, 0, hint, curses.A_DIM)
        scr.refresh()

    def draw_status(y0, h, W):
        st = S["status"]
        if st is None:
            put(y0, 0, "(불러오는 중)")
            return
        lines = []
        for l in status_lines(st):
            lines.extend(wrap(l, W - 1))
        age = int(time.time() - S["status_at"])
        lines.append("")
        lines.append("갱신 %d초 전 (%d초마다 자동)" % (age, REFRESH_SEC))
        for i, l in enumerate(lines[:h]):
            put(y0 + i, 0, l, curses.A_BOLD if i == 0 else 0)

    def draw_memory(y0, h, W):
        if S["mem_view"] is not None:
            lines = wrap_text(S["mem_view"]["text"], W - 1)
            S["mem_scroll"], vis = viewport_lines(lines, S["mem_scroll"], h - 1)
            put(y0, 0, S["mem_view"]["title"], curses.A_BOLD)
            for i, l in enumerate(vis):
                put(y0 + 1 + i, 0, l)
            return "j/k 스크롤  q/Esc 목록"
        rows = group_memories(S["mem"], S["mem_flt"])
        items_idx = [i for i, r in enumerate(rows) if r[0] == "i"]
        if not rows:
            put(y0, 0, "기억 없음" + (" (필터: %s)" % S["mem_flt"] if S["mem_flt"] else ""))
            return "/ 필터  r 갱신"
        S["mem_sel"] = max(0, min(S["mem_sel"], len(items_idx) - 1))
        cur_row = items_idx[S["mem_sel"]] if items_idx else 0
        top = max(0, min(cur_row - h // 2, len(rows) - h))
        for n, r in enumerate(rows[top:top + h]):
            idx = top + n
            if r[0] == "h":
                put(y0 + n, 0, "[%s]" % r[1], curses.A_BOLD)
            else:
                it = r[1]
                txt = "  " + it["name"] + (" - " + it["desc"] if it["desc"] else "")
                put(y0 + n, 0, txt, curses.A_REVERSE if idx == cur_row else 0)
        flt = "  필터:" + S["mem_flt"] if S["mem_flt"] else ""
        return "j/k 이동 Enter 보기 / 필터" + flt

    def draw_log(y0, h, W):
        name = S["log_kind"] + ".log"
        put(y0, 0, "%s (l 전환, 마지막 %d줄)" % (name, TAIL_LINES), curses.A_BOLD)
        if S["log_lines"] is None:
            put(y0 + 1, 0, "로그 없음")
            return "l 전환  r 갱신"
        lines = []
        for l in S["log_lines"]:
            lines.extend(wrap_text(l, W - 1))
        if S["log_scroll"] is None:
            S["log_scroll"] = max(0, len(lines))
        S["log_scroll"], vis = viewport_lines(lines, S["log_scroll"], h - 1)
        for i, l in enumerate(vis):
            put(y0 + 1 + i, 0, l)
        return "j/k 스크롤 g/G 처음/끝 l 전환"

    def draw_props(y0, h, W):
        if S["prop_view"] is not None:
            rv = S["prop_view"]
            lines, skill_end = review_lines(rv["snap"], W - 1)
            rv["scroll"], vis = viewport_lines(lines, rv["scroll"], h - 1)
            read = note_scroll(rv, rv["scroll"], h - 1, skill_end)
            put(y0, 0, "! 신뢰할 수 없는 데이터. SKILL.md 끝까지 " + ("읽음" if read else "읽어야 설치"), curses.A_BOLD)
            for i, l in enumerate(vis):
                put(y0 + 1 + i, 0, l)
            return "j/k 스크롤 i 설치 x 거절 q 목록"
        put(y0, 0, "! 설치 전 내용을 읽어 보세요", curses.A_BOLD)
        if not S["props"]:
            put(y0 + 1, 0, "대기 중인 제안 없음")
            return "r 갱신"
        S["prop_sel"] = max(0, min(S["prop_sel"], len(S["props"]) - 1))
        avail = h - 1
        top = max(0, min(S["prop_sel"] - avail // 2, len(S["props"]) - avail))
        for n, it in enumerate(S["props"][top:top + avail]):
            tag = "" if it["valid"] and it["has_skill"] else " (설치 불가)"
            put(y0 + 1 + n, 0, " " + it["name"] + tag,
                curses.A_REVERSE if top + n == S["prop_sel"] else 0)
        return "j/k 이동 Enter 보기 i 설치 x 거절"

    def cur_prop():
        if S["props"] and 0 <= S["prop_sel"] < len(S["props"]):
            return S["props"][S["prop_sel"]]
        return None

    def open_review(it):
        # 보기를 여는 순간 SKILL.md 를 한 번만 읽어 스냅샷으로 고정한다(이후 표시·설치는 이것만 쓴다)
        S["prop_view"] = new_review(snapshot_proposal(p, it["raw"]))

    def start_install():
        rv = S["prop_view"]
        if rv is None:
            it = cur_prop()
            if it:
                open_review(it)
                S["msg"] = READ_FIRST_MSG
            return
        kind, msg = press_install(p, rv)
        if kind == "confirm":
            S["msg"] = ""
            S["mode"], S["input"] = "confirm-install", ""
        else:
            S["msg"] = msg

    def switch(tab):
        S["tab"] = tab % len(TABS)
        S["msg"] = ""
        S["mode"] = ""
        S["input"] = ""
        if S["tab"] == 3:
            S["props"] = list_proposals(p.proposals)

    def handle_input_mode(k):
        """필터·확인 입력 모드. 처리했으면 True."""
        mode = S["mode"]
        if not mode:
            return False
        if mode == "confirm-reject":
            if k in ("y", "Y"):
                it = cur_prop()
                ok, msg = reject_proposal(p, it["raw"]) if it else (False, "대상 없음")
                S["msg"] = msg
                S["prop_view"] = None
                S["props"] = list_proposals(p.proposals)
            else:
                S["msg"] = "거절 취소"
            S["mode"] = ""
            return True
        # 텍스트 입력(filter / confirm-install)
        if k == "\x1b":
            S["mode"], S["input"] = "", ""
            S["msg"] = "취소"
            if mode == "filter":
                S["mem_flt"], S["msg"] = "", ""
        elif k in ("\n", "\r") or k == curses.KEY_ENTER:
            if mode == "filter":
                S["mem_flt"] = S["input"].strip()
                S["mem_sel"] = 0
                S["msg"] = ""
            else:
                rv = S["prop_view"]
                if S["input"] == "yes" and rv:
                    ok, S["msg"] = install_proposal(p, rv["snap"]["name"], rv["snap"])
                    if not ok and "바뀌었" in S["msg"]:
                        S["prop_view"] = new_review(snapshot_proposal(p, rv["snap"]["name"]))  # 다시 읽게 한다
                    else:
                        S["prop_view"] = None
                    S["props"] = list_proposals(p.proposals)
                else:
                    S["msg"] = "설치 취소(정확히 yes 가 아님)"
            S["mode"], S["input"] = "", ""
        elif k in (curses.KEY_BACKSPACE, "\x7f", "\b"):
            S["input"] = S["input"][:-1]
        elif isinstance(k, str) and k.isprintable() and len(S["input"]) < 64:
            S["input"] += k
        return True

    refresh_all()
    while True:
        h, W = scr.getmaxyx()
        if S["tab"] == 0 and time.time() - S["status_at"] >= REFRESH_SEC:
            S["status"] = load_status(p)
            S["status_at"] = time.time()
        draw()
        try:
            k = scr.get_wch()
        except curses.error:
            continue          # 타임아웃: 다시 그리며 자동 갱신 확인
        except KeyboardInterrupt:
            break
        if k == curses.KEY_RESIZE:
            continue
        if handle_input_mode(k):
            continue
        S["msg"] = ""
        kk = ord(k) if isinstance(k, str) and len(k) == 1 else k
        body_h = max(1, h - 3)
        tab = S["tab"]

        # 상세 보기 중에는 q/Esc 가 목록 복귀(앱 종료가 아님)
        in_view = (tab == 1 and S["mem_view"] is not None) or (tab == 3 and S["prop_view"] is not None)
        if k in ("q", "\x1b"):
            if in_view:
                S["mem_view"] = None
                S["prop_view"] = None
                continue
            if k == "q":
                break
            continue
        if k == "\t":
            switch(tab + 1)
            continue
        if k == curses.KEY_BTAB:
            switch(tab - 1)
            continue
        if isinstance(k, str) and k in "1234" and len(k) == 1 and not in_view:
            switch(int(k) - 1)
            continue
        if k == "r":
            refresh_all(force=False)
            S["msg"] = "갱신됨"
            continue

        if tab == 1:
            if S["mem_view"] is not None:
                lines = wrap_text(S["mem_view"]["text"], W - 1)
                S["mem_scroll"] = scroll_key(kk, S["mem_scroll"], len(lines), body_h)
            else:
                rows = group_memories(S["mem"], S["mem_flt"])
                n_items = len([1 for r in rows if r[0] == "i"])
                if kk in (curses.KEY_DOWN, ord("j")):
                    S["mem_sel"] = min(S["mem_sel"] + 1, max(0, n_items - 1))
                elif kk in (curses.KEY_UP, ord("k")):
                    S["mem_sel"] = max(S["mem_sel"] - 1, 0)
                elif k == "/":
                    S["mode"], S["input"] = "filter", S["mem_flt"]
                elif k in ("\n", "\r") or k == curses.KEY_ENTER:
                    its = [r[1] for r in rows if r[0] == "i"]
                    if its:
                        it = its[min(S["mem_sel"], len(its) - 1)]
                        text = read_text(it["path"])
                        S["mem_view"] = {"title": it["file"],
                                         "text": text if text is not None else "(읽을 수 없음)"}
                        S["mem_scroll"] = 0
        elif tab == 2:
            if k == "l":
                S["log_kind"] = "dream" if S["log_kind"] == "reflect" else "reflect"
                S["log_lines"] = tail_lines(os.path.join(p.logs, S["log_kind"] + ".log"))
                S["log_scroll"] = None
            else:
                total = 10 ** 9
                if S["log_lines"] is not None:
                    total = sum(len(wrap_text(l, W - 1)) for l in S["log_lines"])
                cur = S["log_scroll"] if S["log_scroll"] is not None else total
                S["log_scroll"] = scroll_key(kk, cur, total, body_h)
        elif tab == 3:
            if S["prop_view"] is not None:
                rv = S["prop_view"]
                lines, _ = review_lines(rv["snap"], W - 1)
                rv["scroll"] = scroll_key(kk, rv["scroll"], len(lines), body_h)
                if k == "i":
                    start_install()
                elif k == "x":
                    S["mode"] = "confirm-reject"
            else:
                if kk in (curses.KEY_DOWN, ord("j")):
                    S["prop_sel"] = min(S["prop_sel"] + 1, max(0, len(S["props"]) - 1))
                elif kk in (curses.KEY_UP, ord("k")):
                    S["prop_sel"] = max(S["prop_sel"] - 1, 0)
                elif k in ("\n", "\r") or k == curses.KEY_ENTER:
                    it = cur_prop()
                    if it:
                        open_review(it)
                elif k == "i":
                    start_install()
                elif k == "x" and cur_prop():
                    S["mode"] = "confirm-reject"


# ---------------------------------------------------------------- 시험
def selftest():
    import shutil
    import tempfile
    fails = []

    def check(cond, label):
        if not cond:
            fails.append(label)
            print("FAIL:", label)

    tmp = tempfile.mkdtemp(prefix="maru-ui-selftest-")
    try:
        data = os.path.join(tmp, "data")
        mem = os.path.join(tmp, "mem")
        skills = os.path.join(tmp, "skills")
        for d in (data, mem, skills, os.path.join(data, "logs"), os.path.join(data, "state"),
                  os.path.join(data, "skill-proposals")):
            os.makedirs(d)
        p = Paths(tmp, data, mem, skills, launchd_label="com.maru.selftest-nonexistent")

        def w(path, text):
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)

        # 기억: 정상(한글·metadata.type), 최상위 type, frontmatter 없음, 깨진 frontmatter, 빈 파일, 색인
        w(os.path.join(mem, "MEMORY.md"), "- [a](a.md)\n")
        w(os.path.join(mem, "a.md"), '---\nname: alpha\ndescription: "한글 설명입니다"\nmetadata:\n  type: feedback\n---\n본문\n')
        w(os.path.join(mem, "b.md"), "---\nname: beta\ndescription: plain\ntype: project\n---\nx\n")
        w(os.path.join(mem, "c.md"), "그냥 본문, frontmatter 없음\n")
        w(os.path.join(mem, "d.md"), "---\nname beta-broken\n:::\n")
        w(os.path.join(mem, "e.md"), "")
        w(os.path.join(mem, "f.md"), "---\nname: esc\ndescription: \x1b[31mred\n---\n")
        items = load_memories(mem)
        by = {i["file"]: i for i in items}
        check(len(items) == 6, "memory count 6, got %d" % len(items))
        check(by["a.md"]["type"] == "feedback" and by["a.md"]["desc"] == "한글 설명입니다", "a.md parse")
        check(by["b.md"]["type"] == "project", "b.md top-level type")
        check(by["c.md"]["name"] == "c" and by["c.md"]["type"] == "기타", "c.md fallback")
        check(by["d.md"]["name"] == "d", "broken frontmatter fallback")
        check("\x1b" not in by["f.md"]["desc"], "control chars sanitized")
        rows = group_memories(items)
        check([r[1] for r in rows if r[0] == "h"] == sorted({i["type"] for i in items}), "groups sorted")
        check(len([r for r in group_memories(items, "한글") if r[0] == "i"]) == 1, "filter")
        check(load_memories(os.path.join(tmp, "nope")) == [], "missing mem dir")

        # 한글 폭
        check(swidth("한글ab") == 6, "swidth")
        check(clip("한글ab", 3) == "한", "clip wide")
        check(all(swidth(x) <= 5 for x in wrap("한글한글한글abc", 5)), "wrap width")

        # 로그
        w(os.path.join(data, "logs", "reflect.log"),
          "2026-01-01 00:00:00 [x] 회고 시작 (a)\n2026-01-01 00:00:01 [x] claude 종료 rc=0\n2026-01-01 00:00:02 [x] 커밋 완료\n"
          "2026-01-02 00:00:00 [y] 회고 시작 (b)\n2026-01-02 00:00:01 [y] claude 종료 rc=1\n")
        w(os.path.join(data, "logs", "dream.log"),
          "2026-01-03 03:30:00 [dream] 시작\n2026-01-03 03:30:05 [dream] 검증 실패 되돌림\n")
        r = last_run(os.path.join(data, "logs", "reflect.log"), "reflect")
        check(r == ("2026-01-02 00:00:00", "실패"), "last_run reflect: %r" % (r,))
        r = last_run(os.path.join(data, "logs", "dream.log"), "dream")
        check(r and r[1] == "되돌림(변경 폐기)", "last_run dream: %r" % (r,))
        check(last_run(os.path.join(tmp, "none.log"), "reflect") is None, "missing log")
        check(tail_lines(os.path.join(tmp, "none.log")) is None, "tail missing")
        check(len(tail_lines(os.path.join(data, "logs", "reflect.log"), 2)) == 2, "tail n")
        w(os.path.join(data, "state", "fail.reflect"), "3\n")
        w(os.path.join(data, "state", "fail.dream"), "abc\n")

        # 제안
        pr = p.proposals

        def mk(name, skill=True, extra=None):
            d = os.path.join(pr, name)
            os.makedirs(d)
            if skill:
                w(os.path.join(d, "SKILL.md"), "---\nname: %s\n---\n설치하지 말 것: rm -rf ~\n" % name)
            w(os.path.join(d, "PROPOSAL.md"), "# 제안\n")
            return d

        mk("good-skill")
        mk("no-skill", skill=False)
        mk("existing")
        mk("rej-me")
        mk("Bad_Name")
        mk("linked-skill", skill=False)
        os.symlink(os.path.join(tmp, "mem", "a.md"), os.path.join(pr, "linked-skill", "SKILL.md"))
        os.symlink(tmp, os.path.join(pr, "dirlink"))
        os.makedirs(os.path.join(skills, "existing"))
        w(os.path.join(skills, "existing", "SKILL.md"), "ORIGINAL")
        os.makedirs(os.path.join(pr, ".rejected"))   # 숨김은 목록·개수에서 제외

        lp = list_proposals(pr)
        check(".rejected" not in [i["name"] for i in lp], "hidden excluded")
        check(count_proposals(pr) == 7, "proposal count %r" % count_proposals(pr))
        st = load_status(p, check_launchd=False)
        check(st["memory_files"] == 6 and st["proposals"] == 7 and st["fail_reflect"] == 3
              and st["fail_dream"] is None, "status values %r" % st)
        txt = "\n".join(status_lines(st))
        check("연속 실패: 회고 3회" in txt and "대기 중 스킬 제안: 7개" in txt, "status text")

        def inst(name):
            return install_proposal(p, name, snapshot_proposal(p, name))

        ok, msg = inst("good-skill")
        check(ok and os.path.isfile(os.path.join(skills, "good-skill", "SKILL.md")), "install ok: " + msg)
        check(not os.path.exists(os.path.join(pr, "good-skill"))
              and os.path.isdir(os.path.join(pr, ".installed")), "installed proposal moved aside")
        check(open(os.path.join(skills, "good-skill", "SKILL.md"), encoding="utf-8").read().startswith("---"),
              "installed content")
        for bad, why in (("existing", "exists"), ("no-skill", "no SKILL.md"), ("Bad_Name", "name regex"),
                         ("../mem", "traversal"), ("linked-skill", "symlinked SKILL.md"),
                         ("dirlink", "symlink dir"), ("", "empty"), ("a" * 65, "too long")):
            ok, msg = inst(bad)
            check(not ok, "install must refuse %s (%s)" % (why, msg))
        check(open(os.path.join(skills, "existing", "SKILL.md")).read() == "ORIGINAL", "no overwrite")
        check(sorted(os.listdir(skills)) == ["existing", "good-skill"], "nothing else installed")

        ok, msg = reject_proposal(p, "rej-me")
        rej = os.listdir(os.path.join(pr, ".rejected"))
        check(ok and len(rej) == 1 and rej[0].startswith("rej-me-")
              and os.path.isfile(os.path.join(pr, ".rejected", rej[0], "SKILL.md")), "reject moved: " + msg)
        check(not reject_proposal(p, "../x")[0] and not reject_proposal(p, "dirlink")[0], "reject refuses bad")
        check(os.path.isdir(os.path.join(tmp, "mem")), "symlink target untouched")

        # --- 설치 안전장치 회귀 시험
        good_md = "---\nname: %s\ndescription: d\n---\n본문\n"

        def mk2(name, content, raw=None):
            d = os.path.join(pr, name)
            os.makedirs(d)
            with open(os.path.join(d, "SKILL.md"), "wb") as fh:
                fh.write(raw if raw is not None else content.encode("utf-8"))
            return d

        def refused(name, why, frag=None):
            snap = snapshot_proposal(p, name)
            ok, msg = install_proposal(p, name, snap)
            check(not ok and not os.path.lexists(os.path.join(skills, name)),
                  "must refuse %s: %s" % (why, msg))
            if frag:
                check(frag in msg, "%s reason has %r: %s" % (why, frag, msg))

        check(NAME_RE.fullmatch("abc\n") is None, "NAME_RE rejects trailing newline")
        check(check_proposal(p, "x-skill\n") is not None, "check_proposal rejects trailing newline")
        mk2("nl-name", good_md % "nl-name")
        refused("nl-name\n", "trailing newline name")

        # 심볼릭 링크로 바뀐 SKILL.md(스냅샷 뒤·검사 뒤)
        d = mk2("swap-link", good_md % "swap-link")
        snap = snapshot_proposal(p, "swap-link")
        os.remove(os.path.join(d, "SKILL.md"))
        os.symlink(os.path.join(mem, "a.md"), os.path.join(d, "SKILL.md"))
        ok, msg = install_proposal(p, "swap-link", snap)
        check(not ok and not os.path.lexists(os.path.join(skills, "swap-link")), "symlink swap refused: " + msg)
        check(read_regular(os.path.join(d, "SKILL.md"), 1000)[0] is None, "read_regular refuses symlink")

        # 하드링크
        d = mk2("hard-link", good_md % "hard-link")
        os.link(os.path.join(d, "SKILL.md"), os.path.join(tmp, "hl-other"))
        refused("hard-link", "hardlink", "하드링크")

        # 스냅샷 뒤 파일 변경
        d = mk2("changed", good_md % "changed")
        snap = snapshot_proposal(p, "changed")
        check(not snap["blockers"], "changed: clean snapshot")
        w(os.path.join(d, "SKILL.md"), (good_md % "changed") + "EVIL\n")
        ok, msg = install_proposal(p, "changed", snap)
        check(not ok and "바뀌었" in msg and not os.path.lexists(os.path.join(skills, "changed")),
              "changed after snapshot refused: " + msg)
        ok, msg = install_proposal(p, "changed", snapshot_proposal(p, "changed"))
        check(ok and "EVIL" in open(os.path.join(skills, "changed", "SKILL.md"), encoding="utf-8").read(),
              "re-read snapshot installs what was shown: " + msg)

        # frontmatter
        mk2("name-diff", good_md % "other-name")
        refused("name-diff", "name mismatch", "name")
        for key in ("allowed-tools", "hooks", "model"):
            mk2("extra-" + key, "---\nname: extra-%s\ndescription: d\n%s: x\n---\nb\n" % (key, key))
            refused("extra-" + key, "extra key " + key, key)
        mk2("bad-fm", "---\nname: bad-fm\n  - nested\n---\nb\n")
        refused("bad-fm", "unparsable frontmatter", "파싱")
        mk2("open-fm", "---\nname: open-fm\nbody\n")
        refused("open-fm", "unclosed frontmatter")
        mk2("no-fm-ok", "그냥 본문\n")
        check(not snapshot_proposal(p, "no-fm-ok")["blockers"], "no frontmatter is not a blocker")

        # 저장소 스킬 이름 충돌
        os.makedirs(os.path.join(p.repo_skills, "mac-control"))
        mk2("mac-control", good_md % "mac-control")
        refused("mac-control", "repo skill collision", "저장소")

        # 숨김 문자·잘못된 UTF-8(표시는 가능, 설치만 거부)
        for i, ch in enumerate(("\u3164", "\u115f", "\u1160", "\uffa0", "\u2800", "\u202e", "\x1b", "\r", "\u200b")):
            nm = "hid-%d" % i
            mk2(nm, (good_md % nm) + "a%sb\n" % ch)
            refused(nm, "hidden char U+%04X" % ord(ch), "숨김")
            check(snapshot_proposal(p, nm)["data"] is not None, "hidden still displayable")
        mk2("bad-utf8", "", raw=(good_md % "bad-utf8").encode() + b"\xff\xfe\n")
        refused("bad-utf8", "invalid utf-8", "UTF-8")
        mk2("tab-nl-ok", (good_md % "tab-nl-ok") + "a\tb\n")
        check(not snapshot_proposal(p, "tab-nl-ok")["blockers"], "tab/newline allowed")

        # 상한
        mk2("too-big", "", raw=(good_md % "too-big").encode() + b"a" * MAX_SKILL)
        sn = snapshot_proposal(p, "too-big")
        check(sn["blockers"] and len(sn["data"]) == MAX_SKILL, "oversize flagged, truncated display")
        refused("too-big", "oversize", "초과")
        hd = b"---\nname: exact-max\n---\n"
        d = mk2("exact-max", "", raw=hd + b"a" * (MAX_SKILL - len(hd)))
        check(os.path.getsize(os.path.join(d, "SKILL.md")) == MAX_SKILL
              and not snapshot_proposal(p, "exact-max")["blockers"], "exactly MAX_SKILL allowed")

        # H1 상태 전이: 끝까지 스크롤해야 i 가 동작
        long_md = (good_md % "long-one") + "\n".join("줄 %d" % i for i in range(100)) + "\n"
        mk2("long-one", long_md)
        sn = snapshot_proposal(p, "long-one")
        lines, skill_end = review_lines(sn, 40)
        check(skill_end > 30 and skill_end < len(lines) and "SKILL.md" in lines[0], "SKILL.md shown first")
        check("PROPOSAL.md" not in "\n".join(lines[:skill_end]), "PROPOSAL.md after SKILL.md")
        rv = new_review(sn)
        check(press_install(p, rv) == ("need-read", READ_FIRST_MSG), "i before reading -> notice")
        note_scroll(rv, 0, 10, skill_end)
        check(press_install(p, rv)[0] == "need-read", "partial scroll still blocked")
        note_scroll(rv, skill_end - 10, 10, skill_end)
        check(press_install(p, rv)[0] == "confirm", "end of SKILL.md reached -> confirm")
        rv2 = new_review(snapshot_proposal(p, "name-diff"))
        note_scroll(rv2, 0, 1000, 5)
        check(press_install(p, rv2)[0] == "refused", "read but blocked -> refused")
        rv3 = new_review(snapshot_proposal(p, "long-one"))
        note_scroll(rv3, 0, 10 ** 6, skill_end)
        os.makedirs(os.path.join(skills, "long-one"))
        check(press_install(p, rv3)[0] == "refused", "existing user skill -> refused")
        os.rmdir(os.path.join(skills, "long-one"))
        ok, msg = install_proposal(p, "long-one", snapshot_proposal(p, "long-one"))
        check(ok, "normal proposal installs: " + msg)

        # 빈 환경
        empty = Paths(tmp, os.path.join(tmp, "x"), os.path.join(tmp, "x1"), os.path.join(tmp, "x2"))
        st = load_status(empty, check_launchd=False)
        check(st["memory_files"] is None and st["proposals"] is None and st["reflect"] is None, "empty env status")
        check(list_proposals(empty.proposals) == [], "empty proposals")
        check(sanitize("a\x1b[2Jb\tc") == "a?[2Jb    c", "sanitize")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("selftest: %s" % ("OK" if not fails else "%d 실패" % len(fails)))
    return 0 if not fails else 1


def main(argv):
    if len(argv) > 1 and argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    if "--selftest" in argv[1:]:
        return selftest()
    p = Paths.from_env()
    if "--once" in argv[1:]:
        print("\n".join(status_lines(load_status(p))))
        return 0
    if len(argv) > 1:
        print("알 수 없는 옵션: %s (--once, --selftest)" % " ".join(argv[1:]), file=sys.stderr)
        return 2
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        print("터미널이 아닙니다. 평문 상태는 --once 를 쓰세요.", file=sys.stderr)
        return 2
    run_ui(p)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
