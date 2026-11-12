# Privacy options

**Status: implemented** (the proposal below was approved). Mercury now turns on
the cheap privacy items by default and adds one optional **Hardened mode**
switch for the costly ones. The first two sections describe what is in the
browser; the rest of the document is the original review of
[LibreWolf](https://codeberg.org/librewolf) and
[Camoufox](https://github.com/daijro/camoufox) features that led to it.

## On by default

These are ordinary default prefs in the Mercury block of
`browser/app/profile/firefox.js` (patch `0003`) plus one policy. You can still
change any of them in `about:config`, and Settings still shows tracking
protection as "Standard", because only defaults change.

| Pref / policy | Value | What it does |
|---|---|---|
| `privacy.fingerprintingProtection` | `true` | Firefox's fingerprinting protection (FPP) in normal windows too, not only private ones (#1) |
| `dom.webgpu.enabled` | `false` | WebGPU off (#5) |
| `network.http.referer.XOriginTrimmingPolicy` | `2` | Other sites only get the origin (`https://example.com/`) as referer (#10) |
| `media.peerconnection.ice.proxy_only_if_behind_proxy` | `true` | When a proxy is set, WebRTC goes through it and can't leak your IP (#11) |
| `security.OCSP.enabled` | `0` | No OCSP requests; revocation is checked with CRLite (#12b, see below) |
| `privacy.query_stripping.enabled` / `.pbmode` | `true` | Known tracking parameters are removed from URLs in normal and private windows (#18) |
| `pdfjs.enableScripting` | `false` | No JavaScript in PDFs (#26) |
| `browser.helperApps.deleteTempFileOnExit` | `true` | Files opened in other apps are deleted on exit, on macOS too (#29) |
| policy `ExtensionSettings` → `uBlock0@raymondhill.net` | `"private_browsing": true` | uBlock Origin also runs in private windows (#23). Because a policy sets it, the "Run in private windows" switch for uBO is locked on. |

**OCSP and CRLite.** Firefox 159 has CRLite in enforce mode
(`security.pki.crlite_mode=2`) with the full revocation set, and with
enforcing CRLite it already skips OCSP for ordinary (DV) certificates from
built-in roots. Turning OCSP off therefore only changes two cases:
EV certificates and certificates from private or enterprise CAs (which
CRLite doesn't cover). Those no longer get a revocation check; OCSP responses
stapled by the server are still checked. In return Mercury never tells a CA
which sites you visit. If you rely on a company CA with revocation, set
`security.OCSP.enabled` back to `1`.

## Hardened mode (optional, off by default)

One switch for people who want LibreWolf-level protection and accept that some
sites break: **Settings > Privacy & Security > Hardened mode > "Use Hardened
mode"**, or the pref `mercury.hardened.enabled`. Restart Mercury after
switching so every open page and window picks it up (newly loaded pages get
most of it right away).

When it's on:

| Setting | Pref(s) |
|---|---|
| ResistFingerprinting (RFP): timezone reported as UTC+0 (`Atlantic/Reykjavik` in Firefox 159), coarse timers, rounded window sizes, light theme, canvas-read prompt, restricted fonts, English locale for pages | `privacy.resistFingerprinting` |
| Letterboxing | `privacy.resistFingerprinting.letterboxing` |
| Delete cookies and site data (and the cache) when Mercury closes. History, form data and site settings are kept. Sites you add under "Manage Exceptions..." keep their cookies. | `privacy.sanitize.sanitizeOnShutdown`, `privacy.clearOnShutdown_v2.*` |
| Tracking protection: Strict | `browser.contentblocking.category` |
| HTTPS-Only mode | `dom.security.https_only_mode` |
| DNS over HTTPS, "Increased protection" (falls back to normal DNS if DoH fails). Default provider Quad9 (`https://dns.quad9.net/dns-query`), never Google. If you already chose a provider or "Max protection", that choice is kept. To use another provider by default, set `mercury.hardened.doh.uri` (e.g. `https://dns.mullvad.net/dns-query`) or pick one in Settings > Privacy & Security > DNS over HTTPS. | `network.trr.mode=2`, `network.trr.uri`, `network.trr.custom_uri` |
| No speculative connections from the address bar or bookmarks | `browser.urlbar.speculativeConnect.enabled`, `browser.places.speculativeConnect.enabled` |
| Internationalized domains shown as punycode (`xn--...`) | `network.IDN_show_punycode` |

How it works (`browser/components/mercury/MercuryHardened.sys.mjs`):

- **No cost while off.** At startup Mercury reads one pref and adds one pref
  observer. The module is loaded only when the switch changes (or at startup
  if the switch and the saved state disagree, e.g. you edited `user.js`).
- **Turning it on** sets only prefs that aren't already at the hardened value
  and records what it changed (and the previous user value, if there was one)
  in `mercury.hardened.state`.
- **Turning it off** restores only the prefs it changed **and that you haven't
  changed since**. If you, for example, kept HTTPS-Only on by hand or picked
  a different DoH provider while Hardened mode was on, those stay as you set
  them. Locked prefs (enterprise policy) are never touched.
- Limits: if tracking protection was "Custom" before, turning Hardened mode off
  returns to "Standard" (Firefox can't restore a custom set from the category
  pref alone). After turning off clear-on-close, data that was already
  deleted doesn't come back.

**Extra uBlock Origin lists** (AdGuard URL Tracking Protection, the
EasyList/Fanboy cookie-notice and annoyance lists) aren't part of Hardened
mode. uBO's list choice comes from a static policy (managed storage), so a pref
switch can't add and remove them cleanly. To add them: uBO dashboard > Filter
lists > "Privacy" and "Cookie notices"/"Annoyances", tick the lists, Apply.

**Tests:** `node tests/privacy/hardened-unit.mjs` (unit test with mocked prefs)
and `tests/privacy/integration.mjs`, which runs a stock Firefox 159 with
Mercury's prefs, policy, module and Settings patches (see
[tests/privacy/README.md](../tests/privacy/README.md)).

---

# Original review (approved proposal)

Sources reviewed (November 2026):
- LibreWolf settings, `librewolf.cfg` v8.6 and `distribution/policies.json`
  ([codeberg.org/librewolf/settings](https://codeberg.org/librewolf/settings), commit 590dd1c)
- LibreWolf source patches ([codeberg.org/librewolf/source](https://codeberg.org/librewolf/source),
  commit e63514c, Firefox 160)
- Camoufox `browser/patches/` and README (commit fe3a3f7)
- Firefox 159.0.1 defaults (`StaticPrefList.yaml`, `all.js`, `firefox.js`)

All three projects are MPL-2.0, the same license as Mercury, so prefs or
patches could be reused with attribution.

## Why LibreWolf feels slower and breaks sites

Most of the cost comes from a few defaults. The rest of LibreWolf's list is
cheap.

1. **No disk cache** (`browser.cache.disk.enable=false`). Every restart starts
   with a cold cache, so all scripts, images and fonts are downloaded again.
   This is the biggest speed cost.
2. **ResistFingerprinting (RFP) on.** It reports UTC as the timezone, makes
   timers coarser, forces the light theme, rounds window sizes, prompts before
   canvas reads and limits fonts. This is behind most breakage reports:
   calendar times are wrong, sites ignore dark mode, and some sites detect it
   as a bot.
3. **Cookies and site data are deleted on close**
   (`privacy.sanitize.sanitizeOnShutdown=true`). You're logged out everywhere
   after each restart, and caches and service workers start empty.
4. **ETP Strict.** Embedded social posts, some logins and some comment
   widgets break until you turn protection off for that site.
5. **No speculative connections** (address bar and bookmarks): each navigation
   waits one more round trip before the connection is ready.

Mercury can get most of LibreWolf's privacy by adopting the cheap items and
offering the five above only as opt-in toggles.

## What Mercury already had (after the `degoogle` branch, before this change)

These are already done and aren't counted again below:

- **Tracking protection.** ETP Standard with Total Cookie Protection
  (`network.cookie.cookieBehavior=5`, network state partitioning), blocking of
  known fingerprinters and cryptominers, bounce-tracking protection, and
  baseline fingerprinting protection (Firefox defaults).
  `privacy.fingerprintingProtection` is on in private windows.
- **HTTPS and certificates.** HTTPS-First (Firefox default) and CRLite in
  enforce mode (`security.pki.crlite_mode=2`, Firefox default).
- **No Google.** No Safe Browsing or Google geolocation, and DuckDuckGo is the
  default search engine (see [DEGOOGLE.md](DEGOOGLE.md)).
- **No data collection.** Telemetry, studies, Nimbus, crash auto-submit,
  sponsored content and AI features are off.
- **Privacy signals.** DNT and Global Privacy Control headers are sent.
- **No prefetching.** DNS prefetch, link prefetch (`network.prefetch-next`),
  the network predictor and `speculative-parallel-limit` (hover preconnects)
  are all off.
- **Widevine/DRM** is off by default and opt-in.
- **uBlock Origin** is installed by policy and uses its default filter lists.

## Summary

Performance cost: **none / small / significant**. Breakage: **none / some / high**.
Recommendation: **ON** = on by default in Mercury; **OPT** = optional toggle,
off by default; **SKIP** = not worth adding.

| # | Feature | From | Perf cost | Breakage | Privacy benefit | Rec. |
|---|---|---|---|---|---|---|
| 1 | Fingerprinting protection (FPP) in normal windows | LW (via Strict), Firefox | small | some | medium | **ON** |
| 2 | ResistFingerprinting (RFP) | LW | small | high | high (uniformity) | **OPT** |
| 3 | Letterboxing | LW, Tor | none | some | low alone, medium with RFP | **OPT** (with RFP) |
| 4 | WebGL off | old LW, arkenfox | significant on 3D/map sites | high | medium | **SKIP**; maybe a per-site prompt later |
| 5 | WebGPU off | LW | none | some | low–medium | **ON** (Linux already off) |
| 6 | Canvas-read prompt | LW patch, RFP | none | some | medium–high | **OPT** (with RFP) |
| 7 | Delete cookies/site data on close | LW | small | high (logins) | high vs long-term tracking | **OPT** (UI already exists) |
| 8 | Disable disk cache | LW | **significant** | none | low (cache already partitioned) | **SKIP** |
| 9 | DNS-over-HTTPS | LW (preset, off), Firefox | none–small | some | medium | **OPT**; ON already in DoH-rollout regions |
| 10 | Cross-origin referer trimming | LW | none | low | low–medium | **ON** |
| 11 | WebRTC: proxy-only when a proxy is set | LW | none | low | medium (proxy/VPN users) | **ON** |
| 12 | OCSP: hard-fail | arkenfox | small–significant | some | negative (leaks visits to CAs) | **SKIP** |
| 12b | OCSP off, rely on CRLite | LW | slightly faster | low | medium | **ON** |
| 13 | Disable JIT (Ion/Baseline) | LW per-site toggle, hardening guides | **significant** (JS 2–10× slower) | some | none (security only) | **SKIP** default; per-site toggle **OPT** later |
| 14 | Disable WebAssembly | hardening guides | n/a | high | none (security only) | **SKIP** |
| 15 | Font visibility restriction | LW (RFP), FPP | none | some (non-Latin text, local fonts) | medium | **OPT** (in "Strict" preset) |
| 16 | Timezone/locale spoofing | LW (RFP), Camoufox | none | high | medium | **SKIP** standalone (only via RFP) |
| 17 | First-Party Isolation | old LW, Tor | none | high | marginal over TCP | **SKIP** |
| 18 | Query-parameter stripping (normal and private windows) | LW (Strict) | none | low | medium | **ON** |
| 19 | ETP Strict | LW | none (fewer trackers) | some | medium | **OPT** (one click in Settings) |
| 20 | HTTPS-Only mode | LW (policy) | none | some | medium | **OPT** (UI exists) |
| 21 | Address-bar and bookmark speculative connections off | LW | small (≈1 RTT per navigation) | none | low–medium | **OPT** |
| 22 | Early-hints preconnect off | LW | small | none | low | **SKIP** |
| 23 | uBO: also enable in private windows | LW | none | none | medium | **ON** |
| 24 | Extra uBO lists (URL-tracking, annoyances) | LW/users | small | some (annoyances) | low–medium | **OPT** (user picks in uBO) |
| 25 | Punycode for internationalized domains | LW | none | low (non-Latin domains look odd) | anti-phishing | **OPT** |
| 26 | PDF.js scripting off | LW | none | low | security | **ON** |
| 27 | TLS 0-RTT off | LW | small (1 RTT on resumption) | none | low | **SKIP** |
| 28 | Form history / password saving off | LW | none | UX only | local only | **SKIP** (user setting) |
| 29 | Delete temp files opened with external apps on exit | LW | none | none | local only | **ON** |
| 30 | Clear the alt-svc cache when the HTTP cache is cleared | LW patch | none | none | low | **OPT** (comes with #7) |
| 31 | OS geolocation providers off | LW | none | geolocation stops working | low (still a prompt) | **SKIP** |
| 32 | Captive-portal / connectivity checks off | LW | none | hotel/airport Wi-Fi logins not detected | low (contacts Mozilla) | **OPT** |
| 33 | Push service connects only when a site uses push | Camoufox patch | tiny gain | none | low–medium | **OPT** later (patch) |
| 34 | Camoufox fingerprint *spoofing* (fake device) | Camoufox | varies | some | not a privacy goal | **SKIP**: evasion |
| 35 | Hiding automation (`navigator.webdriver`, Juggler isolation) | Camoufox | n/a | n/a | none | **SKIP**: evasion, out of scope |

Short version:
- **On by default:** turn on 1, 5, 10, 11, 12b, 18, 23, 26 and 29. All are
  pref-only changes with no measurable speed cost.
- **One optional "Hardened" toggle:** 2 (RFP, with 3, 6, 15 and 16), 7, 19
  and 21, for people who want LibreWolf-level protection and accept its
  breakage.
- **Skip:** 8, 12 (hard-fail), 13, 14, 17, 22, 27 and everything
  evasion-related from Camoufox. These either slow Mercury down or break too
  much for too little.

## Details

### 1. Fingerprinting protection (FPP) in normal windows
`privacy.fingerprintingProtection=true` (Firefox enables it in ETP Strict and
private windows).
- **Perf:** small. Canvas randomization adds work only when a page reads
  canvas pixels.
- **Breakage:** some. It randomizes canvas readback and reports a normalized
  set of hardware values. Mozilla ships per-site fixes through
  `fingerprinting-protection-overrides` in Remote Settings, which Mercury
  still uses, and that keeps breakage low. LibreWolf's `fpp-canvas-fix`
  patch shows one bug where canvas randomization missed a code path. Check
  that it's fixed in 159 before turning this on.
- **Benefit:** medium. It blocks the most common active fingerprinting
  vectors without RFP's side effects (wrong timezone, forced light theme).
- **Rec:** ON. This is the RFP-lite that Mozilla maintains.

### 2. ResistFingerprinting (RFP)
`privacy.resistFingerprinting=true`, LibreWolf's default.
- **Perf:** small. Timers are coarser (100 ms `Date` / reduced
  `performance.now`), which can make some animations and benchmarks look
  worse. It doesn't add CPU work.
- **Breakage:** high. The timezone is reported as UTC, so web calendars and
  email show wrong times. `prefers-color-scheme` is forced to light. Window
  sizes are rounded. Canvas reads prompt. Some sites flag the generic
  fingerprint as a bot (more CAPTCHAs).
- **Benefit:** high, but only if many users share the same RFP fingerprint.
- **Rec:** OPT, as part of a "Hardened" toggle. Never on by default.

### 3. Letterboxing
`privacy.resistFingerprinting.letterboxing`. LibreWolf ships it off.
- **Perf:** none. **Breakage:** some: gray margins around pages, and
  responsive layouts can jump between breakpoints. **Benefit:** low alone,
  medium with RFP. **Rec:** OPT, only inside the RFP toggle.

### 4. WebGL off
`webgl.disabled=true`. LibreWolf turned WebGL back on and offers a per-site
prompt patch (`webgl-permission`, about 560 lines) instead.
- **Perf:** significant for maps, 3D, games and some video players, which
  either fall back to slow 2D rendering or don't work at all.
- **Breakage:** high (online maps, Figma, Google Earth-style sites, games).
- **Benefit:** medium. WebGL exposes GPU model strings. FPP and RFP already
  normalize the renderer string.
- **Rec:** SKIP turning it off globally. A per-site prompt could be added
  later (OPT) by porting LibreWolf's patch.

### 5. WebGPU off
`dom.webgpu.enabled=false`. In 159 it's on by default only on Windows and
Apple-silicon macOS; Linux release builds already have it off.
- **Perf:** none (almost nothing uses it). **Breakage:** some: a few demos and
  in-browser ML sites. **Benefit:** low–medium. It exposes adapter details
  and is a new attack surface.
- **Rec:** ON (match LibreWolf), with a toggle to turn it back on.

### 6. Canvas-read prompt
Asks before a site reads canvas pixels. Firefox does this only under RFP.
LibreWolf's `canvas-permission` patch (about 150 lines) also allows it with
FPP.
- **Perf:** none. **Breakage:** some: image editors, upload croppers and
  some CAPTCHAs ask for permission. **Benefit:** medium–high against canvas
  fingerprinting.
- **Rec:** OPT, together with RFP. Port the patch only if you want it without
  RFP.

### 7. Delete cookies and site data on close
`privacy.sanitize.sanitizeOnShutdown` with `clearOnShutdown_v2.cookiesAndStorage`.
- **Perf:** small. Logins, caches and service workers start cold.
- **Breakage:** high for everyday use: you're logged out of everything after
  each restart. Per-site "Allow" exceptions help.
- **Benefit:** high against long-lived tracking identifiers.
- **Rec:** OPT. Firefox already has this setting under Settings > Privacy >
  "Delete cookies and site data when Mercury is closed". At most, mention it
  in Mercury's docs or a first-run choice.

### 8. Disable the disk cache
`browser.cache.disk.enable=false`.
- **Perf:** significant. Repeat visits and restarts download everything again.
  This is the single biggest reason LibreWolf feels slower.
- **Breakage:** none. **Benefit:** low. Since Firefox 85 the cache is
  partitioned by top-level site, so it can't be used for cross-site tracking.
  What remains is local forensics (someone with access to your disk), which
  #7 already covers.
- **Rec:** SKIP.

### 9. DNS-over-HTTPS
LibreWolf sets `network.trr.mode=5` (off) with a Quad9 URI ready to use.
Firefox enables DoH automatically in some regions (US, Canada, ...) through
`doh-rollout`, using Cloudflare.
- **Perf:** none–small. The first lookup can be slower and later lookups are
  cached. **Breakage:** some: company networks, split-horizon DNS, `.local`
  and router hostnames, captive portals. **Benefit:** medium. It hides DNS
  lookups from the ISP and local network.
- **Rec:** OPT. Keep Firefox's default (rollout where Mozilla enables it,
  using the Settings UI). Optionally add Quad9 to the provider list, like
  LibreWolf. None of the built-in providers are Google.

### 10. Cross-origin referer trimming
`network.http.referer.XOriginTrimmingPolicy=2`. Cross-site requests only send
the origin, even if the site asks for more.
- **Perf:** none. **Breakage:** low: a few hotlink-protected images and old
  payment flows that check the full referer. **Benefit:** low–medium. The
  default (`strict-origin-when-cross-origin`) already trims cross-site
  referers, but sites can override it; this setting makes trimming
  mandatory.
- **Rec:** ON.

### 11. WebRTC IP leak protection
Firefox already hides local IPs behind mDNS names
(`media.peerconnection.ice.obfuscate_host_addresses`). LibreWolf adds
`media.peerconnection.ice.proxy_only_if_behind_proxy=true`, so when a proxy is
set, WebRTC can't bypass it. Turning WebRTC off completely
(`media.peerconnection.enabled=false`) breaks video calls (Meet, Jitsi,
Discord).
- **Perf:** none. **Breakage:** low, and only for proxy users: calls fail if
  the proxy can't carry UDP. **Benefit:** medium. It stops your real IP from
  leaking around a proxy.
- **Rec:** ON for `proxy_only_if_behind_proxy`. SKIP the full WebRTC
  kill switch.

### 12. OCSP hard-fail vs. OCSP off
Some hardening guides set `security.OCSP.require=true` (hard-fail).
- **Perf:** small–significant. Every new certificate waits for the CA's OCSP
  server, and slow responders stall page loads.
- **Breakage:** some: captive portals and OCSP outages block sites
  completely.
- **Privacy:** negative. OCSP tells the CA which sites you visit.
- **Rec:** SKIP.

**12b.** LibreWolf instead sets `security.OCSP.enabled=0` and relies on CRLite
(already in enforce mode in Firefox 159), which checks revocation from a local
list without contacting anyone. This is faster and more private. The one gap:
certificates from private or enterprise CAs aren't in CRLite, so they get no
revocation check. **Rec:** ON.

### 13 and 14. JIT and WebAssembly
`javascript.options.ion` / `baselinejit=false`, `javascript.options.wasm=false`.
LibreWolf ships a per-site JIT toggle (`jit-permission`, about 570 lines), on
by default.
- **Perf:** significant. Without the JIT, JavaScript-heavy sites run 2–10×
  slower.
- **Breakage:** some for no-JIT (slow web apps). High for no-WASM: Figma,
  games, some video sites and image tools stop working.
- **Benefit:** none for privacy; this only reduces the attack surface.
- **Rec:** SKIP as defaults. LibreWolf's per-site JIT toggle (default on)
  could come later as an OPT feature for high-risk users.

### 15. Font visibility restriction
`layout.css.font-visibility=1` (a single pref in Firefox 159; the default is
3, all fonts) limits pages to base system fonts. RFP also restricts fonts,
and so do FPP's font-visibility targets.
- **Perf:** none. **Breakage:** some: text in less common scripts falls back
  to other fonts, and fonts you installed locally aren't offered to sites.
- **Benefit:** medium. The list of installed fonts is very identifying.
- **Rec:** OPT, as part of the Hardened preset.

### 16. Timezone and locale spoofing
RFP reports UTC and can ask to use en-US (`privacy.spoof_english`).
Camoufox goes further and fakes timezone, locale and geolocation to match a
proxy.
- **Perf:** none. **Breakage:** high: wrong times in calendars, mail and
  booking sites.
- **Rec:** SKIP as a separate feature (it only makes sense inside RFP).
  Camoufox-style matching to a proxy is evasion (see below).

### 17. First-Party Isolation (FPI) vs. Total Cookie Protection (TCP)
`privacy.firstparty.isolate`. Mercury already has TCP (dynamic state
partitioning), which is Firefox's replacement for FPI. LibreWolf dropped
FPI too.
- **Perf:** none. **Breakage:** high: single sign-on, embedded logins and
  payment frames. **Benefit:** marginal over TCP.
- **Rec:** SKIP.

### 18. Query-parameter stripping
`privacy.query_stripping.enabled` and `.pbmode=true` remove known tracking parameters
(`fbclid`, `mc_eid`, ...) from links. Firefox 159 turns it on only in ETP
Strict (`qps`, `qpsPBM`). In Standard it's off, even in private windows.
- **Perf:** none. **Breakage:** low. Mozilla's list is conservative, and
  LibreWolf keeps an allow-list for `urldefense.com`.
- **Benefit:** medium. **Rec:** ON.

### 19. ETP Strict
`browser.contentblocking.category="strict"`, LibreWolf's default.
- **Perf:** none, and often faster because fewer trackers load. **Breakage:**
  some: social embeds, some logins, "Sign in with ..." popups. The shield
  icon lets you turn it off per site.
- **Benefit:** medium. Strict bundles #1 and #18, plus social-tracker and
  email-tracker blocking, and stricter referrer handling for trackers.
- **Rec:** OPT. It's already one click in Settings. Mercury would turn on its
  low-breakage parts individually (#1, #18) and keep Standard.

### 20. HTTPS-Only mode
LibreWolf turns it on by policy. Firefox 159 already uses HTTPS-First, which
upgrades without blocking.
- **Perf:** none. **Breakage:** some: HTTP-only sites show an interstitial,
  and so do local devices (routers, printers).
- **Rec:** OPT. The Settings UI already exists.

### 21 and 22. Remaining speculative connections
Mercury already turns off most prefetching. Still on:
- `browser.urlbar.speculativeConnect.enabled` and
  `browser.places.speculativeConnect.enabled`: Firefox connects to a site
  while you type its address or hover a bookmark, before you press Enter.
  - **Perf:** small. Turning them off costs about one round trip on those
    navigations.
  - **Benefit:** low–medium. Sites you didn't choose to visit can learn your
    IP.
  - **Rec:** OPT.
- `network.early-hints.preconnect.max_connections`: preconnects that the
  site you're already loading asks for. No meaningful privacy gain.
  **Rec:** SKIP.

### 23 and 24. uBlock Origin
Mercury installs uBO with its default lists (EasyList, EasyPrivacy, uBO
filters, Peter Lowe's, malware lists), like LibreWolf.
- **23. Private windows.** LibreWolf also allows uBO in private windows
  (`"private_browsing": true` in `ExtensionSettings`). Without that, private
  windows have no ad blocking. **Perf:** none (it saves loads). **Rec:** ON.
  This is a one-line policy change.
- **24. Extra lists** (AdGuard URL Tracking, Fanboy annoyances/cookie
  notices). **Perf:** small (more filter memory and parse time at startup).
  **Breakage:** some with annoyance lists. **Rec:** OPT; users enable them in
  uBO's dashboard. Firefox 159 no longer has the built-in cookie-banner
  handler (`cookiebanners.service.*`); LibreWolf still sets those prefs, but
  they have no effect, so uBO's cookie-notice list is the replacement.

### 25–32. Smaller items
- **25. `network.IDN_show_punycode`:** shows `xn--` instead of non-Latin
  domains, which protects against look-alike domains. It looks bad for users
  of non-Latin scripts. **OPT.**
- **26. `pdfjs.enableScripting=false`:** turns off JavaScript inside PDFs. A
  few fillable forms lose their auto-calculation. Security benefit. **ON.**
- **27. TLS 0-RTT off:** a small replay-safety gain, but it costs one round
  trip on reconnects. **SKIP** (speed).
- **28. Form history and password saving off:** this only affects data stored
  locally, and it's a user preference. **SKIP.**
- **29. `browser.helperApps.deleteTempFileOnExit=true`:** files you opened in
  external apps don't stay in `/tmp`. No cost. **ON.**
- **30. Clear the alt-svc cache when the HTTP cache is cleared** (LibreWolf
  patch, about 25 lines): closes a small tracking channel. Only matters with
  #7. **OPT.**
- **31. OS geolocation providers off:** Firefox already asks before any site
  gets your location, so this only stops geolocation from working. **SKIP.**
- **32. Captive-portal and connectivity checks off:** these contact Mozilla
  (not Google) on startup and when the network changes. Turning them off
  means hotel and airport Wi-Fi login pages aren't detected. **OPT.**

## Camoufox: privacy-positive vs. evasion-only

Camoufox is an anti-detect browser for scraping. Most of its patches lie to
websites about the device so that bots look like real, *different* users.
That's the opposite of Mercury's approach, which is to look like *many other
users* (RFP/FPP uniformity) and to say no. Mercury won't add automation hiding
or bot-detection evasion; see the experimental `mcp-control` branch, which
keeps Firefox's remote-control indicator and `navigator.webdriver` visible.

**Privacy-positive ideas** (possible optional features later; none
implemented):
- `push-connect-on-demand`: the Push service connects to Mozilla's push server
  only when a site actually uses push, instead of keeping a connection open
  all the time. It's privacy-positive and slightly cheaper (#33).
- `process-title-environ-leak`: fixes a leak of environment strings through
  the process title on Linux. Small, worth checking against 159.
- `webrtc-ip-spoofing` / `webrtc-socks5-udp`: keep WebRTC behind a proxy.
  Firefox's `proxy_only_if_behind_proxy` pref (#11) covers the important
  part without a patch.
- `anti-font-fingerprinting`: a bundled per-OS font set. Firefox's
  font-visibility levels (#15) give most of the benefit.
- Media-device label normalization: RFP already does this.
- Camoufox's design rule is that "noise is a fingerprint" if stock Firefox
  doesn't add it. That's a useful caution for Mercury too: don't add custom
  randomization beyond what FPP/RFP do, or Mercury users become a small,
  recognizable group.

**Evasion-only** (out of scope for Mercury):
- Per-launch or per-context device identities (navigator/UA, screen, WebGL
  vendor and parameters, audio, fonts, speech voices, touch points)
  generated to look like a different real machine.
- Timezone, locale and geolocation rewritten to match a proxy's IP.
- Everything under "Hiding automation": `navigator.webdriver=false`, Juggler
  isolated worlds, "trusted" synthetic events, human-like mouse coalescing,
  wheel ticks, invisible debugger, popup and drag parity patches.
- `webdriver-bidi-app-name` and similar patches that make an automated
  browser look like stock Firefox.

## What was implemented and what's left

1. Done: #1, #5, #10, #11, #12b, #18, #26, #29 in `firefox.js` and #23 in
   `policies.json` (see "On by default" above).
2. Done: Hardened mode with #2 (RFP, which includes #3's companion settings,
   #6, #15 and #16), #3, #7, #9, #19, #20, #21 and #25. #24 is documented
   instead (manual uBO lists).
3. Not done, possible later patches: per-site WebGL prompt, per-site JIT
   toggle and canvas prompt without RFP (from LibreWolf); push connect on
   demand (from Camoufox); #30 and #32.
