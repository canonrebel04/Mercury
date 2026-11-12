## Building <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_light.svg#gh-dark-mode-only"> <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_dark.svg#gh-light-mode-only">
_**The scripts assume the Mercury source is at $HOME/Mercury/ and Mozilla source is at $HOME/mozilla-unified/ (override with the HG_SRC_DIR env variable). Since Firefox moved to git in 2025, that directory must now be a git checkout of https://github.com/mozilla-firefox/firefox (`bootstrap.sh` creates one). You may have to 'sudo chmod +x' the scripts to make them executable.**_ 

- In general we follow build instructions at https://firefox-source-docs.mozilla.org/setup/linux_build.html
- `bootstrap.sh` can be used to download the Mozilla tree for the first time.
- `version.sh` syncs the Mozilla tree to the Firefox release tag Mercury is based on (currently `FIREFOX_160_0_RELEASE`).
- `tot.sh` syncs the Mozilla tree to trunk (`main`, Nightly) and `revert.sh` reverts all local changes in it.
- `setup.sh` applies Mercury's patches from `patches/firefox/` (failing loudly if one doesn't apply) and copies Mercury-only files over the Mozilla tree. *NOTE: Use the --help flag to see options for Linux and Windows*
- To build, run `./build.sh` (--help for help). *The -j# variable can be changed to limit or increase the number of jobs (generally should be the number of CPU cores on your machine)*


### macOS
- Firefox 160 requires the **macOS 26.5 SDK or newer** (Xcode 26.5+ for native builds).
- Cross-compiling from Linux (`./setup.sh --mac-cross` / `--mac-arm-cross`): put the SDK somewhere and export `MERCURY_MACOS_SDK=/path/to/MacOSX26.5.sdk` before building. If unset, the mozconfigs use `$HOME/macos-sdk/MacOSX26.5.sdk`. See https://firefox-source-docs.mozilla.org/widget/cocoa/sdks.html.
- The macOS app icon (`browser/branding/mercury/Assets.car`) can only be compiled on a Mac: run `infra/make_assets_car.sh` there and commit the result. Until then `setup.sh` makes the build use `firefox.icns` only.


*Happy Mercury Building!*

<img src="https://github.com/Alex313031/Mercury/blob/main/logos/geckoview.svg" width="144">
