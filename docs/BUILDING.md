## Building <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_light.svg#gh-dark-mode-only"> <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_dark.svg#gh-light-mode-only">
_**The scripts assume the Mercury source is at $HOME/Mercury/ and Mozilla source is at $HOME/mozilla-unified/ (override with the HG_SRC_DIR env variable). Since Firefox moved to git in 2025, that directory must now be a git checkout of https://github.com/mozilla-firefox/firefox (`bootstrap.sh` creates one). You may have to 'sudo chmod +x' the scripts to make them executable.**_ 

- In general we follow build instructions at https://firefox-source-docs.mozilla.org/setup/linux_build.html
- `bootstrap.sh` can be used to download the Mozilla tree for the first time.
- `version.sh` syncs the Mozilla tree to the Firefox release tag Mercury is based on (currently `FIREFOX_160_0_1_RELEASE`).
- `tot.sh` syncs the Mozilla tree to trunk (`main`, Nightly) and `revert.sh` reverts all local changes in it.
- `setup.sh` applies Mercury's patches from `patches/firefox/` (failing loudly if one doesn't apply) and copies Mercury-only files over the Mozilla tree. *NOTE: Use the --help flag to see options for Linux and Windows*
- To build, run `./build.sh` (--help for help). *The -j# variable can be changed to limit or increase the number of jobs (generally should be the number of CPU cores on your machine)*
- The default build uses PGO + LTO. The profiling run serves the training corpus on ports **8888** and **8000** (and **8001** if you use an extended corpus). If those ports are already taken on your machine, leave the defaults and set these instead before `./build.sh`:
  - `MERCURY_PGO_PORT` (default 8888)
  - `MERCURY_PGO_SP3_PORT` (default 8000)
  - `MERCURY_PGO_JS3_PORT` (default 8001, extended corpus only)
  Example: `export MERCURY_PGO_PORT=18888 MERCURY_PGO_SP3_PORT=18000`


### Windows (Native & Cross-Compile from Linux)
- **Cross-compiling from Linux (`--cross-avx2` / `--cross`):**
  - Target is `x86_64-pc-windows-msvc` using `clang-cl` + `lld-link` and Mozilla's bootstrapped Windows SDK/MSVC sysroot (`vs`), `dxc`, `wine`, and `nsis`.
  - Install the Rust Windows target once: `rustup target add x86_64-pc-windows-msvc`
  - Run `./setup.sh --cross-avx2` (or `--cross`), then `./build.sh` and `./package.sh`.
  - Outputs in `$HG_SRC_DIR/obj-x86_64-pc-windows-msvc/dist/`:
    - Installer: `install/sea/mercury-<version>.en-US.win64.installer.exe`
    - Portable zip: `mercury-<version>.en-US.win64.zip`
- **Native Windows build (MozillaBuild + VS 2022+):**
  - Run `./setup.sh --win-avx2` (or `--win`, `--win-sse4`, `--win-sse3`), then `./build.sh` and `./package.sh`.
  - `--with-redist` is enabled in the Windows mozconfigs so MSVC CRT DLLs are automatically bundled.

### macOS
- Firefox 160 requires the **macOS 26.5 SDK or newer** (Xcode 26.5+ for native builds).
- Cross-compiling from Linux (`./setup.sh --mac-cross` / `--mac-arm-cross`): put the SDK somewhere and export `MERCURY_MACOS_SDK=/path/to/MacOSX26.5.sdk` before building. If unset, the mozconfigs use `$HOME/macos-sdk/MacOSX26.5.sdk`. See https://firefox-source-docs.mozilla.org/widget/cocoa/sdks.html.
- The macOS app icon (`browser/branding/mercury/Assets.car`) can only be compiled on a Mac: run `infra/make_assets_car.sh` there and commit the result. Until then `setup.sh` makes the build use `firefox.icns` only.

### Android
- Mercury for Android builds GeckoView + Fenix directly from `$HG_SRC_DIR/mobile/android/` using `./setup.sh --android` (arm64-v8a) or `./android/build-android.sh`. See [ANDROID.md](ANDROID.md) for details.


*Happy Mercury Building!*

<img src="https://github.com/Alex313031/Mercury/blob/main/logos/geckoview.svg" width="144">
