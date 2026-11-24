## Building <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_light.svg#gh-dark-mode-only"> <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_dark.svg#gh-light-mode-only">
_**The scripts assume the Mercury source is at `$HOME/Mercury/` and Mozilla source is at `$HOME/mozilla-unified/` (override with the `HG_SRC_DIR` env variable). Since Firefox moved to git in 2025, that directory must be a git checkout of https://github.com/mozilla-firefox/firefox (`bootstrap.sh` creates one).**_

- In general we follow build instructions at https://firefox-source-docs.mozilla.org/setup/linux_build.html
- `bootstrap.sh` downloads the Mozilla source tree for the first time.
- `version.sh` syncs the Mozilla tree to the Firefox release tag Mercury is based on (currently `FIREFOX_161_0_RELEASE`).
- `tot.sh` syncs the Mozilla tree to trunk (`main`, Nightly) and `revert.sh` reverts all local changes in it.
- `setup.sh` applies Mercury's patches from `patches/firefox/` (failing loudly if one doesn't apply), copies Mercury-only files over the Mozilla tree, and installs the selected mozconfig (`./setup.sh --help`).
- Full design specification: [2026-11-23-build-toolchain-speed-design.md](superpowers/specs/2026-11-23-build-toolchain-speed-design.md).

---

### Unified Profile-Once Cross-PGO + Full/Cross-LTO + BOLT Release Pipeline

From a single Linux `x86_64` host, Mercury builds maximum-speed release binaries for **Linux `x86_64` (`x86-64-v3`)**, **Windows `x86_64` (`x86-64-v3` cross-compile)**, and **Android `arm64-v8a`** using one shared LLVM IR PGO profile:

```bash
# Build all 3 platforms (generates build-artifacts/pgo/merged.profdata once, then builds + BOLTs Linux + packages all 3)
./scripts/build-release.sh --targets linux,win,android

# Reuse an existing PGO profile (skips Stage 1 profiling)
./scripts/build-release.sh --targets linux,win,android --pgo-profile "$PWD/build-artifacts/pgo/merged.profdata"

# Fast developer iteration (disables PGO, LTO, BOLT, geckodriver; -O2; Rust codegen-units=16)
./scripts/build-release.sh --targets linux --fast
# Or directly with build.sh:
./setup.sh --avx2 && ./build.sh --fast
```

#### Pipeline Scripts
- `scripts/pgo-generate.sh` — Builds an instrumented native Linux `x86_64` binary (`--enable-profile-generate=cross`), runs the enriched `build/pgo/profileserver.py` corpus (including Mercury's local Canvas2D + JS/Wasm + DOM/Layout stress workload from `0041-mercury-pgo-workload.patch`), merges profraws with toolchain-matched `llvm-profdata`, and outputs `build-artifacts/pgo/merged.profdata`, `en-US.log`, and `manifest.json`.
- `scripts/bolt-optimize.sh` — Runs `llvm-bolt` on `dist/bin/libxul.so` (after `./mach build` and before `./mach package`) using **BOLT instrumentation mode by default** (no `perf`, LBR hardware, or root required; pass `--perf` for hardware LBR sampling), optimizes with `--reorder-blocks=ext-tsp --reorder-functions=cdsort --split-functions --split-all-cold --icf=1 --use-gnu-stack --dyno-stats`, runs a headless startup smoke test, and automatically rolls back to `.pre-bolt` on any error.
- `scripts/build-release.sh` — End-to-end orchestrator (`--targets`, `--pgo-profile`, `--no-pgo`, `--no-bolt`, `--bolt-mode`, `--lto`, `--fast`, `--android-bolt-adb`, `--dry-run`).
- `scripts/bench-verify.sh` — Static pipeline verifier (`--static`), ELF/PE binary inspector (`--inspect <libxul.so>`), and A/B headless startup latency benchmark (`--bench <cand> --baseline <base>`).

#### Environment Variables (Mozconfig Controls)
All primary release mozconfigs (`mozconfig-avx2`, `mozconfig-win-avx2`, `mozconfig-win-avx2-cross`, `mozconfig-android-arm64`) honor:
- `MERCURY_FAST_BUILD=1` — Fast dev mode (no PGO/LTO/BOLT/geckodriver, `-O2`, Rust `codegen-units=16`).
- `MERCURY_PGO_PROFILE=/abs/path/to/merged.profdata` — Single-pass Cross-PGO (`--enable-profile-use=cross` + `--with-pgo-profile-path=...`).
- `MERCURY_PGO_JARLOG=/abs/path/to/en-US.log` — Optional omni.ja startup jarlog.
- `MERCURY_PGO_MODE=auto|cross|cpp` — Defaults to `cross` when Clang & `rustc` share LLVM major version, else `cpp`.
- `MERCURY_LTO_MODE=auto|cross,full|full|thin|off` — Explicitly passes `--enable-lto=...` (eliminating Firefox's silent non-automation ThinLTO fallback). Defaults to `cross,full` when Clang & `rustc` LLVM majors match, else `full`.
- `MERCURY_BOLT=1` — Appends `-Wl,--emit-relocs` on ELF targets (Linux / optional Android) so `llvm-bolt` can relocate `.text`.
- `MOZ_MAKE_FLAGS="-j#"` — Parallel build job count (defaults to `nproc`).
- `MERCURY_PGO_PORT` (default `8888`), `MERCURY_PGO_SP3_PORT` (default `8000`), `MERCURY_PGO_JS3_PORT` (default `8001`), `MERCURY_PGO_AUTO_PORT=1` — Override or auto-select PGO HTTP ports if defaults are occupied.

---

### Per-Platform Quick Reference

#### Linux (`--avx2`, `--sse4`, `--sse3`, `--arm64`)
- Native single-command build (runs 2-phase PGO + Full/Cross-LTO automatically when `MERCURY_PGO_PROFILE` is unset):
  ```bash
  ./setup.sh --avx2 && ./build.sh && ./package.sh
  ```
- With shared Cross-PGO + BOLT:
  ```bash
  export MERCURY_PGO_PROFILE="$PWD/build-artifacts/pgo/merged.profdata"
  export MERCURY_BOLT=1
  ./setup.sh --avx2 && ./build.sh && ./scripts/bolt-optimize.sh && ./package.sh
  ```

#### Windows (Cross-Compile from Linux & Native)
- **Cross-compiling from Linux (`--cross-avx2` / `--cross`):**
  - Target is `x86_64-pc-windows-msvc` using `clang-cl` + `lld-link` (`x86-64-v3` C++ & Rust parity, `-mllvm:-import-instr-limit=45`, `lld-link` call-graph profile sorting + Ext-TSP block placement) and Mozilla's bootstrapped Windows SDK/MSVC sysroot (`vs`), `dxc`, `wine`, and `nsis`.
  - Install the Rust Windows target once: `rustup target add x86_64-pc-windows-msvc`
  - Run with Cross-PGO:
    ```bash
    MERCURY_PGO_PROFILE="$PWD/build-artifacts/pgo/merged.profdata" ./setup.sh --cross-avx2 && \
    MERCURY_PGO_PROFILE="$PWD/build-artifacts/pgo/merged.profdata" ./build.sh && ./package.sh
    ```
  - Outputs in `$HG_SRC_DIR/obj-x86_64-pc-windows-msvc/dist/`:
    - Installer: `install/sea/mercury-<version>.en-US.win64.installer.exe`
    - Portable zip: `mercury-<version>.en-US.win64.zip`
- **Native Windows build (MozillaBuild + VS 2022+):**
  - Run `./setup.sh --win-avx2` (or `--win`, `--win-sse4`, `--win-sse3`), then `./build.sh` and `./package.sh`.
  - `--with-redist` is enabled so MSVC CRT DLLs are automatically bundled.

#### Android (`--android` / `--android-x86_64`)
- Mercury for Android builds GeckoView + Fenix (`arm64-v8a` with ARMv8.2 `+fp16,+rcpc,+dotprod,+crypto` C++ & Rust parity) directly from `$HG_SRC_DIR/mobile/android/`:
  ```bash
  rustup target add aarch64-linux-android
  MERCURY_PGO_PROFILE="$PWD/build-artifacts/pgo/merged.profdata" ./scripts/build-release.sh --targets android
  ```
- Optional on-device BOLT pass: pass `--android-bolt-adb` when an `arm64-v8a` device is connected via `adb` (skips cleanly if no device is attached). See [ANDROID.md](ANDROID.md) for additional Android details.

#### macOS
- Firefox 161 requires the **macOS 26.5 SDK or newer** (Xcode 26.5+ for native builds).
- Cross-compiling from Linux (`./setup.sh --mac-cross` / `--mac-arm-cross`): export `MERCURY_MACOS_SDK=/path/to/MacOSX26.5.sdk` before building (default: `$HOME/macos-sdk/MacOSX26.5.sdk`).
- The macOS app icon (`browser/branding/mercury/Assets.car`) must be compiled on a Mac via `infra/make_assets_car.sh`; until then `setup.sh` falls back to `firefox.icns`.

*Happy Mercury Building!*

<img src="https://github.com/Alex313031/Mercury/blob/main/logos/geckoview.svg" width="144">
