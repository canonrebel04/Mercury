/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Mercury Native Ephemeral ("Burner") Tabs.
 *
 * Each Burner Tab runs in a fresh, dedicated ContextualIdentity container
 * ("Mercury Burner #N", icon "chill", color "orange"). While open, all tabs
 * sharing that burner container are reference-counted across browser windows.
 * As soon as the last tab using a burner container closes (or on startup crash
 * recovery via sweepOrphanedBurners()), Mercury atomically wipes every byte of
 * site data for that userContextId via Services.clearData and deletes the
 * container via ContextualIdentityService.remove().
 */

export const PREF_ACTIVE_IDS = "mercury.burner.activeIds";
export const PREF_AUTO_ISOLATE = "mercury.burner.autoIsolate";
export const BURNER_ICON = "chill";
export const BURNER_COLOR = "orange";
export const BURNER_NAME_PREFIX = "Mercury Burner #";

const NON_ISOLATED_SCHEMES = new Set([
  "about:",
  "chrome:",
  "moz-extension:",
  "resource:",
  "view-source:",
  "javascript:",
  "data:",
  "blob:",
  "file:",
]);

/**
 * Parse a persisted JSON string of burner userContextIds into a sorted,
 * deduplicated array of positive integers. Never throws on corrupt data.
 *
 * @param {string} raw
 * @returns {number[]}
 */
export function parseActiveIds(raw) {
  if (!raw || typeof raw !== "string") {
    return [];
  }
  try {
    let parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    let set = new Set();
    for (let item of parsed) {
      let id = Number(item);
      if (Number.isInteger(id) && id > 0) {
        set.add(id);
      }
    }
    return [...set].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * Determine whether a URL opened in a new tab should be auto-isolated into a
 * fresh Burner Tab when `mercury.burner.autoIsolate` is enabled.
 *
 * Never intercepts:
 * - Private Browsing windows
 * - Pinned tabs
 * - Tabs already assigned to a non-default container (userContextId > 0)
 * - Internal/special schemes (about:, chrome:, moz-extension:, resource:, view-source:, etc.)
 * - Same-origin navigations when openerOrigin is supplied
 *
 * @param {string} url
 * @param {object} [options]
 * @param {boolean} [options.isPinned=false]
 * @param {boolean} [options.isPrivateWindow=false]
 * @param {number} [options.userContextId=0]
 * @param {string} [options.openerOrigin]
 * @returns {boolean}
 */
export function shouldAutoIsolateUrl(url, options = {}) {
  if (
    options.isPinned ||
    options.isPrivateWindow ||
    (Number(options.userContextId) || 0) > 0
  ) {
    return false;
  }
  if (!url || typeof url !== "string") {
    return false;
  }
  let trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (NON_ISOLATED_SCHEMES.has(parsed.protocol)) {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (options.openerOrigin) {
    try {
      let opener = new URL(options.openerOrigin);
      if (opener.origin === parsed.origin) {
        return false;
      }
    } catch {
      // Ignore unparseable openerOrigin and allow isolation.
    }
  }
  return true;
}

function getTabUserContextId(tab) {
  if (!tab) {
    return 0;
  }
  if (typeof tab.userContextId === "number") {
    return tab.userContextId;
  }
  let attr = tab.getAttribute?.("usercontextid");
  return attr ? parseInt(attr, 10) || 0 : 0;
}

/**
 * Create a testable MercuryBurner controller bound to an environment adapter.
 *
 * @param {object} env
 */
export function createBurnerController(env) {
  let burnerSeq = 0;
  const wiping = new Set();

  function getActiveIds() {
    return parseActiveIds(env.prefs.getStringPref(PREF_ACTIVE_IDS, "[]"));
  }

  function saveActiveIds(ids) {
    let normalized = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))].sort(
      (a, b) => a - b
    );
    env.prefs.setStringPref(PREF_ACTIVE_IDS, JSON.stringify(normalized));
    return normalized;
  }

  function isBurnerId(userContextId) {
    let id = Number(userContextId);
    if (!Number.isInteger(id) || id <= 0) {
      return false;
    }
    return getActiveIds().includes(id);
  }

  function countOpenTabs(userContextId, { excludeTab = null, excludeWindow = null } = {}) {
    let count = 0;
    for (let win of env.getWindows()) {
      if (!win || win === excludeWindow || win.closed) {
        continue;
      }
      let tabs = win.gBrowser?.tabs;
      if (!tabs) {
        continue;
      }
      for (let tab of tabs) {
        if (!tab || tab === excludeTab || tab.closing) {
          continue;
        }
        if (getTabUserContextId(tab) === userContextId) {
          count++;
        }
      }
    }
    return count;
  }

  function createBurnerIdentity() {
    let existing = getActiveIds();
    burnerSeq = Math.max(burnerSeq + 1, existing.length + 1);
    let name = `${BURNER_NAME_PREFIX}${burnerSeq}`;
    let identity = env.contextualIdentity.create(name, BURNER_ICON, BURNER_COLOR);
    let id = Number(identity.userContextId);
    existing.push(id);
    saveActiveIds(existing);
    return identity;
  }

  async function wipeAndRemove(userContextId) {
    let id = Number(userContextId);
    if (!Number.isInteger(id) || id <= 0 || wiping.has(id)) {
      return false;
    }
    wiping.add(id);
    try {
      await env.clearData.deleteDataFromOriginAttributesPattern({
        userContextId: id,
      });
      env.contextualIdentity.remove(id);
      let remaining = getActiveIds().filter(x => x !== id);
      saveActiveIds(remaining);
      return true;
    } catch (e) {
      env.logError?.("MercuryBurner wipe failed:", e);
      return false;
    } finally {
      wiping.delete(id);
    }
  }

  function openBurnerTab(win, url, options = {}) {
    if (!win || env.isWindowPrivate(win)) {
      return null;
    }
    let identity = createBurnerIdentity();
    let targetUrl = url || env.getNewTabUrl();
    let tabOptions = {
      ...options,
      userContextId: identity.userContextId,
      triggeringPrincipal:
        options.triggeringPrincipal ?? env.getSystemPrincipal(),
    };
    let tab = env.openTab(win, targetUrl, tabOptions);
    return { tab, userContextId: identity.userContextId, identity };
  }

  async function handleTabClose(tab) {
    let userContextId = getTabUserContextId(tab);
    if (!isBurnerId(userContextId)) {
      return false;
    }
    let remaining = countOpenTabs(userContextId, { excludeTab: tab });
    if (remaining === 0) {
      return await wipeAndRemove(userContextId);
    }
    return false;
  }

  async function handleWindowClosed(win) {
    let ids = getActiveIds();
    let wiped = [];
    for (let id of ids) {
      if (countOpenTabs(id, { excludeWindow: win }) === 0) {
        if (await wipeAndRemove(id)) {
          wiped.push(id);
        }
      }
    }
    return wiped;
  }

  async function sweepOrphanedBurners() {
    let ids = getActiveIds();
    let wiped = [];
    for (let id of ids) {
      if (countOpenTabs(id) === 0) {
        if (await wipeAndRemove(id)) {
          wiped.push(id);
        }
      }
    }
    return wiped;
  }

  async function purgeAllUnused() {
    return await sweepOrphanedBurners();
  }

  async function purgeAll() {
    let ids = new Set(getActiveIds());
    if (!ids.size) {
      return [];
    }
    for (let win of env.getWindows()) {
      if (!win || win.closed || !win.gBrowser?.tabs) {
        continue;
      }
      let toClose = [...win.gBrowser.tabs].filter(tab =>
        ids.has(getTabUserContextId(tab))
      );
      for (let tab of toClose) {
        try {
          win.gBrowser.removeTab(tab, { animate: false, skipPermitUnload: true });
        } catch (e) {
          env.logError?.("MercuryBurner removeTab failed:", e);
        }
      }
    }
    let wiped = [];
    for (let id of ids) {
      if (await wipeAndRemove(id)) {
        wiped.push(id);
      }
    }
    return wiped;
  }

  function maybeAutoIsolateTab(win, tab, url, openerOrigin) {
    if (!env.prefs.getBoolPref(PREF_AUTO_ISOLATE, false)) {
      return null;
    }
    if (!win || !tab || env.isWindowPrivate(win)) {
      return null;
    }
    let should = shouldAutoIsolateUrl(url, {
      isPinned: Boolean(tab.pinned),
      isPrivateWindow: env.isWindowPrivate(win),
      userContextId: getTabUserContextId(tab),
      openerOrigin,
    });
    if (!should) {
      return null;
    }
    let res = openBurnerTab(win, url, { inBackground: false });
    if (res && win.gBrowser?.removeTab) {
      try {
        win.gBrowser.removeTab(tab, { animate: false, skipPermitUnload: true });
      } catch (e) {
        env.logError?.("MercuryBurner auto-isolate removeTab failed:", e);
      }
    }
    return res;
  }

  return {
    getActiveIds,
    isBurnerId,
    countOpenTabs,
    createBurnerIdentity,
    wipeAndRemove,
    openBurnerTab,
    handleTabClose,
    handleWindowClosed,
    sweepOrphanedBurners,
    purgeAllUnused,
    purgeAll,
    maybeAutoIsolateTab,
  };
}

// --- Firefox Runtime Integration ---

let gInitialized = false;
const gAttachedWindows = new WeakSet();
let gController = null;

function getRuntimeController() {
  if (gController) {
    return gController;
  }
  const { ContextualIdentityService } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs"
  );
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
  );
  gController = createBurnerController({
    prefs: Services.prefs,
    contextualIdentity: ContextualIdentityService,
    clearData: {
      deleteDataFromOriginAttributesPattern(pattern) {
        return new Promise(resolve => {
          Services.clearData.deleteDataFromOriginAttributesPattern(pattern, () =>
            resolve()
          );
        });
      },
    },
    isWindowPrivate: win => PrivateBrowsingUtils.isWindowPrivate(win),
    getWindows: () => [...Services.wm.getEnumerator("navigator:browser")],
    getNewTabUrl: () =>
      Services.prefs.getStringPref("browser.newtab.url", "about:newtab"),
    getSystemPrincipal: () => Services.scriptSecurityManager.getSystemPrincipal(),
    openTab(win, url, options) {
      let inBackground = Boolean(options.inBackground);
      let tab = win.gBrowser.addTab(url, {
        userContextId: options.userContextId,
        triggeringPrincipal: options.triggeringPrincipal,
        referrerInfo: options.referrerInfo,
      });
      if (!inBackground) {
        win.gBrowser.selectedTab = tab;
      }
      return tab;
    },
    logError: (...args) => console.error(...args),
  });
  return gController;
}

function isBrowserWindow(win) {
  return (
    win &&
    win.document?.documentElement?.getAttribute("windowtype") ===
      "navigator:browser"
  );
}

const WindowObserver = {
  observe(subject, topic) {
    if (topic === "domwindowclosed") {
      if (isBrowserWindow(subject)) {
        MercuryBurner.handleWindowClosed(subject);
      }
    } else if (topic === "browser-delayed-startup-finished") {
      MercuryBurner.attachWindow(subject);
    }
  },
};

export const MercuryBurner = {
  init() {
    if (gInitialized) {
      return;
    }
    gInitialized = true;
    try {
      Services.obs.addObserver(WindowObserver, "browser-delayed-startup-finished");
      Services.obs.addObserver(WindowObserver, "domwindowclosed");
      for (let win of Services.wm.getEnumerator("navigator:browser")) {
        this.attachWindow(win);
      }
    } catch (e) {
      console.error("MercuryBurner.init failed:", e);
    }
  },

  attachWindow(win) {
    if (!win || gAttachedWindows.has(win) || !win.gBrowser?.tabContainer) {
      return;
    }
    const controller = getRuntimeController();
    const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
      "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
    );
    if (PrivateBrowsingUtils.isWindowPrivate(win)) {
      return;
    }
    gAttachedWindows.add(win);

    const onTabClose = event => {
      controller.handleTabClose(event.target);
    };

    const onTabOpen = event => {
      if (!Services.prefs.getBoolPref(PREF_AUTO_ISOLATE, false)) {
        return;
      }
      let tab = event.target;
      let openerOrigin = "";
      try {
        openerOrigin =
          win.gBrowser.selectedBrowser?.currentURI?.spec || "";
      } catch {
        openerOrigin = "";
      }
      // Wait one tick so initial URI is attached to the newly opened browser.
      Services.tm.dispatchToMainThread(() => {
        if (!tab || tab.closing || !tab.linkedBrowser) {
          return;
        }
        let spec = tab.linkedBrowser.currentURI?.spec || "";
        controller.maybeAutoIsolateTab(win, tab, spec, openerOrigin);
      });
    };

    const onUnload = () => {
      win.gBrowser?.tabContainer?.removeEventListener("TabClose", onTabClose);
      win.gBrowser?.tabContainer?.removeEventListener("TabOpen", onTabOpen);
      win.removeEventListener("unload", onUnload);
      controller.handleWindowClosed(win);
    };

    win.gBrowser.tabContainer.addEventListener("TabClose", onTabClose);
    win.gBrowser.tabContainer.addEventListener("TabOpen", onTabOpen);
    win.addEventListener("unload", onUnload, { once: true });
  },

  createBurnerIdentity() {
    return getRuntimeController().createBurnerIdentity();
  },

  openBurnerTab(win, url, options) {
    this.init();
    this.attachWindow(win);
    return getRuntimeController().openBurnerTab(win, url, options);
  },

  async handleWindowClosed(win) {
    return await getRuntimeController().handleWindowClosed(win);
  },

  async sweepOrphanedBurners() {
    try {
      return await getRuntimeController().sweepOrphanedBurners();
    } catch (e) {
      console.error("MercuryBurner.sweepOrphanedBurners failed:", e);
      return [];
    }
  },

  async purgeAllUnused() {
    try {
      return await getRuntimeController().purgeAllUnused();
    } catch (e) {
      console.error("MercuryBurner.purgeAllUnused failed:", e);
      return [];
    }
  },

  async purgeAll() {
    try {
      return await getRuntimeController().purgeAll();
    } catch (e) {
      console.error("MercuryBurner.purgeAll failed:", e);
      return [];
    }
  },
};
