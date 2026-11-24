# Mercury 160.0.1.1

Built from Firefox `FIREFOX_160_0_1_RELEASE` (`160.0.1`) for **Linux `x86-64-v3` (AVX2)**, **Windows `x86-64-v3` (AVX2)**, and **Android `arm64-v8a`**.

## Highlights

- **Dedicated Mercury Settings Tab (Desktop & Android Parity):**
  - First-class **Mercury** settings pane (`about:preferences#mercury` on Desktop; **Settings > Mercury** on Android) with full Settings search integration.
  - Controls for **Hardened Mode** (`mercury.hardened.enabled`, with Preserve System Theme under RFP), **Security Levels** (`Standard` / `Safer` / `Safest`), one-click **New Identity**, DoH provider selection, and individual toggles for WebRTC, WebGL, WebGPU, DRM (Widevine), Beacons/Pings, Speculative Prefetching, Punycode IDN, Query Parameter Stripping, Built-in AI controls, Update Check Notifications, and Hardware Acceleration / WebRender / GPU Canvas2D.
- **Zero Firefox Accounts & Terms-of-Use Prompts by Default (Desktop & Android):**
  - Firefox Accounts / Sync sign-in buttons, toolbar/AppMenu/Sidebar/Settings entries, and background `WeaveService` sync tasks are disabled by default (`DisableFirefoxAccounts: true`, `identity.fxaccounts.enabled = false`).
  - Firefox Terms of Use, Privacy Notice "Agree" modals/infobars, pre-onboarding splash screens, and marketing/welcome tabs are suppressed by default (`SkipTermsOfUse: true`, `SkipOnboarding: true`).
- **Next-Level Privacy, Anti-Fingerprinting & Native Burner Tabs:**
  - **Upgraded 36-Target Crowd-Blend FPP:** Expanded `privacy.fingerprintingProtection.overrides` across WebGL, Canvas third-party extraction, AudioContext, MediaCapabilities, WebCodecs, DiskStorageLimit, native colors, screen/window/mouse metrics, CSS media features, and PDF.js while preserving native JS `Math` speed and system dark/light theme; Mozilla RemoteSettings FPP overrides disabled (`privacy.fingerprintingProtection.remoteOverrides.enabled = false`).
  - **Link, Storage & Bounce Defenses:** Curated ~65-parameter redirect query-parameter stripping (`privacy.query_stripping.redirect = true`), blocked Storage Access API auto-grants/headers, and tightened Bounce Tracking Protection (300s grace / 600s purge).
  - **Zero-Background-Chatter Defaults:** Connectivity & captive-portal probes disabled by default with a user-facing **Captive Portal Detection** toggle in Mercury Settings (Desktop & Android) for hotel/airport Wi-Fi.
  - **Native Ephemeral ("Burner") Tabs (Desktop):** Open isolated single-use tabs via `Ctrl+Alt+T`, right-click **"Open Link in Burner Tab"**, or optional **Auto-Burner** mode; automatically wipes cookies, storage, cache, and permissions when the last tab in a burner closes, with crash orphan sweeping and Private Browsing guards.
- **Unified Profile-Once Cross-PGO + Full/Cross-LTO + BOLT Pipeline:**
  - Single enriched Linux LLVM IR profile (`scripts/pgo-generate.sh` + local Canvas2D/JS/Wasm/DOM stress workload) reused across Linux, Windows cross-compile, and Android `arm64-v8a` via `scripts/build-release.sh`.
  - True Full / Cross-Language LTO (`--enable-lto=cross,full` with safe fallback to `--enable-lto=full`) and post-link Linux `llvm-bolt` layout optimization (`scripts/bolt-optimize.sh`) with automatic headless smoke-testing and rollback.

## Search, Packaging & MCP

- Google, Bing, eBay, and Perplexity remain removed from default search engines; **DuckDuckGo** is the default search engine.
- **Arch Linux / CachyOS:** `paru -S mercury-browser-v3-bin` (or install `mercury-browser-v3-bin-160.0.1.1-1-x86_64.pkg.tar.zst` directly with `sudo pacman -U`). Installs to `/opt/mercury`; launch with `mercury-browser`.
- **Windows:** NSIS installer (`mercury-160.0.1.1.en-US.win64.installer.exe`) and portable archive (`mercury-160.0.1.1.en-US.win64.zip`).
- **Android:** `arm64-v8a` APK with mirrored Mercury Settings, branding, and GeckoView privacy/speed defaults.
- **MCP Control:** Remains off unless launched with `--mcp` (see `mcp/README.md`).
