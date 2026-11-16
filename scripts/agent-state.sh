#!/bin/bash
# Claude Code 훅에서 호출: 마루 앱이 띄운 세션의 상태(busy|idle|waiting)를 data/state/app/<id>.json 에 원자적으로 쓴다.
# MARU_APP_SESSION 이 없거나 형식이 틀리면 아무것도 하지 않는다(앱 밖 세션·cmux 영향 없음). 항상 exit 0.
# 표준입력(훅 JSON)은 읽어서 버리며 저장하지 않는다.
state=${1:-}
id=${MARU_APP_SESSION:-}
[ -n "$id" ] || exit 0
[ -t 0 ] || cat >/dev/null 2>&1
case "$state" in busy|idle|waiting) ;; *) exit 0 ;; esac
case "$id" in *[!A-Za-z0-9-]*) exit 0 ;; esac
[ "${#id}" -ge 8 ] && [ "${#id}" -le 64 ] || exit 0
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P) || exit 0
dir=$here/../data/state/app
[ -L "$dir" ] && exit 0
mkdir -p "$dir" 2>/dev/null || exit 0
[ -L "$dir" ] && exit 0
tmp=$(mktemp "$dir/.$id.XXXXXX" 2>/dev/null) || exit 0
if printf '{"state":"%s","at":"%s"}\n' "$state" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$tmp" 2>/dev/null; then
  mv -f "$tmp" "$dir/$id.json" 2>/dev/null
fi
rm -f "$tmp" 2>/dev/null
exit 0
