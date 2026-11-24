#!/usr/bin/env node
// Unit test for browser/components/mercury/MercuryHardened.sys.mjs with a
// mocked Services.prefs. Run: node tests/privacy/hardened-unit.mjs
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const modulePath = join(repoRoot, "browser/components/mercury/MercuryHardened.sys.mjs");

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
  "mercury.hardened.doh.uri": "https://dns.adguard-dns.com/dns-query",
  "mercury.rfp.preserveSystemTheme": true,
  "privacy.resistFingerprinting": false,
  "privacy.resistFingerprinting.letterboxing": false,
  "privacy.fingerprintingProtection.overrides": "+EfficientCanvasRandomization,-CanvasRandomization,+CanvasExtractionFromThirdPartiesIsBlocked,+FontVisibilityLangPack,+ScreenAvailToResolution,+WindowScreenXY,+WindowInnerScreenXY,+ScreenPixelDepth,+MouseEventScreenPoint,+NavigatorHWConcurrencyTiered,+MaxTouchPointsCollapse,+IMEStyle,+WebGLRendererConstant,+WebGLVendorSanitize,+WebGLRandomization,+WebGLRenderCapability,+Gamepad,+DeviceSensors,+AudioSampleRate,+AudioContext,+MediaDevices,+MediaCapabilities,+WebCodecs,+SpeechSynthesis,+NetworkConnection,+DiskStorageLimit,+UseStandinsForNativeColors,+CSSColorInfo,+CSSVideoDynamicRange,+CSSPointerCapabilities,+CSSPrefersReducedTransparency,+CSSInvertedColors,+VideoElementPlaybackQuality,+PdfjsSpoof,-JSMathFdlibm,-CSSPrefersColorScheme",
  "browser.contentblocking.category": "strict",
  "privacy.sanitize.sanitizeOnShutdown": false,
  "privacy.clearOnShutdown_v2.cookiesAndStorage": true,
  "privacy.clearOnShutdown_v2.cache": true,
  "privacy.clearOnShutdown_v2.browsingHistoryAndDownloads": true,
  "privacy.clearOnShutdown_v2.formdata": false,
  "privacy.clearOnShutdown_v2.siteSettings": false,
  "dom.security.https_only_mode": false,
  "network.trr.mode": 2,
  "network.trr.uri": "https://dns.adguard-dns.com/dns-query",
  "network.trr.custom_uri": "",
  "browser.urlbar.speculativeConnect.enabled": true,
  "browser.places.speculativeConnect.enabled": true,
  "network.http.speculative-parallel-limit": 20,
  "network.dns.disablePrefetch": false,
  "network.dns.disablePrefetchFromHTTPS": false,
  "network.prefetch-next": true,
  "network.predictor.enabled": true,
  "network.predictor.enable-prefetch": true,
  "network.IDN_show_punycode": false,
};
const HARDENED = {
  "privacy.resistFingerprinting": true,
  "privacy.resistFingerprinting.letterboxing": true,
  "privacy.fingerprintingProtection.overrides": "-CSSPrefersColorScheme",
  "browser.contentblocking.category": "strict",
  "privacy.sanitize.sanitizeOnShutdown": true,
  "privacy.clearOnShutdown_v2.cookiesAndStorage": true,
  "privacy.clearOnShutdown_v2.cache": true,
  "privacy.clearOnShutdown_v2.browsingHistoryAndDownloads": false,
  "privacy.clearOnShutdown_v2.formdata": false,
  "privacy.clearOnShutdown_v2.siteSettings": false,
  "dom.security.https_only_mode": true,
  "network.trr.mode": 2,
  "network.trr.uri": "https://dns.adguard-dns.com/dns-query",
  "network.trr.custom_uri": "https://dns.adguard-dns.com/dns-query",
  "browser.urlbar.speculativeConnect.enabled": false,
  "browser.places.speculativeConnect.enabled": false,
  "network.http.speculative-parallel-limit": 0,
  "network.dns.disablePrefetch": true,
  "network.dns.disablePrefetchFromHTTPS": true,
  "network.prefetch-next": false,
  "network.predictor.enabled": false,
  "network.predictor.enable-prefetch": false,
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
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

await test("default state: sync() does nothing when off", () => {
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

test("tracking protection: strict default is preserved and user custom is restored", () => {
  const prefs = setup({ "browser.contentblocking.category": "standard" });
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  assert.equal(value(prefs, "browser.contentblocking.category"), "strict");
  prefs._user.set("mercury.hardened.enabled", false);
  MercuryHardened.sync();
  assert.equal(prefs._user.get("browser.contentblocking.category"), "standard");
});

test("security levels: safer disables Ion/WASM; safest disables all JIT & WebGL; standard restores", () => {
  const prefs = setup();
  const a = servicesAdapter({ prefs });
  mod.applySecurityLevel("safer", a);
  assert.equal(prefs._user.get("javascript.options.ion"), false);
  assert.equal(prefs._user.get("javascript.options.wasm"), false);
  assert.ok(!prefs._user.has("webgl.disabled"));
  mod.applySecurityLevel("safest", a);
  assert.equal(prefs._user.get("javascript.options.baselinejit"), false);
  assert.equal(prefs._user.get("webgl.disabled"), true);
  mod.applySecurityLevel("standard", a);
  assert.ok(!prefs._user.has("javascript.options.ion"));
  assert.ok(!prefs._user.has("webgl.disabled"));
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

test("preserveSystemTheme keeps -CSSPrefersColorScheme when hardened is on", () => {
  const prefs = setup();
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  assert.equal(value(prefs, "privacy.fingerprintingProtection.overrides"), "-CSSPrefersColorScheme");
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

test("preserveSystemTheme=false clears overrides to empty string under hardened", () => {
  const prefs = setup({ "mercury.rfp.preserveSystemTheme": false });
  prefs._user.set("mercury.hardened.enabled", true);
  MercuryHardened.sync();
  assert.equal(value(prefs, "privacy.fingerprintingProtection.overrides"), "");
  prefs._user.set("mercury.hardened.enabled", false);
  MercuryHardened.sync();
  assert.equal(
    value(prefs, "privacy.fingerprintingProtection.overrides"),
    DEFAULTS["privacy.fingerprintingProtection.overrides"]
  );
});

test("security level falls back to standard on invalid input", () => {
  const prefs = setup();
  const a = servicesAdapter({ prefs });
  mod.applySecurityLevel("safest", a);
  assert.equal(prefs._user.get("webgl.disabled"), true);
  mod.applySecurityLevel("bogus-level", a);
  assert.equal(prefs._user.get("mercury.security.level"), "standard");
  assert.ok(!prefs._user.has("webgl.disabled"));
});

await test("newIdentity invokes Services.clearData.deleteData with expected flags and purges unused burners", async () => {
  setup();
  let capturedFlags = 0;
  let burnerPurged = false;
  globalThis.Ci = {
    nsIClearDataService: {
      CLEAR_COOKIES: 1 << 0,
      CLEAR_ALL_CACHES: 1 << 1,
      CLEAR_DOM_STORAGES: 1 << 2,
      CLEAR_AUTH_TOKENS: 1 << 3,
      CLEAR_AUTH_CACHE: 1 << 4,
      CLEAR_SESSION_HISTORY: 1 << 5,
      CLEAR_EME: 1 << 6,
      CLEAR_SECURITY_SETTINGS: 1 << 7,
    },
  };
  globalThis.Services.clearData = {
    deleteData(flags, cb) {
      capturedFlags = flags;
      cb();
    },
  };
  globalThis.ChromeUtils = {
    importESModule: url => {
      if (url === "resource:///modules/MercuryBurner.sys.mjs") {
        return {
          MercuryBurner: {
            async purgeAllUnused() {
              burnerPurged = true;
              return [];
            },
          },
        };
      }
      throw new Error(`unexpected module: ${url}`);
    },
  };
  await MercuryHardened.newIdentity();
  assert.equal(capturedFlags, 0xff);
  assert.equal(burnerPurged, true);
});

await test("CROWD_BLEND_OVERRIDES targets exist in Firefox 160 RFPTargets.inc and match 0003; strip_list excludes functional params", () => {
  const overrides = mod.CROWD_BLEND_OVERRIDES.split(",").map(s => s.trim()).filter(Boolean);
  assert.equal(overrides.length, 36);
  const targets = overrides.map(tok => {
    assert.ok(tok[0] === "+" || tok[0] === "-", `invalid override token: ${tok}`);
    return tok.slice(1);
  });

  // Check against $HOME/mozilla-unified RFPTargets.inc if present on disk.
  const rfpTargetsPath = join(
    homedir(),
    "mozilla-unified/toolkit/components/resistfingerprinting/RFPTargets.inc"
  );
  if (existsSync(rfpTargetsPath)) {
    const rfpInc = readFileSync(rfpTargetsPath, "utf8");
    const validTargets = new Set(
      [...rfpInc.matchAll(/ITEM_VALUE\(\s*([A-Za-z0-9_]+)\s*,/g)].map(m => m[1])
    );
    for (const t of targets) {
      assert.ok(validTargets.has(t), `Unknown RFPTarget in CROWD_BLEND_OVERRIDES: ${t}`);
    }
  }

  // Verify exact parity with 0003 and safe strip_list (if present in 0003).
  const p0003 = readFileSync(
    join(repoRoot, "patches/firefox/0003-browser-app-profile-firefox.js.patch"),
    "utf8"
  );
  const fppMatch = p0003.match(
    /^\+pref\("privacy\.fingerprintingProtection\.overrides",\s*"([^"]+)"\);/m
  );
  assert.ok(fppMatch, "privacy.fingerprintingProtection.overrides not found in 0003");
  assert.equal(
    fppMatch[1],
    mod.CROWD_BLEND_OVERRIDES,
    "0003 privacy.fingerprintingProtection.overrides must match MercuryHardened.CROWD_BLEND_OVERRIDES exactly"
  );

  const stripMatch = p0003.match(
    /^\+pref\("privacy\.query_stripping\.strip_list",\s*"([^"]+)"\);/m
  );
  assert.ok(stripMatch, "privacy.query_stripping.strip_list not found in 0003");
  const stripParams = new Set(stripMatch[1].trim().split(/\s+/).filter(Boolean));
  assert.ok(stripParams.size >= 50, `expected curated strip_list >= 50 params, got ${stripParams.size}`);
  const forbiddenFunctional = [
    "id",
    "ref",
    "v",
    "t",
    "page",
    "q",
    "token",
    "code",
    "state",
    "redirect",
  ];
  for (const fp of forbiddenFunctional) {
    assert.ok(
      !stripParams.has(fp),
      `functional OAuth/search/nav param '${fp}' must NOT be in privacy.query_stripping.strip_list`
    );
  }
});

await test("desktop Mercury settings pane l10n IDs, groups, settings, and pref safety", () => {
  const mercuryMjs = readFileSync(
    join(repoRoot, "browser/components/preferences/config/mercury.mjs"),
    "utf8"
  );
  const mercuryCodeOnly = mercuryMjs
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const ftlPatch = readFileSync(
    join(
      repoRoot,
      "patches/firefox/0032-browser-locales-en-US-browser-preferences-preferences.ftl.patch"
    ),
    "utf8"
  );
  const prefsJsPatch = readFileSync(
    join(
      repoRoot,
      "patches/firefox/0033-browser-components-preferences-preferences.js.patch"
    ),
    "utf8"
  );
  const panePatch = readFileSync(
    join(repoRoot, "patches/firefox/0038-mercury-desktop-settings-pane.patch"),
    "utf8"
  );
  const privacyPatch = readFileSync(
    join(
      repoRoot,
      "patches/firefox/0029-browser-components-preferences-config-privacy.mjs.patch"
    ),
    "utf8"
  );

  // Must not call Preferences.addAll/add in mercury.mjs (prevents cross-pane collisions).
  assert.ok(
    !/Preferences\.add(All)?\s*\(/.test(mercuryCodeOnly),
    "mercury.mjs must not call Preferences.add/addAll to avoid cross-pane pref collisions"
  );

  // Must use real Firefox 160 pref name gfx.webrender.svg-shapes.
  assert.ok(
    !mercuryMjs.includes("gfx.webrender.svg-shapes.enabled"),
    "gfx.webrender.svg-shapes.enabled does not exist in Firefox 160"
  );
  assert.ok(mercuryMjs.includes('"gfx.webrender.svg-shapes"'));

  // Extract defined Fluent message IDs from 0032.
  const definedFtl = new Set(
    [...ftlPatch.matchAll(/^\+([a-z][a-z0-9-]*)\s*=/gm)].map(m => m[1])
  );

  // Every l10nId referenced in mercury.mjs, 0033 (mercury), 0038, 0029 must exist in 0032.
  const referenced = new Set([
    ...[...mercuryMjs.matchAll(/l10nId:\s*"([^"]+)"/g)].map(m => m[1]),
    ...[...mercuryMjs.matchAll(/id:\s*"(mercury-[a-z0-9-]+)"/g)].map(m => m[1]),
    ...[...panePatch.matchAll(/^\+.*data-l10n-id="([^"]+)"/gm)].map(m => m[1]),
    ...[...prefsJsPatch.matchAll(/^\+.*l10nId:\s*"(pane-mercury-[^"]+)"/gm)].map(
      m => m[1]
    ),
    ...[...privacyPatch.matchAll(/^\+.*l10nId:\s*"(mercury-[^"]+)"/gm)].map(
      m => m[1]
    ),
  ]);
  for (const id of referenced) {
    assert.ok(definedFtl.has(id), `Missing Fluent ID in 0032: ${id}`);
  }
  for (const id of definedFtl) {
    assert.ok(referenced.has(id), `Orphan Fluent ID in 0032: ${id}`);
  }

  // Every groupId in 0033's CONFIG_PANES.mercury must be registered in mercury.mjs.
  const groupIdsMatch = prefsJsPatch.match(
    /mercury:\s*\{[\s\S]*?groupIds:\s*\[([\s\S]*?)\]/
  );
  assert.ok(groupIdsMatch, "CONFIG_PANES.mercury.groupIds not found in 0033");
  const groupIds = [...groupIdsMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.ok(groupIds.length >= 5);
  for (const gid of groupIds) {
    assert.ok(
      new RegExp(`\\b${gid}:\\s*\\{`).test(mercuryMjs),
      `Missing SettingGroup registration in mercury.mjs: ${gid}`
    );
  }

  // Every item.id in SettingGroupManager.registerGroups must have a Setting registered.
  const groupsBlock = mercuryMjs.slice(
    mercuryMjs.indexOf("SettingGroupManager.registerGroups(")
  );
  const registeredSettings = new Set([
    ...[...mercuryMjs.matchAll(/addPrefSetting\(\s*"([^"]+)"/g)].map(m => m[1]),
    ...[
      ...mercuryMjs.matchAll(
        /Preferences\.addSetting\(\s*\{\s*id:\s*"([^"]+)"/g
      ),
    ].map(m => m[1]),
  ]);
  const itemIds = [...groupsBlock.matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1]);
  assert.ok(itemIds.length >= 25);
  for (const iid of itemIds) {
    assert.ok(
      registeredSettings.has(iid),
      `Missing Setting registration for group item: ${iid}`
    );
  }
});

console.log(`\nPASS: ${passed} unit tests`);
