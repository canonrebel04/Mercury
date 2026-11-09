# Google touchpoints in Mercury

Mercury removes Google from the browser in the spirit of ungoogled-chromium and
LibreWolf. All changes are made with patches in `patches/firefox/`, default prefs in
the `firefox.js` patch (the "MERCURY: DE-GOOGLE AND PRIVACY DEFAULTS" block at
the end), and `policies/policies.json`.

## Removed

| Touchpoint | What Mercury does |
|---|---|
| Google search engine | Patch 0026 (`SearchEngineSelector.sys.mjs`) filters every engine whose id is `google*` or whose search URL is on `google.<tld>`. That covers remote search-config updates and contextual search. `policies.json` also removes "Google". |
| Default search engine | DuckDuckGo in every region, in normal and private windows (patch 0026 plus `SearchEngines.Default`). Search suggestions follow the default engine (`ac.duckduckgo.com`). |
| Google search-shortcut tiles on the new tab | `improvesearch.topSiteSearchShortcuts` off. |
| Google Lens ("Search image with Google Lens") | `browser.search.visualSearch.featureGate` off. The Google engine that provided it is gone too. |
| Safe Browsing `google`, `google4` and `google5` providers | Removed from `all.js` (patch 0027), along with every `safebrowsing.google.com` / `safebrowsing.googleapis.com` / `developers.google.com` URL and the `goog-*` lists. Malware/phishing/download checks are off. |
| Download reputation (`sb-ssl.google.com`) | URL blanked, remote checks off. |
| Network geolocation (`www.googleapis.com/geolocation`) | Empty by default (patch 0027 and `firefox.js`). OS location services are still used where they exist. |
| Google API keys | None are built in (`mozconfigs/ga` was deleted). |
| Widevine version lookups on Google's Chromium update service (`update.googleapis.com`) | `allow-chromium-update` is false and `chromium-update-url` is empty. |
| Widevine download while DRM is off | DRM is off by default. Patch 0028 skips the plugin update check entirely unless a plugin is turned on (see the Widevine section). |
| youtube.com in the default top sites | Removed from Mercury's list and the `DefaultSites` patch. `browser.topsites.useRemoteSetting=false`, so Mozilla's remote list (which has YouTube) isn't used. |
| `play.google.com` links in the protections report | Blanked; the mobile-app card and VPN banner are hidden. |
| WebRTC `allow_old_setParameters.allowlist` (`*.google.com`) | Set to empty. Upstream only uses it on Nightly. |
| `mail.google.com` in `privacy.trackingprotection.emailtracking.webapp.domains` | Removed. The list only labels telemetry (email-tracker counts on webmail pages), so blocking isn't affected. |

## Kept, and why

| Touchpoint | Why it stays |
|---|---|
| `google-trackwhite-digest256` in the tracking-protection allowlists | It's part of Mozilla's own entity allowlist, served by Mozilla's shavar servers (provider "mozilla"), not by Google. It stops tracking protection from breaking Google's own sites (for example, Google's resources on YouTube) for people who choose to use them. Removing it wouldn't cut any request to Google, but it would break those sites. |
| `accounts.google.com/o/oauth2/` (and `datastudio.google.com`) in `privacy.restrict3rdpartystorage.partitionedHosts` | This is a site-compatibility fix that gives those frames partitioned (isolated) storage instead of blocking them. Without it, "Sign in with Google" breaks for people who want to use it. It makes no requests on its own and doesn't weaken privacy. |
| Gemini in the AI chatbot provider list | The user picks a chatbot provider in Settings. Nothing is preselected and nothing loads while AI is off. To hide it, set `browser.ml.chat.providers` to `claude,chatgpt,huggingchat,lechat`. |
| `layout.css.fake-webkit-scrollbar.enabled-domains` (`mail/docs/play.google.com`, ...) | A layout compatibility shim for those sites. No network effect. |
| `plugins.rewrite_youtube_embeds` | Rewrites old Flash YouTube embeds on pages that already embed YouTube. It never contacts YouTube on its own. |
| `browser.pageextractor.youtube.*` | Used only by the AI page extractor (Smart Window), which is off. |
| `font.name-list.*` "Google Sans" / "Material Icons" | Android-only font fallbacks and the list of allowed local icon fonts. These are local font names; nothing is downloaded. |
| Web-compat interventions and shims for YouTube/Google sites, including the Google Analytics no-op shim | They only apply on those sites. The shim replaces Google Analytics with a stub, which helps privacy. |
| DoH rollout heuristics (`toolkit/components/doh`) | In regions where Mozilla turns on DNS-over-HTTPS by default, Firefox looks up `www.google.com` / YouTube safe-search hostnames through your normal DNS resolver to detect parental controls. That's a DNS query to your resolver, not a connection to Google. Choosing a DoH mode yourself in Settings skips the rollout and its heuristics. |
| Captive-portal / connectivity checks | They go to Mozilla (`firefox-portal-detection.com`, `detectportal.firefox.com`), not Google. |
| `search-config-v2.json` dump and `top-sites.json` dump | The bundled data files still contain Google/YouTube entries. Patch 0026 filters Google at runtime, and the top-sites dump isn't used (`useRemoteSetting=false`). |
| `toolkit/content/gmp-sources/widevinecdm*.json` | Firefox's fallback download list for Widevine (Google URLs). It's only used after you turn on DRM and only if Mozilla's update server can't be reached. |

## Widevine / DRM

- **Off by default.** `media.eme.enabled=false`. While it's off, Firefox hides the
  Widevine plugin and never downloads it. Mercury's patch 0028 also skips the
  plugin update check completely, so nothing is requested from Mozilla
  (`aus5.mozilla.org`), Google or Cisco.
- **To turn it on:** Settings > General > Digital Rights Management (DRM)
  Content > "Play DRM-controlled content", or click "Enable DRM" in the
  notification bar on a DRM site.
- **What happens then:** Firefox asks Mozilla's update server which Widevine
  version to use. It then **downloads Google's Widevine CDM from Google's
  servers** (`edgedl.me.gvt1.com`, mirror `www.google.com/dl`). Widevine is
  made by Google, so there is no non-Google way to get it. Firefox runs it in
  a sandbox. Google's Chromium update service is not used. Nothing else is
  downloaded: OpenH264 stays off unless you turn it on.
- **OpenH264** (Cisco's H.264 codec for WebRTC calls) is also off by default. You
  can turn it on in about:addons > Plugins. Without it, video calls use
  VP8/VP9.
