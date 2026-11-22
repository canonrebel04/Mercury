# Mercury Browser

<img src="https://raw.githubusercontent.com/Alex313031/Mercury/main/logos/Mercury_256.png" width="128">

[Firefox](https://www.mozilla.org/en-US/firefox/) fork built for **maximum real-world speed and strong privacy** across **Linux, Windows, and Android**, combining compiler optimizations, custom Gecko/WebRender/Canvas2D engine patches, and privacy hardening inspired by [LibreWolf](https://gitlab.com/librewolf-community), [Waterfox](https://github.com/WaterfoxCo/Waterfox), [Betterfox](https://github.com/yokoffing/Betterfox), [Mull](https://gitlab.com/divested-mobile/mull-fenix), [IronFox](https://gitlab.com/ironfox-oss/IronFox), and [iodé](https://gitlab.com/iode/os/public/apps/browser).

**Current base:** Firefox **160.0.1** (git tag `FIREFOX_160_0_1_RELEASE` in [mozilla-firefox/firefox](https://github.com/mozilla-firefox/firefox)). This fork ([canonrebel04/Mercury](https://github.com/canonrebel04/Mercury)) continues Mercury after the last upstream release (129.0.2, which is vulnerable to CVE-2024-9680 and later Firefox security bugs).

Mercury's changes to upstream Firefox files live as small, cleanly rebaseable patches in [`patches/firefox/`](patches/firefox) and are applied by `setup.sh`, which stops with an error if a patch no longer applies. Mercury-only files (branding, icons, policies) are copied over the tree.

---

## Performance & GPU Overhaul

Mercury 160.0.1 includes a 75-point speed and privacy overhaul designed to make Mercury **measurably faster than stock Firefox** while keeping strict privacy protections enabled:

- **Compiler & Linker Optimizations:** `-O3`, ThinLTO with tuned inlining (`-import-instr-limit=45`), Rust SIMD (`opt-level=3`, `codegen-units=1`), PGO on Linux, AVX2 (`x86-64-v3`) on Linux/Windows, and ARMv8.2-A (`cortex-a76` + `fp16` + `dotprod` + `crypto`) on Android.
- **Custom GPU Canvas2D (`DrawTargetWebgl`) Fast-Paths:** Direct uncached GPU Bezier curve stroking (`StrokeCurveAccel`), direct GPU filled-circle rendering (`DrawCircleAccel`), translucent curve alpha acceleration (`allowStrokeAlpha`), and `OnUncachedDraw()` tracking so heavy vector/graph canvases stay on the GPU instead of falling back to CPU Skia.
- **WebRender & Wayland GPU:** Unblocks NVIDIA (`>= 580.76.05`) DMA-BUF WebGL and Vulkan hardware video decoding on Linux Wayland, uncapped high-refresh Wayland vsync (`layout.frame_rate=-1`), native WebRender GPU SVG primitives, and expanded Canvas2D GPU caches.
- **SpiderMonkey JIT, GC & ScriptLoader:** Earlier Baseline/Ion tier-up, off-thread compilation strategy 3, parallel GC marking, 64 MB nursery, self-hosted JS bytecode cache, WASM SIMD/relaxed SIMD/branch hinting, and speculative async JS parsing + bytecode disk caching.
- **Necko & Startup:** 40 high-priority DNS threads, IPv6 lookup skip when no IPv6 addresses exist, RCWN disabled, active-tab network priority, speculative preconnect/DNS prefetch (automatically disabled in Hardened mode), and skipped `ASRouter` initialization at startup when CFR is disabled.

### Real-World Benchmarks (Linux x86_64 AVX2 vs. Stock Firefox 160.0.1)

| Benchmark | Stock Firefox 160.0.1 | Mercury 160.0.1 | Improvement |
| :--- | :---: | :---: | :---: |
| Heavy Canvas2D Graph (1,000 nodes / 6,000 curves per frame, Wayland NVIDIA) | 94.08 FPS | **109.04 FPS** | **+15.9% faster** |
| JS Math / JIT (`mathMs`) | 88 ms | **65 ms** | **26% faster** |
| Canvas2D GPU (`c2dMs`) | 17 ms | **14 ms** | **18% faster** |
| Combined micro-benchmark (`totalMs`) | 555 ms | **540 ms** | **2.7% faster** |

---

## Downloads & Platforms

Prebuilt binaries for all three platforms are published on [GitHub Releases](https://github.com/canonrebel04/Mercury/releases):

### Linux (`x86_64` AVX2 / `x86-64-v3`)
- **Arch / CachyOS (AUR):**
  ```sh
  paru -S mercury-browser-v3-bin
  # or: yay -S mercury-browser-v3-bin
  ```
- **Self-hosted pacman repo (`pacman -Syu`):**
  ```ini
  # /etc/pacman.conf
  [mercury]
  SigLevel = Optional TrustAll
  Server = https://github.com/canonrebel04/Mercury/releases/download/pacman-repo
  ```
- **Tarball:** Download `mercury-<version>.en-US.linux-x86_64.tar.xz` from [Releases](https://github.com/canonrebel04/Mercury/releases).
- See [packaging/arch/README.md](packaging/arch/README.md) for signed-repo setup, release publishing, and migrating from the unmaintained `mercury-browser-avx2-bin` (Firefox 129) package.

### Windows (`win64` AVX2)
- Download `mercury-<version>.en-US.win64.installer.exe` (NSIS installer) or `mercury-<version>.en-US.win64.zip` (portable) from [Releases](https://github.com/canonrebel04/Mercury/releases).

### Android (`arm64-v8a` APK)
- Built directly from `mozilla-unified/mobile/android` (GeckoView + Fenix) with `--enable-isolated-zygote-process`, mirrored GeckoView speed/privacy prefs, and Mull/IronFox/iodé-inspired Fenix enhancements:
  - Unlocked `about:config` and Custom AMO Extension Collections
  - Telemetry, Nimbus experiments, Pocket, Contile sponsored tiles, Firefox Suggest, and Google Safe Browsing disabled
  - Query-parameter stripping and strict tracking protection enabled by default
- Download the `arm64-v8a` `.apk` from [Releases](https://github.com/canonrebel04/Mercury/releases).

---

## Privacy & Security

### Zero-Cost Default Protections
Mercury turns on Firefox's high-value, zero-overhead privacy protections by default without throttling JS math or CPU thread concurrency:
- Fingerprinting protection with optimized SipHash canvas key generation (while keeping native `Math` speed and full `navigator.hardwareConcurrency`)
- Query-parameter stripping and cross-site referer trimming
- Beacons (`navigator.sendBeacon`), hyperlink auditing (`<a ping>`), Battery API, Gamepad API, Device Sensors, WebGL debug renderer info, and subresource HTTP auth disabled
- No WebGPU, no WebRTC IP leaks behind a proxy, no OCSP requests (CRLite checks revocation instead), no scripts in PDFs, and uBlock Origin enabled in private windows

### Hardened Mode
For maximum anti-fingerprinting, enable **Settings > Privacy & Security > Hardened mode** (off by default; pref `mercury.hardened.enabled`). It enables ResistFingerprinting (UTC timezone, letterboxing, canvas prompt, limited fonts), clears cookies and site data on close (keeping your exceptions), Strict tracking protection, HTTPS-Only, DNS over HTTPS with Quad9 by default (never Google), disables speculative connections/prefetching, and forces punycode domains. Turning it off cleanly restores only what it changed. Details, trade-offs, and tests: [PRIVACY-OPTIONS.md](docs/PRIVACY-OPTIONS.md).

### No Google
Mercury removes Google from the browser, like ungoogled-chromium and LibreWolf: no Google search engine (DuckDuckGo is the default), no Google Safe Browsing or geolocation, no Google API keys, and no YouTube in the default top sites. Telemetry, studies, sponsored content, and promos are off by default. The full list is in [DEGOOGLE.md](docs/DEGOOGLE.md).

### DRM (Widevine)
DRM is off by default, and Mercury makes no requests to Google or Mozilla's plugin server while it's off. To watch DRM video (Netflix, Spotify, ...), turn on **Settings > General > "Play DRM-controlled content"**. **This downloads Google's Widevine CDM from Google's servers.** Details are in [DEGOOGLE.md](docs/DEGOOGLE.md#widevine--drm).

### Update Notifications
Mercury has no auto-updater. Once a day it checks the GitHub Releases API (`api.github.com/repos/canonrebel04/Mercury/releases/latest`) and, if a newer release exists, shows a bar with a link to the download page. Nothing is downloaded or installed, and no cookies or telemetry are sent. To disable it, set `mercury.updatecheck.enabled` to `false` in `about:config`.

### Optional AI Features
All of Firefox's AI features are included but off by default, and no AI model is downloaded until you turn a feature on. Go to **Settings > AI controls** to enable them individually (AI chatbot sidebar, link previews, smart tab groups, PDF alt-text, Smart Window / on-device speech). Local private Translations stay available on demand from the address bar.

### MCP Browser Control (Experimental)
LLM clients (Claude Desktop, Cursor, ...) can drive Mercury through the optional [MCP server](mcp/README.md). It is off unless you start Mercury with `mercury-browser --mcp`, which enables Firefox's built-in Remote Agent on `127.0.0.1` with a separate profile. Without `--mcp`, nothing listens. See the [security notes](mcp/README.md#security).

---

## Documentation

- **Patches** <img src="https://raw.githubusercontent.com/Alex313031/Mercury/main/logos/patches.png" width="24"> — [PATCHES.md](docs/PATCHES.md)
- **Bugs** <img src="https://github.com/Alex313031/Mercury/blob/main/logos/bug.svg" width="24"> — [BUGS.md](docs/BUGS.md)
- **Building** <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_light.svg#gh-dark-mode-only"> <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_dark.svg#gh-light-mode-only"> — [BUILDING.md](docs/BUILDING.md) and [DEBUGGING.md](docs/DEBUGGING.md)
