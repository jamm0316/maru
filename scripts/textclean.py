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
