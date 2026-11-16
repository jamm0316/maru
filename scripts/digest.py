#!/usr/bin/env python3
"""세션 transcript(JSONL)를 읽기 쉬운 텍스트로 압축한다.
사용: digest.py <transcript> <out> [--from-line N]
N번째 줄 이후(앞의 N줄은 이미 처리됨)만 다룬다. stdout: "<사용자 턴 수> <전체 줄 수>"
"""
import json, sys

args = sys.argv[1:]
from_line = 0
if "--from-line" in args:
    i = args.index("--from-line")
    from_line = max(0, int(args[i + 1]))
    del args[i:i + 2]
src, out = args[0], args[1]
CLIP = 2000
lines, cwd, turns, total = [], "", 0, 0

def clip(s, n=CLIP):
    s = s.strip()
    return s if len(s) <= n else s[:n] + f"...[{len(s)-n}자 생략]"

with open(src, encoding="utf-8", errors="replace") as f:
    for idx, raw in enumerate(f):
        # 쓰는 중인 마지막 줄(개행 없음)은 세지 않는다: 살아 있는 세션을 중간에 회고해도 그 줄을 다음 회고가 처음부터 읽는다
        if not raw.endswith("\n"):
            break
        total = idx + 1
        if idx < from_line:
            continue
        try:
            o = json.loads(raw)
        except Exception:
            continue
        t = o.get("type")
        if t not in ("user", "assistant") or o.get("isSidechain"):
            continue
        if o.get("isMeta") or o.get("isCompactSummary"):
            continue
        cwd = cwd or o.get("cwd", "")
        c = (o.get("message") or {}).get("content")
        if isinstance(c, str):
            c = [{"type": "text", "text": c}]
        if not isinstance(c, list):
            continue
        for b in c:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "text" and b.get("text", "").strip():
                txt = b["text"]
                if t == "user":
                    if txt.lstrip().startswith(("<system-reminder", "<command-", "<local-command")):
                        continue
                    turns += 1
                    lines.append(f"[사용자] {clip(txt)}")
                else:
                    lines.append(f"[어시스턴트] {clip(txt)}")
            elif bt == "tool_use":
                inp = json.dumps(b.get("input", {}), ensure_ascii=False)[:200]
                lines.append(f"[도구 {b.get('name')}: {inp}]")
            elif bt == "tool_result" and b.get("is_error"):
                rc = b.get("content")
                if isinstance(rc, list):
                    rc = " ".join(x.get("text", "") for x in rc if isinstance(x, dict))
                lines.append(f"[도구오류] {clip(str(rc), 300)}")

body = "\n".join(lines)
if len(body) > 80_000:
    body = body[:20_000] + "\n...[중간 생략]...\n" + body[-60_000:]
with open(out, "w", encoding="utf-8") as f:
    f.write(f"# 세션 다이제스트\ncwd: {cwd}\n원본: {src}\n구간: {from_line}줄 이후\n\n{body}\n")
print(turns, total)
