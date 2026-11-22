#!/usr/bin/env bash
# Create or update a GitHub Release (tag vX.Y) from a ./package.sh tarball,
# attach the tarball and a .sha256, and bump packaging/arch/PKGBUILD + .SRCINFO.
#
# This script does not publish to the AUR and does not touch the pacman-repo
# tag. After the release is published, .github/workflows/aur-publish.yml
# updates the AUR package (and optionally the pacman repo).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: release.sh [options] [tarball]

Options:
  --dry-run            Update PKGBUILD/.SRCINFO locally; do not call gh
  --skip-upload        Same as --dry-run (keep packaging files only)
  --win-installer F    Attach Windows installer (.exe) and its .sha256
  --win-zip F          Attach Windows zip (.zip) and its .sha256
  --apk F              Attach Android APK (.apk) and its .sha256
  --win-only           Upload only Windows/Android assets to an existing v<version> release
  --notes-file F       Release notes file passed to gh release create
  --draft              Create a draft release (does not trigger the AUR workflow)
  -h, --help           Show this help

If no tarball is given, looks in $HG_SRC_DIR/obj-*/dist/mercury-*.tar.xz
(default HG_SRC_DIR=$HOME/mozilla-unified). Windows artifacts are also
auto-detected in $HG_SRC_DIR/obj-*windows*/dist/ if present.

The release tag is v<version>, taken from the artifact name
(mercury-<version>.en-US.linux-x86_64.tar.xz or Windows equivalent),
matching the in-browser update notifier.
EOF
}

dry_run=0
draft=0
win_only=0
notes_file=""
tarball=""
win_installer=""
win_zip=""
android_apk=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --dry-run|--skip-upload) dry_run=1; shift ;;
    --draft) draft=1; shift ;;
    --win-only) win_only=1; shift ;;
    --win-installer)
      [[ $# -ge 2 ]] || { echo "release.sh: --win-installer needs a path" >&2; exit 2; }
      win_installer="$2"; shift 2 ;;
    --win-zip)
      [[ $# -ge 2 ]] || { echo "release.sh: --win-zip needs a path" >&2; exit 2; }
      win_zip="$2"; shift 2 ;;
    --apk)
      [[ $# -ge 2 ]] || { echo "release.sh: --apk needs a path" >&2; exit 2; }
      android_apk="$2"; shift 2 ;;
    --notes-file)
      [[ $# -ge 2 ]] || { echo "release.sh: --notes-file needs a path" >&2; exit 2; }
      notes_file="$2"; shift 2 ;;
    --) shift; break ;;
    -*) echo "release.sh: unknown option $1" >&2; usage >&2; exit 2 ;;
    *) tarball="$1"; shift ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
pkgbuild="$script_dir/PKGBUILD"
hg_src="${HG_SRC_DIR:-$HOME/mozilla-unified}"

if [[ -z $win_installer ]]; then
  shopt -s nullglob
  win_inst_candidates=(
    "$hg_src"/obj-*windows*/dist/mercury-*.installer.exe
    "$hg_src"/obj-*windows*/dist/install/sea/mercury-*.installer.exe
  )
  shopt -u nullglob
  if [[ ${#win_inst_candidates[@]} -gt 0 ]]; then
    win_installer="${win_inst_candidates[0]}"
  fi
fi

if [[ -z $win_zip ]]; then
  shopt -s nullglob
  win_zip_candidates=("$hg_src"/obj-*windows*/dist/mercury-*.win64.zip)
  shopt -u nullglob
  if [[ ${#win_zip_candidates[@]} -gt 0 ]]; then
    win_zip="${win_zip_candidates[0]}"
  fi
fi

upload_assets=()
version=""

if [[ $win_only -eq 0 ]]; then
  if [[ -z $tarball ]]; then
    shopt -s nullglob
    candidates=("$hg_src"/obj-*/dist/mercury-*.tar.xz)
    shopt -u nullglob
    if [[ ${#candidates[@]} -eq 0 ]]; then
      echo "release.sh: no tarball given and none found in $hg_src/obj-*/dist/" >&2
      echo "Run ./package.sh first, or pass the path to mercury-*.tar.xz." >&2
      exit 1
    fi
    tarball="${candidates[0]}"
  fi

  tarball="$(readlink -f "$tarball")"
  [[ -f $tarball ]] || { echo "release.sh: not a file: $tarball" >&2; exit 1; }

  base="$(basename "$tarball")"
  if [[ $base =~ ^mercury-([0-9]+(\.[0-9]+)*)\.en-US\.linux-x86_64\.tar\.xz$ ]]; then
    version="${BASH_REMATCH[1]}"
  else
    echo "release.sh: unexpected tarball name: $base" >&2
    echo "Expected mercury-<version>.en-US.linux-x86_64.tar.xz" >&2
    exit 1
  fi

  sum="$(sha256sum "$tarball" | awk '{print $1}')"
  sum_file="${tarball}.sha256"
  printf '%s  %s\n' "$sum" "$base" > "$sum_file"

  "$script_dir/update-pkgbuild.py" --pkgbuild "$pkgbuild" --version "$version" --tarball-sha256 "$sum"
  upload_assets+=("$tarball" "$sum_file")
  echo "Tarball: $tarball"
  echo "SHA256:  $sum"
  echo "Wrote:   $sum_file"
fi

add_win_asset() {
  local asset="$1"
  local label="$2"
  asset="$(readlink -f "$asset")"
  [[ -f $asset ]] || { echo "release.sh: not a file: $asset" >&2; exit 1; }
  local abase asum asum_file
  abase="$(basename "$asset")"
  if [[ -z $version && $abase =~ ^mercury-([0-9]+(\.[0-9]+)*)(\.en-US\.win64|-android) ]]; then
    version="${BASH_REMATCH[1]}"
  fi
  if [[ -z $version && -f "$pkgbuild" ]]; then
    version="$(grep -E '^pkgver=' "$pkgbuild" | head -n1 | cut -d= -f2)"
  fi
  asum="$(sha256sum "$asset" | awk '{print $1}')"
  asum_file="${asset}.sha256"
  printf '%s  %s\n' "$asum" "$abase" > "$asum_file"
  upload_assets+=("$asset" "$asum_file")
  echo "${label}: $asset"
  echo "SHA256:  $asum"
  echo "Wrote:   $asum_file"
}

if [[ -z $android_apk ]]; then
  shopt -s nullglob
  apk_candidates=(
    "$hg_src"/obj-*android*/gradle/build/mobile/android/fenix/app/outputs/apk/*/app-*-arm64-v8a-*.apk
    "$hg_src"/obj-*android*/gradle/build/mobile/android/fenix/app/outputs/apk/*/*.apk
    "$hg_src"/obj-*android*/dist/mercury-*.apk
  )
  shopt -u nullglob
  if [[ ${#apk_candidates[@]} -gt 0 ]]; then
    android_apk="${apk_candidates[0]}"
  fi
fi

if [[ -n $win_installer ]]; then
  add_win_asset "$win_installer" "WinInst"
fi
if [[ -n $win_zip ]]; then
  add_win_asset "$win_zip" "WinZip"
fi
if [[ -n $android_apk ]]; then
  add_win_asset "$android_apk" "AndroidAPK"
fi

if [[ ${#upload_assets[@]} -eq 0 ]]; then
  echo "release.sh: no artifacts found to release." >&2
  exit 1
fi
if [[ -z $version ]]; then
  echo "release.sh: could not determine Mercury version from artifact filenames." >&2
  exit 1
fi

tag="v${version}"
echo "Tag:     $tag"

if [[ $dry_run -eq 1 ]]; then
  echo "Dry run: not calling gh. Commit the PKGBUILD/.SRCINFO bump if you want it in git."
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "release.sh: gh is not installed; release was not uploaded." >&2
  exit 1
fi

repo="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "canonrebel04/Mercury")"
cd "$repo_root"

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  echo "Release $tag already exists; uploading assets (clobber)."
  gh release upload "$tag" "${upload_assets[@]}" --repo "$repo" --clobber
else
  if [[ $win_only -eq 1 ]]; then
    echo "release.sh: release $tag does not exist yet; create it with the Linux release first or omit --win-only." >&2
    exit 1
  fi
  title="Mercury $version"
  notes_args=()
  if [[ -n $notes_file ]]; then
    notes_args=(--notes-file "$notes_file")
  else
    notes_args=(--notes "Mercury $version (AVX2 / x86-64-v3 Linux & Windows). Arch users: paru -S mercury-browser-v3-bin, or see packaging/arch/README.md.")
  fi
  draft_args=()
  [[ $draft -eq 1 ]] && draft_args=(--draft)
  gh release create "$tag" "${upload_assets[@]}" \
    --repo "$repo" \
    --title "$title" \
    "${notes_args[@]}" \
    "${draft_args[@]}"
  echo "Created GitHub Release $tag"
fi

if [[ $draft -eq 1 ]]; then
  echo "Draft release: the AUR workflow will not run until you publish it."
else
  echo "Published $tag. The aur-publish workflow will update the AUR package."
fi
echo "Commit and push the PKGBUILD/.SRCINFO bump when you are ready."
