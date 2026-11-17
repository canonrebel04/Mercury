#!/usr/bin/env bash
# Build mercury-browser-v3-bin as a .pkg.tar.zst, optionally sign it, run
# repo-add, and upload the database plus package to the GitHub Release
# tag "pacman-repo". That tag is always a prerelease so it never becomes
# /releases/latest (the in-browser update notifier uses that endpoint).
#
# Run on Arch / CachyOS, or in an archlinux container. Does not compile
# the browser; it only packages the release tarball.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: build-repo.sh [options]

Options:
  --upload           Upload the repo database and package to tag pacman-repo
  --tarball PATH     Use this local tarball instead of downloading the release
  --tag vX.Y         Release tag whose tarball to package (default: latest v*)
  --no-sign          Do not sign, even if PACMAN_GPG_KEY is set
  --workdir DIR      Build directory (default: a temp dir that is removed)
  -h, --help         Show this help

Signing: if PACMAN_GPG_KEY contains an armored private key, it is imported
into a temporary gnupg home and used with makepkg --sign and repo-add -s.
EOF
}

do_upload=0
tarball=""
tag=""
do_sign=1
workdir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --upload) do_upload=1; shift ;;
    --no-sign) do_sign=0; shift ;;
    --tarball)
      [[ $# -ge 2 ]] || { echo "build-repo.sh: --tarball needs a path" >&2; exit 2; }
      tarball="$2"; shift 2 ;;
    --tag)
      [[ $# -ge 2 ]] || { echo "build-repo.sh: --tag needs a value" >&2; exit 2; }
      tag="$2"; shift 2 ;;
    --workdir)
      [[ $# -ge 2 ]] || { echo "build-repo.sh: --workdir needs a path" >&2; exit 2; }
      workdir="$2"; shift 2 ;;
    *) echo "build-repo.sh: unknown option $1" >&2; usage >&2; exit 2 ;;
  esac
done

if ! command -v makepkg >/dev/null 2>&1 || ! command -v repo-add >/dev/null 2>&1; then
  echo "build-repo.sh: makepkg and repo-add are required (run on Arch or in an archlinux container)." >&2
  exit 1
fi
if [[ $(id -u) -eq 0 ]]; then
  echo "build-repo.sh: refusing to run as root (makepkg will not allow it)." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_name="${GITHUB_REPOSITORY:-canonrebel04/Mercury}"
clean_work=0
if [[ -z $workdir ]]; then
  workdir="$(mktemp -d "${TMPDIR:-/tmp}/mercury-repo.XXXXXX")"
  clean_work=1
fi
mkdir -p "$workdir"
trap '[[ $clean_work -eq 1 ]] && rm -rf "$workdir"' EXIT

# Isolate packaging files so we can drop a local tarball beside the PKGBUILD.
cp -a "$script_dir/PKGBUILD" "$script_dir/mercury-browser.sh" \
  "$script_dir/mercury-browser.desktop" "$script_dir/mercury-browser-v3-bin.install" \
  "$workdir/"
if [[ -f $script_dir/.SRCINFO ]]; then
  cp -a "$script_dir/.SRCINFO" "$workdir/"
fi

if [[ -n $tarball ]]; then
  tarball="$(readlink -f "$tarball")"
  [[ -f $tarball ]] || { echo "build-repo.sh: not a file: $tarball" >&2; exit 1; }
  base="$(basename "$tarball")"
  cp -a "$tarball" "$workdir/$base"
  if [[ $base =~ ^mercury-([0-9]+(\.[0-9]+)*)\.en-US\.linux-x86_64\.tar\.xz$ ]]; then
    version="${BASH_REMATCH[1]}"
  else
    echo "build-repo.sh: unexpected tarball name: $base" >&2
    exit 1
  fi
  tag="${tag:-v$version}"
  sum="$(sha256sum "$workdir/$base" | awk '{print $1}')"
  "$script_dir/update-pkgbuild.py" --pkgbuild "$workdir/PKGBUILD" --version "$version" --tarball-sha256 "$sum"
  # update-pkgbuild.py also writes .SRCINFO next to that PKGBUILD.
else
  if [[ -z $tag ]]; then
    tag="${RELEASE_TAG:-}"
  fi
  if [[ -z $tag ]]; then
    if command -v gh >/dev/null 2>&1; then
      tag="$(gh release list --repo "$repo_name" --limit 50 --json tagName,isPrerelease,isDraft \
        --jq '[.[] | select((.isPrerelease|not) and (.isDraft|not) and (.tagName|startswith("v")))][0].tagName')"
    fi
  fi
  [[ -n $tag && $tag != null ]] || { echo "build-repo.sh: no release tag; pass --tag or --tarball" >&2; exit 1; }
  version="${tag#v}"
  expected="mercury-${version}.en-US.linux-x86_64.tar.xz"
  echo "Downloading $expected from $tag"
  gh release download "$tag" --repo "$repo_name" -p "$expected" -D "$workdir"
  sum="$(sha256sum "$workdir/$expected" | awk '{print $1}')"
  "$script_dir/update-pkgbuild.py" --pkgbuild "$workdir/PKGBUILD" --version "$version" --tarball-sha256 "$sum"
fi

gpg_home=""
keyid=""
if [[ $do_sign -eq 1 && -n ${PACMAN_GPG_KEY:-} ]]; then
  gpg_home="$(mktemp -d "${TMPDIR:-/tmp}/mercury-gnupg.XXXXXX")"
  chmod 700 "$gpg_home"
  export GNUPGHOME="$gpg_home"
  # shellcheck disable=SC2094
  printf '%s\n' "$PACMAN_GPG_KEY" | gpg --batch --import
  keyid="$(gpg --batch --list-secret-keys --with-colons | awk -F: '$1=="sec"{print $5; exit}')"
  [[ -n $keyid ]] || { echo "build-repo.sh: PACMAN_GPG_KEY imported but no secret key id found" >&2; exit 1; }
  # Trust the key so repo-add / pacman-key style signing works non-interactively.
  printf '%s:6:\n' "$keyid" | gpg --batch --import-ownertrust
  gpg --batch --export --armor "$keyid" > "$workdir/mercury-repo.pubkey.asc"
  echo "Signing with key $keyid"
fi

cd "$workdir"
export PACKAGER="${PACKAGER:-canonrebel04 <117294984+canonrebel04@users.noreply.github.com>}"
makepkg_flags=(-f --holdver)
# Dependencies of the package are not needed to *create* the package.
makepkg_flags+=(--nodeps)
if [[ -n $keyid ]]; then
  makepkg_flags+=(--sign --key "$keyid")
fi
makepkg "${makepkg_flags[@]}"

shopt -s nullglob
packages=(mercury-browser-v3-bin-*.pkg.tar.zst)
shopt -u nullglob
[[ ${#packages[@]} -gt 0 ]] || { echo "build-repo.sh: makepkg did not produce a package" >&2; exit 1; }

repodir="$workdir/repo"
mkdir -p "$repodir"
cp -a "${packages[@]}" "$repodir/"
# Include signatures if present.
shopt -s nullglob
for sig in mercury-browser-v3-bin-*.pkg.tar.zst.sig; do
  cp -a "$sig" "$repodir/"
done
shopt -u nullglob
if [[ -f $workdir/mercury-repo.pubkey.asc ]]; then
  cp -a "$workdir/mercury-repo.pubkey.asc" "$repodir/"
fi

cd "$repodir"
pkgfile="$(ls -1 mercury-browser-v3-bin-*.pkg.tar.zst | head -1)"
if [[ -n $keyid ]]; then
  repo-add -s -k "$keyid" mercury.db.tar.gz "$pkgfile"
else
  repo-add mercury.db.tar.gz "$pkgfile"
fi

echo "Repo contents:"
ls -l "$repodir"

if [[ $do_upload -eq 1 ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "build-repo.sh: gh is required for --upload" >&2
    exit 1
  fi
  if ! gh release view pacman-repo --repo "$repo_name" >/dev/null 2>&1; then
    gh release create pacman-repo \
      --repo "$repo_name" \
      --prerelease \
      --title "Pacman repository" \
      --notes "Rolling Arch package database for mercury-browser-v3-bin. This pre-release is not a browser version and must not be treated as latest."
  fi
  # Upload every file in the repo dir, replacing previous assets of the same name.
  shopt -s nullglob
  assets=("$repodir"/*)
  shopt -u nullglob
  gh release upload pacman-repo "${assets[@]}" --repo "$repo_name" --clobber
  echo "Uploaded pacman repo to https://github.com/${repo_name}/releases/tag/pacman-repo"
fi

echo "Built $pkgfile"
