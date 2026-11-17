#!/bin/bash
# Copyright (c) 2026 canonrebel04.
#
# Compiles browser/branding/mercury/Assets.xcassets (the Mercury app icon in
# every macOS size) into browser/branding/mercury/Assets.car, which Firefox 159+
# ships inside the .app as the macOS app icon.
#
# Apple's asset compiler (actool) only exists on macOS with Xcode installed, so
# run this on a Mac, then commit the resulting Assets.car. Until Assets.car is
# committed, setup.sh's macOS options apply
# patches/optional/macos-no-assets-car.patch, and the app icon falls back to
# firefox.icns (Mercury-branded).

set -euo pipefail

BRANDING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../browser/branding/mercury" && pwd)"
OUT_DIR="$(mktemp -d)"
trap 'rm -rf "${OUT_DIR}"' EXIT

xcrun actool \
  --compile "${OUT_DIR}" \
  --platform macosx \
  --minimum-deployment-target 10.15 \
  --app-icon AppIcon \
  --output-partial-info-plist "${OUT_DIR}/partial-info.plist" \
  "${BRANDING_DIR}/Assets.xcassets"

cp -v "${OUT_DIR}/Assets.car" "${BRANDING_DIR}/Assets.car"
echo "Done. Commit ${BRANDING_DIR}/Assets.car"
