#!/usr/bin/env python3
"""Rewrite pkgver/sha256sums in PKGBUILD and regenerate .SRCINFO.

Used by release.sh, build-repo.sh, and the aur-publish workflow so the
three stay in sync. Does not upload anything.
"""
from __future__ import annotations

import argparse
import hashlib
import pathlib
import re
import subprocess
import sys

ARCH_DIR = pathlib.Path(__file__).resolve().parent
PKGBUILD = ARCH_DIR / "PKGBUILD"
SRCINFO = ARCH_DIR / ".SRCINFO"
REPO_URL = "https://github.com/canonrebel04/Mercury"


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def rewrite_pkgbuild(pkgbuild: pathlib.Path, version: str, tarball_sum: str) -> None:
    text = pkgbuild.read_text()
    text = re.sub(r"^pkgver=.*$", f"pkgver={version}", text, count=1, flags=re.M)
    text = re.sub(r"^pkgrel=.*$", "pkgrel=1", text, count=1, flags=re.M)
    launcher = sha256_file(pkgbuild.parent / "mercury-browser.sh")
    desktop = sha256_file(pkgbuild.parent / "mercury-browser.desktop")
    new_sums = (
        "sha256sums=(\n"
        f"  '{tarball_sum}'\n"
        f"  '{launcher}'\n"
        f"  '{desktop}'\n"
        ")"
    )
    text, n = re.subn(r"sha256sums=\(\n(?:[^\)]*\n)+\)", new_sums, text, count=1)
    if n != 1:
        raise SystemExit(f"failed to rewrite sha256sums in {pkgbuild}")
    pkgbuild.write_text(text)


def write_srcinfo(dest: pathlib.Path, version: str, tarball_sum: str, arch_dir: pathlib.Path) -> None:
    launcher = sha256_file(arch_dir / "mercury-browser.sh")
    desktop = sha256_file(arch_dir / "mercury-browser.desktop")
    url = f"{REPO_URL}/releases/download/v{version}/mercury-{version}.en-US.linux-x86_64.tar.xz"
    dest.write_text(
        "pkgbase = mercury-browser-v3-bin\n"
        "\tpkgdesc = Privacy-focused Firefox fork with compiler optimizations (binary release; requires AVX2 / x86-64-v3)\n"
        f"\tpkgver = {version}\n"
        "\tpkgrel = 1\n"
        f"\turl = {REPO_URL}\n"
        "\tinstall = mercury-browser-v3-bin.install\n"
        "\tarch = x86_64\n"
        "\tlicense = MPL-2.0\n"
        "\tdepends = bash\n"
        "\tdepends = glibc\n"
        "\tdepends = gcc-libs\n"
        "\tdepends = gtk3\n"
        "\tdepends = hicolor-icon-theme\n"
        "\tdepends = libxt\n"
        "\tdepends = mime-types\n"
        "\tdepends = dbus-glib\n"
        "\tdepends = nss\n"
        "\tdepends = ttf-font\n"
        "\toptdepends = ffmpeg: H264/AAC/MP3 decoding\n"
        "\toptdepends = hunspell-en_US: Spell checking, American English\n"
        "\toptdepends = libnotify: Notification integration\n"
        "\toptdepends = networkmanager: Location detection via available WiFi networks\n"
        "\toptdepends = pulseaudio: Audio support\n"
        "\toptdepends = speech-dispatcher: Text-to-Speech\n"
        "\toptdepends = xdg-desktop-portal: Screensharing with Wayland\n"
        "\tprovides = mercury-browser\n"
        "\tconflicts = mercury-browser\n"
        "\toptions = !strip\n"
        "\toptions = !debug\n"
        "\toptions = !emptydirs\n"
        f"\tsource = mercury-{version}.en-US.linux-x86_64.tar.xz::{url}\n"
        "\tsource = mercury-browser.sh\n"
        "\tsource = mercury-browser.desktop\n"
        f"\tsha256sums = {tarball_sum}\n"
        f"\tsha256sums = {launcher}\n"
        f"\tsha256sums = {desktop}\n"
        "\n"
        "pkgname = mercury-browser-v3-bin\n"
    )



def maybe_makepkg_srcinfo(arch_dir: pathlib.Path) -> bool:
    try:
        result = subprocess.run(
            ["makepkg", "--printsrcinfo"],
            cwd=arch_dir,
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False
    (arch_dir / ".SRCINFO").write_text(result.stdout)
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--tarball-sha256", required=True)
    parser.add_argument(
        "--pkgbuild",
        type=pathlib.Path,
        default=PKGBUILD,
        help="PKGBUILD to rewrite (default: the one next to this script)",
    )
    args = parser.parse_args(argv)
    pkgbuild = args.pkgbuild.resolve()
    arch_dir = pkgbuild.parent
    rewrite_pkgbuild(pkgbuild, args.version, args.tarball_sha256)
    if not maybe_makepkg_srcinfo(arch_dir):
        write_srcinfo(arch_dir / ".SRCINFO", args.version, args.tarball_sha256, arch_dir)
        print("Wrote .SRCINFO without makepkg; regenerate with makepkg --printsrcinfo when available.")
    else:
        print("Regenerated .SRCINFO with makepkg --printsrcinfo")
    print(f"Updated {pkgbuild} for {args.version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
