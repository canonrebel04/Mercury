#!/usr/bin/env node
// Integration test for Mercury's privacy defaults and Hardened mode, run
// against a real Firefox 159 binary prepared by make-test-browser.py.
//
//   python3 tests/privacy/make-test-browser.py /path/to/firefox /tmp/ff-mercury
//   MERCURY_BIN=/tmp/ff-mercury/firefox node tests/privacy/integration.mjs
//
// Drives the browser headless over Marionette (chrome-privileged scripts to
// read prefs, content scripts to check what pages see).
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const BIN = process.env.MERCURY_BIN;
if (!BIN) {
  console.error("set MERCURY_BIN");
  process.exit(2);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (name, detail = "") => {
  passed++;
  console.log(`  ok  ${name}${detail ? ` - ${detail}` : ""}`);
};

async function freePort() {
  return new Promise(res => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

// --- tiny Marionette client -------------------------------------------------
class Marionette {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.id = 0;
    this.waiting = new Map();
    this.hello = null;
    sock.on("data", d => this.#onData(d));
  }
  static async connect(port) {
    for (let i = 0; i < 120; i++) {
      try {
        const sock = await new Promise((res, rej) => {
          const s = net.connect(port, "127.0.0.1", () => res(s));
          s.once("error", rej);
        });
        const m = new Marionette(sock);
        await new Promise(r => (m.hello = r));
        return m;
      } catch {
        await sleep(250);
      }
    }
    throw new Error("Marionette did not start");
  }
  #onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const colon = this.buf.indexOf(":");
      if (colon < 0) return;
      const len = Number(this.buf.subarray(0, colon).toString());
      if (this.buf.length < colon + 1 + len) return;
      const msg = JSON.parse(this.buf.subarray(colon + 1, colon + 1 + len).toString());
      this.buf = this.buf.subarray(colon + 1 + len);
      if (!Array.isArray(msg)) {
        this.hello?.(msg);
        this.hello = null;
        continue;
      }
      const [, id, error, result] = msg;
      const w = this.waiting.get(id);
      this.waiting.delete(id);
      if (error) w?.rej(new Error(`${error.error}: ${error.message}`));
      else w?.res(result);
    }
  }
  send(name, params = {}) {
    const id = ++this.id;
    const body = Buffer.from(JSON.stringify([0, id, name, params]));
    this.sock.write(`${body.length}:`);
    this.sock.write(body);
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id);
          rej(new Error(`${name} timed out`));
        }
      }, 60000);
    });
  }
  async chrome(script, args = []) {
    await this.send("Marionette:SetContext", { value: "chrome" });
    const r = await this.send("WebDriver:ExecuteScript", { script, args });
    return r.value;
  }
  async navigate(url) {
    await this.send("Marionette:SetContext", { value: "content" });
    await this.send("WebDriver:Navigate", { url });
  }
  async content(script, args = []) {
    await this.send("Marionette:SetContext", { value: "content" });
    const r = await this.send("WebDriver:ExecuteScript", { script, args });
    return r.value;
  }
}

async function launch(profile, extraUserJs = "") {
  const port = await freePort();
  writeFileSync(
    join(profile, "user.js"),
    `user_pref("marionette.port", ${port});\n` +
      // Keep the test offline-friendly and quiet.
      `user_pref("browser.shell.checkDefaultBrowser", false);\n` +
      extraUserJs
  );
  const proc = spawn(BIN, ["--headless", "--marionette", "--no-remote", "--profile", profile, "about:blank"], {
    env: { ...process.env, TZ: "America/Chicago", MOZ_CRASHREPORTER_DISABLE: "1", MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
    stdio: "ignore",
  });
  const m = await Marionette.connect(port);
  await m.send("WebDriver:NewSession", { capabilities: { alwaysMatch: { acceptInsecureCerts: false } } });
  await sleep(1500); // let delayed startup (ContentBlockingPrefs etc.) settle
  m.proc = proc;
  return m;
}

async function quit(m) {
  try {
    await m.send("Marionette:Quit", { flags: ["eForceQuit"] });
  } catch {}
  await new Promise(r => {
    if (m.proc.exitCode !== null) return r();
    m.proc.on("exit", r);
    setTimeout(() => {
      m.proc.kill("SIGKILL");
      r();
    }, 15000);
  });
}

const readPrefs = names => `
  const out = {};
  for (const n of ${JSON.stringify(names)}) {
    const t = Services.prefs.getPrefType(n);
    out[n] = t == 128 ? Services.prefs.getBoolPref(n) : t == 64 ? Services.prefs.getIntPref(n) : t == 32 ? Services.prefs.getStringPref(n) : null;
  }
  return out;`;
const userValues = names => `return ${JSON.stringify(names)}.filter(n => Services.prefs.prefHasUserValue(n));`;

const DEFAULT_ON = {
  "privacy.fingerprintingProtection": true,
  "privacy.query_stripping.enabled": true,
  "privacy.query_stripping.enabled.pbmode": true,
  "dom.webgpu.enabled": false,
  "network.http.referer.XOriginTrimmingPolicy": 2,
  "media.peerconnection.ice.proxy_only_if_behind_proxy": true,
  "security.OCSP.enabled": 0,
  "security.pki.crlite_mode": 2,
  "pdfjs.enableScripting": false,
  "browser.helperApps.deleteTempFileOnExit": true,
  "mercury.hardened.enabled": false,
  "browser.contentblocking.category": "standard",
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
  "dom.security.https_only_mode": true,
  "network.trr.mode": 2,
  "network.trr.uri": "https://dns.quad9.net/dns-query",
  "browser.urlbar.speculativeConnect.enabled": false,
  "browser.places.speculativeConnect.enabled": false,
  "network.IDN_show_punycode": true,
};
const GROUP = Object.keys(HARDENED);
const MODULE = "moz-src:///browser/components/mercury/MercuryHardened.sys.mjs";
const tzScript = "return JSON.parse(document.title).tz;";
const offsetScript = "return JSON.parse(document.title).offset;";
const gpuScript = "return JSON.parse(document.title).gpu;";
const work = mkdtempSync(join(tmpdir(), "mercury-privacy-"));
// A local web page (RFP doesn't apply to data: or about: documents).
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  // The page reports what *it* sees (Marionette's own scripts run in a
  // separate sandbox that resistFingerprinting doesn't apply to).
  res.end(`<title>t</title><script>
    document.title = JSON.stringify({
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offset: new Date().getTimezoneOffset(),
      gpu: "gpu" in navigator,
    });</script>`);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const page = `http://127.0.0.1:${server.address().port}/`;

try {
  // --- 1. defaults on a fresh profile ---------------------------------------
  const profile = join(work, "p1");
  (await import("node:fs")).mkdirSync(profile);
  let m = await launch(profile);
  const prefs = await m.chrome(readPrefs(Object.keys(DEFAULT_ON)));
  assert.deepEqual(prefs, DEFAULT_ON);
  ok("default-on prefs are active", Object.keys(DEFAULT_ON).length + " prefs");
  // (Firefox itself stores the matched category as a user value.)
  const userSet = await m.chrome(userValues(Object.keys(DEFAULT_ON).filter(n => n != "browser.contentblocking.category")));
  assert.deepEqual(userSet, [], "defaults, not user values");
  ok("they are defaults, so tracking protection still reads 'Standard'");
  const ubo = await m.chrome(`return Services.policies.getExtensionSettings("uBlock0@raymondhill.net");`);
  assert.equal(ubo?.private_browsing, true);
  ok("policy: uBlock Origin allowed in private windows");
  assert.equal(await m.chrome(`return Cu.isESModuleLoaded(${JSON.stringify(MODULE)});`), false);
  assert.equal(await m.chrome(`return Services.prefs.prefHasUserValue("mercury.hardened.state");`), false);
  ok("Hardened mode off: its module is not even loaded");

  await m.navigate(page);
  assert.equal(await m.content(tzScript), "America/Chicago");
  assert.equal(await m.content(gpuScript), false);
  ok("pages see the real timezone and no WebGPU");

  // --- 2. flip Hardened mode on ---------------------------------------------
  await m.chrome(`Services.prefs.setBoolPref("mercury.hardened.enabled", true);`);
  await sleep(300);
  assert.deepEqual(await m.chrome(readPrefs(GROUP)), HARDENED);
  ok("turning on applies the group", GROUP.length + " prefs");
  const strictSide = await m.chrome(readPrefs([
    "privacy.trackingprotection.socialtracking.enabled",
    "privacy.trackingprotection.emailtracking.enabled",
    "privacy.sanitize.clearOnShutdown.hasMigratedToNewPrefs3",
  ]));
  assert.equal(strictSide["privacy.trackingprotection.socialtracking.enabled"], true);
  assert.equal(strictSide["privacy.trackingprotection.emailtracking.enabled"], true);
  assert.equal(strictSide["privacy.sanitize.clearOnShutdown.hasMigratedToNewPrefs3"], true);
  ok("Firefox switched tracking protection to Strict; clear-on-close prefs migrated first");
  await m.navigate(page + "?2");
  assert.equal(await m.content(offsetScript), 0);
  ok("resistFingerprinting is live: newly loaded pages see UTC+0", await m.content(tzScript));

  // --- 3. flip it off: everything restored ----------------------------------
  await m.chrome(`Services.prefs.setBoolPref("mercury.hardened.enabled", false);`);
  await sleep(300);
  const leftovers = await m.chrome(userValues([
    ...GROUP,
    "network.trr.custom_uri",
    "privacy.trackingprotection.socialtracking.enabled",
    "privacy.trackingprotection.emailtracking.enabled",
    "privacy.fingerprintingProtection",
    "privacy.query_stripping.enabled",
    "mercury.hardened.state",
  ]));
  // The sanitizer migration leaves its own (harmless) v2 values behind, and
  // Firefox keeps the category it matched ("standard") as a user value, as
  // it was before.
  assert.deepEqual(
    leftovers.filter(n => !n.startsWith("privacy.clearOnShutdown_v2.") && n != "browser.contentblocking.category"),
    []
  );
  const afterOff = await m.chrome(readPrefs(Object.keys(DEFAULT_ON)));
  assert.deepEqual(afterOff, DEFAULT_ON);
  ok("turning off restores Mercury defaults (Standard tracking protection again)");
  await m.navigate(page + "?3");
  assert.equal(await m.content(tzScript), "America/Chicago");
  ok("pages see the real timezone again");

  // --- 4. user override survives turning off --------------------------------
  await m.chrome(`Services.prefs.setBoolPref("mercury.hardened.enabled", true);`);
  await sleep(200);
  await m.chrome(`Services.prefs.setBoolPref("dom.security.https_only_mode", false);
                  Services.prefs.setStringPref("network.trr.uri", "https://dns.mullvad.net/dns-query");`);
  await m.chrome(`Services.prefs.setBoolPref("mercury.hardened.enabled", false);`);
  await sleep(200);
  const kept = await m.chrome(readPrefs(["dom.security.https_only_mode", "network.trr.uri", "privacy.resistFingerprinting"]));
  assert.deepEqual(kept, {
    "dom.security.https_only_mode": false,
    "network.trr.uri": "https://dns.mullvad.net/dns-query",
    "privacy.resistFingerprinting": false,
  });
  ok("changes made while on are kept when turning off");

  // --- 5. Settings UI --------------------------------------------------------
  await m.chrome(`Services.prefs.clearUserPref("dom.security.https_only_mode");
                  Services.prefs.clearUserPref("network.trr.uri");`);
  await m.navigate("about:preferences#privacy");
  await sleep(1500);
  const ui = await m.content(`
    const group = document.querySelector('setting-group[groupid="mercuryHardened"]');
    if (!group) return { found: false, href: location.href, groups: [...document.querySelectorAll("setting-group")].map(g => g.getAttribute("groupid")).join(",") };
    const cb = group.shadowRoot?.querySelector("#mercuryHardenedEnabled") || group.querySelector("#mercuryHardenedEnabled") ||
      [...group.querySelectorAll("*")].find(e => e.id == "mercuryHardenedEnabled");
    return { found: true, hidden: group.hidden, text: group.textContent + " " + (group.shadowRoot?.textContent || ""),
             hasCheckbox: !!cb, label: cb?.label, description: cb?.description, checked: cb?.checked };`);
  assert.ok(ui.found, "setting-group present: " + JSON.stringify(ui));
  assert.ok(ui.hasCheckbox, "checkbox present: " + JSON.stringify(ui));
  assert.equal(ui.label, "Use Hardened mode");
  assert.match(ui.description || "", /Restart/);
  assert.equal(ui.checked, false);
  ok("Settings > Privacy & Security shows the Hardened mode checkbox", `"${ui.label}"`);
  await m.content(`
    const group = document.querySelector('setting-group[groupid="mercuryHardened"]');
    const cb = [...group.querySelectorAll("*")].find(e => e.id == "mercuryHardenedEnabled");
    cb.click();`);
  await sleep(500);
  assert.equal(await m.chrome(`return Services.prefs.getBoolPref("mercury.hardened.enabled");`), true);
  assert.equal(await m.chrome(`return Services.prefs.getBoolPref("privacy.resistFingerprinting");`), true);
  ok("clicking it turns Hardened mode on");

  // --- 6. restart: state persists, nothing re-applied -----------------------
  await quit(m);
  m = await launch(profile);
  assert.deepEqual(await m.chrome(readPrefs(GROUP)), HARDENED);
  ok("Hardened mode survives a restart");
  await m.navigate(page + "?4");
  assert.equal(await m.content(offsetScript), 0);
  assert.notEqual(await m.content(tzScript), "America/Chicago");
  ok("after the restart, pages see a UTC+0 timezone (resistFingerprinting)", await m.content(tzScript));
  await m.chrome(`Services.prefs.setBoolPref("mercury.hardened.enabled", false);`);
  await sleep(300);
  assert.equal(await m.chrome(`return Services.prefs.getBoolPref("privacy.resistFingerprinting");`), false);
  await quit(m);
  m = await launch(profile);
  await m.navigate(page + "?5");
  assert.equal(await m.content(tzScript), "America/Chicago");
  assert.equal(await m.chrome(`return Services.prefs.prefHasUserValue("mercury.hardened.state");`), false);
  ok("turned off + restart: pages see the real timezone again");
  await quit(m);

  // --- 7. enabled from user.js while closed: applied at startup -------------
  const profile2 = join(work, "p2");
  (await import("node:fs")).mkdirSync(profile2);
  m = await launch(profile2, `user_pref("mercury.hardened.enabled", true);\n`);
  assert.deepEqual(await m.chrome(readPrefs(GROUP)), HARDENED);
  ok("enabled before startup (user.js): applied at startup");
  await quit(m);
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}
console.log(`\nPASS: ${passed} checks`);
process.exit(0);
