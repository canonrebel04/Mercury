# Mercury Browser

<img src="https://raw.githubusercontent.com/Alex313031/Mercury/main/logos/Mercury_256.png" width="128">

[Firefox](https://www.mozilla.org/en-US/firefox/) fork with compiler optimizations and patches from [Librewolf](https://gitlab.com/librewolf-community), [Waterfox](https://github.com/WaterfoxCo/Waterfox), [Ghostery](https://github.com/ghostery/user-agent-desktop), and [BetterFox](https://github.com/yokoffing/Betterfox).

It aims to be the Firefox equivalent of my main project: [Thorium](https://github.com/Alex313031/Thorium) (a [Chromium](https://www.chromium.org/) fork).

**Current base:** Firefox **160.0** (git tag `FIREFOX_160_0_RELEASE` in [mozilla-firefox/firefox](https://github.com/mozilla-firefox/firefox)). This fork ([canonrebel04/Mercury](https://github.com/canonrebel04/Mercury)) continues Mercury after the last upstream release (129.0.2, which is vulnerable to CVE-2024-9680 and later Firefox security bugs).

Mercury's changes to upstream Firefox files live as small patches in [`patches/firefox/`](patches/firefox) and are applied by `setup.sh`, which stops with an error if a patch no longer applies. Mercury-only files (branding, icons, policies) are still copied over the tree.

### Update notifications
Mercury has no auto-updater. Once a day it asks the GitHub Releases API (`api.github.com/repos/canonrebel04/Mercury/releases/latest`) whether a newer release exists and, if so, shows a bar with a link to the download page. Nothing is downloaded or installed, and no cookies or telemetry are sent. To turn it off, set `mercury.updatecheck.enabled` to `false` in `about:config`.

### No Google
Mercury removes Google from the browser, like ungoogled-chromium and LibreWolf: there's no Google search engine (DuckDuckGo is the default), no Google Safe Browsing or geolocation, no Google API keys, and no YouTube in the default top sites. Telemetry, studies, sponsored content and promos are off by default. The full list, including what is kept and why, is in [DEGOOGLE.md](docs/DEGOOGLE.md).

### DRM (Widevine)
DRM is off by default, and Mercury makes no requests to Google or Mozilla's plugin server while it's off. To watch DRM video (Netflix, Spotify, ...), turn on Settings > General > "Play DRM-controlled content". **This downloads Google's Widevine CDM from Google's servers.** Widevine is made by Google, so there's no other source. Details are in [DEGOOGLE.md](docs/DEGOOGLE.md#widevine--drm).

### Optional AI features
All of Firefox's AI features are included but off by default, and no AI model is downloaded until you turn a feature on. Go to Settings > AI controls and switch off "Block AI enhancements" (makes them all available), or turn on one feature at a time:
- AI chatbot sidebar and "Ask chatbot" menu items (pick any provider; none is preselected)
- link previews with AI key points
- smart tab groups
- PDF alt-text generation
- Smart Window and on-device speech recognition

Translations (Firefox's local, private translation engine) stay available, but Mercury doesn't offer to translate pages automatically. Use the translate button in the address bar, or turn the offer on in Settings.

### MCP browser control (experimental)
LLM clients (Claude Desktop, Cursor, ...) can drive Mercury through a small optional [MCP server](mcp/README.md). It's off unless you start Mercury with `mercury-browser --mcp`, which turns on Firefox's built-in Remote Agent on `127.0.0.1` with a separate profile. While it's on, the address bar shows Firefox's striped "remote control" robot indicator, and any program on your computer can control that browser. Without `--mcp` nothing is added to the browser and nothing listens. See the [security notes](mcp/README.md#security).

## Patches <img src="https://raw.githubusercontent.com/Alex313031/Mercury/main/logos/patches.png" width="28">
See > [PATCHES.md](docs/PATCHES.md)

## Bugs <img src="https://github.com/Alex313031/Mercury/blob/main/logos/bug.svg" width="28">
See > [BUGS.md](docs/BUGS.md)

## Building <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_light.svg#gh-dark-mode-only"> <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_dark.svg#gh-light-mode-only">
See > [BUILDING.md](docs/BUILDING.md) and [DEBUGGING.md](docs/DEBUGGING.md).
