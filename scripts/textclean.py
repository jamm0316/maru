"""apply_suggestions / apply_journal / apply_todos 공용: 모델이 쓴 텍스트에서 제어·서식·보이지 않는 문자를 가려낸다.
lib.sh 의 python3 -I 블록이 sys.path 에 이 폴더를 넣고 import 한다."""
import unicodedata

HIDDEN = {"ㅤ", "ᅟ", "ᅠ", "ﾠ", "⠀"}   # 한글 채움 문자·점자 빈칸
BAD_CATEGORIES = ("Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp")  # 제어·서식(bidi/zero-width)·서로게이트·사설·미할당·줄/문단 구분자


# 앱(app/lib.js BAD_SRC)이 명시적으로 지우는 문자: 범주로는 안 잡히는 결합 그래프 결합자·한글 채움·몽골어 모음 구분자·변형 선택자.
# 셸과 앱이 같은 줄을 같은 항목으로 읽게 하려고 같은 집합을 쓴다.
EXTRA_RANGES = ((0x034F, 0x034F), (0x115F, 0x1160), (0x180E, 0x180E), (0xFE00, 0xFE0F), (0xE0100, 0xE01EF))


def is_bad(c):
    o = ord(c)
    if any(a <= o <= b for a, b in EXTRA_RANGES): return True
    return c in HIDDEN or unicodedata.category(c) in BAD_CATEGORIES


def has_bad(s):
    return any(is_bad(c) for c in s)


def strip_bad(s):
    return "".join(c for c in s if not is_bad(c))


_ANGLE = {ord("<"): "\u2039", ord(">"): "\u203a"}   # < > -> ‹ ›
_BRACKET = {ord("["): "(", ord("]"): ")"}
_SECRET = None


def defang_angle(s):
    """< > 를 ‹ › 로 바꿔 태그·HTML 주석·system-reminder 닫기를 만들 수 없게 한다."""
    return s.translate(_ANGLE)


def neutralize_body(s):
    """일지 문장 하나를 컨텍스트에 넣어도 안전한 형태로 바꾼다(쓸 때·읽을 때 같은 함수):
    백틱 제거, < > -> ‹ ›, [ ] -> ( ), 앞쪽 # 와 @ 제거(@ 는 일지 줄의 태그 표기와 헷갈리지 않게).
    앞뒤 공백을 정리해 돌려준다(빈 문자열일 수 있음)."""
    s = strip_bad(s).replace("`", "")
    s = defang_angle(s).translate(_BRACKET)
    s = s.strip()
    while s and (s[0] in "#@" or s[0].isspace()):
        s = s[1:]
    return s.strip()


def safe_start(s):
    """앱의 isSafeQuestStart 와 같은 규칙: 비어 있지 않고 숫자·!·/ 로 시작하지 않는다(선택 프롬프트·셸·슬래시 명령으로 오해될 수 있음)."""
    return bool(s) and s[0] not in "0123456789!/"


TAG_CHARS = "0-9A-Za-z가-힣-"   # 태그·todos 의 tag 필드에 쓸 수 있는 문자(정규식 문자 클래스 내용)


def valid_tag(s):
    import re
    return bool(re.fullmatch("[" + TAG_CHARS + "]{1,12}", s))


def looks_secret(s):
    """비밀값처럼 보이는 문자열: sk- 뒤 토큰 16자+, 16진수 32자+, base64 계열 40자+."""
    global _SECRET
    if _SECRET is None:
        import re
        _SECRET = re.compile(r"sk-[A-Za-z0-9_-]{16,}|[0-9A-Fa-f]{32,}|[A-Za-z0-9+/_=-]{40,}")
    return bool(_SECRET.search(s))


# ---- 프로젝트(태그/슬러그) ----
# 프로젝트 표기는 태그 칸의 `태그/슬러그`. 슬러그는 소문자·숫자·한글·`-` 1~24자.
# 앱(app/lib.js)과 같은 상수·같은 규칙을 쓴다(test-todos.sh 가 같은 입력으로 대조한다).
SLUG_CHARS = "0-9a-z가-힣-"
PROJECT_TITLE_MAX = 40
PROJECT_ACTIVE_MAX = 200      # 완료·합쳐진 것을 뺀 "열린" 프로젝트 상한
PROJECT_FILE_LINES = 1000     # 파일 자체의 줄 수 상한(완료·합침이 쌓일 여유)
PROJECT_NEW_MAX = 3           # 한 번의 apply_projects 에서 새로 등록할 수 있는 최대 줄 수
PROJECT_FILE_MAX = 262144
PROJECT_STATE_MAX = 524288    # data/project-state.json 읽기 상한(앱이 쓰기 전에 같은 값으로 검사한다)
PROJECT_STATE_ENTRIES = 1000
_TITLE_OK = None
_KEY_RE = None


def valid_slug(s):
    import re
    return bool(re.fullmatch("[" + SLUG_CHARS + "]{1,24}", s))


def split_project(field):
    """태그 칸 문자열 -> (태그 원문, 슬러그 또는 None). 태그 검증은 호출 쪽(valid_tag)이 한다.
    `/` 가 없으면 슬러그 없음. 슬러그 형식이 틀리면(빈 값·대문자·`/` 포함·길이 초과 등) 줄을 버리지 않고 슬러그만 뗀다."""
    tag, sep, slug = field.partition("/")
    if not sep or not valid_slug(slug):
        return tag, None
    return tag, slug


def clean_title(raw):
    """프로젝트 제목 정리(앱 cleanProjectTitle 과 같은 규칙, 멱등): 무해화(neutralize_body) 뒤 공백 접기를 안정될 때까지 되풀이하고,
    한글·영숫자·공백과 `. , - _ / ( ) : · + # &` 만 남은 1~40자일 때만 돌려준다. 아니면 ''."""
    import re
    global _TITLE_OK
    if _TITLE_OK is None:
        _TITLE_OK = re.compile("[0-9A-Za-z가-힣 .,\\-_/():\u00b7+#&]+")
    if not isinstance(raw, str) or len(raw) > 400: return ""
    t = raw
    for _ in range(4):
        n = re.sub(r"\s+", " ", neutralize_body(t)).strip()
        if n == t: break
        t = n
    return t if 1 <= len(t) <= PROJECT_TITLE_MAX and _TITLE_OK.fullmatch(t) and not looks_secret(t) else ""


def read_projects_checked(path):
    """data/projects.txt(`태그|슬러그|제목`) -> ([(태그, 슬러그, 제목)], 오류 또는 None). 파일이 없으면 ([], None).
    있는데 읽을 수 없으면(링크·일반 파일 아님·크기 초과·UTF-8 아님) ([], 이유). 형식이 틀린 줄·위험한 줄은 조용히 버린다(키 중복은 첫 줄, 최대 1000줄)."""
    import os, stat
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return [], None
    except OSError as e:
        return [], "상태 확인 실패(%s)" % type(e).__name__
    if not stat.S_ISREG(st.st_mode): return [], "일반 파일 아님(심볼릭 링크 등)"
    if st.st_size > PROJECT_FILE_MAX: return [], "크기 초과(%d바이트)" % st.st_size
    try:
        with open(path, "rb") as f: text = f.read(PROJECT_FILE_MAX + 1).decode("utf-8")
    except (OSError, UnicodeDecodeError) as e:
        return [], "읽기 실패(%s)" % type(e).__name__
    out, seen = [], set()
    for line in text.split("\n"):
        line = line.rstrip("\r")
        if not line or has_bad(line): continue
        parts = line.split("|")
        if len(parts) != 3: continue
        tag, slug, title = parts
        if not valid_tag(tag) or not valid_slug(slug) or clean_title(title) != title or looks_secret(title): continue
        if (tag, slug) in seen: continue
        seen.add((tag, slug)); out.append((tag, slug, title))
        if len(out) >= PROJECT_FILE_LINES: break
    return out, None


def read_projects(path):
    return read_projects_checked(path)[0]


def load_state(path):
    """data/project-state.json(앱이 쓰는 파일, 읽기만) -> {키: {status, mergedInto?, title?}}. 없거나 이상하면 {}. 형식이 틀린 항목은 버린다."""
    import json, os, re, stat
    global _KEY_RE
    if _KEY_RE is None:
        _KEY_RE = re.compile("[" + TAG_CHARS + "]{1,12}/[" + SLUG_CHARS + "]{1,24}")
    try:
        st = os.lstat(path)
        if not stat.S_ISREG(st.st_mode) or st.st_size > PROJECT_STATE_MAX: return {}
        with open(path, "rb") as f: o = json.loads(f.read(PROJECT_STATE_MAX + 1).decode("utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(o, dict) or len(o) > PROJECT_STATE_ENTRIES: return {}
    out = {}
    for k, e in o.items():
        if not isinstance(k, str) or not _KEY_RE.fullmatch(k) or not isinstance(e, dict) or e.get("status") not in ("open", "done"): continue
        v = {"status": e["status"]}
        t = e.get("title")
        if isinstance(t, str) and t and clean_title(t) == t: v["title"] = t
        m = e.get("mergedInto")
        if isinstance(m, str) and _KEY_RE.fullmatch(m) and m != k: v["mergedInto"] = m
        out[k] = v
    return out


def project_root(state, key):
    """합친 프로젝트를 따라가 대표 키를 찾는다(최대 8단계, 순환이면 처음 키). 앱 projectRoot 와 같다."""
    k = key
    for _ in range(8):
        e = state.get(k)
        if not e or not e.get("mergedInto"): return k
        k = e["mergedInto"]
    return key


def project_inactive(state, regkeys, key):
    """완료됐거나, 레지스트리에 있는 다른 프로젝트에 합쳐졌으면 True. 합친 대상이 레지스트리에 없으면 합침을 무시한다(앱 buildProjects 와 같다)."""
    e = state.get(key)
    if not e: return False
    if e.get("status") == "done": return True
    r = project_root(state, key)
    return r != key and r in regkeys


def recent_days(journal_dir):
    """일지(journal/*.md, journal/archive/*.md; 링크·일반 파일 아닌 것 제외)에서 프로젝트별 가장 최근 기록 날짜. {키: 'YYYY-MM-DD'}"""
    import datetime, os, re, stat
    item = re.compile(r"^- \[(?:한 일|결정|남은 일)\] \((?:10|[1-9])\) @([" + TAG_CHARS + r"]{1,12}/[" + SLUG_CHARS + r"]{1,24}) ")
    name = re.compile(r"^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:\.[0-9]{1,3})?\.md$")
    def real_dir(d):
        try: st = os.lstat(d)
        except OSError: return False
        return stat.S_ISDIR(st.st_mode)
    files = []
    if real_dir(journal_dir):
        for d in (journal_dir, os.path.join(journal_dir, "archive")):
            if not real_dir(d): continue
            try: names = os.listdir(d)
            except OSError: continue
            for n in names:
                m = name.match(n)
                if not m: continue
                try: datetime.date.fromisoformat(m.group(1))
                except ValueError: continue
                files.append((m.group(1), os.path.join(d, n)))
    files.sort(reverse=True)
    out = {}
    for day, f in files[:400]:
        try:
            st = os.lstat(f)
            if not stat.S_ISREG(st.st_mode) or st.st_size > 262144: continue
            with open(f, "rb") as fh: text = fh.read(262145).decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for l in text.split("\n"):
            m = item.match(strip_bad(l.rstrip("\r")))
            if m and out.get(m.group(1), "") < day: out[m.group(1)] = day
    return out


def open_project_lines(projects_path, state_path, journal_dir=None, limit=50):
    """회고·정리 프롬프트에 넣을 열린 프로젝트 목록 줄들(`태그/슬러그 — 제목`, 최대 limit 줄).
    완료·합쳐진 것은 뺀다(data/project-state.json 은 읽기만; 없거나 이상하면 전부 열린 것). 고르는 순서: 일지에 최근 기록이 있는 순,
    그다음 기록 없는 것을 최근 등록순(파일 뒤쪽 먼저)."""
    reg, _err = read_projects_checked(projects_path)
    state = load_state(state_path)
    regkeys = {t + "/" + s for t, s, _ in reg}
    days = recent_days(journal_dir) if journal_dir else {}
    last = {}
    for k, d in days.items():   # 합쳐진 프로젝트의 기록은 대표 프로젝트의 것으로 센다
        r = project_root(state, k)
        r = r if r in regkeys else k
        if last.get(r, "") < d: last[r] = d
    rows = []
    for idx, (tag, slug, title) in enumerate(reg):
        key = tag + "/" + slug
        if project_inactive(state, regkeys, key): continue
        e = state.get(key)
        if e and e.get("title"): title = e["title"]
        rows.append((last.get(key, ""), idx, "%s — %s" % (key, title)))
    rows.sort(key=lambda r: (r[0] != "", r[0], r[1]), reverse=True)   # 기록 있는 것(최근 날짜순) 먼저, 같은 날·기록 없음은 나중에 등록한 것 먼저
    return [r[2] for r in rows[:limit]]
