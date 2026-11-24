# Mercury Browser

<img src="https://raw.githubusercontent.com/Alex313031/Mercury/main/logos/Mercury_256.png" width="128">

[Firefox](https://www.mozilla.org/en-US/firefox/) fork built for **maximum real-world speed, hardcore exploit mitigations, and strong privacy** across **Linux, Windows, and Android**, combining compiler/linker/BOLT optimizations, Rust-first Gecko/WebRender/Canvas2D engine upgrades, Vanadium-style per-site JIT allowlisting, and privacy hardening inspired by [LibreWolf](https://gitlab.com/librewolf-community), [Waterfox](https://github.com/WaterfoxCo/Waterfox), [Betterfox](https://github.com/yokoffing/Betterfox), [Mull](https://gitlab.com/divested-mobile/mull-fenix), [IronFox](https://gitlab.com/ironfox-oss/IronFox), and [iodé](https://gitlab.com/iode/os/public/apps/browser).

**Current release:** Mercury **160.0.1.1** — based on Firefox **160.0.1** (git tag `FIREFOX_160_0_1_RELEASE` in [mozilla-firefox/firefox](https://github.com/mozilla-firefox/firefox)). This fork ([canonrebel04/Mercury](https://github.com/canonrebel04/Mercury)) continues Mercury after the last upstream release (129.0.2, which is vulnerable to CVE-2024-9680 and later Firefox security bugs).

Mercury's changes to upstream Firefox files live as small, cleanly rebaseable patches in [`patches/firefox/`](patches/firefox) and are applied by `setup.sh`, which stops with an error if a patch no longer applies. Mercury-only files (branding, icons, policies, settings modules) are copied over the tree.

---

## Performance, Rust-First Engine & Toolchain Overhaul

Mercury **160.0.1.1** combines a 75-point Gecko/GPU overhaul, **Rust-first Canvas2D/font/compression upgrades**, and a unified **Profile-Once Cross-PGO + Full/Cross-LTO + BOLT** release pipeline:

- **Unified Cross-PGO + Full/Cross-LTO + BOLT Pipeline (`scripts/build-release.sh`):**
  - Generates one enriched LLVM IR PGO profile on Linux (`scripts/pgo-generate.sh`, including Mercury's local Canvas2D + JS/Wasm + DOM/Layout stress workload) and applies it across **Linux `x86-64-v3`**, **Windows `x86-64-v3` cross-compile**, and **Android `arm64-v8a`** via `--enable-profile-use=cross` + `--with-pgo-profile-path`.
  - **Full / Cross-Language LTO** (`--enable-lto=cross,full` when Clang & `rustc` share LLVM major version, safe fallback to `--enable-lto=full`), tuned inlining (`-import-instr-limit=45`), `lld`/`lld-link` call-graph profile sorting + Ext-TSP block placement, `-O3`, Rust SIMD (`opt-level=3`, `codegen-units=1`), `x86-64-v3` (AVX2) on desktop, and `armv8.2-a+fp16+rcpc+dotprod+crypto` (`cortex-a76`) C++ & Rust parity on Android.
  - **Post-Link Linux `llvm-bolt` (`scripts/bolt-optimize.sh`):** Reorders hot basic blocks (`ext-tsp`) and functions (`cdsort`), splits cold code, folds identical functions (`icf=1`), runs an automatic headless smoke test, and rolls back atomically on any failure — using BOLT instrumentation mode by default (no `perf` or root required).
  - **Fast Dev Mode:** `--fast` / `MERCURY_FAST_BUILD=1` disables PGO, LTO, BOLT, and `geckodriver` for quick local iteration.
- **Rust-First Canvas2D, Fonts & Compression (`0044`, `--enable-fontations`, `USE_LIBZ_RS=1`):**
  - **Pure-Rust Canvas2D GPU Tessellators (`mercury_canvas_accel.rs`):** Zero-heap-alloc, bounds-checked Rust tessellators for cubic Bezier curves, stroked circles, polylines, and stroked rounded rects wired into `DrawTargetWebgl` alongside direct GPU Bezier/circle fast-paths (`StrokeCurveAccel`, `DrawCircleAccel`, `allowStrokeAlpha`) so heavy vector/graph canvases stay on the GPU.
  - **Pure-Rust Fontations & `zlib-rs`:** `--enable-fontations` (`gfx.font_rendering.fontations.enabled = true`) and `USE_LIBZ_RS=1` (pure-Rust SIMD `zlib-rs`) enabled across all release mozconfigs.
- **WebRender, Wayland GPU, Wasm & HTTP/3 GSO:**
  - Unblocks NVIDIA (`>= 580.76.05`) DMA-BUF WebGL and Vulkan hardware video decoding on Linux Wayland, uncapped high-refresh Wayland vsync (`layout.frame_rate=-1`), WebRender layer compositor, 512 KB batched uploads, 32-surface pool, and native WebRender GPU SVG primitives.
  - Wasm lazy tiering + desktop `x86_64` AVX SIMD (`javascript.options.wasm_simd_avx = true`), earlier Baseline/Ion tier-up, parallel GC marking, 64 MB nursery, and speculative async JS parsing.
  - HTTP/3 GSO (`max_gso_segments = 16`, 4 MB desktop / 2 MB Android recv buffer) with QUIC 0-RTT disabled (`enable_0rtt = false`) to eliminate replay risk, 40 high-priority DNS threads, Fission process prelaunch (`4`), and switchable **Performance & Memory Profiles** (`Balanced` / `Turbo` / `Low-RAM` via `MercuryPerformance.sys.mjs`).

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
- **Tarball:** Download `mercury-160.0.1.1.en-US.linux-x86_64.tar.xz` from [Releases](https://github.com/canonrebel04/Mercury/releases).
- See [packaging/arch/README.md](packaging/arch/README.md) for signed-repo setup, release publishing, and migrating from the unmaintained `mercury-browser-avx2-bin` (Firefox 129) package.

### Windows (`win64` AVX2 / `x86-64-v3`)
- Download `mercury-160.0.1.1.en-US.win64.installer.exe` (NSIS installer) or `mercury-160.0.1.1.en-US.win64.zip` (portable) from [Releases](https://github.com/canonrebel04/Mercury/releases).

### Android (`arm64-v8a` APK)
- Built directly from `mozilla-unified/mobile/android` (GeckoView + Fenix) with `--enable-isolated-zygote-process`, ARM64 PAC+BTI (`-mbranch-protection=standard`), full **Mercury Settings** parity, custom Mercury branding, and Mull/IronFox/iodé-inspired enhancements:
  - Dedicated **Settings > Mercury** screen with Hardened Mode, Security Levels, Performance & Memory Profiles (`Balanced` / `Turbo` / `Low-RAM`), New Identity, Trusted JIT & WebAssembly Sites allowlist, Parent-Process JIT Killswitch, Strict Fission Site Isolation, 36-target Crowd-Blend FPP, Captive Portal toggle, Rust Fontations toggle, DoH provider selector, and WebRTC/WebGL/DRM/GPU toggles
  - Firefox Accounts / Sync sign-in UI and Terms-of-Use / Privacy-Notice / Onboarding prompts disabled by default
  - Unlocked `about:config` and Custom AMO Extension Collections
  - Telemetry, Nimbus experiments, Pocket, Contile sponsored tiles, Firefox Suggest, and Google Safe Browsing disabled
  - Curated 65-parameter query stripping, Bounce Tracking Protection, and Strict Tracking Protection enabled by default
- Download the `arm64-v8a` `.apk` from [Releases](https://github.com/canonrebel04/Mercury/releases).

---

## Security, Exploit Mitigations, Privacy & Mercury Settings

### Hardcore Exploit Mitigations & Per-Site JIT/WASM Allowlisting
- **Compiler & Binary Mitigations:** `-D_FORTIFY_SOURCE=3` + `-fcf-protection=branch` (Intel CET IBT) on Linux `x86_64`; `-D_FORTIFY_SOURCE=3` + `-mbranch-protection=standard` (ARM64 PAC+BTI) on Linux `arm64`; `-mbranch-protection=standard` on Android `arm64-v8a`; Windows `/CETCOMPAT` + CET Shadow Stack + ACG + CIG prespawn + Win32k lockdown.
- **Process, Sandbox & Transport Hardening:** Parent-process JIT disabled (`javascript.options.main_process_disable_jit = true`), W^X JIT code write-protection (`javascript.options.content_process_write_protect_code = true`), strict Fission `IsolateEverything` (`fission.webContentIsolationStrategy = 1`), Linux sandbox levels 6/2/1, TLS 1.2+ minimum with safe renegotiation, mixed display content blocked, and QUIC 0-RTT disabled.
- **Vanadium-Style Per-Site JIT/WASM Allowlist (`0043`):** In `Safer` or `Safest` security levels (where JIT/WASM are disabled globally), selectively allow JIT & WebAssembly only for exact trusted site-isolated origins (`mercury.security.jitAllowlist`, editable in **Settings > Mercury**). Strictly scoped to `webIsolated=`/`webCOOP+COEP=` content processes with exact origin matching and zero wildcard/suffix spoofing.

### Dedicated Mercury Settings Tab
Desktop (`about:preferences#mercury`) and Android (**Settings > Mercury**) provide a dedicated, searchable settings tab exposing Mercury's privacy, security, and performance controls in one place:
- **Hardened Mode** (`mercury.hardened.enabled`) + **Preserve System Theme under RFP** (`mercury.rfp.preserveSystemTheme`)
- **Security Levels** (`Standard` / `Safer` / `Safest`), **Trusted JIT & WebAssembly Sites**, **Parent-Process JIT Killswitch**, **Strict Fission Site Isolation**, and one-click **New Identity**
- **Performance & Memory Profile** (`Balanced` / `Turbo` / `Low-RAM`), **Rust Fontations Font Engine**, and **Hardware Acceleration / WebRender / GPU Canvas2D**
- **Crowd-Blend FPP**, **Strict Tracking Protection**, **HTTPS-Only**, **Query Parameter Stripping**, **Captive Portal Detection**, and **DNS-over-HTTPS** provider selector (AdGuard / Quad9 / Mullvad / Custom)
- Individual toggles for WebRTC, WebGL, WebGPU, DRM (Widevine), Beacons/Pings, Speculative Prefetching, Punycode IDN, Built-in AI controls, and Update Check Notifications.

### Zero-Cost Default Protections
Mercury enables high-value anti-fingerprinting and anti-tracking protections by default without throttling JS math or CPU thread concurrency:
- **36-target Crowd-Blend FPP** (WebGL, Canvas third-party extraction, AudioContext, MediaCapabilities, WebCodecs, DiskStorageLimit, native colors, screen/window/mouse metrics, CSS media queries, PDF.js) with native JS `Math` speed and system theme preserved, and Mozilla RemoteSettings FPP overrides disabled
- **Curated ~65-param Redirect Query Stripping**, blocked Storage Access API auto-grants/headers, tightened Bounce Tracking Protection (300s grace / 600s purge), and cross-site referer trimming
- **Zero-Background-Chatter Defaults:** Connectivity and captive-portal probes disabled by default (toggleable in Mercury Settings for hotel/airport Wi-Fi), no OCSP requests (CRLite instead), no Beacons/Pings/Battery/Gamepad/Sensors/WebGPU/PDF JS, and uBlock Origin enabled in private windows

### Native Ephemeral ("Burner") Tabs (Desktop)
Open disposable, single-use isolated tabs that never leak state into your main browsing profile:
- Press **`Ctrl+Alt+T`** (`Cmd+Option+T` on macOS), right-click any link -> **"Open Link in Burner Tab"**, or enable **Auto-Burner** in Mercury Settings.
- When the last tab in a burner closes, Mercury atomically clears all cookies, storage, cache, and site permissions for that container (with crash orphan recovery and automatic Private Browsing bypass).

### No Firefox Accounts, No Terms-of-Use Prompts, No Google
- **No FxA / No ToS:** Firefox Accounts / Sync sign-in UI and Firefox Terms-of-Use / Privacy-Notice "Agree" modals, infobars, and onboarding prompts are disabled by default on both Desktop and Android.
- **No Google:** No Google search engine (DuckDuckGo is the default), no Google Safe Browsing or geolocation, no Google API keys, and no YouTube in default top sites. Telemetry, studies, sponsored content, and promos are off by default. Full list: [DEGOOGLE.md](docs/DEGOOGLE.md).

### Hardened Mode
For maximum anti-fingerprinting, enable **Settings > Mercury > Hardened mode** (`mercury.hardened.enabled`). It enables ResistFingerprinting (UTC timezone, letterboxing, canvas prompt, limited fonts), clears cookies and site data on close (keeping exceptions), Strict tracking protection, HTTPS-Only, DoH (AdGuard DNS by default), disables speculative connections/prefetching, and forces punycode domains. Turning it off cleanly restores only what it changed. Details and tests: [PRIVACY-OPTIONS.md](docs/PRIVACY-OPTIONS.md).

### DRM (Widevine)
DRM is off by default, and Mercury makes no requests to Google or Mozilla's plugin server while it's off. To watch DRM video (Netflix, Spotify, ...), enable **Play DRM-controlled content** in **Settings > Mercury** (or **General**). **This downloads Google's Widevine CDM from Google's servers.** Details: [DEGOOGLE.md](docs/DEGOOGLE.md#widevine--drm).

### Update Notifications
Mercury has no auto-updater. Once a day it checks the GitHub Releases API (`api.github.com/repos/canonrebel04/Mercury/releases/latest`) and, if a newer release exists, shows a bar with a link to the download page. Nothing is downloaded or installed, and no cookies or telemetry are sent. Toggle it off in **Settings > Mercury** (`mercury.updatecheck.enabled`).

### Optional AI Features
All of Firefox's AI features are off by default, and no AI model is downloaded until enabled. Use **Settings > Mercury** or **Settings > AI controls** to configure them individually.

### MCP Browser Control (Experimental)
LLM clients (Claude Desktop, Cursor, ...) can drive Mercury through the optional [MCP server](mcp/README.md). It is off unless you start Mercury with `mercury-browser --mcp`, which enables Firefox's built-in Remote Agent on `127.0.0.1` with a separate profile. Without `--mcp`, nothing listens. See the [security notes](mcp/README.md#security).

---

## Documentation

- **Patches** <img src="https://raw.githubusercontent.com/Alex313031/Mercury/main/logos/patches.png" width="24"> — [PATCHES.md](docs/PATCHES.md)
- **Bugs** <img src="https://github.com/Alex313031/Mercury/blob/main/logos/bug.svg" width="24"> — [BUGS.md](docs/BUGS.md)
- **Building** <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_light.svg#gh-dark-mode-only"> <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_dark.svg#gh-light-mode-only"> — [BUILDING.md](docs/BUILDING.md) and [DEBUGGING.md](docs/DEBUGGING.md)
- **Design Specs:**
  - [Build, Toolchain & Binary Speed Pipeline (Cross-PGO + Full-LTO + BOLT)](docs/superpowers/specs/2026-11-23-build-toolchain-speed-design.md)
  - [Next-Level Privacy, Anti-Fingerprinting & Native Burner Tabs](docs/superpowers/specs/2026-11-23-privacy-antifingerprinting-design.md)
  - [Hardcore Security, Exploit Mitigations & Per-Site JIT/WASM Allowlisting](docs/superpowers/specs/2026-11-24-security-mitigations-design.md)
  - [Rust-First Engine, Rendering & Runtime Speed](docs/superpowers/specs/2026-11-24-engine-rust-speed-design.md)
