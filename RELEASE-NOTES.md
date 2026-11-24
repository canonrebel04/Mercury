# Mercury 161.0 (unreleased)

Rebased onto Firefox `FIREFOX_161_0_RELEASE` (`161.0`), which fixes the
security bugs in [MFSA 2026-131](https://www.mozilla.org/en-US/security/advisories/mfsa2026-131/)
(rated high). Everything from Mercury 160.0.1.1 carries over.

- Patches refreshed for Firefox 161: `0003` (context only), `0034` and `0041`
  (Firefox 161's new PGO driver that closes benchmarks when they report done;
  the port overrides and the 15 s Mercury workload are kept), `0036`
  (Android search config v2/v3 split, multi-item account menu provider,
  onboarding haptics flag), `0038` (new `default-browser.mjs` jar entry).
- Dropped `0039-mercury-version-bump.patch`: the version is now Firefox's own
  `161.0`. Re-add a bump patch for a Mercury-only respin (e.g. `161.0.0.1`).
- Removed `security.sandbox.socket.process.level`,
  `security.sandbox.socket.win32k-disable` and
  `security.sandbox.socket.shadow-stack.enabled` from `0003`: Firefox 161
  removed the socket process, so these prefs no longer exist.

# Mercury 160.0.1.1

Built from Firefox `FIREFOX_160_0_1_RELEASE` (`160.0.1`) for **Linux `x86-64-v3` (AVX2)**, **Windows `x86-64-v3` (AVX2)**, and **Android `arm64-v8a`**.

## Highlights

- **Dedicated Mercury Settings Tab (Desktop & Android Parity):**
  - First-class **Mercury** settings pane (`about:preferences#mercury` on Desktop; **Settings > Mercury** on Android) with full Settings search integration.
  - Controls for **Hardened Mode** (`mercury.hardened.enabled`, with Preserve System Theme under RFP), **Security Levels** (`Standard` / `Safer` / `Safest`), **Performance & Memory Profiles** (`Balanced` / `Turbo` / `Low-RAM`), one-click **New Identity**, **Trusted JIT & WebAssembly Sites** allowlist, **Parent-Process JIT Killswitch**, **Strict Fission Site Isolation**, **Captive Portal Detection**, **Rust Fontations Font Engine**, DoH provider selection, and individual toggles for WebRTC, WebGL, WebGPU, DRM (Widevine), Beacons/Pings, Speculative Prefetching, Punycode IDN, Query Parameter Stripping, Built-in AI controls, Update Check Notifications, and Hardware Acceleration / WebRender / GPU Canvas2D.
- **Zero Firefox Accounts & Terms-of-Use Prompts by Default (Desktop & Android):**
  - Firefox Accounts / Sync sign-in buttons, toolbar/AppMenu/Sidebar/Settings entries, and background `WeaveService` sync tasks are disabled by default (`DisableFirefoxAccounts: true`, `identity.fxaccounts.enabled = false`).
  - Firefox Terms of Use, Privacy Notice "Agree" modals/infobars, pre-onboarding splash screens, and marketing/welcome tabs are suppressed by default (`SkipTermsOfUse: true`, `SkipOnboarding: true`).
- **Next-Level Privacy, Anti-Fingerprinting & Native Burner Tabs:**
  - **Upgraded 36-Target Crowd-Blend FPP:** Expanded `privacy.fingerprintingProtection.overrides` across WebGL, Canvas third-party extraction, AudioContext, MediaCapabilities, WebCodecs, DiskStorageLimit, native colors, screen/window/mouse metrics, CSS media features, and PDF.js while preserving native JS `Math` speed and system dark/light theme; Mozilla RemoteSettings FPP overrides disabled (`privacy.fingerprintingProtection.remoteOverrides.enabled = false`).
  - **Link, Storage & Bounce Defenses:** Curated ~65-parameter redirect query-parameter stripping (`privacy.query_stripping.redirect = true`), blocked Storage Access API auto-grants/headers, and tightened Bounce Tracking Protection (300s grace / 600s purge).
  - **Zero-Background-Chatter Defaults:** Connectivity & captive-portal probes disabled by default with a user-facing **Captive Portal Detection** toggle in Mercury Settings (Desktop & Android) for hotel/airport Wi-Fi.
  - **Native Ephemeral ("Burner") Tabs (Desktop):** Open isolated single-use tabs via `Ctrl+Alt+T`, right-click **"Open Link in Burner Tab"**, or optional **Auto-Burner** mode; automatically wipes cookies, storage, cache, and permissions when the last tab in a burner closes, with crash orphan sweeping and Private Browsing guards.
- **Hardcore Security & Exploit Mitigations (Desktop & Android):**
  - **Compiler & Binary Hardening:** `-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3` + `-fcf-protection=branch` (Intel CET IBT) on Linux `x86_64` release builds; `-D_FORTIFY_SOURCE=3` + `-mbranch-protection=standard` (ARM64 PAC+BTI) on Linux `arm64`; `-mbranch-protection=standard` on Android `arm64-v8a`.
  - **OS Sandbox, Fission & Transport Hardening:** Parent-process JIT disabled (`javascript.options.main_process_disable_jit = true`), W^X JIT code protection (`javascript.options.content_process_write_protect_code = true`), Fission `IsolateEverything` (`fission.webContentIsolationStrategy = 1`), Linux content sandbox level 6 + socket level 2 + GPU level 1, Windows Win32k lockdown + CET Shadow Stack + ACG + CIG prespawn + ksecdd handle close, TLS 1.2+ minimum with safe renegotiation, blocked mixed display content, and disabled CSP telemetry reporting.
  - **Vanadium-Style Per-Site JIT/WASM Allowlisting (`0043`):** Run Mercury in `Safer` or `Safest` (no-JIT/no-WASM globally) while selectively re-enabling JIT & WebAssembly on exact trusted `webIsolated=`/`webCOOP+COEP=` origins via `mercury.security.jitAllowlist` (with OriginAttributes `^` stripping, default-port canonicalization, zero wildcard/suffix spoofing, and live `ContentChild::RecvSetRemoteType` hook).
- **Rust-First Engine, Rendering & Runtime Speed (`0044`):**
  - **Pure-Rust Canvas2D GPU Tessellators (`mercury_canvas_accel.rs`):** Zero-heap-alloc, bounds-checked Rust tessellators for cubic Bezier curves, stroked circles, polylines, and stroked rounded rects wired into `DrawTargetWebgl` so heavy vector workloads stay on GPU.
  - **Pure-Rust Font & Compression Engines:** `--enable-fontations` (`gfx.font_rendering.fontations.enabled = true`) and `USE_LIBZ_RS=1` (pure-Rust SIMD `zlib-rs`) enabled across all 17 release mozconfigs.
  - **Wasm, WebRender, HTTP/3 & Process Tuning:** Wasm lazy tiering + x86_64 AVX SIMD (`wasm_simd_avx`, desktop only), WebRender layer compositor + 512 KB batched uploads + 32-surface pool, HTTP/3 GSO (`max_gso_segments = 16`, 4 MB desktop / 2 MB Android recv buffer) with QUIC 0-RTT disabled (`enable_0rtt = false`) to close replay attacks, Fission process prelaunch (`4`), and switchable `MercuryPerformance.sys.mjs` profiles (`Balanced` / `Turbo` / `Low-RAM`).
- **Unified Profile-Once Cross-PGO + Full/Cross-LTO + BOLT Pipeline:**
  - Single enriched Linux LLVM IR profile (`scripts/pgo-generate.sh` + local Canvas2D/JS/Wasm/DOM stress workload) reused across Linux, Windows cross-compile, and Android `arm64-v8a` via `scripts/build-release.sh`.
  - True Full / Cross-Language LTO (`--enable-lto=cross,full` with safe fallback to `--enable-lto=full`) and post-link Linux `llvm-bolt` layout optimization (`scripts/bolt-optimize.sh`) with automatic headless smoke-testing and rollback.

## Search, Packaging & MCP

- Google, Bing, eBay, and Perplexity remain removed from default search engines; **DuckDuckGo** is the default search engine.
- **Arch Linux / CachyOS:** `paru -S mercury-browser-v3-bin` (or install `mercury-browser-v3-bin-160.0.1.1-1-x86_64.pkg.tar.zst` directly with `sudo pacman -U`). Installs to `/opt/mercury`; launch with `mercury-browser`.
- **Windows:** NSIS installer (`mercury-160.0.1.1.en-US.win64.installer.exe`) and portable archive (`mercury-160.0.1.1.en-US.win64.zip`).
- **Android:** `arm64-v8a` APK with mirrored Mercury Settings, branding, and GeckoView security/privacy/speed defaults.
- **MCP Control:** Remains off unless launched with `--mcp` (see `mcp/README.md`).
