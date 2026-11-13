#!/usr/bin/env python3
"""과거 Claude Code 대화 검색. 사용법은 SKILL.md 참고."""
import argparse, glob, json, os, sys, time
from datetime import datetime, timezone

ROOT = os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude"), "projects")


def texts(d):
    """(role, text) for user string content / text blocks only."""
    t = d.get("type")
    if t not in ("user", "assistant") or d.get("isSidechain"):
        return None
    c = (d.get("message") or {}).get("content")
    if isinstance(c, str):
        s = c
    elif isinstance(c, list):
        s = "\n".join(b.get("text", "") for b in c
                      if isinstance(b, dict) and b.get("type") == "text")
    else:
        return None
    s = s.strip()
    return (t, s) if s else None


def parse(line):
    try:
        d = json.loads(line)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


def clip(s, terms, n):
    s = " ".join(s.split())
    low = s.lower()
    i = min((low.find(t) for t in terms if t in low), default=0)
    a = max(0, i - n // 2)
    b = min(len(s), a + n + 60)
    return ("…" if a else "") + s[a:b] + ("…" if b < len(s) else "")


def scan_file(path, terms, ctx):
    try:
        raw = open(path, encoding="utf-8", errors="replace").read()
    except Exception:
        return None
    low = raw.lower()
    if not all(t in low for t in terms):
        return None
    title = cwd = sid = None
    first_user = None
    hits = []
    for line in raw.splitlines():
        ll = line.lower()
        is_title = '"custom-title"' in line
        match = all(t in ll for t in terms)
        if not (is_title or match or first_user is None):
            continue
        d = parse(line)
        if not d:
            continue
        if d.get("type") == "custom-title":
            title = d.get("customTitle") or title
            continue
        r = texts(d)
        if not r:
            continue
        cwd = cwd or d.get("cwd")
        sid = sid or d.get("sessionId")
        if first_user is None and r[0] == "user":
            first_user = r[1]
            if "[agent-reflect]" in first_user:
                return None
        if match and all(t in r[1].lower() for t in terms):
            hits.append((d.get("timestamp", ""), r[0], clip(r[1], terms, ctx)))
    if not hits:
        return None
    return dict(title=title, cwd=cwd, sid=sid or os.path.basename(path)[:-6],
                hits=hits, mtime=os.path.getmtime(path))


def do_search(a):
    terms = [t.lower() for t in a.terms]
    cutoff = time.time() - a.days * 86400
    res = []
    for p in glob.glob(os.path.join(ROOT, "*", "*.jsonl")):
        slug = os.path.basename(os.path.dirname(p))
        if a.project and a.project.lower() not in slug.lower():
            continue
        if os.path.getmtime(p) < cutoff:
            continue
        r = scan_file(p, terms, a.context)
        if r:
            res.append(r)
    res.sort(key=lambda r: r["mtime"], reverse=True)
    if not res:
        print("결과 없음 (--days 늘리기 / 동의어·영문·한글 변형 시도)")
        return
    shown = 0
    for r in res:
        if shown >= a.limit:
            break
        date = datetime.fromtimestamp(r["mtime"]).strftime("%Y-%m-%d")
        print(f"## {date} | {r['cwd']} | {r['sid']}" + (f" | {r['title']}" if r["title"] else ""))
        for ts, role, snip in r["hits"]:
            if shown >= a.limit:
                break
            who = "사용자" if role == "user" else "에이전트"
            print(f"  [{who} {ts[:16].replace('T', ' ')}] {snip}")
            shown += 1
    print(f"\n(세션 {len(res)}개, 스니펫 {shown}개 표시. 맥락 읽기: --session <id> [--around ISO])")


def do_session(a):
    paths = glob.glob(os.path.join(ROOT, "*", a.session + "*.jsonl"))
    if not paths:
        print("세션을 찾을 수 없음"); return
    msgs = []
    for line in open(paths[0], encoding="utf-8", errors="replace"):
        d = parse(line)
        r = d and texts(d)
        if r:
            msgs.append((d.get("timestamp", ""), r[0], r[1]))
    if a.around:
        i = min(range(len(msgs)), key=lambda k: abs(
            (parse_ts(msgs[k][0]) - parse_ts(a.around)))) if msgs else 0
        lo = max(0, i - 6)
        msgs = msgs[lo:]
    out, total = [], 0
    for ts, role, s in msgs:
        s = s if len(s) <= 1500 else s[:1500] + "…[생략]"
        line = f"[{'사용자' if role == 'user' else '에이전트'} {ts[:16].replace('T', ' ')}]\n{s}\n"
        if total + len(line) > 30000:
            out.append("…[30KB 상한, 이후 생략]"); break
        out.append(line); total += len(line)
    print(f"# {paths[0]}\n" + "\n".join(out))


def parse_ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("terms", nargs="*")
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--project")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--context", type=int, default=200)
    ap.add_argument("--session")
    ap.add_argument("--around")
    a = ap.parse_args()
    if a.session:
        do_session(a)
    elif a.terms:
        do_search(a)
    else:
        ap.print_help()
