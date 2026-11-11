/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Mercury Hardened mode.
 *
 * One switch (`mercury.hardened.enabled`, Settings > Privacy & Security >
 * Hardened mode) that turns on a group of stricter privacy settings, and
 * turns them back off again.
 *
 * Cost when off: BrowserGlue adds one pref observer and, at startup, reads
 * two prefs. This module is only loaded when the switch is flipped, or at
 * startup if the switch and the saved state disagree (for example the pref
 * was changed in user.js while Mercury was closed).
 *
 * User overrides are respected:
 * - When turning on, a pref that already has the hardened value is left
 *   alone (and is not recorded as ours).
 * - Every pref this module changes is recorded in `mercury.hardened.state`
 *   with the value it set and the user value it replaced (if any).
 * - When turning off, a recorded pref is only restored if it still has the
 *   value Hardened mode set. Prefs the user changed afterwards are kept.
 *   Restoring means putting back the user's previous value, or clearing the
 *   user value so the Mercury default applies again.
 */

const PREF_ENABLED = "mercury.hardened.enabled";
const PREF_STATE = "mercury.hardened.state";
const PREF_DOH_URI = "mercury.hardened.doh.uri";
const DEFAULT_DOH_URI = "https://dns.quad9.net/dns-query";

const CB_CATEGORY = "browser.contentblocking.category";

/**
 * The Hardened mode group. Each entry is [pref, value, options]:
 * - options.skip(current, prefs): return true to leave the pref alone.
 *
 * @param {object} prefs - pref adapter (see servicesAdapter)
 */
export function hardenedPrefs(prefs) {
  let dohURI = prefs.get(PREF_DOH_URI) || DEFAULT_DOH_URI;
  // Keep a DNS-over-HTTPS provider the user picked in Settings.
  let keepUserDoHProvider = { skip: (cur, p, name) => p.hasUserValue(name) };
  return [
    // Resist fingerprinting (UTC timezone, font restriction, canvas prompt,
    // rounded window sizes, ...) plus letterboxing.
    ["privacy.resistFingerprinting", true],
    ["privacy.resistFingerprinting.letterboxing", true],
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
    // DNS over HTTPS, "Increased protection" (falls back to the system
    // resolver if DoH fails). Never downgrades "Max protection" (3).
    ["network.trr.mode", 2, { skip: cur => cur == 2 || cur == 3 }],
    ["network.trr.uri", dohURI, keepUserDoHProvider],
    ["network.trr.custom_uri", dohURI, keepUserDoHProvider],
    // No connections to sites before you pick them in the address bar or
    // bookmarks.
    ["browser.urlbar.speculativeConnect.enabled", false],
    ["browser.places.speculativeConnect.enabled", false],
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
      continue; // Already like that (default or the user's choice): not ours.
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
      continue; // Changed by the user while Hardened mode was on: keep it.
    }
    if (name == CB_CATEGORY && !("p" in entry)) {
      // Switching the category to "standard" makes Firefox reset all the
      // tracking-protection prefs that "strict" set; then drop the user
      // value so Mercury's default category applies.
      prefs.set(name, "standard");
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
        return; // Enterprise policy wins.
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

  // Firefox migrates the old "clear on shutdown" prefs to the new ones the
  // first time it sanitizes on shutdown, which would overwrite what we set
  // (and clear history). Do that migration first, like Settings does.
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
