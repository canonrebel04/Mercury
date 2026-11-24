/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Mercury Hardened mode, Tor/Mullvad-inspired Privacy Profiles, Security Levels,
 * and "New Identity" session reset.
 *
 * Cost when idle: BrowserGlue adds one pref observer and, at startup, reads
 * two prefs. This module is only loaded when toggled or when saved state
 * disagrees with the pref.
 */

const PREF_ENABLED = "mercury.hardened.enabled";
const PREF_STATE = "mercury.hardened.state";
const PREF_DOH_URI = "mercury.hardened.doh.uri";
const PREF_SECURITY_LEVEL = "mercury.security.level";
const PREF_PRESERVE_THEME = "mercury.rfp.preserveSystemTheme";
export const PREF_JIT_ALLOWLIST = "mercury.security.jitAllowlist";

export const DEFAULT_DOH_URI = "https://dns.adguard-dns.com/dns-query";

/**
 * Default "Crowd-Blend" (Hide in Plain Sight) FPP overrides:
 * Keeps standard Web APIs present (avoiding tiny ~0.05% anomaly sets) while
 * standardizing/sanitizing hardware, GPU, audio, font, screen, and sensor
 * fingerprints. Preserves system dark/light theme (-CSSPrefersColorScheme)
 * and native JS Math speed (-JSMathFdlibm).
 */
export const CROWD_BLEND_OVERRIDES = [
  "+EfficientCanvasRandomization",
  "-CanvasRandomization",
  "+CanvasExtractionFromThirdPartiesIsBlocked",
  "+FontVisibilityLangPack",
  "+ScreenAvailToResolution",
  "+WindowScreenXY",
  "+WindowInnerScreenXY",
  "+ScreenPixelDepth",
  "+MouseEventScreenPoint",
  "+NavigatorHWConcurrencyTiered",
  "+MaxTouchPointsCollapse",
  "+IMEStyle",
  "+WebGLRendererConstant",
  "+WebGLVendorSanitize",
  "+WebGLRandomization",
  "+WebGLRenderCapability",
  "+Gamepad",
  "+DeviceSensors",
  "+AudioSampleRate",
  "+AudioContext",
  "+MediaDevices",
  "+MediaCapabilities",
  "+WebCodecs",
  "+SpeechSynthesis",
  "+NetworkConnection",
  "+DiskStorageLimit",
  "+UseStandinsForNativeColors",
  "+CSSColorInfo",
  "+CSSVideoDynamicRange",
  "+CSSPointerCapabilities",
  "+CSSPrefersReducedTransparency",
  "+CSSInvertedColors",
  "+VideoElementPlaybackQuality",
  "+PdfjsSpoof",
  "-JSMathFdlibm",
  "-CSSPrefersColorScheme",
].join(",");

const CB_CATEGORY = "browser.contentblocking.category";

/**
 * The Hardened / Mullvad-Tor Blend mode group. Each entry is [pref, value, options]:
 * - options.skip(current, prefs): return true to leave the pref alone.
 *
 * @param {object} prefs - pref adapter (see servicesAdapter)
 */
export function hardenedPrefs(prefs) {
  let dohURI = prefs.get(PREF_DOH_URI) || DEFAULT_DOH_URI;
  let preserveTheme = prefs.get(PREF_PRESERVE_THEME);
  if (preserveTheme === undefined) {
    preserveTheme = true;
  }
  let keepUserDoHProvider = { skip: (cur, p, name) => p.hasUserValue(name) };
  return [
    // Resist fingerprinting (UTC timezone, font restriction, canvas prompt,
    // rounded window sizes, ...) plus letterboxing.
    ["privacy.resistFingerprinting", true],
    ["privacy.resistFingerprinting.letterboxing", true],
    // Preserve system dark/light mode switching if mercury.rfp.preserveSystemTheme is true.
    [
      "privacy.fingerprintingProtection.overrides",
      preserveTheme ? "-CSSPrefersColorScheme" : "",
    ],
    // Strict Enhanced Tracking Protection.
    [CB_CATEGORY, "strict"],
    // Delete cookies, site data and cache when Mercury closes. History,
    // form data and site settings are kept. Sites allowed under
    // "Manage Exceptions" keep their cookies.
    ["privacy.sanitize.sanitizeOnShutdown", true],
    ["privacy.clearOnShutdown_v2.cookiesAndStorage", true],
    ["privacy.clearOnShutdown_v2.cache", true],
    ["privacy.clearOnShutdown_v2.browsingHistoryAndDownloads", false],
    ["privacy.clearOnShutdown_v2.formdata", false],
    ["privacy.clearOnShutdown_v2.siteSettings", false],
    // HTTPS-Only Mode in all windows.
    ["dom.security.https_only_mode", true],
    // DNS over HTTPS, "Increased protection" (never downgrades "Max protection" 3).
    ["network.trr.mode", 2, { skip: cur => cur == 2 || cur == 3 }],
    ["network.trr.uri", dohURI, keepUserDoHProvider],
    ["network.trr.custom_uri", dohURI, keepUserDoHProvider],
    // No speculative prefetch/preconnect.
    ["browser.urlbar.speculativeConnect.enabled", false],
    ["browser.places.speculativeConnect.enabled", false],
    ["network.http.speculative-parallel-limit", 0],
    ["network.dns.disablePrefetch", true],
    ["network.dns.disablePrefetchFromHTTPS", true],
    ["network.prefetch-next", false],
    ["network.predictor.enabled", false],
    ["network.predictor.enable-prefetch", false],
    // Show internationalized domain names as punycode (anti-spoofing).
    ["network.IDN_show_punycode", true],
  ];
}

/**
 * Turns the group on. Returns the state record that was saved.
 *
 * @param {object} prefs - pref adapter
 */
export function applyHardened(prefs) {
  let state = {};
  for (let [name, value, options] of hardenedPrefs(prefs)) {
    let current = prefs.get(name);
    if (current === value) {
      continue;
    }
    if (options?.skip?.(current, prefs, name)) {
      continue;
    }
    let entry = { v: value };
    if (prefs.hasUserValue(name)) {
      entry.p = current;
    }
    state[name] = entry;
    prefs.set(name, value);
  }
  prefs.set(PREF_STATE, JSON.stringify(state));
  return state;
}

/**
 * Turns the group off, restoring only what Hardened mode set and the user
 * hasn't changed since. Returns the list of prefs that were restored.
 *
 * @param {object} prefs - pref adapter
 */
export function restoreHardened(prefs) {
  let state = {};
  try {
    state = JSON.parse(prefs.get(PREF_STATE) || "{}") || {};
  } catch (e) {
    state = {};
  }
  let restored = [];
  for (let name of Object.keys(state).reverse()) {
    let entry = state[name];
    if (!entry || prefs.get(name) !== entry.v) {
      continue;
    }
    if (name == CB_CATEGORY && !("p" in entry)) {
      prefs.clear(name);
    } else if ("p" in entry) {
      prefs.set(name, entry.p);
    } else {
      prefs.clear(name);
    }
    restored.push(name);
  }
  prefs.clear(PREF_STATE);
  return restored;
}

/**
 * Tor-inspired Security Levels:
 * - "standard": Full SpiderMonkey JIT & WASM speed + all network/LNA/PQ/ECH/CRLite protections.
 * - "safer":    Disables Ion JIT, WASM, MathML, and SVG OpenType fonts (~80% less JIT/WASM attack surface).
 * - "safest":   Disables all JS JITs, WASM, MathML, SVG OpenType fonts, WebGL, and remote downloadable fonts.
 */
export function applySecurityLevel(level, prefs) {
  const safeLevel =
    level === "safer" || level === "safest" ? level : "standard";
  prefs.set(PREF_SECURITY_LEVEL, safeLevel);
  if (safeLevel === "standard") {
    prefs.clear("javascript.options.ion");
    prefs.clear("javascript.options.baselinejit");
    prefs.clear("javascript.options.blinterp");
    prefs.clear("javascript.options.wasm");
    prefs.clear("javascript.options.wasm_baselinejit");
    prefs.clear("javascript.options.wasm_optimizingjit");
    prefs.clear("mathml.disabled");
    prefs.clear("gfx.font_rendering.opentype_svg.enabled");
    prefs.clear("webgl.disabled");
    prefs.clear("gfx.downloadable_fonts.enabled");
  } else if (safeLevel === "safer") {
    prefs.set("javascript.options.ion", false);
    prefs.clear("javascript.options.baselinejit");
    prefs.clear("javascript.options.blinterp");
    prefs.set("javascript.options.wasm", false);
    prefs.set("javascript.options.wasm_baselinejit", false);
    prefs.set("javascript.options.wasm_optimizingjit", false);
    prefs.set("mathml.disabled", true);
    prefs.set("gfx.font_rendering.opentype_svg.enabled", false);
    prefs.clear("webgl.disabled");
    prefs.clear("gfx.downloadable_fonts.enabled");
  } else {
    prefs.set("javascript.options.ion", false);
    prefs.set("javascript.options.baselinejit", false);
    prefs.set("javascript.options.blinterp", false);
    prefs.set("javascript.options.wasm", false);
    prefs.set("javascript.options.wasm_baselinejit", false);
    prefs.set("javascript.options.wasm_optimizingjit", false);
    prefs.set("mathml.disabled", true);
    prefs.set("gfx.font_rendering.opentype_svg.enabled", false);
    prefs.set("webgl.disabled", true);
    prefs.set("gfx.downloadable_fonts.enabled", false);
  }
}

/**
 * Normalize a user-supplied origin for `mercury.security.jitAllowlist`,
 * matching the C++ rules in `XPCJSContext.cpp` (0043):
 * - Trims ASCII whitespace and lowercases.
 * - Accepts `https://host[:port]`, `http://host[:port]`, or bare `host[:port]`
 *   (normalized to `https://host[:port]`).
 * - Strips a single trailing `/` only when it is the bare root path.
 * - Rejects wildcards (`*`), paths, queries, fragments, userinfo, OriginAttributes (`^`),
 *   non-http(s) schemes, invalid hostnames, or empty strings (returns `null`).
 *
 * @param {string} input
 * @returns {string|null}
 */
export function normalizeJitOrigin(input) {
  if (typeof input !== "string") {
    return null;
  }
  let s = input.trim().toLowerCase();
  if (!s) {
    return null;
  }
  // Reject whitespace, wildcards, query, fragment, userinfo, backslashes, or OA suffix.
  if (/[\s*?#@\\^]/.test(s)) {
    return null;
  }

  let candidate;
  if (s.includes("://")) {
    if (!s.startsWith("https://") && !s.startsWith("http://")) {
      return null;
    }
    candidate = s;
  } else {
    // Reject non-http(s) schemes without "//" (e.g. javascript:alert(1), about:blank, data:...).
    let colonIdx = s.indexOf(":");
    if (colonIdx !== -1 && !s.startsWith("[")) {
      let afterColon = s.slice(colonIdx + 1).replace(/\/$/, "");
      if (!/^\d{1,5}$/.test(afterColon)) {
        return null;
      }
    }
    candidate = `https://${s}`;
  }

  // Allow at most a single trailing slash for bare root; reject any non-root path.
  if (candidate.endsWith("/")) {
    candidate = candidate.slice(0, -1);
  }
  let schemeEnd = candidate.indexOf("://") + 3;
  if (candidate.indexOf("/", schemeEnd) !== -1) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }

  let host = parsed.hostname;
  if (!host) {
    return null;
  }
  if (host.startsWith("[") && host.endsWith("]")) {
    if (!/^\[[0-9a-f:.]+\]$/.test(host)) {
      return null;
    }
  } else {
    if (
      host.startsWith(".") ||
      host.endsWith(".") ||
      host.includes("..") ||
      !/^[a-z0-9.-]+$/.test(host)
    ) {
      return null;
    }
    for (let label of host.split(".")) {
      if (!label || label.startsWith("-") || label.endsWith("-")) {
        return null;
      }
    }
  }

  if (parsed.port) {
    let portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return null;
    }
  }

  return parsed.origin;
}

/**
 * Parse a comma/whitespace-separated `mercury.security.jitAllowlist` string into
 * deduplicated canonical origins preserving order.
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function parseJitAllowlist(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return [];
  }
  let seen = new Set();
  let out = [];
  for (let tok of raw.split(/[\s,]+/)) {
    let norm = normalizeJitOrigin(tok);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/**
 * Format an array (or raw string) of origins into the canonical comma-separated
 * pref representation.
 *
 * @param {string[]|string} origins
 * @returns {string}
 */
export function formatJitAllowlist(origins) {
  if (typeof origins === "string") {
    return parseJitAllowlist(origins).join(",");
  }
  if (!Array.isArray(origins)) {
    return "";
  }
  let seen = new Set();
  let out = [];
  for (let item of origins) {
    let norm = normalizeJitOrigin(item);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out.join(",");
}

/**
 * Add a normalized origin to `mercury.security.jitAllowlist`.
 *
 * @param {string} origin
 * @param {object} prefs - pref adapter
 * @returns {boolean} true if valid (and added or already present)
 */
export function addJitAllowlistOrigin(origin, prefs) {
  let norm = normalizeJitOrigin(origin);
  if (!norm) {
    return false;
  }
  let list = parseJitAllowlist(prefs.get(PREF_JIT_ALLOWLIST) || "");
  if (!list.includes(norm)) {
    list.push(norm);
    prefs.set(PREF_JIT_ALLOWLIST, formatJitAllowlist(list));
  }
  return true;
}

/**
 * Remove a normalized origin from `mercury.security.jitAllowlist`.
 *
 * @param {string} origin
 * @param {object} prefs - pref adapter
 * @returns {boolean} true if the origin was present and removed
 */
export function removeJitAllowlistOrigin(origin, prefs) {
  let norm = normalizeJitOrigin(origin);
  if (!norm) {
    return false;
  }
  let list = parseJitAllowlist(prefs.get(PREF_JIT_ALLOWLIST) || "");
  let next = list.filter(item => item !== norm);
  if (next.length === list.length) {
    return false;
  }
  prefs.set(PREF_JIT_ALLOWLIST, formatJitAllowlist(next));
  return true;
}

/**
 * Check whether a content process remoteType origin (optionally carrying a
 * `^...` OriginAttributes suffix such as `https://figma.com^userContextId=1`)
 * is an EXACT match in `mercury.security.jitAllowlist`.
 *
 * @param {string} remoteOrigin
 * @param {object} prefs - pref adapter
 * @returns {boolean}
 */
export function isOriginJitAllowed(remoteOrigin, prefs) {
  if (typeof remoteOrigin !== "string" || !remoteOrigin.trim()) {
    return false;
  }
  // Strip any OriginAttributes suffix (^userContextId=1, ^privateBrowsingId=1, ...).
  let caretIdx = remoteOrigin.indexOf("^");
  let base = (caretIdx === -1 ? remoteOrigin : remoteOrigin.slice(0, caretIdx)).trim();
  // Isolated Fission remoteType origins always carry an explicit http(s):// scheme.
  if (!/^https?:\/\//i.test(base)) {
    return false;
  }
  let norm = normalizeJitOrigin(base);
  if (!norm) {
    return false;
  }
  let allowlist = parseJitAllowlist(prefs.get(PREF_JIT_ALLOWLIST) || "");
  return allowlist.includes(norm);
}

/**
 * Pref adapter over Services.prefs, so the logic above can be unit tested
 * with a mock.
 */
export function servicesAdapter(Services) {
  const P = Services.prefs;
  return {
    get(name) {
      switch (P.getPrefType(name)) {
        case P.PREF_BOOL:
          return P.getBoolPref(name);
        case P.PREF_INT:
          return P.getIntPref(name);
        case P.PREF_STRING:
          return P.getStringPref(name);
      }
      return undefined;
    },
    set(name, value) {
      if (P.prefIsLocked(name)) {
        return;
      }
      if (typeof value == "boolean") {
        P.setBoolPref(name, value);
      } else if (typeof value == "number") {
        P.setIntPref(name, value);
      } else {
        P.setStringPref(name, String(value));
      }
    },
    clear(name) {
      if (!P.prefIsLocked(name)) {
        P.clearUserPref(name);
      }
    },
    hasUserValue(name) {
      return P.prefHasUserValue(name);
    },
  };
}

export const MercuryHardened = {
  /**
   * Brings the prefs in line with `mercury.hardened.enabled`. Never throws.
   */
  sync() {
    try {
      let enabled = Services.prefs.getBoolPref(PREF_ENABLED, false);
      let applied = Services.prefs.prefHasUserValue(PREF_STATE);
      let prefs = servicesAdapter(Services);
      if (enabled && !applied) {
        this._migrateSanitizerPrefs();
        applyHardened(prefs);
      } else if (!enabled && applied) {
        restoreHardened(prefs);
      }
    } catch (e) {
      console.error("Mercury Hardened mode:", e);
    }
  },

  setSecurityLevel(level) {
    try {
      applySecurityLevel(level, servicesAdapter(Services));
    } catch (e) {
      console.error("Mercury Security Level:", e);
    }
  },

  addJitAllowlistOrigin(origin) {
    return addJitAllowlistOrigin(origin, servicesAdapter(Services));
  },

  removeJitAllowlistOrigin(origin) {
    return removeJitAllowlistOrigin(origin, servicesAdapter(Services));
  },

  isOriginJitAllowed(remoteOrigin) {
    return isOriginJitAllowed(remoteOrigin, servicesAdapter(Services));
  },

  /**
   * Tor / Mullvad-inspired "New Identity": atomically clears cookies, cache,
   * DOM/IndexedDB/ServiceWorker storage, HTTP auth, and TLS session state.
   */
  async newIdentity() {
    try {
      const flags =
        Ci.nsIClearDataService.CLEAR_COOKIES |
        Ci.nsIClearDataService.CLEAR_ALL_CACHES |
        Ci.nsIClearDataService.CLEAR_DOM_STORAGES |
        Ci.nsIClearDataService.CLEAR_AUTH_TOKENS |
        Ci.nsIClearDataService.CLEAR_AUTH_CACHE |
        Ci.nsIClearDataService.CLEAR_SESSION_HISTORY |
        Ci.nsIClearDataService.CLEAR_EME |
        Ci.nsIClearDataService.CLEAR_SECURITY_SETTINGS;
      await new Promise(resolve => {
        Services.clearData.deleteData(flags, () => resolve());
      });
      try {
        const { MercuryBurner } = ChromeUtils.importESModule(
          "resource:///modules/MercuryBurner.sys.mjs"
        );
        await MercuryBurner.purgeAllUnused();
      } catch (e) {
        // MercuryBurner may not be loaded in minimal unit-test mocks.
      }
    } catch (e) {
      console.error("Mercury New Identity:", e);
    }
  },

  _migrateSanitizerPrefs() {
    try {
      const { Sanitizer } = ChromeUtils.importESModule(
        "resource:///modules/Sanitizer.sys.mjs"
      );
      Sanitizer.maybeMigratePrefs("clearOnShutdown");
    } catch (e) {
      console.error("Mercury Hardened mode: sanitizer migration failed", e);
    }
  },
};
