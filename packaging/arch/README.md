# Arch Linux packages for Mercury

This directory holds the AUR binary package and the optional self-hosted
pacman repo. The browser itself is **not** compiled on GitHub; you build
it on your CachyOS machine with PGO+LTO and AVX2, then attach the
tarball from `./package.sh` to a GitHub Release tagged `vX.Y` (for
example `v160.0.1`). That tag format is what the in-browser update
notifier already expects.

The package name is `mercury-browser-v3-bin` (AVX2 / x86-64-v3).
`mercury-browser-bin` was taken on 14 November 2026 by a `999-1`
placeholder that tells people to switch to Firefox, so this package
does not use that name and does not conflict with it.

It also does not collide with the older `mercury-browser-avx2-bin` AUR
package (Alex313031's Mercury 129.0.2, last updated 2025-01-25,
maintainer `saxophone_dev`, already labeled unmaintained and
vulnerable). That package is **not orphaned**. To take it over so
existing users migrate automatically: comment on the AUR page asking
`saxophone_dev` to transfer it; if there is no reply after about two
weeks, file an Orphan Request on the same page. Do not submit a second
package under that name.

## One-time setup

1. **AUR account.** Register at https://aur.archlinux.org/register. You
   can use any email you own; the PKGBUILD Maintainer line and the
   workflow `commit_email` should match that account.
2. **SSH key for the AUR.** Generate a dedicated key, add the public
   half under AUR Account > SSH Public Key, and add the **private** half
   as a repository secret named `AUR_SSH_PRIVATE_KEY` (Settings >
   Secrets and variables > Actions). Example:

   ```sh
   ssh-keygen -t ed25519 -f ~/.ssh/aur -C "aur-mercury" -N ""
   # paste ~/.ssh/aur.pub into the AUR account
   # paste the contents of ~/.ssh/aur into AUR_SSH_PRIVATE_KEY
   ```

   The first run of the publish workflow creates the AUR repo by
   pushing `mercury-browser-v3-bin`. You can also seed it yourself:

   ```sh
   git clone ssh://aur@aur.archlinux.org/mercury-browser-v3-bin.git
   cp packaging/arch/PKGBUILD packaging/arch/.SRCINFO \
      packaging/arch/mercury-browser.sh packaging/arch/mercury-browser.desktop \
      packaging/arch/mercury-browser-v3-bin.install mercury-browser-v3-bin/
   cd mercury-browser-v3-bin && git add . && git commit -m "Initial import" && git push
   ```

   Do not push until you are ready for the package to go live.

3. **Optional: pacman-repo signing key.** If you want `[mercury]` users
   to install with `SigLevel = Required`, create a GPG key, export the
   armored private key, and store it as the repository secret
   `PACMAN_GPG_KEY`. Keep the public key; `build-repo.sh` also uploads
   `mercury-repo.pubkey.asc` next to the database.

   ```sh
   gpg --batch --passphrase "" --quick-generate-key "Mercury Arch repo <you@example.com>" default default never
   gpg --armor --export-secret-keys KEYID > /tmp/mercury-repo-priv.asc
   # store that file's contents as PACMAN_GPG_KEY, then shred the file
   gpg --armor --export KEYID
   ```

## Per-release steps

On the machine that already builds Mercury (AVX2, PGO+LTO):

```sh
export HG_SRC_DIR=$HOME/mozilla-unified
# after a successful ./setup.sh --avx2 && ./build.sh
./package.sh
./packaging/arch/release.sh
# or: ./packaging/arch/release.sh /path/to/mercury-160.0.1.en-US.linux-x86_64.tar.xz
```

`release.sh` writes a `.sha256` next to the tarball, bumps `pkgver` and
the checksums in `PKGBUILD` / `.SRCINFO`, and creates (or updates) the
GitHub Release `vX.Y`. Commit the packaging bump afterwards. Publishing
the release triggers `.github/workflows/aur-publish.yml`, which
recomputes the checksum from the release asset, pushes to the AUR, and
rebuilds the `pacman-repo` database. It never compiles Firefox.

A dry run (`./packaging/arch/release.sh --dry-run /path/to/tarball`)
only updates the packaging files.

To build the pacman package locally (CachyOS already has `makepkg`):

```sh
./packaging/arch/build-repo.sh --tarball /path/to/mercury-160.0.1.en-US.linux-x86_64.tar.xz
# add --upload to publish to the pacman-repo pre-release tag
```

## Install (users)

AUR:

```sh
paru -S mercury-browser-v3-bin
# or: yay -S mercury-browser-v3-bin
```

Self-hosted repo, unsigned:

```ini
# /etc/pacman.conf
[mercury]
SigLevel = Optional TrustAll
Server = https://github.com/canonrebel04/Mercury/releases/download/pacman-repo
```

Self-hosted repo, signed:

```sh
sudo pacman-key --add mercury-repo.pubkey.asc
sudo pacman-key --lsign-key KEYID
```

```ini
[mercury]
SigLevel = Required TrustedOnly
Server = https://github.com/canonrebel04/Mercury/releases/download/pacman-repo
```

Then `sudo pacman -Syu mercury-browser-v3-bin`.

If you still have the old vulnerable package:

```sh
sudo pacman -R mercury-browser-avx2-bin
```

The binary needs AVX2 (x86-64-v3) and installs to `/opt/mercury`, with
`/usr/bin/mercury-browser` as the launcher.

## Validation notes

The `PKGBUILD` tarball checksum in this tree is a placeholder (64 zeros)
until the first `vX.Y` release exists; `release.sh` and the publish
workflow replace it. `namcap PKGBUILD` is clean. `namcap` on the built
package reports `ELF files outside of a valid path ('opt/')`, which is
expected: the files are installed to `/opt/mercury` on purpose, like
`firefox-bin`. Other namcap messages about "may not be needed" or
dangling hunspell/NSS symlinks showed up only when the package was
tested against a dummy tarball in a minimal chroot, not a full Firefox
tree on a desktop system.
