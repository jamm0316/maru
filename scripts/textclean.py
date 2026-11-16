"""apply_suggestions / apply_journal 공용: 모델이 쓴 텍스트에서 제어·서식·보이지 않는 문자를 가려낸다.
lib.sh 의 python3 -I 블록이 sys.path 에 이 폴더를 넣고 import 한다."""
import unicodedata

HIDDEN = {"ㅤ", "ᅟ", "ᅠ", "ﾠ", "⠀"}   # 한글 채움 문자·점자 빈칸
BAD_CATEGORIES = ("Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp")  # 제어·서식(bidi/zero-width)·서로게이트·사설·미할당·줄/문단 구분자


def is_bad(c):
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
    백틱 제거, < > -> ‹ ›, [ ] -> ( ), 앞쪽 # 제거. 앞뒤 공백을 정리해 돌려준다(빈 문자열일 수 있음)."""
    s = strip_bad(s).replace("`", "")
    s = defang_angle(s).translate(_BRACKET)
    return s.strip().lstrip("#").strip()


def looks_secret(s):
    """비밀값처럼 보이는 문자열: sk- 뒤 토큰 16자+, 16진수 32자+, base64 계열 40자+."""
    global _SECRET
    if _SECRET is None:
        import re
        _SECRET = re.compile(r"sk-[A-Za-z0-9_-]{16,}|[0-9A-Fa-f]{32,}|[A-Za-z0-9+/_=-]{40,}")
    return bool(_SECRET.search(s))
