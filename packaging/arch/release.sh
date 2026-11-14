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
  --dry-run       Update PKGBUILD/.SRCINFO locally; do not call gh
  --skip-upload   Same as --dry-run (keep packaging files only)
  --notes-file F  Release notes file passed to gh release create
  --draft         Create a draft release (does not trigger the AUR workflow)
  -h, --help      Show this help

If no tarball is given, looks in $HG_SRC_DIR/obj-*/dist/mercury-*.tar.xz
(default HG_SRC_DIR=$HOME/mozilla-unified).

The release tag is v<version>, taken from the tarball name
mercury-<version>.en-US.linux-x86_64.tar.xz, matching the in-browser
update notifier.
EOF
}

dry_run=0
draft=0
notes_file=""
tarball=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --dry-run|--skip-upload) dry_run=1; shift ;;
    --draft) draft=1; shift ;;
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

if [[ -z $tarball ]]; then
  hg_src="${HG_SRC_DIR:-$HOME/mozilla-unified}"
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

tag="v${version}"
sum="$(sha256sum "$tarball" | awk '{print $1}')"
sum_file="${tarball}.sha256"
printf '%s  %s\n' "$sum" "$base" > "$sum_file"

"$script_dir/update-pkgbuild.py" --pkgbuild "$pkgbuild" --version "$version" --tarball-sha256 "$sum"


echo "Tarball: $tarball"
echo "SHA256:  $sum"
echo "Wrote:   $sum_file"
echo "Tag:     $tag"

if [[ $dry_run -eq 1 ]]; then
  echo "Dry run: not calling gh. Commit the PKGBUILD/.SRCINFO bump if you want it in git."
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "release.sh: gh is not installed; PKGBUILD was updated, but the release was not uploaded." >&2
  exit 1
fi

repo="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "canonrebel04/Mercury")"
cd "$repo_root"

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  echo "Release $tag already exists; uploading assets (clobber)."
  gh release upload "$tag" "$tarball" "$sum_file" --repo "$repo" --clobber
else
  title="Mercury $version"
  notes_args=()
  if [[ -n $notes_file ]]; then
    notes_args=(--notes-file "$notes_file")
  else
    notes_args=(--notes "Mercury $version (AVX2 / x86-64-v3 Linux tarball). Arch users: paru -S mercury-browser-bin, or see packaging/arch/README.md.")
  fi
  draft_args=()
  [[ $draft -eq 1 ]] && draft_args=(--draft)
  gh release create "$tag" "$tarball" "$sum_file" \
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
