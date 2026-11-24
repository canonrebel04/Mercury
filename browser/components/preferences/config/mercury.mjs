/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);
const {
  MercuryHardened,
  CROWD_BLEND_OVERRIDES,
  DEFAULT_DOH_URI,
  PREF_JIT_ALLOWLIST,
  parseJitAllowlist,
  formatJitAllowlist,
} = ChromeUtils.importESModule(
  "moz-src:///browser/components/mercury/MercuryHardened.sys.mjs"
);
const { MercuryBurner } = ChromeUtils.importESModule(
  "resource:///modules/MercuryBurner.sys.mjs"
);

const FPP_OVERRIDES_PREF = "privacy.fingerprintingProtection.overrides";

const KNOWN_DOH_URIS = new Set([
  "https://dns.adguard-dns.com/dns-query",
  "https://dns.quad9.net/dns-query",
  "https://adblock.dns.mullvad.net/dns-query",
  "https://mozilla.cloudflare-dns.com/dns-query",
  "https://firefox.dns.nextdns.io/",
]);

let gDohCustomSelected = false;

/**
 * Observe one or more Services.prefs branches directly so this pane never
 * calls Preferences.addAll() on prefs that other panes (privacy.mjs,
 * tabs-browsing.mjs, search.mjs, main.js) may also register. Calling
 * Preferences.addAll() for a shared pref throws if panes load in either order.
 */
function observePrefs(prefNames, emitChange) {
  let unique = [...new Set(prefNames)];
  let observer = () => emitChange();
  for (let name of unique) {
    Services.prefs.addObserver(name, observer);
  }
  return () => {
    for (let name of unique) {
      Services.prefs.removeObserver(name, observer);
    }
  };
}

function readPref(name, type, fallback) {
  switch (type) {
    case "bool":
      return Services.prefs.getBoolPref(name, fallback);
    case "int":
      return Services.prefs.getIntPref(name, fallback);
    case "string":
      return Services.prefs.getStringPref(name, fallback);
  }
  return fallback;
}

function writePref(name, type, value) {
  if (Services.prefs.prefIsLocked(name)) {
    return;
  }
  switch (type) {
    case "bool":
      Services.prefs.setBoolPref(name, Boolean(value));
      break;
    case "int":
      Services.prefs.setIntPref(name, Number(value));
      break;
    case "string":
      Services.prefs.setStringPref(name, String(value));
      break;
  }
}

function addPrefSetting(id, prefName, type, defaultValue, opts = {}) {
  let watched = [prefName, ...(opts.extraObservedPrefs || [])];
  let settingConfig = {
    id,
    setup: emitChange => observePrefs(watched, emitChange),
    disabled: (deps, setting) =>
      Services.prefs.prefIsLocked(prefName) ||
      Boolean(opts.disabled?.(deps, setting)),
    get: (_unused, deps, setting) => {
      let raw = readPref(prefName, type, defaultValue);
      return opts.get ? opts.get(raw, deps, setting) : raw;
    },
    set: (val, deps, setting) => {
      if (Services.prefs.prefIsLocked(prefName)) {
        return;
      }
      let next = opts.set ? opts.set(val, deps, setting) : val;
      if (next !== undefined) {
        writePref(prefName, type, next);
      }
    },
  };
  if (opts.deps) {
    settingConfig.deps = opts.deps;
  }
  if (opts.visible) {
    settingConfig.visible = opts.visible;
  }
  if (opts.onUserChange) {
    settingConfig.onUserChange = opts.onUserChange;
  }
  Preferences.addSetting(settingConfig);
}

function parseOverrides(str) {
  let map = new Map();
  for (let tok of String(str || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)) {
    let sign = tok[0];
    if (sign === "+" || sign === "-") {
      map.set(tok.slice(1), sign);
    }
  }
  return map;
}

function serializeOverrides(map) {
  let out = [];
  for (let [key, sign] of map.entries()) {
    out.push(`${sign}${key}`);
  }
  return out.join(",");
}

function setOverrideTargets(changes) {
  if (Services.prefs.prefIsLocked(FPP_OVERRIDES_PREF)) {
    return;
  }
  let current = Services.prefs.getStringPref(
    FPP_OVERRIDES_PREF,
    CROWD_BLEND_OVERRIDES
  );
  let map = parseOverrides(current);
  for (let [target, sign] of Object.entries(changes)) {
    if (sign === null) {
      map.delete(target);
    } else {
      map.set(target, sign);
    }
  }
  Services.prefs.setStringPref(FPP_OVERRIDES_PREF, serializeOverrides(map));
}

// --- Group 1: Identity & Privacy Mode ---
addPrefSetting("mercuryPaneHardenedMode", "mercury.hardened.enabled", "bool", false);

addPrefSetting(
  "mercuryPreserveSystemTheme",
  "mercury.rfp.preserveSystemTheme",
  "bool",
  true,
  {
    extraObservedPrefs: [FPP_OVERRIDES_PREF],
    set: val => {
      setOverrideTargets({ CSSPrefersColorScheme: val ? "-" : "+" });
      return val;
    },
  }
);

addPrefSetting(
  "mercurySecurityLevel",
  "mercury.security.level",
  "string",
  "standard",
  {
    get: val => (val === "safer" || val === "safest" ? val : "standard"),
    set: val => {
      MercuryHardened.setSecurityLevel(val);
      return undefined;
    },
  }
);

addPrefSetting("mercuryJitAllowlist", PREF_JIT_ALLOWLIST, "string", "", {
  get: val => formatJitAllowlist(parseJitAllowlist(val)),
  set: val => formatJitAllowlist(parseJitAllowlist(val)),
});

addPrefSetting(
  "mercuryMainProcessNoJit",
  "javascript.options.main_process_disable_jit",
  "bool",
  true
);

addPrefSetting(
  "mercuryFissionIsolateAll",
  "fission.webContentIsolationStrategy",
  "int",
  1,
  {
    get: val => val === 1,
    set: val => (val ? 1 : 2),
  }
);

Preferences.addSetting({
  id: "mercuryNewIdentityButton",
  onUserClick: async () => {
    await MercuryHardened.newIdentity();
    let title = "Mercury — New Identity";
    let body =
      "Cookies, caches, site storage, HTTP auth, and TLS session state have been cleared.";
    try {
      let [l10nTitle, l10nBody] = await document.l10n.formatValues([
        { id: "mercury-new-identity-alert-title" },
        { id: "mercury-new-identity-alert-body" },
      ]);
      if (l10nTitle) {
        title = l10nTitle;
      }
      if (l10nBody) {
        body = l10nBody;
      }
    } catch (e) {
      // Fallback strings above are already set.
    }
    Services.prompt.alert(window, title, body);
  },
});

// --- Group 2: Anti-Fingerprinting & Crowd-Blending ---
addPrefSetting(
  "mercuryStrictTracking",
  "browser.contentblocking.category",
  "string",
  "strict",
  {
    get: val => val === "strict",
    set: val => (val ? "strict" : "standard"),
  }
);

addPrefSetting(
  "mercuryCrowdBlendFpp",
  "privacy.fingerprintingProtection",
  "bool",
  true,
  {
    extraObservedPrefs: ["privacy.fingerprintingProtection.pbmode"],
    set: val => {
      writePref("privacy.fingerprintingProtection.pbmode", "bool", val);
      return val;
    },
  }
);

addPrefSetting(
  "mercuryLetterboxing",
  "privacy.resistFingerprinting.letterboxing",
  "bool",
  false
);

addPrefSetting(
  "mercuryResistFingerprinting",
  "privacy.resistFingerprinting",
  "bool",
  false
);

addPrefSetting(
  "mercuryCanvasMode",
  FPP_OVERRIDES_PREF,
  "string",
  CROWD_BLEND_OVERRIDES,
  {
    get: val => {
      let map = parseOverrides(val);
      if (map.get("CanvasRandomization") === "+") {
        return "strict";
      }
      if (map.get("EfficientCanvasRandomization") === "-") {
        return "off";
      }
      return "efficient";
    },
    set: mode => {
      if (mode === "strict") {
        setOverrideTargets({
          CanvasRandomization: "+",
          EfficientCanvasRandomization: "-",
        });
      } else if (mode === "off") {
        setOverrideTargets({
          CanvasRandomization: "-",
          EfficientCanvasRandomization: "-",
        });
      } else {
        setOverrideTargets({
          EfficientCanvasRandomization: "+",
          CanvasRandomization: "-",
        });
      }
      return undefined;
    },
  }
);

addPrefSetting(
  "mercuryCpuCoresMode",
  FPP_OVERRIDES_PREF,
  "string",
  CROWD_BLEND_OVERRIDES,
  {
    get: val => {
      let map = parseOverrides(val);
      if (map.get("NavigatorHWConcurrency") === "+") {
        return "fixed4";
      }
      if (map.get("NavigatorHWConcurrencyTiered") === "-") {
        return "full";
      }
      return "tiered";
    },
    set: mode => {
      if (mode === "fixed4") {
        setOverrideTargets({
          NavigatorHWConcurrency: "+",
          NavigatorHWConcurrencyTiered: "-",
        });
      } else if (mode === "full") {
        setOverrideTargets({
          NavigatorHWConcurrency: "-",
          NavigatorHWConcurrencyTiered: "-",
        });
      } else {
        setOverrideTargets({
          NavigatorHWConcurrencyTiered: "+",
          NavigatorHWConcurrency: "-",
        });
      }
      return undefined;
    },
  }
);

addPrefSetting("mercuryWebGLMode", "webgl.disabled", "bool", false, {
  extraObservedPrefs: [FPP_OVERRIDES_PREF],
  get: disabled => {
    if (disabled) {
      return "disabled";
    }
    let map = parseOverrides(
      Services.prefs.getStringPref(FPP_OVERRIDES_PREF, CROWD_BLEND_OVERRIDES)
    );
    if (map.get("WebGLRendererConstant") === "-") {
      return "unrestricted";
    }
    return "sanitized";
  },
  set: mode => {
    if (mode === "disabled") {
      return true;
    }
    if (mode === "unrestricted") {
      setOverrideTargets({
        WebGLRendererConstant: "-",
        WebGLVendorSanitize: "-",
      });
    } else {
      setOverrideTargets({
        WebGLRendererConstant: "+",
        WebGLVendorSanitize: "+",
      });
    }
    return false;
  },
});

addPrefSetting("mercuryWebGPUEnabled", "dom.webgpu.enabled", "bool", false);

addPrefSetting(
  "mercuryWebRTCEnabled",
  "media.peerconnection.enabled",
  "bool",
  true
);

addPrefSetting(
  "mercuryWebRTCMaskLan",
  "media.peerconnection.ice.no_host",
  "bool",
  true,
  {
    extraObservedPrefs: [
      "media.peerconnection.ice.default_address_only",
      "media.peerconnection.ice.proxy_only_if_behind_proxy",
    ],
    set: val => {
      writePref("media.peerconnection.ice.default_address_only", "bool", val);
      writePref(
        "media.peerconnection.ice.proxy_only_if_behind_proxy",
        "bool",
        val
      );
      return val;
    },
  }
);

addPrefSetting(
  "mercuryGPC",
  "privacy.globalprivacycontrol.enabled",
  "bool",
  true
);

addPrefSetting(
  "mercuryQueryStripping",
  "privacy.query_stripping.enabled",
  "bool",
  true,
  {
    extraObservedPrefs: [
      "privacy.query_stripping.enabled.pbmode",
      "privacy.query_stripping.strip_on_share.enabled",
    ],
    set: val => {
      writePref("privacy.query_stripping.enabled.pbmode", "bool", val);
      writePref("privacy.query_stripping.strip_on_share.enabled", "bool", val);
      return val;
    },
  }
);

addPrefSetting(
  "mercuryRefererPolicy",
  "network.http.referer.XOriginTrimmingPolicy",
  "int",
  2,
  {
    // moz-select option values are strings; convert between string and int.
    get: val => {
      let n = Number(val);
      return n === 0 || n === 1 || n === 2 ? String(n) : "2";
    },
    set: val => Number(val),
  }
);

// --- Group 3: Network, DNS & Bleeding-Edge Security ---
addPrefSetting("mercuryDohPreset", "network.trr.uri", "string", DEFAULT_DOH_URI, {
  extraObservedPrefs: ["network.trr.mode", "network.trr.custom_uri"],
  disabled: () => Services.prefs.prefIsLocked("network.trr.mode"),
  get: val => {
    let mode = Services.prefs.getIntPref("network.trr.mode", 2);
    if (mode === 5) {
      return "off";
    }
    if (gDohCustomSelected) {
      return "custom";
    }
    let uri = (val || DEFAULT_DOH_URI).trim();
    return KNOWN_DOH_URIS.has(uri) ? uri : "custom";
  },
  set: (val, _deps, setting) => {
    if (val === "off") {
      gDohCustomSelected = false;
      writePref("network.trr.mode", "int", 5);
      setting.emit("change");
      return undefined;
    }
    let mode = Services.prefs.getIntPref("network.trr.mode", 2);
    if (mode === 5 || mode === 0) {
      writePref("network.trr.mode", "int", 2);
    }
    if (val === "custom") {
      gDohCustomSelected = true;
      let customUri = Services.prefs
        .getStringPref("network.trr.custom_uri", "")
        .trim();
      if (customUri && !KNOWN_DOH_URIS.has(customUri)) {
        writePref("network.trr.uri", "string", customUri);
      }
      setting.emit("change");
      return undefined;
    }
    gDohCustomSelected = false;
    let prevCustom = Services.prefs
      .getStringPref("network.trr.custom_uri", "")
      .trim();
    if (KNOWN_DOH_URIS.has(prevCustom)) {
      // Match privacy.mjs so choosing a built-in preset doesn't look "custom" there.
      writePref("network.trr.custom_uri", "string", " ");
    }
    return val;
  },
});

addPrefSetting("mercuryDohCustomUri", "network.trr.custom_uri", "string", "", {
  deps: ["mercuryDohPreset"],
  extraObservedPrefs: ["network.trr.uri", "network.trr.mode"],
  visible: ({ mercuryDohPreset }) => mercuryDohPreset.value === "custom",
  disabled: () =>
    Services.prefs.prefIsLocked("network.trr.uri") ||
    Services.prefs.prefIsLocked("network.trr.mode"),
  get: val => {
    let trimmed = String(val || "").trim();
    if (trimmed) {
      return trimmed;
    }
    let currentUri = Services.prefs.getStringPref("network.trr.uri", "").trim();
    return KNOWN_DOH_URIS.has(currentUri) ? "" : currentUri;
  },
  set: val => {
    let trimmed = String(val || "").trim();
    if (trimmed) {
      let mode = Services.prefs.getIntPref("network.trr.mode", 2);
      if (mode === 5 || mode === 0) {
        writePref("network.trr.mode", "int", 2);
      }
      writePref("network.trr.uri", "string", trimmed);
      return trimmed;
    }
    return " ";
  },
});

addPrefSetting("mercuryHttpsOnly", "dom.security.https_only_mode", "bool", false);

addPrefSetting(
  "mercuryPostQuantum",
  "media.webrtc.send_mlkem_keyshare",
  "bool",
  true,
  {
    extraObservedPrefs: ["security.tls.enable_mlkem1024"],
    set: val => {
      writePref("security.tls.enable_mlkem1024", "bool", val);
      return val;
    },
  }
);

addPrefSetting("mercuryECH", "network.dns.echconfig.enabled", "bool", true, {
  extraObservedPrefs: ["network.dns.http3_echconfig.enabled"],
  set: val => {
    writePref("network.dns.http3_echconfig.enabled", "bool", val);
    return val;
  },
});

addPrefSetting("mercuryLNADefense", "network.lna.block_trackers", "bool", true, {
  extraObservedPrefs: ["network.lna.block_insecure_contexts"],
  set: val => {
    writePref("network.lna.block_insecure_contexts", "bool", val);
    return val;
  },
});

addPrefSetting(
  "mercuryBounceTracking",
  "privacy.bounceTrackingProtection.mode",
  "int",
  1,
  {
    get: val => val === 1,
    set: val => (val ? 1 : 0),
  }
);

addPrefSetting(
  "mercuryDisable0RTT",
  "security.tls.enable_0rtt_data",
  "bool",
  false,
  {
    extraObservedPrefs: ["network.http.http3.enable_0rtt"],
    get: val => !val,
    set: val => {
      writePref("network.http.http3.enable_0rtt", "bool", !val);
      return !val;
    },
  }
);

addPrefSetting("mercuryBlockBeacons", "beacon.enabled", "bool", false, {
  extraObservedPrefs: ["browser.send_pings"],
  get: val => !val && !Services.prefs.getBoolPref("browser.send_pings", false),
  set: block => {
    writePref("browser.send_pings", "bool", !block);
    return !block;
  },
});

addPrefSetting(
  "mercurySpeculativeConnect",
  "network.dns.disablePrefetch",
  "bool",
  false,
  {
    extraObservedPrefs: [
      "network.dns.disablePrefetchFromHTTPS",
      "network.prefetch-next",
      "network.http.speculative-parallel-limit",
      "network.predictor.enabled",
    ],
    get: val => !val,
    set: allow => {
      writePref("network.dns.disablePrefetchFromHTTPS", "bool", !allow);
      writePref("network.prefetch-next", "bool", allow);
      writePref("network.http.speculative-parallel-limit", "int", allow ? 20 : 0);
      writePref("network.predictor.enabled", "bool", allow);
      writePref("network.predictor.enable-prefetch", "bool", allow);
      return !allow;
    },
  }
);

addPrefSetting("mercuryPunycode", "network.IDN_show_punycode", "bool", false);

addPrefSetting(
  "mercuryClearOnClose",
  "privacy.sanitize.sanitizeOnShutdown",
  "bool",
  false
);

// --- Group 4: Performance & GPU Engine ---
addPrefSetting(
  "mercuryHardwareAccel",
  "layers.acceleration.disabled",
  "bool",
  false,
  {
    extraObservedPrefs: [
      "layers.acceleration.force-enabled",
      "gfx.webrender.all",
    ],
    get: disabled => !disabled,
    set: enable => {
      writePref("layers.acceleration.force-enabled", "bool", enable);
      writePref("gfx.webrender.all", "bool", enable);
      return !enable;
    },
  }
);

addPrefSetting("mercuryGpuCanvas2d", "gfx.canvas.accelerated", "bool", true);

addPrefSetting("mercuryWebRenderSvg", "gfx.webrender.svg-shapes", "bool", true);

addPrefSetting("mercuryUncappedFrameRate", "layout.frame_rate", "int", -1, {
  get: val => val === -1,
  set: val => (val ? -1 : 60),
});

addPrefSetting(
  "mercuryBytecodeCache",
  "dom.script_loader.bytecode_cache.enabled",
  "bool",
  true
);

addPrefSetting(
  "mercuryWaylandDmabuf",
  "widget.dmabuf.force-enabled",
  "bool",
  false,
  {
    visible: () => AppConstants.platform === "linux",
  }
);

// --- Group 5: Behavior & Optional Features ---
addPrefSetting(
  "mercuryBlockAiFeatures",
  "browser.ai.control.default",
  "string",
  "blocked",
  {
    extraObservedPrefs: ["extensions.ml.enabled"],
    get: val => val === "blocked",
    set: blocked => {
      try {
        const { OnDeviceModelManager } = ChromeUtils.importESModule(
          "chrome://browser/content/preferences/OnDeviceModelManager.mjs",
          { global: "current" }
        );
        for (let feature of Object.values(OnDeviceModelManager.features)) {
          if (blocked) {
            OnDeviceModelManager.block(feature);
          } else if (!OnDeviceModelManager.isEnabled(feature)) {
            OnDeviceModelManager.makeAvailable(feature);
          }
        }
      } catch (e) {
        // Fallback: still set the global AI control & extension ML prefs below.
      }
      writePref("extensions.ml.enabled", "bool", !blocked);
      return blocked ? "blocked" : "available";
    },
  }
);

Preferences.addSetting({
  id: "mercuryOpenAiControls",
  visible: () =>
    Services.prefs.getBoolPref("browser.preferences.aiControls", false),
  onUserClick: () => {
    window.gotoPref("ai");
  },
});

addPrefSetting("mercuryAllowDrm", "media.eme.enabled", "bool", false);

addPrefSetting(
  "mercurySearchSuggestions",
  "browser.search.suggest.enabled",
  "bool",
  false,
  {
    extraObservedPrefs: ["browser.urlbar.suggest.searches"],
    set: val => {
      writePref("browser.urlbar.suggest.searches", "bool", val);
      return val;
    },
  }
);

addPrefSetting("mercuryUpdateCheck", "mercury.updatecheck.enabled", "bool", true);

// --- Group 6: Ephemeral Burner Tabs & Network Silence ---
addPrefSetting("mercuryAutoBurner", "mercury.burner.autoIsolate", "bool", false);

Preferences.addSetting({
  id: "mercuryPurgeBurnersButton",
  onUserClick: async () => {
    await MercuryBurner.purgeAll();
    let title = "Mercury — Burner Data Purged";
    let body =
      "All active and orphaned Burner Tabs and their isolated site data have been wiped.";
    try {
      let [l10nTitle, l10nBody] = await document.l10n.formatValues([
        { id: "mercury-purge-burners-alert-title" },
        { id: "mercury-purge-burners-alert-body" },
      ]);
      if (l10nTitle) {
        title = l10nTitle;
      }
      if (l10nBody) {
        body = l10nBody;
      }
    } catch (e) {
      // Fallback strings above are already set.
    }
    Services.prompt.alert(window, title, body);
  },
});

addPrefSetting(
  "mercuryCaptivePortal",
  "network.captive-portal-service.enabled",
  "bool",
  false,
  {
    extraObservedPrefs: ["network.connectivity-service.enabled"],
    get: val =>
      val || Services.prefs.getBoolPref("network.connectivity-service.enabled", false),
    set: enable => {
      writePref("network.connectivity-service.enabled", "bool", enable);
      return enable;
    },
  }
);

addPrefSetting(
  "mercuryBlockStorageAccessAutoGrants",
  "dom.storage_access.auto_grants",
  "bool",
  false,
  {
    extraObservedPrefs: ["dom.storage_access.headers.enabled"],
    get: val =>
      !val &&
      !Services.prefs.getBoolPref("dom.storage_access.headers.enabled", false),
    set: block => {
      writePref("dom.storage_access.headers.enabled", "bool", !block);
      return !block;
    },
  }
);

addPrefSetting(
  "mercuryRedirectQueryStripping",
  "privacy.query_stripping.redirect",
  "bool",
  true
);

SettingGroupManager.registerGroups({
  mercuryIdentity: {
    l10nId: "mercury-group-identity",
    headingLevel: 2,
    items: [
      {
        id: "mercuryPaneHardenedMode",
        l10nId: "mercury-hardened-enabled",
      },
      {
        id: "mercuryPreserveSystemTheme",
        l10nId: "mercury-preserve-system-theme",
      },
      {
        id: "mercurySecurityLevel",
        l10nId: "mercury-security-level",
        control: "moz-select",
        options: [
          { value: "standard", l10nId: "mercury-security-level-standard" },
          { value: "safer", l10nId: "mercury-security-level-safer" },
          { value: "safest", l10nId: "mercury-security-level-safest" },
        ],
      },
      {
        id: "mercuryJitAllowlist",
        l10nId: "mercury-jit-allowlist",
        control: "moz-input-text",
      },
      {
        id: "mercuryMainProcessNoJit",
        l10nId: "mercury-main-process-no-jit",
      },
      {
        id: "mercuryFissionIsolateAll",
        l10nId: "mercury-fission-isolate-all",
      },
      {
        id: "mercuryNewIdentityButton",
        l10nId: "mercury-new-identity-button",
        control: "moz-button",
      },
    ],
  },
  mercuryBurner: {
    l10nId: "mercury-group-burner",
    headingLevel: 2,
    items: [
      {
        id: "mercuryAutoBurner",
        l10nId: "mercury-auto-burner",
      },
      {
        id: "mercuryPurgeBurnersButton",
        l10nId: "mercury-purge-burners-button",
        control: "moz-button",
      },
      {
        id: "mercuryCaptivePortal",
        l10nId: "mercury-captive-portal",
      },
      {
        id: "mercuryBlockStorageAccessAutoGrants",
        l10nId: "mercury-block-storage-access-auto-grants",
      },
      {
        id: "mercuryRedirectQueryStripping",
        l10nId: "mercury-redirect-query-stripping",
      },
    ],
  },
  mercuryFingerprinting: {
    l10nId: "mercury-group-fingerprinting",
    headingLevel: 2,
    items: [
      {
        id: "mercuryStrictTracking",
        l10nId: "mercury-strict-tracking",
      },
      {
        id: "mercuryCrowdBlendFpp",
        l10nId: "mercury-crowd-blend-fpp",
      },
      {
        id: "mercuryLetterboxing",
        l10nId: "mercury-letterboxing",
      },
      {
        id: "mercuryResistFingerprinting",
        l10nId: "mercury-resist-fingerprinting",
      },
      {
        id: "mercuryCanvasMode",
        l10nId: "mercury-canvas-mode",
        control: "moz-select",
        options: [
          { value: "efficient", l10nId: "mercury-canvas-mode-efficient" },
          { value: "strict", l10nId: "mercury-canvas-mode-strict" },
          { value: "off", l10nId: "mercury-canvas-mode-off" },
        ],
      },
      {
        id: "mercuryCpuCoresMode",
        l10nId: "mercury-cpu-cores-mode",
        control: "moz-select",
        options: [
          { value: "tiered", l10nId: "mercury-cpu-cores-tiered" },
          { value: "fixed4", l10nId: "mercury-cpu-cores-fixed4" },
          { value: "full", l10nId: "mercury-cpu-cores-full" },
        ],
      },
      {
        id: "mercuryWebGLMode",
        l10nId: "mercury-webgl-mode",
        control: "moz-select",
        options: [
          { value: "sanitized", l10nId: "mercury-webgl-sanitized" },
          { value: "disabled", l10nId: "mercury-webgl-disabled" },
          { value: "unrestricted", l10nId: "mercury-webgl-unrestricted" },
        ],
      },
      {
        id: "mercuryWebGPUEnabled",
        l10nId: "mercury-webgpu-enabled",
      },
      {
        id: "mercuryWebRTCEnabled",
        l10nId: "mercury-webrtc-enabled",
      },
      {
        id: "mercuryWebRTCMaskLan",
        l10nId: "mercury-webrtc-mask-lan",
      },
      {
        id: "mercuryGPC",
        l10nId: "mercury-gpc",
      },
      {
        id: "mercuryQueryStripping",
        l10nId: "mercury-query-stripping",
      },
      {
        id: "mercuryRefererPolicy",
        l10nId: "mercury-referer-policy",
        control: "moz-select",
        options: [
          { value: "2", l10nId: "mercury-referer-origin" },
          { value: "1", l10nId: "mercury-referer-scheme-host" },
          { value: "0", l10nId: "mercury-referer-full" },
        ],
      },
    ],
  },
  mercuryNetwork: {
    l10nId: "mercury-group-network",
    headingLevel: 2,
    items: [
      {
        id: "mercuryDohPreset",
        l10nId: "mercury-doh-preset",
        control: "moz-select",
        options: [
          {
            value: "https://dns.adguard-dns.com/dns-query",
            l10nId: "mercury-doh-adguard",
          },
          {
            value: "https://dns.quad9.net/dns-query",
            l10nId: "mercury-doh-quad9",
          },
          {
            value: "https://adblock.dns.mullvad.net/dns-query",
            l10nId: "mercury-doh-mullvad",
          },
          {
            value: "https://mozilla.cloudflare-dns.com/dns-query",
            l10nId: "mercury-doh-cloudflare",
          },
          {
            value: "https://firefox.dns.nextdns.io/",
            l10nId: "mercury-doh-nextdns",
          },
          { value: "custom", l10nId: "mercury-doh-custom" },
          { value: "off", l10nId: "mercury-doh-off" },
        ],
      },
      {
        id: "mercuryDohCustomUri",
        l10nId: "mercury-doh-custom-uri",
        control: "moz-input-text",
      },
      {
        id: "mercuryHttpsOnly",
        l10nId: "mercury-https-only",
      },
      {
        id: "mercuryPostQuantum",
        l10nId: "mercury-post-quantum",
      },
      {
        id: "mercuryECH",
        l10nId: "mercury-ech",
      },
      {
        id: "mercuryLNADefense",
        l10nId: "mercury-lna-defense",
      },
      {
        id: "mercuryBounceTracking",
        l10nId: "mercury-bounce-tracking",
      },
      {
        id: "mercuryDisable0RTT",
        l10nId: "mercury-disable-0rtt",
      },
      {
        id: "mercuryBlockBeacons",
        l10nId: "mercury-block-beacons",
      },
      {
        id: "mercurySpeculativeConnect",
        l10nId: "mercury-speculative-connect",
      },
      {
        id: "mercuryPunycode",
        l10nId: "mercury-punycode",
      },
      {
        id: "mercuryClearOnClose",
        l10nId: "mercury-clear-on-close",
      },
    ],
  },
  mercuryPerformance: {
    l10nId: "mercury-group-performance",
    headingLevel: 2,
    items: [
      {
        id: "mercuryHardwareAccel",
        l10nId: "mercury-hardware-accel",
      },
      {
        id: "mercuryGpuCanvas2d",
        l10nId: "mercury-gpu-canvas2d",
      },
      {
        id: "mercuryWebRenderSvg",
        l10nId: "mercury-webrender-svg",
      },
      {
        id: "mercuryUncappedFrameRate",
        l10nId: "mercury-uncapped-framerate",
      },
      {
        id: "mercuryBytecodeCache",
        l10nId: "mercury-bytecode-cache",
      },
      {
        id: "mercuryWaylandDmabuf",
        l10nId: "mercury-wayland-dmabuf",
      },
    ],
  },
  mercuryBehavior: {
    l10nId: "mercury-group-behavior",
    headingLevel: 2,
    items: [
      {
        id: "mercuryBlockAiFeatures",
        l10nId: "mercury-block-ai-features",
      },
      {
        id: "mercuryOpenAiControls",
        l10nId: "mercury-open-ai-controls",
        control: "moz-button",
      },
      {
        id: "mercuryAllowDrm",
        l10nId: "mercury-allow-drm",
      },
      {
        id: "mercurySearchSuggestions",
        l10nId: "mercury-search-suggestions",
      },
      {
        id: "mercuryUpdateCheck",
        l10nId: "mercury-update-check",
      },
    ],
  },
});
