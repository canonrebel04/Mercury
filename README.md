# Mercury Browser

<img src="https://raw.githubusercontent.com/Alex313031/Mercury/main/logos/Mercury_256.png" width="128">

[Firefox](https://www.mozilla.org/en-US/firefox/) fork with compiler optimizations and patches from [Librewolf](https://gitlab.com/librewolf-community), [Waterfox](https://github.com/WaterfoxCo/Waterfox), [Ghostery](https://github.com/ghostery/user-agent-desktop), and [BetterFox](https://github.com/yokoffing/Betterfox).

It aims to be the Firefox equivalent of my main project: [Thorium](https://github.com/Alex313031/Thorium) (a [Chromium](https://www.chromium.org/) fork).

**Current base:** Firefox **159.0.1** (git tag `FIREFOX_159_0_1_RELEASE` in [mozilla-firefox/firefox](https://github.com/mozilla-firefox/firefox)). This fork ([canonrebel04/Mercury](https://github.com/canonrebel04/Mercury)) continues Mercury after the last upstream release (129.0.2, which is vulnerable to CVE-2024-9680 and later Firefox security bugs).

Mercury's changes to upstream Firefox files live as small patches in [`patches/firefox/`](patches/firefox) and are applied by `setup.sh`, which stops with an error if a patch no longer applies. Mercury-only files (branding, icons, policies) are still copied over the tree.

### Update notifications
Mercury has no auto-updater. Once a day it asks the GitHub Releases API (`api.github.com/repos/canonrebel04/Mercury/releases/latest`) whether a newer release exists and, if so, shows a bar with a link to the download page. Nothing is downloaded or installed, and no cookies or telemetry are sent. To turn it off, set `mercury.updatecheck.enabled` to `false` in `about:config`.

## Patches <img src="https://raw.githubusercontent.com/Alex313031/Mercury/main/logos/patches.png" width="28">
See > [PATCHES.md](docs/PATCHES.md)

## Bugs <img src="https://github.com/Alex313031/Mercury/blob/main/logos/bug.svg" width="28">
See > [BUGS.md](docs/BUGS.md)

## Building <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_light.svg#gh-dark-mode-only"> <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_dark.svg#gh-light-mode-only">
See > [BUILDING.md](docs/BUILDING.md) and [DEBUGGING.md](docs/DEBUGGING.md).
