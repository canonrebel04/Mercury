#!/usr/bin/env node
// Unit & static verification tests for Mercury Sub-Project 3:
// Per-Site JIT/WASM Allowlist helpers, Firefox 161 security/sandbox/Fission prefs,
// 0043 C++ patch markers, and Mercury Settings l10n coverage.
// Run: node tests/privacy/security-unit.mjs
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
const hardenedModulePath = join(
  repoRoot,
  "browser/components/mercury/MercuryHardened.sys.mjs"
);

const {
  PREF_JIT_ALLOWLIST,
  normalizeJitOrigin,
  parseJitAllowlist,
  formatJitAllowlist,
  addJitAllowlistOrigin,
  removeJitAllowlistOrigin,
  isOriginJitAllowed,
} = await import(pathToFileURL(hardenedModulePath).href);

function makeSimplePrefs(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: k => store.get(k),
    set: (k, v) => store.set(k, v),
    clear: k => store.delete(k),
    hasUserValue: k => store.has(k),
  };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

await test("normalizeJitOrigin normalizes valid http(s) origins, bare hosts, ports, and bare root slash", () => {
  assert.equal(normalizeJitOrigin("https://figma.com"), "https://figma.com");
  assert.equal(normalizeJitOrigin("  HTTPS://FIGMA.COM/  "), "https://figma.com");
  assert.equal(normalizeJitOrigin("figma.com"), "https://figma.com");
  assert.equal(normalizeJitOrigin("Figma.COM/"), "https://figma.com");
  assert.equal(normalizeJitOrigin("figma.com:8443"), "https://figma.com:8443");
  assert.equal(normalizeJitOrigin("https://figma.com:443"), "https://figma.com");
  assert.equal(normalizeJitOrigin("http://localhost:3000/"), "http://localhost:3000");
  assert.equal(normalizeJitOrigin("http://localhost:80"), "http://localhost");
  assert.equal(normalizeJitOrigin("http://[::1]:8080"), "http://[::1]:8080");
});

await test("normalizeJitOrigin rejects wildcards, paths, queries, fragments, bad schemes, and malformed hosts", () => {
  for (const bad of [
    "",
    "   ",
    null,
    undefined,
    "*",
    "*.figma.com",
    "https://*.figma.com",
    "https://figma.com/*",
    "https://figma.com/file/123",
    "figma.com/foo",
    "https://figma.com//",
    "https://figma.com?foo=1",
    "https://figma.com#section",
    "https://user:pass@figma.com",
    "https://figma.com^userContextId=1",
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "ftp://files.example.com",
    "about:blank",
    "chrome://browser/content/browser.xhtml",
    "moz-extension://12345678-1234-1234-1234-1234567890ab",
    "https://.figma.com",
    "https://figma..com",
    "https://-bad.com",
    "https://bad-.com",
    "https://figma.com:99999",
    "https://figma.com:0",
    "http://has space.com",
  ]) {
    assert.equal(normalizeJitOrigin(bad), null, `expected null for ${String(bad)}`);
  }
});

await test("parseJitAllowlist and formatJitAllowlist deduplicate preserving order and drop invalid entries", () => {
  const parsed = parseJitAllowlist(
    " FIGMA.COM, https://photopea.com/ , *.evil.com, https://figma.com:443  http://localhost:3000 https://figma.com/badpath "
  );
  assert.deepEqual(parsed, [
    "https://figma.com",
    "https://photopea.com",
    "http://localhost:3000",
  ]);
  assert.equal(
    formatJitAllowlist(["Figma.com", "https://photopea.com/", "https://figma.com", "*.bad"]),
    "https://figma.com,https://photopea.com"
  );
  assert.equal(formatJitAllowlist(""), "");
  assert.deepEqual(parseJitAllowlist(""), []);
});

await test("addJitAllowlistOrigin and removeJitAllowlistOrigin mutate pref cleanly", () => {
  const prefs = makeSimplePrefs({ [PREF_JIT_ALLOWLIST]: "" });
  assert.equal(addJitAllowlistOrigin("*.wildcard.com", prefs), false);
  assert.equal(prefs.get(PREF_JIT_ALLOWLIST), "");

  assert.equal(addJitAllowlistOrigin("figma.com", prefs), true);
  assert.equal(prefs.get(PREF_JIT_ALLOWLIST), "https://figma.com");

  // Duplicate add is idempotent
  assert.equal(addJitAllowlistOrigin("HTTPS://FIGMA.COM/", prefs), true);
  assert.equal(prefs.get(PREF_JIT_ALLOWLIST), "https://figma.com");

  assert.equal(addJitAllowlistOrigin("http://localhost:8080", prefs), true);
  assert.equal(
    prefs.get(PREF_JIT_ALLOWLIST),
    "https://figma.com,http://localhost:8080"
  );

  assert.equal(removeJitAllowlistOrigin("https://notpresent.example", prefs), false);
  assert.equal(removeJitAllowlistOrigin("figma.com", prefs), true);
  assert.equal(prefs.get(PREF_JIT_ALLOWLIST), "http://localhost:8080");
});

await test("isOriginJitAllowed handles OriginAttributes suffix and rejects spoofing/port/scheme mismatches", () => {
  const prefs = makeSimplePrefs({
    [PREF_JIT_ALLOWLIST]: "https://figma.com,http://localhost:3000",
  });

  // Exact matches (with and without OriginAttributes suffix)
  assert.equal(isOriginJitAllowed("https://figma.com", prefs), true);
  assert.equal(isOriginJitAllowed("https://figma.com^userContextId=1", prefs), true);
  assert.equal(
    isOriginJitAllowed("https://figma.com^userContextId=12&privateBrowsingId=1", prefs),
    true
  );
  assert.equal(
    isOriginJitAllowed("http://localhost:3000^partitionKey=(https,localhost)", prefs),
    true
  );

  // Suffix / prefix / subdomain / port / scheme / non-http spoofing rejections
  assert.equal(isOriginJitAllowed("https://evil-figma.com", prefs), false);
  assert.equal(isOriginJitAllowed("https://figma.com.evil.org", prefs), false);
  assert.equal(isOriginJitAllowed("https://sub.figma.com", prefs), false);
  assert.equal(isOriginJitAllowed("https://figma.com:8443", prefs), false);
  assert.equal(isOriginJitAllowed("https://figma.com:8443^userContextId=1", prefs), false);
  assert.equal(isOriginJitAllowed("http://figma.com", prefs), false);
  assert.equal(isOriginJitAllowed("https://localhost:3000", prefs), false);
  assert.equal(isOriginJitAllowed("http://localhost:3001", prefs), false);
  assert.equal(isOriginJitAllowed("figma.com", prefs), false);
  assert.equal(isOriginJitAllowed("moz-extension://abc", prefs), false);
  assert.equal(isOriginJitAllowed("file:///tmp/x.html", prefs), false);
  assert.equal(isOriginJitAllowed("", prefs), false);
});

await test("Sub-Project 3 security/sandbox/Fission/TLS prefs in 0003 and 0036 exist in Firefox 161 HEAD", () => {
  const p0003 = readFileSync(
    join(repoRoot, "patches/firefox/0003-browser-app-profile-firefox.js.patch"),
    "utf8"
  );
  const p0036 = readFileSync(
    join(repoRoot, "patches/firefox/0036-android-geckoview-mercury-speed-privacy.patch"),
    "utf8"
  );

  const expectedSharedPrefs = [
    "javascript.options.main_process_disable_jit",
    "javascript.options.content_process_write_protect_code",
    "fission.autostart",
    "fission.webContentIsolationStrategy",
    "security.tls.version.min",
    "security.ssl.require_safe_negotiation",
    "dom.security.https_only_mode_send_http_background_request",
    "security.mixed_content.block_display_content",
    "security.csp.reporting.enabled",
    "security.dialog_enable_delay",
    "network.auth.subresource-http-auth-allow",
    "mercury.security.jitAllowlist",
  ];
  const expectedDesktopOnlyPrefs = [
    "browser.download.always_ask_before_handling_new_types",
    "security.sandbox.content.win32k-disable",
    "security.sandbox.gmp.win32k-disable",
    "security.sandbox.content.shadow-stack.enabled",
    "security.sandbox.gpu.shadow-stack.enabled",
    "security.sandbox.rdd.shadow-stack.enabled",
    "security.sandbox.gmp.shadow-stack.enabled",
    "security.sandbox.rdd.acg.enabled",
    "security.sandbox.gmp.acg.enabled",
    "security.sandbox.utility-wmf.acg.enabled",
    "security.sandbox.cig.prespawn.enabled",
    "security.sandbox.content.close-ksecdd-handle",
    "security.sandbox.content.level",
    "security.sandbox.gpu.level",
    "security.sandbox.warn_unprivileged_namespaces",
  ];

  // Ensure nonexistent pref name is never used
  assert.ok(
    !p0003.includes('"javascript.options.write_protect_code"'),
    "0003 must use javascript.options.content_process_write_protect_code, not write_protect_code"
  );
  assert.ok(
    !p0036.includes('"javascript.options.write_protect_code"'),
    "0036 must use javascript.options.content_process_write_protect_code, not write_protect_code"
  );

  for (const pref of [...expectedSharedPrefs, ...expectedDesktopOnlyPrefs]) {
    assert.ok(p0003.includes(`"${pref}"`), `0003 missing Sub-Project 3 pref: ${pref}`);
  }
  for (const pref of expectedSharedPrefs) {
    assert.ok(p0036.includes(`"${pref}"`), `0036 missing Sub-Project 3 pref: ${pref}`);
  }

  // Verify every Firefox pref actually exists in $HOME/mozilla-unified HEAD if present.
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

    for (const pref of [...expectedSharedPrefs, ...expectedDesktopOnlyPrefs]) {
      if (pref.startsWith("mercury.")) {
        continue;
      }
      assert.ok(
        combined.includes(pref),
        `Pref '${pref}' not found in Firefox 161 HEAD StaticPrefList.yaml/all.js/firefox.js`
      );
    }
  }
});

await test("0043-mercury-per-site-jit-allowlist.patch C++ markers and mercury.mjs / 0032 l10n coverage", () => {
  const p0043Path = join(
    repoRoot,
    "patches/firefox/0043-mercury-per-site-jit-allowlist.patch"
  );
  assert.ok(existsSync(p0043Path), "0043-mercury-per-site-jit-allowlist.patch must exist");
  const p0043 = readFileSync(p0043Path, "utf8");
  for (const marker of [
    "XPCJSContext.cpp",
    "xpcprivate.h",
    "ContentChild.cpp",
    "IsCurrentProcessJitAllowlisted",
    "XRE_IsContentProcess",
    "mercury.security.jitAllowlist",
    "ReloadJitAllowlist",
    "RecvSetRemoteType",
    "JSJITCOMPILER_ION_ENABLE",
    "JSJITCOMPILER_BASELINE_ENABLE",
    "setWasm(true)",
  ]) {
    assert.ok(p0043.includes(marker), `0043 missing expected C++ marker: ${marker}`);
  }

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
  for (const id of [
    "mercury-jit-allowlist",
    "mercury-main-process-no-jit",
    "mercury-fission-isolate-all",
  ]) {
    assert.ok(mercuryMjs.includes(`"${id}"`), `mercury.mjs missing l10nId ${id}`);
    assert.ok(p0032.includes(`+${id} =`), `0032 missing Fluent definition for ${id}`);
  }
});

console.log(`\nPASS: ${passed} security unit tests`);
