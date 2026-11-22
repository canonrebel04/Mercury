#!/bin/bash
set -euo pipefail

# Build Mercury for Android (GeckoView + Fenix) from mozilla-unified/mobile/android.
# Usage: ./android/build-android.sh [--x86_64] [--bootstrap]

MERCURY_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HG_SRC_DIR="${HG_SRC_DIR:-$HOME/mozilla-unified}"
export HG_SRC_DIR

ARCH_FLAG="--android"
RUST_TARGET="aarch64-linux-android"
DO_BOOTSTRAP=0

for arg in "$@"; do
  case "$arg" in
    --x86_64)
      ARCH_FLAG="--android-x86_64"
      RUST_TARGET="x86_64-linux-android"
      ;;
    --bootstrap)
      DO_BOOTSTRAP=1
      ;;
    -h|--help)
      echo "Usage: $0 [--x86_64] [--bootstrap]"
      echo "  --x86_64    Build for x86_64 Android instead of arm64-v8a"
      echo "  --bootstrap Run ./mach bootstrap for GeckoView/Firefox for Android first"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [ ! -f "${HG_SRC_DIR}/mach" ]; then
  echo "ERROR: ${HG_SRC_DIR} is not a mozilla-unified checkout." >&2
  exit 1
fi

if command -v rustup >/dev/null 2>&1; then
  rustup target add "${RUST_TARGET}" || true
fi

if [ "${DO_BOOTSTRAP}" -eq 1 ]; then
  (cd "${HG_SRC_DIR}" && ./mach bootstrap --application-choice="GeckoView/Firefox for Android" --no-interactive)
fi

"${MERCURY_SRC_DIR}/setup.sh" "${ARCH_FLAG}"

cd "${HG_SRC_DIR}"
./mach build -v
./mach package -v

echo ""
echo "Android build and package complete. Check ${HG_SRC_DIR}/obj-*/gradle/build/mobile/android/fenix/app/outputs/apk/ and obj-*/dist/."
