/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Mercury Performance & Memory Profiles.
 *
 * Tunes Fission process prelaunch, Canvas2D GPU cache, SpiderMonkey nursery,
 * image surface cache, parser notify interval, and low-memory tab unloading
 * across three user-selectable presets ("balanced", "turbo", "low-ram").
 *
 * Strictly scoped to performance/memory prefs: never mutates privacy,
 * Hardened mode, or Security Level settings.
 */

export const PREF_PROFILE = "mercury.performance.profile";

export const PERFORMANCE_PROFILES = Object.freeze({
  balanced: Object.freeze({
    "dom.ipc.processPrelaunch.fission.number": 4,
    "gfx.canvas.accelerated.cache-size": 512,
    "javascript.options.mem.nursery.max_kb": 65536,
    "image.mem.surfacecache.max_size_kb": 2097152,
    "content.notify.interval": 100000,
    "browser.tabs.unloadOnLowMemory": true,
  }),
  turbo: Object.freeze({
    "dom.ipc.processPrelaunch.fission.number": 6,
    "gfx.canvas.accelerated.cache-size": 1024,
    "javascript.options.mem.nursery.max_kb": 131072,
    "image.mem.surfacecache.max_size_kb": 2097152,
    "content.notify.interval": 83333,
    "browser.tabs.unloadOnLowMemory": false,
  }),
  "low-ram": Object.freeze({
    "dom.ipc.processPrelaunch.fission.number": 1,
    "gfx.canvas.accelerated.cache-size": 128,
    "javascript.options.mem.nursery.max_kb": 16384,
    "image.mem.surfacecache.max_size_kb": 262144,
    "content.notify.interval": 120000,
    "browser.tabs.unloadOnLowMemory": true,
  }),
});

/**
 * Normalize an arbitrary profile name to a known key ("balanced" fallback).
 *
 * @param {string} profile
 * @returns {"balanced"|"turbo"|"low-ram"}
 */
export function normalizeProfile(profile) {
  if (profile === "turbo" || profile === "low-ram" || profile === "balanced") {
    return profile;
  }
  return "balanced";
}

/**
 * Pref adapter over Services.prefs so applyPerformanceProfile can be unit
 * tested with a mock.
 *
 * @param {object} Services
 */
export function servicesAdapter(Services) {
  const P = Services.prefs;
  return {
    set(name, value) {
      if (P.prefIsLocked(name)) {
        return;
      }
      if (typeof value === "boolean") {
        P.setBoolPref(name, value);
      } else if (typeof value === "number") {
        P.setIntPref(name, value);
      } else {
        P.setStringPref(name, String(value));
      }
    },
  };
}

/**
 * Apply a Mercury performance & memory profile using a pref adapter.
 * Normalizes unknown profile names to "balanced".
 *
 * @param {string} profile
 * @param {object} prefs - adapter with `.set(name, value)`
 * @returns {"balanced"|"turbo"|"low-ram"} normalized profile name applied
 */
export function applyPerformanceProfile(profile, prefs) {
  const normalized = normalizeProfile(profile);
  const settings = PERFORMANCE_PROFILES[normalized];
  prefs.set(PREF_PROFILE, normalized);
  for (const [name, value] of Object.entries(settings)) {
    prefs.set(name, value);
  }
  return normalized;
}

export const MercuryPerformance = {
  setProfile(profile) {
    try {
      return applyPerformanceProfile(profile, servicesAdapter(Services));
    } catch (e) {
      console.error("Mercury Performance Profile:", e);
      return "balanced";
    }
  },
};
