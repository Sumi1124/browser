#!/usr/bin/env bash
# Builds Aster.app (universal: Apple silicon + Intel) and Aster-<version>.dmg.
# Runs on macOS with Xcode command-line tools. Usage: mac/build.sh [output-dir]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="${1:-$ROOT/work/dist}"
mkdir -p "$OUT" && OUT="$(cd "$OUT" && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/package.json")"
BUILD="${GITHUB_RUN_NUMBER:-1}"
STAGE="$HERE/.build/stage"
APP="$STAGE/Aster.app"

echo "Building Aster $VERSION ($BUILD)"
cd "$HERE"
mkdir -p "$HERE/.build"
# Treat "nearly matches" warnings as errors: a delegate method whose
# signature drifts from the SDK's would otherwise silently never be called.
swift build -c release --arch arm64 --arch x86_64 2>&1 | tee "$HERE/.build/build.log"
if grep -q "nearly matches" "$HERE/.build/build.log"; then
  echo "error: a protocol method signature does not match the SDK (see 'nearly matches' above)" >&2
  exit 1
fi
BIN="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/Aster"

rm -rf "$STAGE"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web/aster"
cp "$BIN" "$APP/Contents/MacOS/Aster"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" "$HERE/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# Study-tools page plus the tested JavaScript modules it imports.
cp "$HERE/Resources/web/"* "$APP/Contents/Resources/web/"
for module in common research study data ai storage; do
  mkdir -p "$APP/Contents/Resources/web/aster/$module"
  cp "$ROOT/aster/$module/"*.mjs "$APP/Contents/Resources/web/aster/$module/"
done
cp "$ROOT/LICENSE" "$APP/Contents/Resources/LICENSE.txt"

# App icon from the 1024 px master.
ICONSET="$HERE/.build/AppIcon.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$HERE/Resources/AppIcon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$HERE/Resources/AppIcon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# Ad-hoc signature: required to run on Apple silicon. Not a Developer ID
# signature, so Gatekeeper asks the user to confirm the first launch.
codesign --force --deep --sign - "$APP"
codesign --verify --strict --verbose=2 "$APP"
lipo -info "$APP/Contents/MacOS/Aster"

# Disk image with a drag-to-Applications layout and a short read-me.
DMG_DIR="$HERE/.build/dmg"
rm -rf "$DMG_DIR" && mkdir -p "$DMG_DIR" "$OUT"
cp -R "$APP" "$DMG_DIR/"
ln -s /Applications "$DMG_DIR/Applications"
cp "$HERE/DMG-README.txt" "$DMG_DIR/Read Me First.txt"
DMG="$OUT/Aster-$VERSION.dmg"
rm -f "$DMG"
hdiutil create -volname "Aster $VERSION" -srcfolder "$DMG_DIR" -fs HFS+ -format UDZO -ov "$DMG"
hdiutil verify "$DMG"
echo "Built $DMG"
