#!/usr/bin/env node
// Unit & static verification tests for Mercury Sub-Project 4:
// MercuryPerformance.sys.mjs profiles, Firefox 160 speed/rendering/Rust prefs
// in 0003 & 0036, moz.build registration, and Mercury Settings l10n coverage.
// Run: node tests/privacy/performance-unit.mjs
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const perfModulePath = join(
  repoRoot,
  "browser/components/mercury/MercuryPerformance.sys.mjs"
);

const {
  PREF_PROFILE,
  PERFORMANCE_PROFILES,
  normalizeProfile,
  applyPerformanceProfile,
  servicesAdapter,
} = await import(pathToFileURL(perfModulePath).href);

function makeMockPrefs(initial = {}, locked = []) {
  const store = new Map(Object.entries(initial));
  const lockedSet = new Set(locked);
  const written = [];
  return {
    _store: store,
    _written: written,
    prefIsLocked: k => lockedSet.has(k),
    setBoolPref: (k, v) => {
      store.set(k, Boolean(v));
      written.push([k, Boolean(v)]);
    },
    setIntPref: (k, v) => {
      store.set(k, Number(v));
      written.push([k, Number(v)]);
    },
    setStringPref: (k, v) => {
      store.set(k, String(v));
      written.push([k, String(v)]);
    },
  };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

await test("normalizeProfile accepts known profiles and falls back to balanced", () => {
  assert.equal(normalizeProfile("balanced"), "balanced");
  assert.equal(normalizeProfile("turbo"), "turbo");
  assert.equal(normalizeProfile("low-ram"), "low-ram");
  assert.equal(normalizeProfile("unknown"), "balanced");
  assert.equal(normalizeProfile(""), "balanced");
  assert.equal(normalizeProfile(null), "balanced");
  assert.equal(normalizeProfile(undefined), "balanced");
});

await test("applyPerformanceProfile writes exact prefs for balanced, turbo, and low-ram", () => {
  for (const profile of ["balanced", "turbo", "low-ram"]) {
    const mock = makeMockPrefs();
    const adapter = servicesAdapter({ prefs: mock });
    const applied = applyPerformanceProfile(profile, adapter);
    assert.equal(applied, profile);
    assert.equal(mock._store.get(PREF_PROFILE), profile);
    const expected = PERFORMANCE_PROFILES[profile];
    for (const [k, v] of Object.entries(expected)) {
      assert.equal(mock._store.get(k), v, `${profile}: ${k}`);
    }
    assert.equal(
      mock._store.size,
      Object.keys(expected).length + 1,
      "must write only profile pref + profile's own perf prefs"
    );
  }
});

await test("applyPerformanceProfile falls back to balanced on invalid profile name", () => {
  const mock = makeMockPrefs();
  const adapter = servicesAdapter({ prefs: mock });
  const applied = applyPerformanceProfile("ludicrous", adapter);
  assert.equal(applied, "balanced");
  assert.equal(mock._store.get(PREF_PROFILE), "balanced");
  assert.equal(mock._store.get("dom.ipc.processPrelaunch.fission.number"), 4);
  assert.equal(mock._store.get("gfx.canvas.accelerated.cache-size"), 512);
});

await test("applyPerformanceProfile never mutates privacy, Hardened mode, or Security Level prefs", () => {
  const protectedPrefs = {
    "mercury.hardened.enabled": true,
    "mercury.security.level": "safest",
    "mercury.security.jitAllowlist": "https://figma.com",
    "privacy.fingerprintingProtection": true,
    "privacy.resistFingerprinting": true,
    "dom.security.https_only_mode": true,
    "network.http.http3.enable_0rtt": false,
    "javascript.options.main_process_disable_jit": true,
    "fission.webContentIsolationStrategy": 1,
  };
  const mock = makeMockPrefs(protectedPrefs);
  const adapter = servicesAdapter({ prefs: mock });

  for (const profile of ["turbo", "low-ram", "balanced", "invalid"]) {
    applyPerformanceProfile(profile, adapter);
    for (const [k, v] of Object.entries(protectedPrefs)) {
      assert.equal(mock._store.get(k), v, `profile '${profile}' mutated ${k}`);
    }
  }
});

await test("servicesAdapter skips locked enterprise-policy prefs", () => {
  const mock = makeMockPrefs(
    { "browser.tabs.unloadOnLowMemory": true },
    ["browser.tabs.unloadOnLowMemory"]
  );
  const adapter = servicesAdapter({ prefs: mock });
  applyPerformanceProfile("turbo", adapter);
  assert.equal(mock._store.get("browser.tabs.unloadOnLowMemory"), true);
  assert.equal(mock._store.get("gfx.canvas.accelerated.cache-size"), 1024);
});

await test("Sub-Project 4 engine/rendering/Rust prefs in 0003 and 0036 exist in Firefox 160 HEAD", () => {
  const p0003 = readFileSync(
    join(repoRoot, "patches/firefox/0003-browser-app-profile-firefox.js.patch"),
    "utf8"
  );
  const p0036 = readFileSync(
    join(repoRoot, "patches/firefox/0036-android-geckoview-mercury-speed-privacy.patch"),
    "utf8"
  );

  const sharedSub4Prefs = [
    "gfx.font_rendering.fontations.enabled",
    "javascript.options.wasm_lazy_tiering",
    "gfx.webrender.batched-upload-threshold",
    "gfx.webrender.compositor.surface-pool-size",
    "gfx.webrender.layer-compositor",
    "network.http.http3.max_gso_segments",
    "network.http.http3.recvBufferSize",
    "network.http.http3.enable_0rtt",
    "mercury.performance.profile",
  ];
  const desktopOnlySub4Prefs = [
    "javascript.options.wasm_simd_avx",
    "dom.ipc.processPrelaunch.fission.number",
    "browser.tabs.unloadOnLowMemory",
  ];

  for (const pref of [...sharedSub4Prefs, ...desktopOnlySub4Prefs]) {
    assert.ok(p0003.includes(`"${pref}"`), `0003 missing Sub-Project 4 pref: ${pref}`);
  }
  for (const pref of sharedSub4Prefs) {
    assert.ok(p0036.includes(`"${pref}"`), `0036 missing Sub-Project 4 pref: ${pref}`);
  }
  // Android ARM64 must NOT enable x86 AVX Wasm SIMD!
  assert.ok(
    !p0036.includes('"javascript.options.wasm_simd_avx"'),
    "0036 (Android ARM64) must not set x86-only javascript.options.wasm_simd_avx"
  );
  // Both 0003 and 0036 must keep QUIC 0-RTT disabled (replay-attack protection)
  assert.ok(
    p0003.includes('pref("network.http.http3.enable_0rtt", false)'),
    "0003 must set network.http.http3.enable_0rtt = false"
  );
  assert.ok(
    p0036.includes('pref("network.http.http3.enable_0rtt", false)'),
    "0036 must set network.http.http3.enable_0rtt = false"
  );

  const mozillaRepo = join(homedir(), "mozilla-unified");
  if (existsSync(join(mozillaRepo, ".git"))) {
    const combined =
      execFileSync("git", ["-C", mozillaRepo, "show", "HEAD:modules/libpref/init/StaticPrefList.yaml"], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }) +
      "\n" +
      execFileSync("git", ["-C", mozillaRepo, "show", "HEAD:modules/libpref/init/all.js"], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }) +
      "\n" +
      execFileSync("git", ["-C", mozillaRepo, "show", "HEAD:browser/app/profile/firefox.js"], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });

    for (const pref of [...sharedSub4Prefs, ...desktopOnlySub4Prefs]) {
      if (pref.startsWith("mercury.")) {
        continue;
      }
      assert.ok(
        combined.includes(pref),
        `Pref '${pref}' not found in Firefox 160 HEAD StaticPrefList.yaml/all.js/firefox.js`
      );
    }
  }
});

await test("moz.build registers MercuryPerformance.sys.mjs and mercury.mjs / 0032 have 0 missing/orphan Fluent IDs", () => {
  const mozBuild = readFileSync(
    join(repoRoot, "browser/components/mercury/moz.build"),
    "utf8"
  );
  assert.ok(
    mozBuild.includes('"MercuryPerformance.sys.mjs"'),
    "browser/components/mercury/moz.build must register MercuryPerformance.sys.mjs"
  );

  const mercuryMjs = readFileSync(
    join(repoRoot, "browser/components/preferences/config/mercury.mjs"),
    "utf8"
  );
  const p0032 = readFileSync(
    join(
      repoRoot,
      "patches/firefox/0032-browser-locales-en-US-browser-preferences-preferences.ftl.patch"
    ),
    "utf8"
  );
  const p0033 = readFileSync(
    join(
      repoRoot,
      "patches/firefox/0033-browser-components-preferences-preferences.js.patch"
    ),
    "utf8"
  );
  const p0038 = readFileSync(
    join(repoRoot, "patches/firefox/0038-mercury-desktop-settings-pane.patch"),
    "utf8"
  );
  const p0029 = readFileSync(
    join(
      repoRoot,
      "patches/firefox/0029-browser-components-preferences-config-privacy.mjs.patch"
    ),
    "utf8"
  );

  for (const id of [
    "mercury-performance-profile",
    "mercury-performance-profile-balanced",
    "mercury-performance-profile-turbo",
    "mercury-performance-profile-low-ram",
    "mercury-fontations",
    "mercury-unload-low-mem",
  ]) {
    assert.ok(mercuryMjs.includes(`"${id}"`), `mercury.mjs missing l10nId ${id}`);
    assert.ok(p0032.includes(`+${id} =`), `0032 missing Fluent definition for ${id}`);
  }

  const definedFtl = new Set(
    [...p0032.matchAll(/^\+([a-z][a-z0-9-]*)\s*=/gm)].map(m => m[1])
  );
  const referenced = new Set([
    ...[...mercuryMjs.matchAll(/l10nId:\s*"([^"]+)"/g)].map(m => m[1]),
    ...[...mercuryMjs.matchAll(/id:\s*"(mercury-[a-z0-9-]+)"/g)].map(m => m[1]),
    ...[...p0038.matchAll(/^\+.*data-l10n-id="([^"]+)"/gm)].map(m => m[1]),
    ...[...p0033.matchAll(/^\+.*l10nId:\s*"(pane-mercury-[^"]+)"/gm)].map(
      m => m[1]
    ),
    ...[...p0029.matchAll(/^\+.*l10nId:\s*"(mercury-[^"]+)"/gm)].map(
      m => m[1]
    ),
  ]);
  for (const id of referenced) {
    assert.ok(definedFtl.has(id), `Missing Fluent ID in 0032: ${id}`);
  }
  for (const id of definedFtl) {
    assert.ok(referenced.has(id), `Orphan Fluent ID in 0032: ${id}`);
  }
});

console.log(`\nPASS: ${passed} performance unit tests`);
