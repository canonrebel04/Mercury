#!/usr/bin/env node
// Unit tests for browser/components/mercury/MercuryBurner.sys.mjs
// Run: node tests/privacy/burner-unit.mjs
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const burnerModulePath = join(
  repoRoot,
  "browser/components/mercury/MercuryBurner.sys.mjs"
);

const {
  PREF_ACTIVE_IDS,
  PREF_AUTO_ISOLATE,
  BURNER_ICON,
  BURNER_COLOR,
  BURNER_NAME_PREFIX,
  parseActiveIds,
  shouldAutoIsolateUrl,
  createBurnerController,
} = await import(pathToFileURL(burnerModulePath).href);

function makeMockEnv({ autoIsolate = false, activeIds = "[]" } = {}) {
  const stringPrefs = new Map([[PREF_ACTIVE_IDS, activeIds]]);
  const boolPrefs = new Map([[PREF_AUTO_ISOLATE, autoIsolate]]);
  let nextContextId = 10;
  const identities = new Map();
  const clearedPatterns = [];
  const removedIdentities = [];
  const windows = [];

  const prefs = {
    getStringPref: (k, def = "") => (stringPrefs.has(k) ? stringPrefs.get(k) : def),
    setStringPref: (k, v) => stringPrefs.set(k, String(v)),
    getBoolPref: (k, def = false) => (boolPrefs.has(k) ? boolPrefs.get(k) : def),
    setBoolPref: (k, v) => boolPrefs.set(k, Boolean(v)),
  };

  const contextualIdentity = {
    create(name, icon, color) {
      const id = ++nextContextId;
      const entry = { userContextId: id, name, icon, color, public: true };
      identities.set(id, entry);
      return entry;
    },
    remove(id) {
      removedIdentities.push(id);
      return identities.delete(id);
    },
  };

  const clearData = {
    async deleteDataFromOriginAttributesPattern(pattern) {
      clearedPatterns.push(pattern);
    },
  };

  function makeWindow({ isPrivate = false } = {}) {
    const win = {
      isPrivate,
      closed: false,
      gBrowser: {
        tabs: [],
        selectedTab: null,
        addTab(url, opts = {}) {
          const tab = {
            url,
            userContextId: opts.userContextId ?? 0,
            triggeringPrincipal: opts.triggeringPrincipal ?? null,
            pinned: Boolean(opts.pinned),
            closing: false,
          };
          win.gBrowser.tabs.push(tab);
          return tab;
        },
        removeTab(tab) {
          tab.closing = true;
          const idx = win.gBrowser.tabs.indexOf(tab);
          if (idx >= 0) {
            win.gBrowser.tabs.splice(idx, 1);
          }
        },
      },
    };
    windows.push(win);
    return win;
  }

  const env = {
    prefs,
    contextualIdentity,
    clearData,
    isWindowPrivate: win => Boolean(win?.isPrivate),
    getWindows: () => windows,
    getNewTabUrl: () => "about:newtab",
    getSystemPrincipal: () => ({ isSystemPrincipal: true }),
    openTab(win, url, options) {
      const tab = win.gBrowser.addTab(url, options);
      if (!options.inBackground) {
        win.gBrowser.selectedTab = tab;
      }
      return tab;
    },
    logError: (...args) => {
      throw new Error(args.join(" "));
    },
  };

  const ctrl = createBurnerController(env);
  return {
    ctrl,
    env,
    prefs,
    identities,
    clearedPatterns,
    removedIdentities,
    windows,
    makeWindow,
  };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

await test("parseActiveIds handles valid, duplicate, invalid, and corrupt JSON safely", () => {
  assert.deepEqual(parseActiveIds("[]"), []);
  assert.deepEqual(parseActiveIds("[14, 11, 14, 0, -3, \"bad\", 12]"), [11, 12, 14]);
  assert.deepEqual(parseActiveIds("{corrupt"), []);
  assert.deepEqual(parseActiveIds(""), []);
  assert.deepEqual(parseActiveIds(null), []);
});

await test("createBurnerIdentity creates orange chill container and persists activeIds", () => {
  const { ctrl, prefs, identities } = makeMockEnv();
  const id1 = ctrl.createBurnerIdentity();
  const id2 = ctrl.createBurnerIdentity();
  assert.equal(id1.icon, BURNER_ICON);
  assert.equal(id1.color, BURNER_COLOR);
  assert.ok(id1.name.startsWith(BURNER_NAME_PREFIX));
  assert.notEqual(id1.userContextId, id2.userContextId);
  assert.equal(identities.size, 2);
  assert.deepEqual(JSON.parse(prefs.getStringPref(PREF_ACTIVE_IDS)), [
    id1.userContextId,
    id2.userContextId,
  ]);
});

await test("openBurnerTab refuses Private Browsing windows without creating containers", () => {
  const { ctrl, identities, prefs, makeWindow } = makeMockEnv();
  const pbmWin = makeWindow({ isPrivate: true });
  const res = ctrl.openBurnerTab(pbmWin, "https://example.org/");
  assert.equal(res, null);
  assert.equal(identities.size, 0);
  assert.equal(pbmWin.gBrowser.tabs.length, 0);
  assert.deepEqual(JSON.parse(prefs.getStringPref(PREF_ACTIVE_IDS)), []);
});

await test("multi-tab refcount: closing first tab keeps data; closing last tab wipes and removes container", async () => {
  const { ctrl, identities, clearedPatterns, removedIdentities, prefs, makeWindow } =
    makeMockEnv();
  const win1 = makeWindow();
  const win2 = makeWindow();

  const opened = ctrl.openBurnerTab(win1, "https://tracker.example/");
  assert.ok(opened);
  const cid = opened.userContextId;
  assert.ok(opened.tab.triggeringPrincipal?.isSystemPrincipal);

  // Spawn a second tab in the same burner container in another window.
  const childTab = win2.gBrowser.addTab("https://tracker.example/page2", {
    userContextId: cid,
  });
  assert.equal(ctrl.countOpenTabs(cid), 2);

  // Close the first tab: container and data MUST stay alive.
  const wiped1 = await ctrl.handleTabClose(opened.tab);
  win1.gBrowser.removeTab(opened.tab);
  assert.equal(wiped1, false);
  assert.equal(clearedPatterns.length, 0);
  assert.equal(removedIdentities.length, 0);
  assert.ok(identities.has(cid));

  // Close the last tab: container MUST be atomically wiped & removed.
  const wiped2 = await ctrl.handleTabClose(childTab);
  win2.gBrowser.removeTab(childTab);
  assert.equal(wiped2, true);
  assert.deepEqual(clearedPatterns, [{ userContextId: cid }]);
  assert.deepEqual(removedIdentities, [cid]);
  assert.ok(!identities.has(cid));
  assert.deepEqual(JSON.parse(prefs.getStringPref(PREF_ACTIVE_IDS)), []);
});

await test("handleWindowClosed wipes burner containers whose last tabs were in that window", async () => {
  const { ctrl, clearedPatterns, removedIdentities, makeWindow } = makeMockEnv();
  const win1 = makeWindow();
  const win2 = makeWindow();

  const b1 = ctrl.openBurnerTab(win1, "https://a.example/");
  const b2 = ctrl.openBurnerTab(win1, "https://b.example/");
  // Keep b2 alive in win2.
  win2.gBrowser.addTab("https://b.example/sub", { userContextId: b2.userContextId });

  const wiped = await ctrl.handleWindowClosed(win1);
  assert.deepEqual(wiped, [b1.userContextId]);
  assert.deepEqual(clearedPatterns, [{ userContextId: b1.userContextId }]);
  assert.deepEqual(removedIdentities, [b1.userContextId]);
  assert.deepEqual(ctrl.getActiveIds(), [b2.userContextId]);
});

await test("sweepOrphanedBurners wipes crash orphans while sparing live burner tabs", async () => {
  const { ctrl, clearedPatterns, removedIdentities, makeWindow } = makeMockEnv({
    activeIds: "[42, 43]",
  });
  const win = makeWindow();
  // 43 still has a restored tab; 42 is a crash orphan with 0 open tabs.
  win.gBrowser.addTab("https://restored.example/", { userContextId: 43 });

  const wiped = await ctrl.sweepOrphanedBurners();
  assert.deepEqual(wiped, [42]);
  assert.deepEqual(clearedPatterns, [{ userContextId: 42 }]);
  assert.deepEqual(removedIdentities, [42]);
  assert.deepEqual(ctrl.getActiveIds(), [43]);
});

await test("purgeAll closes all active burner tabs and wipes every burner container", async () => {
  const { ctrl, clearedPatterns, removedIdentities, makeWindow } = makeMockEnv();
  const win = makeWindow();
  const normalTab = win.gBrowser.addTab("https://keep.example/", { userContextId: 0 });
  const b1 = ctrl.openBurnerTab(win, "https://burn1.example/");
  const b2 = ctrl.openBurnerTab(win, "https://burn2.example/");

  const wiped = await ctrl.purgeAll();
  assert.deepEqual(wiped, [b1.userContextId, b2.userContextId]);
  assert.deepEqual(clearedPatterns, [
    { userContextId: b1.userContextId },
    { userContextId: b2.userContextId },
  ]);
  assert.deepEqual(removedIdentities, [b1.userContextId, b2.userContextId]);
  assert.deepEqual(ctrl.getActiveIds(), []);
  assert.deepEqual(win.gBrowser.tabs, [normalTab]);
});

await test("shouldAutoIsolateUrl filters internal schemes, pinned tabs, PBM, existing containers, and same-origin", () => {
  // Never intercept internal/special schemes
  for (const url of [
    "about:preferences",
    "about:newtab",
    "chrome://browser/content/browser.xhtml",
    "moz-extension://abc/popup.html",
    "resource:///modules/MercuryBurner.sys.mjs",
    "view-source:https://example.org/",
    "javascript:void(0)",
    "data:text/html,hi",
    "blob:https://example.org/123",
    "file:///tmp/test.html",
    "",
  ]) {
    assert.equal(shouldAutoIsolateUrl(url), false, `must not isolate ${url}`);
  }

  // Never intercept pinned tabs, private windows, or existing containers
  assert.equal(
    shouldAutoIsolateUrl("https://news.example/", { isPinned: true }),
    false
  );
  assert.equal(
    shouldAutoIsolateUrl("https://news.example/", { isPrivateWindow: true }),
    false
  );
  assert.equal(
    shouldAutoIsolateUrl("https://news.example/", { userContextId: 2 }),
    false
  );

  // Never intercept same-origin navigations
  assert.equal(
    shouldAutoIsolateUrl("https://docs.example/page2", {
      openerOrigin: "https://docs.example/page1",
    }),
    false
  );

  // DO isolate cross-site / external HTTP(S) links
  assert.equal(
    shouldAutoIsolateUrl("https://other.example/article", {
      openerOrigin: "https://docs.example/page1",
    }),
    true
  );
  assert.equal(shouldAutoIsolateUrl("http://external.example/"), true);
});

await test("maybeAutoIsolateTab respects mercury.burner.autoIsolate pref and replaces tab", () => {
  const { ctrl, prefs, makeWindow } = makeMockEnv({ autoIsolate: false });
  const win = makeWindow();
  const tabOff = win.gBrowser.addTab("https://external.example/", { userContextId: 0 });
  assert.equal(
    ctrl.maybeAutoIsolateTab(win, tabOff, "https://external.example/", "https://origin.example/"),
    null
  );

  prefs.setBoolPref(PREF_AUTO_ISOLATE, true);
  const res = ctrl.maybeAutoIsolateTab(
    win,
    tabOff,
    "https://external.example/",
    "https://origin.example/"
  );
  assert.ok(res);
  assert.equal(win.gBrowser.tabs.length, 1);
  assert.equal(win.gBrowser.tabs[0].userContextId, res.userContextId);
});

await test("0042-mercury-burner-tabs-ui.patch wires Ctrl+Alt+T shortcut, context menu, and FTL IDs", () => {
  const patch = readFileSync(
    join(repoRoot, "patches/firefox/0042-mercury-burner-tabs-ui.patch"),
    "utf8"
  );
  assert.ok(patch.includes('id="cmd_newBurnerTab"'));
  assert.ok(patch.includes('id="key_newBurnerTab"'));
  assert.ok(patch.includes('modifiers="accel,alt"'));
  assert.ok(patch.includes('id="context-openlinkinburner"'));
  assert.ok(patch.includes("openLinkInBurnerTab()"));
  assert.ok(patch.includes("main-context-menu-open-link-burner-tab ="));
  assert.ok(patch.includes("mercury-burner-tab-shortcut ="));
  assert.ok(patch.includes("shouldShow && !isWindowPrivate"));
});

console.log(`\nPASS: ${passed} burner unit tests`);
