# Privacy tests

Tests for Mercury's default-on privacy prefs and Hardened mode
(see [docs/PRIVACY-OPTIONS.md](../../docs/PRIVACY-OPTIONS.md)).

## Unit test (no browser needed)

    node tests/privacy/hardened-unit.mjs

Runs `MercuryHardened.sys.mjs` against a mocked `Services.prefs`
(default/user/locked values): apply, restore, user overrides kept, locked prefs
skipped, DoH provider choice kept, clear-on-close migration order.

## Integration test (stock Firefox 159, headless)

Needs Node 18+, Python 3 and a stock Firefox **159.0.1** for Linux
(e.g. `https://archive.mozilla.org/pub/firefox/releases/159.0.1/linux-x86_64/en-US/`).

    python3 tests/privacy/make-test-browser.py /path/to/firefox /tmp/ff-mercury
    MERCURY_BIN=/tmp/ff-mercury/firefox node tests/privacy/integration.mjs

`make-test-browser.py` copies the stock browser and patches its `omni.ja`
files with Mercury's front-end changes: the prefs from patch 0003, BrowserGlue
(0024), the Settings UI (0029-0033), the Mercury modules and
`policies.json`. C++ patches and the de-Google `all.js` patch need a real
build and aren't included.

The test drives the browser over Marionette and checks the default-on prefs,
the uBO policy, that the Hardened module isn't loaded while off, turning
Hardened mode on and off (including user overrides), the Settings checkbox,
restarts, what pages see (timezone, WebGPU), and turning it on via `user.js`
before startup.
