#!/usr/bin/env python3
"""install.sh / uninstall.sh 가 쓰는 설정 편집기. 사용자 설정 파일을 최소한으로만 고친다.
사용: maru_config.py <명령> [옵션]   (모든 명령은 --dry-run 지원: 바꿀 내용만 출력)
  hook-add     --settings F --command CMD [--backup-dir D]
  hook-remove  --settings F --match S [--backup-dir D]
  claude-md    --file F --block-file B [--backup-dir D]       (maru 블록만 추가/교체. 블록 밖은 건드리지 않는다)
  claude-md-remove --file F [--backup-dir D]
  local-settings --file F --dir DIR
  local-settings-remove --file F --dir DIR   (우리가 넣은 항목만 제거, 비면 파일 삭제)
  dock-gen     --dir ROOT      cmux Dock 설정(JSON)을 ROOT 저장소 기준으로 생성해 출력
  dock-check   --file F --dir ROOT   F 가 maru 가 만든 것인지 판정: missing / same / legacy / other
"""
import argparse, json, os, re, shutil, sys, time

BEGIN, END = "<!-- maru:begin -->", "<!-- maru:end -->"


def backup(path, bdir, dry):
    if not os.path.exists(path):
        return
    dest = os.path.join(bdir, f"{os.path.basename(path)}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    print(f"  백업: {dest}")
    if not dry:
        os.makedirs(bdir, exist_ok=True)
        shutil.copy2(path, dest)


def atomic_write(path, text):
    tmp = f"{path}.maru-tmp"
    mode = os.stat(path).st_mode & 0o777 if os.path.exists(path) else 0o600
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def load_json(path):
    raw = open(path, encoding="utf-8").read() if os.path.exists(path) else "{}"
    m = re.search(r'^( +|\t)"', raw, re.M)
    indent = m.group(1) if m else 2
    return json.loads(raw), indent, raw.endswith("\n")


def dump_json(d, indent, nl):
    return json.dumps(d, ensure_ascii=False, indent=indent) + ("\n" if nl else "")


def hook_cmds(group):
    return [h for h in group.get("hooks", []) if isinstance(h, dict)]


def strip_hooks(d, pred):
    """SessionEnd 에서 pred(command)가 참인 훅만 제거. 제거 개수 반환."""
    groups = d.get("hooks", {}).get("SessionEnd", [])
    removed, out = 0, []
    for g in groups:
        keep = [h for h in g.get("hooks", []) if not (isinstance(h, dict) and pred(h.get("command", "")))]
        removed += len(g.get("hooks", [])) - len(keep)
        if keep:
            g = dict(g); g["hooks"] = keep; out.append(g)
        elif not g.get("hooks"):
            out.append(g)  # 원래 비어 있던 그룹은 건드리지 않는다
    if removed:
        d["hooks"]["SessionEnd"] = out
    return removed


def cmd_hook_add(a):
    d, ind, nl = load_json(a.settings)
    before = json.dumps(d, sort_keys=True)
    strip_hooks(d, lambda c: c == a.command)
    d.setdefault("hooks", {}).setdefault("SessionEnd", []).append({"hooks": [{"type": "command", "command": a.command}]})
    if json.dumps(d, sort_keys=True) == before:
        print("  SessionEnd 훅: 이미 등록됨(변경 없음)"); return
    print(f"  SessionEnd 훅 등록: {a.command}")
    if a.dry_run: return
    backup(a.settings, a.backup_dir, False)
    atomic_write(a.settings, dump_json(d, ind, nl))


def cmd_hook_remove(a):
    d, ind, nl = load_json(a.settings)
    n = strip_hooks(d, lambda c: a.match in c)
    if not n:
        print("  SessionEnd 훅: 해당 항목 없음"); return
    print(f"  SessionEnd 훅 {n}개 제거")
    if a.dry_run: return
    backup(a.settings, a.backup_dir, False)
    atomic_write(a.settings, dump_json(d, ind, nl))


def strip_block(text):
    pat = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", re.S)
    return pat.sub("", text)


def cmd_claude_md(a):
    block = open(a.block_file, encoding="utf-8").read().strip("\n")
    old = open(a.file, encoding="utf-8").read() if os.path.exists(a.file) else ""
    text = strip_block(old)
    text = re.sub(r"\n{3,}", "\n\n", text).strip("\n")
    new = (text + "\n\n" if text else "") + block + "\n"
    if new == old:
        print("  ~/.claude/CLAUDE.md 블록: 이미 최신(변경 없음)"); return
    print("  ~/.claude/CLAUDE.md: maru 블록 추가/갱신")
    if a.dry_run: return
    backup(a.file, a.backup_dir, False)
    os.makedirs(os.path.dirname(a.file), exist_ok=True)
    atomic_write(a.file, new)


def cmd_claude_md_remove(a):
    if not os.path.exists(a.file): print("  CLAUDE.md 없음"); return
    old = open(a.file, encoding="utf-8").read()
    if BEGIN not in old: print("  CLAUDE.md: maru 블록 없음"); return
    new = re.sub(r"\n{3,}", "\n\n", strip_block(old)).strip("\n")
    new = new + "\n" if new else ""
    print("  ~/.claude/CLAUDE.md: maru 블록 제거")
    if a.dry_run: return
    backup(a.file, a.backup_dir, False)
    atomic_write(a.file, new)


def cmd_local_settings(a):
    d, ind, nl = load_json(a.file)
    dirs = d.setdefault("permissions", {}).setdefault("additionalDirectories", [])
    if a.dir in dirs:
        print("  .claude/settings.local.json: 이미 설정됨"); return
    dirs.append(a.dir)
    print(f"  .claude/settings.local.json: additionalDirectories += {a.dir}")
    if a.dry_run: return
    os.makedirs(os.path.dirname(a.file), exist_ok=True)
    atomic_write(a.file, dump_json(d, ind if os.path.exists(a.file) else 2, True))


def cmd_local_settings_remove(a):
    if not os.path.exists(a.file): print("  .claude/settings.local.json 없음"); return
    d, ind, nl = load_json(a.file)
    dirs = d.get("permissions", {}).get("additionalDirectories", [])
    if a.dir not in dirs: print("  .claude/settings.local.json: 우리가 넣은 항목 없음"); return
    dirs.remove(a.dir)
    if not dirs: del d["permissions"]["additionalDirectories"]
    if not d["permissions"]: del d["permissions"]
    print(f"  .claude/settings.local.json: additionalDirectories 에서 {a.dir} 제거" + ("(파일이 비어 삭제)" if not d else ""))
    if a.dry_run: return
    if d: atomic_write(a.file, dump_json(d, ind, nl))
    else: os.remove(a.file)


DOCK_ID = "maru-ui"


def dock_obj(root):
    q = "'" + os.path.join(root, "bin", "maru").replace("'", "'\\''") + "'"   # 셸 단일따옴표 인용
    return {"controls": [{"id": DOCK_ID, "title": "maru", "command": q + " ui"}]}


def cmd_dock_gen(a):
    sys.stdout.write(json.dumps(dock_obj(a.dir), ensure_ascii=False, indent=2) + "\n")


def cmd_dock_check(a):
    # same: 지금 생성될 내용과 동일 / legacy: 수동 설치된 `"$HOME/maru/bin/maru" ui` 이고 그 경로가 이 저장소
    # (둘 다 "maru 가 만든 것") / other: 그 외(사용자 파일로 간주) / missing
    # 최종 파일이 심볼릭 링크(끊어진 것 포함)면 항상 other: 링크는 dotfiles 관리 대상이라 건드리지 않는다.
    # (설정 폴더 자체가 링크인 것은 허용)
    if os.path.islink(a.file):
        print("other"); return
    if not os.path.lexists(a.file):
        print("missing"); return
    try:
        with open(a.file, encoding="utf-8") as f: d = json.load(f)
    except Exception:
        print("other"); return
    if d == dock_obj(a.dir):
        print("same"); return
    try:
        c = d["controls"]
        legacy = (list(d) == ["controls"] and len(c) == 1 and c[0] == {"id": DOCK_ID, "title": "maru",
                  "command": '"$HOME/maru/bin/maru" ui'}
                  and os.path.realpath(os.path.join(os.environ["HOME"], "maru")) == os.path.realpath(a.dir))
    except Exception:
        legacy = False
    print("legacy" if legacy else "other")


p = argparse.ArgumentParser()
p.add_argument("cmd")
for o in ("settings", "command", "match", "file", "block-file", "dir", "backup-dir"):
    p.add_argument("--" + o)
p.add_argument("--dry-run", action="store_true")
a = p.parse_args()
{"hook-add": cmd_hook_add, "hook-remove": cmd_hook_remove, "claude-md": cmd_claude_md,
 "claude-md-remove": cmd_claude_md_remove, "local-settings": cmd_local_settings,
 "local-settings-remove": cmd_local_settings_remove,
 "dock-gen": cmd_dock_gen, "dock-check": cmd_dock_check}[a.cmd](a)
