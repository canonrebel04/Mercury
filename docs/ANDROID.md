# Mercury for Android

## Architecture: Same `mozilla-unified` Tree vs. Separate Fork

Starting with Firefox 127+ (Mercury is based on Firefox `161.0`), Mozilla merged `firefox-android` (**Fenix**, **Android Components**, and **GeckoView**) directly into `mobile/android/` inside `mozilla-unified`:

- `mobile/android/geckoview/` — Gecko engine + Android bindings
- `mobile/android/android-components/` — shared browser components
- `mobile/android/fenix/` — Firefox for Android app shell & UI

Because of this monorepo layout, **there is no separate upstream `firefox-android` repository for Firefox 161**. Building Mercury for Android directly from `mozilla-unified/mobile/android/` using Mercury's existing patch and mozconfig pipeline is the cleanest and fastest approach:

1. **All Gecko engine speed & privacy patches are shared**:
   - Compiler optimizations (`-O3`, ThinLTO, `-ffp-contract=fast`, Rust SIMD, ARMv8.2-A `cortex-a76` tuning).
   - De-Google patches (`0027` removing Google SafeBrowsing & Geolocation providers from `all.js`, `0026` search selector, `0028` GMP install skip).
   - WebRender shader disk cache, accelerated 2D Canvas (`cache-items = 8192`), SpiderMonkey JIT thresholds (`baselinejit.threshold = 5`, `ion.threshold = 500`), WASM SIMD, and fast speculative networking.
   - Low-cost privacy defaults (`privacy.fingerprintingProtection = true` with `-JSMathFdlibm,-NavigatorHWConcurrencyTiered` so JS `Math.*` stays native-fast and multi-core worker pools aren't throttled, plus query stripping, referrer trimming, CRLite without OCSP, and zero telemetry).
2. **Android-specific preferences & Fenix patches** live in [`0036-android-geckoview-mercury-speed-privacy.patch`](../patches/firefox/0036-android-geckoview-mercury-speed-privacy.patch), which patches `mobile/android/app/geckoview-prefs.js` and Fenix's `FeatureFlags.kt`, `GeckoProvider.kt`, `SettingsFragment.kt`, and `Settings.kt`.

## Comparison with Mull, IronFox, and iodé Browser

| Feature | Mull (EOL) / IronFox | iodé Browser | Mercury Android |
|---|---|---|---|
| `about:config` in Release | Enabled | Enabled | **Enabled** (`GeckoProvider.kt`) |
| Custom AMO Extension Collections | Enabled | Enabled | **Enabled** without Secret Settings (`FeatureFlags.kt`, `SettingsFragment.kt`) |
| Query Parameter Stripping | Enabled | Enabled | **Enabled** in normal & private tabs (`GeckoProvider.kt`) |
| Telemetry, Nimbus Rollouts, Contile, Pocket, Fx Suggest | Stripped / Off | Stripped / Off | **Off by default** (`Settings.kt`, `FeatureFlags.kt`, `geckoview-prefs.js`) |
| Isolated App Zygote Processes | Supported | Standard | **Enabled** (`--enable-isolated-zygote-process`) |
| Zero-cost Fingerprinting Hardening (`webgl.enable-debug-renderer-info=false`, `beacon.enabled=false`, `dom.battery.enabled=false`) | Enabled | Partial | **Enabled** |
| JavaScript JIT (Baseline + Ion + WASM SIMD) | **Disabled in IronFox** (5–10× slower JS) | Enabled | **Enabled & tuned** (`baselinejit.threshold=5`, `ion.threshold=500`) |
| `privacy.fingerprintingProtection` | Full RFP / `JSMathFdlibm` (slower `Math.*`, UTC timezone) | Standard | **FPP enabled with `-JSMathFdlibm,-NavigatorHWConcurrencyTiered`** (fast native `Math.*` & full CPU cores) |
| Speculative Preconnect & Disk Cache | Disabled | Enabled | **Enabled** (faster page loads) |

## Building Android APK / GeckoView

1. **Bootstrap Android SDK/NDK & Rust target** (one-time):
   ```bash
   rustup target add aarch64-linux-android
   cd ~/mozilla-unified
   ./mach bootstrap --application-choice="GeckoView/Firefox for Android"
   ```
2. **Apply Mercury patches & Android mozconfig, then build**:
   ```bash
   cd ~/Mercury
   ./android/build-android.sh
   ```
   For x86_64 emulators/tablets:
   ```bash
   ./android/build-android.sh --x86_64
   ```
   Or manually:
   ```bash
   ./setup.sh --android
   ./build.sh
   ./package.sh
   ```

## Outputs
- Fenix APK(s): `$HG_SRC_DIR/obj-aarch64-unknown-linux-android/gradle/build/mobile/android/fenix/app/outputs/apk/`
- GeckoView AAR / dist artifacts: `$HG_SRC_DIR/obj-aarch64-unknown-linux-android/dist/`
