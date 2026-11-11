#!/usr/bin/env node
// Unit test for browser/components/mercury/MercuryHardened.sys.mjs with a
// mocked Services.prefs. Run: node tests/privacy/hardened-unit.mjs
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = join(here, "../../browser/components/mercury/MercuryHardened.sys.mjs");

// --- Minimal Services.prefs mock: default branch + user branch + locks. ---
function makePrefs(defaults) {
  const PREF_INVALID = 0, PREF_STRING = 32, PREF_INT = 64, PREF_BOOL = 128;
  const def = new Map(Object.entries(defaults));
  const user = new Map();
  const locked = new Set();
  const log = [];
  const typeOf = v => (typeof v == "boolean" ? PREF_BOOL : typeof v == "number" ? PREF_INT : PREF_STRING);
  const value = n => (user.has(n) ? user.get(n) : def.get(n));
  const set = (n, v, t) => {
    if (locked.has(n)) throw new Error(`locked ${n}`);
    const existing = value(n);
    if (existing !== undefined && typeOf(existing) != t) throw new Error(`type mismatch ${n}`);
    user.set(n, v);
    log.push(["set", n, v]);
  };
  const get = (n, t, fallback) => {
    const v = value(n);
    if (v === undefined) {
      if (fallback !== undefined) return fallback;
      throw new Error(`no pref ${n}`);
    }
    if (typeOf(v) != t) throw new Error(`type mismatch ${n}`);
    return v;
  };
  return {
    PREF_INVALID, PREF_STRING, PREF_INT, PREF_BOOL,
    _user: user, _locked: locked, _log: log,
    getPrefType: n => (value(n) === undefined ? PREF_INVALID : typeOf(value(n))),
    getBoolPref: (n, f) => get(n, PREF_BOOL, f),
    getIntPref: (n, f) => get(n, PREF_INT, f),
    getStringPref: (n, f) => get(n, PREF_STRING, f),
    setBoolPref: (n, v) => set(n, v, PREF_BOOL),
    setIntPref: (n, v) => set(n, v, PREF_INT),
    setStringPref: (n, v) => set(n, v, PREF_STRING),
    clearUserPref: n => { user.delete(n); log.push(["clear", n]); },
    prefHasUserValue: n => user.has(n),
    prefIsLocked: n => locked.has(n),
  };
}

// Mercury's defaults for the prefs Hardened mode touches.
const DEFAULTS = {
  "mercury.hardened.enabled": false,
  "mercury.hardened.doh.uri": "https://dns.quad9.net/dns-query",
  "privacy.resistFingerprinting": false,
  "privacy.resistFingerprinting.letterboxing": false,
  "browser.contentblocking.category": "standard",
  "privacy.sanitize.sanitizeOnShutdown": false,
  "privacy.clearOnShutdown_v2.cookiesAndStorage": true,
  "privacy.clearOnShutdown_v2.cache": true,
  "privacy.clearOnShutdown_v2.browsingHistoryAndDownloads": true,
  "privacy.clearOnShutdown_v2.formdata": false,
  "privacy.clearOnShutdown_v2.siteSettings": false,
  "dom.security.https_only_mode": false,
  "network.trr.mode": 0,
  "network.trr.uri": "",
  "network.trr.custom_uri": "",
  "browser.urlbar.speculativeConnect.enabled": true,
  "browser.places.speculativeConnect.enabled": true,
  "network.IDN_show_punycode": false,
};
const HARDENED = {
  "privacy.resistFingerprinting": true,
  "privacy.resistFingerprinting.letterboxing": true,
  "browser.contentblocking.category": "strict",
  "privacy.sanitize.sanitizeOnShutdown": true,
  "privacy.clearOnShutdown_v2.cookiesAndStorage": true,
  "privacy.clearOnShutdown_v2.cache": true,
  "privacy.clearOnShutdown_v2.browsingHistoryAndDownloads": false,
  "privacy.clearOnShutdown_v2.formdata": false,
  "privacy.clearOnShutdown_v2.siteSettings": false,
  "dom.security.https_only_mode": true,
  "network.trr.mode": 2,
  "network.trr.uri": "https://dns.quad9.net/dns-query",
  "network.trr.custom_uri": "https://dns.quad9.net/dns-query",
  "browser.urlbar.speculativeConnect.enabled": false,
  "browser.places.speculativeConnect.enabled": false,
  "network.IDN_show_punycode": true,
};

let migrations = 0;
function setup(extraUser = {}) {
  const prefs = makePrefs(DEFAULTS);
  for (const [k, v] of Object.entries(extraUser)) prefs._user.set(k, v);
  globalThis.Services = { prefs };
  globalThis.ChromeUtils = {
    importESModule: url => {
      assert.equal(url, "resource:///modules/Sanitizer.sys.mjs");
      return { Sanitizer: { maybeMigratePrefs: ctx => { assert.equal(ctx, "clearOnShutdown"); migrations++; } } };
    },
  };
  prefs._log.length = 0;
  return prefs;
}
const value = (prefs, n) => (prefs._user.has(n) ? prefs._user.get(n) : DEFAULTS[n]);

const mod = await import(pathToFileURL(modulePath).href);
const { MercuryHardened, applyHardened, restoreHardened, servicesAdapter } = mod;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

test("default state: sync() does nothing when off", () => {
  const prefs = setup();
  MercuryHardened.sync();
  assert.equal(prefs._user.size, 0);
  assert.equal(migrations, 0);
});

test("turning on applies the whole group and records state", () => {
  const prefs = setup();
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  for (const [k, v] of Object.entries(HARDENED)) assert.equal(value(prefs, k), v, k);
  assert.equal(migrations, 1, "sanitizer prefs migrated before applying");
  const state = JSON.parse(prefs._user.get("mercury.hardened.state"));
  // Prefs that already had the hardened value by default are not ours.
  assert.ok(!("privacy.clearOnShutdown_v2.cookiesAndStorage" in state));
  assert.ok(!("privacy.clearOnShutdown_v2.formdata" in state));
  assert.ok("privacy.resistFingerprinting" in state);
  assert.ok(!("p" in state["privacy.resistFingerprinting"]));
});

test("turning off restores Mercury defaults exactly", () => {
  const prefs = setup();
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  prefs._user.set("mercury.hardened.enabled", false);
  MercuryHardened.sync();
  assert.deepEqual([...prefs._user.keys()], ["mercury.hardened.enabled"]);
});

test("tracking protection: restore switches to standard, then clears", () => {
  const prefs = setup();
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  prefs._log.length = 0;
  prefs._user.set("mercury.hardened.enabled", false);
  MercuryHardened.sync();
  const cb = prefs._log.filter(e => e[1] == "browser.contentblocking.category");
  assert.deepEqual(cb, [["set", "browser.contentblocking.category", "standard"], ["clear", "browser.contentblocking.category"]]);
});

test("user changes made while on are kept when turning off", () => {
  const prefs = setup();
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  prefs._user.set("dom.security.https_only_mode", false); // user turned HTTPS-Only off
  prefs._user.set("browser.contentblocking.category", "custom"); // user customised ETP
  prefs._user.set("network.trr.uri", "https://dns.mullvad.net/dns-query"); // picked a provider
  prefs._user.set("mercury.hardened.enabled", false);
  MercuryHardened.sync();
  assert.equal(prefs._user.get("dom.security.https_only_mode"), false);
  assert.equal(prefs._user.get("browser.contentblocking.category"), "custom");
  assert.equal(prefs._user.get("network.trr.uri"), "https://dns.mullvad.net/dns-query");
  assert.equal(value(prefs, "privacy.resistFingerprinting"), false);
  assert.ok(!prefs._user.has("privacy.resistFingerprinting"));
  assert.ok(!prefs._user.has("mercury.hardened.state"));
});

test("user values from before are put back, not reset to defaults", () => {
  const prefs = setup({ "network.trr.mode": 5, "browser.urlbar.speculativeConnect.enabled": true });
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  assert.equal(prefs._user.get("network.trr.mode"), 2);
  prefs._user.set("mercury.hardened.enabled", false);
  MercuryHardened.sync();
  assert.equal(prefs._user.get("network.trr.mode"), 5);
  assert.equal(prefs._user.get("browser.urlbar.speculativeConnect.enabled"), true);
});

test("a pref the user already had at the hardened value is not touched", () => {
  const prefs = setup({ "privacy.resistFingerprinting": true });
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  const state = JSON.parse(prefs._user.get("mercury.hardened.state"));
  assert.ok(!("privacy.resistFingerprinting" in state));
  prefs._user.set("mercury.hardened.enabled", false);
  MercuryHardened.sync();
  assert.equal(prefs._user.get("privacy.resistFingerprinting"), true);
});

test("DoH: keeps a provider the user chose and never downgrades Max protection", () => {
  const prefs = setup({ "network.trr.mode": 3, "network.trr.uri": "https://dns.mullvad.net/dns-query" });
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  assert.equal(prefs._user.get("network.trr.mode"), 3);
  assert.equal(prefs._user.get("network.trr.uri"), "https://dns.mullvad.net/dns-query");
});

test("DoH: provider comes from mercury.hardened.doh.uri", () => {
  const prefs = setup({ "mercury.hardened.doh.uri": "https://dns.mullvad.net/dns-query" });
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  assert.equal(prefs._user.get("network.trr.uri"), "https://dns.mullvad.net/dns-query");
  assert.ok(!Object.values(HARDENED).some(v => String(v).includes("google")));
});

test("locked prefs (enterprise policy) are left alone", () => {
  const prefs = setup();
  prefs._locked.add("dom.security.https_only_mode");
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  assert.ok(!prefs._user.has("dom.security.https_only_mode"));
  prefs._user.set("mercury.hardened.enabled", false);
  MercuryHardened.sync();
  assert.ok(!prefs._user.has("mercury.hardened.state"));
});

test("toggling repeatedly is stable and idempotent", () => {
  const prefs = setup();
  for (let i = 0; i < 3; i++) {
    prefs._user.set("mercury.hardened.enabled", true);
    MercuryHardened.sync();
    MercuryHardened.sync(); // second call is a no-op
    for (const [k, v] of Object.entries(HARDENED)) assert.equal(value(prefs, k), v, k);
    prefs._user.set("mercury.hardened.enabled", false);
    MercuryHardened.sync();
    assert.deepEqual([...prefs._user.keys()], ["mercury.hardened.enabled"]);
  }
});

test("corrupt state never throws and is cleared", () => {
  const prefs = setup({ "mercury.hardened.state": "{not json" });
  MercuryHardened.sync();
  assert.ok(!prefs._user.has("mercury.hardened.state"));
});

test("pure functions work on any adapter", () => {
  const prefs = setup();
  const a = servicesAdapter({ prefs });
  const state = applyHardened(a);
  assert.ok(Object.keys(state).length >= 10);
  const restored = restoreHardened(a);
  assert.equal(restored.length, Object.keys(state).length);
});

console.log(`\nPASS: ${passed} unit tests`);
