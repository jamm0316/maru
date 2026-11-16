#!/usr/bin/env python3
"""maru todo [번호]: data/todos.txt(`태그|중요도|제목|프롬프트`)를 태그별로 번호와 함께(태그 칸은 `태그/슬러그` 도 받아 태그로 묶는다) 출력한다.
번호를 주면 그 항목의 프롬프트를 클립보드에 복사한다(전송하지 않는다). 프롬프트가 빈 항목은 사용자가 직접 할 일이다.
파일은 신뢰할 수 없는 표시 데이터로 읽는다(일반 파일·64KB 이하·UTF-8·줄 형식 검사, 제어 문자 줄은 버림). 표준 라이브러리만 쓴다."""
import os
import re
import stat
import sys
import time

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)
from textclean import has_bad, valid_tag, safe_start, split_project, read_todo_done, title_key   # noqa: E402
from maru_ui import copy_suggestion        # noqa: E402

MAX_BYTES, MAX_ITEMS = 64 * 1024, 12   # apply_todos 의 병합 결과 상한과 같다


def load_todos(path):
    """[(tag, importance, title, prompt)] — 형식이 틀린 줄은 버린다. 파일 순서를 그대로 유지한다."""
    try:
        st = os.lstat(path)
        if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_BYTES:
            return []
        with open(path, "rb") as f:
            text = f.read(MAX_BYTES + 1).decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    out = []
    for line in text.split("\n"):
        line = line.rstrip("\r").strip(" ")
        parts = line.split("|")
        if len(parts) != 4 or has_bad(line):
            continue
        tag, imp, title, prompt = parts
        tag, _slug = split_project(tag)   # `태그/슬러그` 도 받는다(묶음은 태그 기준, 슬러그는 CLI 에서 안 씀)
        if not valid_tag(tag) or not re.fullmatch(r"[0-9]{1,2}", imp) or not 1 <= int(imp) <= 10:
            continue
        if not title or len(title) > 60 or len(prompt) > 120:
            continue
        if prompt and not safe_start(prompt):
            prompt = ""   # 숫자·!·/ 로 시작하는 프롬프트는 복사하지 않는다(직접 할 일 취급; 셸이 이미 비우지만 파일을 믿지 않는다)
        out.append((tag, int(imp), title, prompt))
    return out[:MAX_ITEMS]


def hide_done(items, donepath, now):
    """최근 7일 안에 완료/안 함으로 표시된 항목(최상위 태그와 제목 키가 모두 같은 것)을 뺀다. 다음 회고 전에도 앱과 목록이 같아지게 한다."""
    pairs = {(m[2], m[5]) for m in read_todo_done(donepath, int(now))}
    return [it for it in items if (it[0], title_key(it[2])) not in pairs] if pairs else items


def main(argv, runner=None, out=None):
    out = out or sys.stdout
    data = os.environ.get("MARU_DATA") or os.path.join(os.environ.get("MARU_HOME") or os.path.dirname(HERE), "data")
    items = hide_done(load_todos(os.path.join(data, "todos.txt")), os.path.join(data, "todo-done.txt"), time.time())
    args = argv[1:]
    if not args:
        if not items:
            print("할 일 목록이 없습니다(회고·새벽 정리가 쌓으면 생깁니다).", file=out)
            return 0
        last = None
        for i, (tag, imp, title, prompt) in enumerate(items, 1):
            if tag != last:
                print("[%s]" % tag, file=out)
                last = tag
            print("  %d. (%d) %s%s" % (i, imp, title, "" if prompt else "  — 직접 할 일"), file=out)
            if prompt:
                print("       → %s" % prompt, file=out)
        print("복사: maru todo <번호> (프롬프트를 복사. 붙여넣은 뒤 직접 Enter)", file=out)
        return 0
    if len(args) != 1 or not re.fullmatch(r"[0-9]{1,3}", args[0]):
        print("사용: maru todo [번호]", file=sys.stderr)
        return 2
    n = int(args[0])
    if not 1 <= n <= len(items):
        print("번호 범위 밖(1~%d)" % len(items) if items else "할 일 목록이 없습니다", file=sys.stderr)
        return 1
    prompt = items[n - 1][3]
    if not prompt:
        print("이 항목은 프롬프트가 없습니다 — 직접 해야 하는 일입니다: %s" % items[n - 1][2], file=out)
        return 0
    ok, msg = copy_suggestion(prompt, runner)
    print(msg, file=out if ok else sys.stderr)
    if ok:
        print("복사한 내용: %s" % " ".join(prompt.split()), file=out)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
