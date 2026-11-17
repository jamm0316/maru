#!/bin/bash
# Usage: site/set-release.sh <path-to-dmg> <version>
# Rewrites the four pinned release constants in install.sh from a built dmg.
# Run it after every release build, then publish the dmg at the URL it prints.
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: $0 <path-to-dmg> <version>" >&2; exit 2; }
dmg=$1; ver=$2
[ -f "$dmg" ] || { echo "not a file: $dmg" >&2; exit 1; }
case "$ver" in ""|*[!0-9.]*) echo "version must look like 0.1.0" >&2; exit 1;; esac
name=$(basename "$dmg")
case "$name" in "Maru-$ver-"*.dmg) ;; *) echo "dmg name should be Maru-$ver-<arch>.dmg, got $name" >&2; exit 1;; esac
sha=$(shasum -a 256 "$dmg" | awk '{print $1}')
url="https://github.com/jamm0316/maru/releases/download/v$ver/$name"
f="$(cd "$(dirname "$0")" && pwd)/install.sh"
tmp=$(mktemp "$f.XXXXXX")
trap 'rm -f "$tmp"' EXIT
awk -v v="$ver" -v n="$name" -v u="$url" -v s="$sha" '
  /^VERSION=/    { print "VERSION=\"" v "\""; c++; next }
  /^DMG_NAME=/   { print "DMG_NAME=\"" n "\""; c++; next }
  /^DMG_URL=/    { print "DMG_URL=\"" u "\""; c++; next }
  /^DMG_SHA256=/ { print "DMG_SHA256=\"" s "\""; c++; next }
  { print }
  END { if (c != 4) exit 3 }' "$f" > "$tmp" || { echo "could not find all four constants in install.sh" >&2; exit 1; }
chmod --reference="$f" "$tmp" 2>/dev/null || chmod 755 "$tmp"
mv "$tmp" "$f"; trap - EXIT
echo "install.sh now pins $name"; echo "  url:    $url"; echo "  sha256: $sha"
echo "Also update the download link in site/copy.js if the file name changed."
