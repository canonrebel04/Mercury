/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Mercury update notification.
 *
 * Mercury is built without Mozilla's updater, so this module asks the GitHub
 * Releases API of the Mercury repository whether a newer release exists and,
 * if so, shows a notification bar with a link to the release page. Nothing is
 * downloaded or installed automatically.
 *
 * Privacy: one anonymous GET request (no cookies, no referrer, no telemetry)
 * at most once per `mercury.updatecheck.intervalHours`, only to the URL in
 * `mercury.updatecheck.url`. Set `mercury.updatecheck.enabled` to false to
 * turn it off completely.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const PREF_ENABLED = "mercury.updatecheck.enabled";
const PREF_URL = "mercury.updatecheck.url";
const PREF_RELEASES_PAGE = "mercury.updatecheck.releasesPage";
const PREF_INTERVAL_HOURS = "mercury.updatecheck.intervalHours";
const PREF_LAST_CHECK = "mercury.updatecheck.lastCheck";
const PREF_DISMISSED = "mercury.updatecheck.dismissedVersion";

const NOTIFICATION_ID = "mercury-update-available";
const REQUEST_TIMEOUT_MS = 15000;
const RELEASE_PAGE_PREFIX = "https://github.com/";

export const MercuryUpdateCheck = {
  /**
   * Runs the check if it is enabled and the interval has passed. Never throws.
   */
  async maybeCheck() {
    try {
      if (!Services.prefs.getBoolPref(PREF_ENABLED, false)) {
        return;
      }
      let now = Math.floor(Date.now() / 1000);
      let last = Services.prefs.getIntPref(PREF_LAST_CHECK, 0);
      let hours = Math.max(1, Services.prefs.getIntPref(PREF_INTERVAL_HOURS, 24));
      if (last > 0 && last <= now && now - last < hours * 3600) {
        return;
      }
      Services.prefs.setIntPref(PREF_LAST_CHECK, now);

      let release = await this._fetchLatestRelease();
      if (!release) {
        return;
      }
      let latest = String(release.tag_name || "").replace(/^[^0-9]+/, "");
      if (!/^\d+(\.\d+)*$/.test(latest)) {
        return;
      }
      let current = Services.appinfo.version;
      if (Services.vc.compare(latest, current) <= 0) {
        return;
      }
      if (Services.prefs.getStringPref(PREF_DISMISSED, "") == latest) {
        return;
      }
      let page = String(release.html_url || "");
      if (!page.startsWith(RELEASE_PAGE_PREFIX)) {
        page = Services.prefs.getStringPref(PREF_RELEASES_PAGE, "");
      }
      this._notify(latest, page);
    } catch (e) {
      console.warn("Mercury update check failed:", e);
    }
  },

  async _fetchLatestRelease() {
    let url = Services.prefs.getStringPref(PREF_URL, "");
    if (!url.startsWith("https://")) {
      return null;
    }
    let controller = new AbortController();
    let timer = lazy.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }
      let release = await response.json();
      if (!release || release.draft || release.prerelease) {
        return null;
      }
      return release;
    } finally {
      lazy.clearTimeout(timer);
    }
  },

  _notify(version, page) {
    let win = lazy.BrowserWindowTracker.getTopWindow({ private: false });
    if (!win?.gNotificationBox) {
      return;
    }
    if (win.gNotificationBox.getNotificationWithValue(NOTIFICATION_ID)) {
      return;
    }
    let buttons = [];
    if (page) {
      buttons.push({
        label: "Open download page",
        accessKey: "O",
        callback() {
          win.openTrustedLinkIn(page, "tab");
        },
      });
    }
    buttons.push({
      label: "Don't remind me about this version",
      accessKey: "D",
      callback() {
        Services.prefs.setStringPref(PREF_DISMISSED, version);
      },
    });
    win.gNotificationBox.appendNotification(
      NOTIFICATION_ID,
      {
        label: `A new version of Mercury (${version}) is available.`,
        priority: win.gNotificationBox.PRIORITY_INFO_MEDIUM,
      },
      buttons
    ).catch(e => console.warn("Mercury update notification failed:", e));
  },
};
