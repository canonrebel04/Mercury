## Building <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_light.svg#gh-dark-mode-only"> <img src="https://github.com/Alex313031/Mercury/blob/main/logos/build_dark.svg#gh-light-mode-only">
_**The scripts assume the Mercury source is at $HOME/Mercury/ and Mozilla source is at $HOME/mozilla-unified/ (override with the HG_SRC_DIR env variable). Since Firefox moved to git in 2025, that directory must now be a git checkout of https://github.com/mozilla-firefox/firefox (`bootstrap.sh` creates one). You may have to 'sudo chmod +x' the scripts to make them executable.**_ 

- In general we follow build instructions at https://firefox-source-docs.mozilla.org/setup/linux_build.html
- `bootstrap.sh` can be used to download the Mozilla tree for the first time.
- `version.sh` syncs the Mozilla tree to the Firefox release tag Mercury is based on (currently `FIREFOX_159_0_1_RELEASE`).
- `tot.sh` syncs the Mozilla tree to trunk (`main`, Nightly) and `revert.sh` reverts all local changes in it.
- `setup.sh` applies Mercury's patches from `patches/firefox/` (failing loudly if one doesn't apply) and copies Mercury-only files over the Mozilla tree. *NOTE: Use the --help flag to see options for Linux and Windows*
- To build, run `./build.sh` (--help for help). *The -j# variable can be changed to limit or increase the number of jobs (generally should be the number of CPU cores on your machine)*


*Happy Mercury Building!*

<img src="https://github.com/Alex313031/Mercury/blob/main/logos/geckoview.svg" width="144">
