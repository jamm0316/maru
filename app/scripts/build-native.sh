#!/bin/bash
# EventKit 캘린더 도우미(native/maru-cal.swift)를 arm64 로 컴파일해 native/bin/maru-cal 에 두고 ad-hoc 서명한다.
# 디버그 정보와 빌드 경로가 바이너리에 남지 않게 한다. 실패하면 비-0 으로 끝난다(npm run dist 가 막힌다).
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$APP/native/maru-cal.swift"
OUT="$APP/native/bin/maru-cal"
SWIFTC=""
for c in "$(xcrun -f swiftc 2>/dev/null || true)" /Library/Developer/CommandLineTools/usr/bin/swiftc /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc; do
  if [ -n "$c" ] && [ -x "$c" ]; then SWIFTC="$c"; break; fi
done
if [ -z "$SWIFTC" ]; then echo "build-native: swiftc 를 찾을 수 없습니다 (Xcode Command Line Tools 필요)" >&2; exit 1; fi
mkdir -p "$APP/native/bin"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
# SDK 후보를 차례로 시도한다(기본 SDK 의 표준 라이브러리를 못 읽는 환경이 있다).
BUILT=""
for SDK in "" /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk "$(xcrun --show-sdk-path 2>/dev/null || true)"; do
  SDKARG=(); if [ -n "$SDK" ]; then [ -d "$SDK" ] || continue; SDKARG=(-sdk "$SDK"); fi
  if "$SWIFTC" ${SDKARG[@]+"${SDKARG[@]}"} -O -gnone -swift-version 5 -target arm64-apple-macos12.0 \
    -file-prefix-map "$APP=/src" -file-prefix-map "$TMP=/build" -file-prefix-map "$HOME=/home" \
    -module-name maru_cal "$SRC" -o "$TMP/maru-cal" 2>"$TMP/err.txt"; then BUILT=1; break; fi
done
if [ -z "$BUILT" ]; then cat "$TMP/err.txt" >&2; echo "build-native: 컴파일 실패" >&2; exit 1; fi
/usr/bin/strip -x "$TMP/maru-cal" 2>/dev/null || true
cp "$TMP/maru-cal" "$OUT"; chmod 755 "$OUT"
/usr/bin/codesign -s - --force "$OUT"
if strings "$OUT" | grep -q "$HOME"; then echo "build-native: 바이너리에 홈 경로가 남아 있습니다" >&2; rm -f "$OUT"; exit 1; fi
echo "build-native: $OUT"
