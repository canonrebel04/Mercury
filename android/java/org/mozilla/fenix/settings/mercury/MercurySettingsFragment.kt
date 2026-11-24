/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings.mercury

import android.os.Bundle
import android.widget.Toast
import androidx.core.content.edit
import androidx.navigation.fragment.findNavController
import androidx.preference.EditTextPreference
import androidx.preference.ListPreference
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import androidx.preference.SwitchPreferenceCompat
import java.util.Locale
import mozilla.components.ExperimentalAndroidComponentsApi
import mozilla.components.concept.engine.Engine
import mozilla.components.concept.engine.fission.WebContentIsolationStrategy
import mozilla.components.concept.engine.preferences.Branch
import mozilla.components.concept.engine.preferences.SetBrowserPreference
import org.mozilla.fenix.R
import org.mozilla.fenix.e2e.SystemInsetsPaddedFragment
import org.mozilla.fenix.ext.getPreferenceKey
import org.mozilla.fenix.ext.openToBrowser
import org.mozilla.fenix.ext.requireComponents
import org.mozilla.fenix.ext.showToolbar

/**
 * Dedicated Mercury Browser settings screen (Android) with desktop parity for
 * Hardened Mode, Crowd-Blend FPP, Security Levels, New Identity, HTTPS-Only,
 * Strict Tracking Protection, Query Stripping, DoH, Web APIs, and GPU controls.
 */
@OptIn(ExperimentalAndroidComponentsApi::class)
class MercurySettingsFragment : PreferenceFragmentCompat(), SystemInsetsPaddedFragment {

    override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
        setPreferencesFromResource(R.xml.preferences_mercury, rootKey)
        bindIdentityPreferences()
        bindNetworkPreferences()
        bindWebSecurityPreferences()
        bindPerformancePreferences()
        bindAdvancedPreferences()
    }

    override fun onResume() {
        super.onResume()
        showToolbar(getString(R.string.preferences_mercury))
        syncPreferenceStates()
        arguments?.getString("preference_to_scroll_to")?.let { key ->
            scrollToPreference(key)
        }
    }

    private fun bindIdentityPreferences() {
        findSwitch(R.string.pref_key_mercury_hardened_mode)?.apply {
            isChecked = requireComponents.settings.mercuryHardenedMode
            setOnPreferenceChangeListener { _, newValue ->
                val enabled = newValue as Boolean
                applyHardenedMode(enabled)
                true
            }
        }

        findSwitch(R.string.pref_key_mercury_crowd_blend_fpp)?.apply {
            isChecked = requireComponents.settings.mercuryCrowdBlendFpp
            setOnPreferenceChangeListener { _, newValue ->
                val enabled = newValue as Boolean
                applyCrowdBlendFpp(enabled)
                true
            }
        }

        findList(R.string.pref_key_mercury_security_level)?.apply {
            value = requireComponents.settings.mercurySecurityLevel
            setOnPreferenceChangeListener { _, newValue ->
                val level = newValue as String
                applySecurityLevel(level)
                true
            }
        }

        findEditText(R.string.pref_key_mercury_jit_allowlist)?.apply {
            setOnPreferenceChangeListener { pref, newValue ->
                val normalized = formatJitAllowlist(newValue as? String ?: "")
                setStringPref(PREF_JIT_ALLOWLIST, normalized)
                (pref as? EditTextPreference)?.apply {
                    text = normalized
                    summary = normalized.ifBlank { getString(R.string.mercury_jit_allowlist_summary_empty) }
                }
                false
            }
        }
    }

    private fun bindNetworkPreferences() {
        findSwitch(R.string.pref_key_mercury_https_only)?.apply {
            isChecked = requireComponents.settings.shouldUseHttpsOnly
            setOnPreferenceChangeListener { _, newValue ->
                val enabled = newValue as Boolean
                val settings = requireComponents.settings
                settings.shouldUseHttpsOnly = enabled
                if (enabled) {
                    settings.shouldUseHttpsOnlyInAllTabs = true
                    settings.shouldUseHttpsOnlyInPrivateTabsOnly = false
                }
                requireComponents.core.engine.settings.httpsOnlyMode = settings.getHttpsOnlyMode()
                true
            }
        }

        findSwitch(R.string.pref_key_mercury_strict_etp)?.apply {
            isChecked = isStrictTrackingProtectionActive()
            setOnPreferenceChangeListener { _, newValue ->
                applyStrictTrackingProtection(newValue as Boolean)
                true
            }
        }

        findSwitch(R.string.pref_key_mercury_query_stripping)?.apply {
            isChecked = requireComponents.settings.mercuryQueryStripping
            setOnPreferenceChangeListener { _, newValue ->
                val enabled = newValue as Boolean
                requireComponents.settings.mercuryQueryStripping = enabled
                val engine = requireComponents.core.engine
                engine.settings.queryParameterStripping = enabled
                engine.settings.queryParameterStrippingPrivateBrowsing = enabled
                setBoolPref("privacy.query_stripping.strip_on_share.enabled", enabled)
                true
            }
        }

        findSwitch(R.string.pref_key_mercury_redirect_query_stripping)?.setOnPreferenceChangeListener { _, newValue ->
            setBoolPref("privacy.query_stripping.redirect", newValue as Boolean)
            true
        }

        findSwitch(R.string.pref_key_mercury_block_storage_access_autogrants)?.setOnPreferenceChangeListener { _, newValue ->
            val block = newValue as Boolean
            setGeckoPrefs(
                listOf(
                    SetBrowserPreference.setBoolPref("dom.storage_access.auto_grants", !block, Branch.USER),
                    SetBrowserPreference.setBoolPref("dom.storage_access.headers.enabled", !block, Branch.USER),
                ),
            )
            true
        }

        findSwitch(R.string.pref_key_mercury_captive_portal)?.setOnPreferenceChangeListener { _, newValue ->
            val enabled = newValue as Boolean
            setGeckoPrefs(
                listOf(
                    SetBrowserPreference.setBoolPref("network.captive-portal-service.enabled", enabled, Branch.USER),
                    SetBrowserPreference.setBoolPref("network.connectivity-service.enabled", enabled, Branch.USER),
                ),
            )
            true
        }

        findList(R.string.pref_key_mercury_doh_provider)?.apply {
            value = currentDohPresetValue()
            setOnPreferenceChangeListener { _, newValue ->
                applyDohProvider(newValue as String)
                true
            }
        }
    }

    private fun bindWebSecurityPreferences() {
        findSwitch(R.string.pref_key_mercury_webrtc)?.setOnPreferenceChangeListener { _, newValue ->
            setBoolPref("media.peerconnection.enabled", newValue as Boolean)
            true
        }

        findSwitch(R.string.pref_key_mercury_webgl)?.setOnPreferenceChangeListener { _, newValue ->
            setBoolPref("webgl.disabled", !(newValue as Boolean))
            true
        }

        findSwitch(R.string.pref_key_mercury_drm)?.setOnPreferenceChangeListener { _, newValue ->
            setBoolPref("media.eme.enabled", newValue as Boolean)
            true
        }

        findSwitch(R.string.pref_key_mercury_speculative_prefetch)?.setOnPreferenceChangeListener { _, newValue ->
            applySpeculativePrefetch(newValue as Boolean)
            true
        }

        findSwitch(R.string.pref_key_mercury_punycode)?.setOnPreferenceChangeListener { _, newValue ->
            setBoolPref("network.IDN_show_punycode", newValue as Boolean)
            true
        }

        findSwitch(R.string.pref_key_mercury_main_process_no_jit)?.setOnPreferenceChangeListener { _, newValue ->
            setBoolPref("javascript.options.main_process_disable_jit", newValue as Boolean)
            true
        }

        findSwitch(R.string.pref_key_mercury_fission_isolate_all)?.apply {
            isChecked = requireComponents.settings.mercuryFissionIsolateAll
            setOnPreferenceChangeListener { _, newValue ->
                val isolateAll = newValue as Boolean
                requireComponents.settings.mercuryFissionIsolateAll = isolateAll
                requireComponents.core.engine.settings.webContentIsolationStrategy =
                    if (isolateAll) {
                        WebContentIsolationStrategy.ISOLATE_EVERYTHING
                    } else {
                        WebContentIsolationStrategy.ISOLATE_HIGH_VALUE
                    }
                true
            }
        }
    }

    private fun bindPerformancePreferences() {
        findList(R.string.pref_key_mercury_performance_profile)?.apply {
            value = requireComponents.settings.mercuryPerformanceProfile
            setOnPreferenceChangeListener { _, newValue ->
                applyPerformanceProfile(newValue as String)
                true
            }
        }

        findSwitch(R.string.pref_key_mercury_fontations)?.setOnPreferenceChangeListener { _, newValue ->
            setBoolPref("gfx.font_rendering.fontations.enabled", newValue as Boolean)
            true
        }

        findSwitch(R.string.pref_key_mercury_gpu_canvas)?.setOnPreferenceChangeListener { _, newValue ->
            setBoolPref("gfx.canvas.accelerated", newValue as Boolean)
            true
        }

        findSwitch(R.string.pref_key_mercury_webrender)?.setOnPreferenceChangeListener { _, newValue ->
            val enabled = newValue as Boolean
            setGeckoPrefs(
                listOf(
                    SetBrowserPreference.setBoolPref("gfx.webrender.all", enabled, Branch.USER),
                    SetBrowserPreference.setBoolPref("gfx.webrender.compositor", enabled, Branch.USER),
                ),
            )
            true
        }

        findSwitch(R.string.pref_key_mercury_js_jit)?.setOnPreferenceChangeListener { _, newValue ->
            val enabled = newValue as Boolean
            setGeckoPrefs(
                listOf(
                    SetBrowserPreference.setBoolPref("javascript.options.ion", enabled, Branch.USER),
                    SetBrowserPreference.setBoolPref("javascript.options.baselinejit", enabled, Branch.USER),
                    SetBrowserPreference.setBoolPref("javascript.options.blinterp", enabled, Branch.USER),
                ),
            )
            true
        }
    }

    private fun bindAdvancedPreferences() {
        findSwitch(R.string.pref_key_mercury_show_sync_ui)?.apply {
            isChecked = requireComponents.settings.mercuryShowSyncUi
            setOnPreferenceChangeListener { _, newValue ->
                val enabled = newValue as Boolean
                requireComponents.settings.mercuryShowSyncUi = enabled
                setBoolPref("identity.fxaccounts.enabled", enabled)
                true
            }
        }
    }

    private fun syncPreferenceStates() {
        val settings = requireComponents.settings
        findSwitch(R.string.pref_key_mercury_hardened_mode)?.isChecked = settings.mercuryHardenedMode
        findSwitch(R.string.pref_key_mercury_crowd_blend_fpp)?.isChecked = settings.mercuryCrowdBlendFpp
        findList(R.string.pref_key_mercury_security_level)?.value = settings.mercurySecurityLevel
        findSwitch(R.string.pref_key_mercury_https_only)?.isChecked = settings.shouldUseHttpsOnly
        findSwitch(R.string.pref_key_mercury_strict_etp)?.isChecked = isStrictTrackingProtectionActive()
        findSwitch(R.string.pref_key_mercury_query_stripping)?.isChecked = settings.mercuryQueryStripping
        findList(R.string.pref_key_mercury_doh_provider)?.value = currentDohPresetValue()
        findSwitch(R.string.pref_key_mercury_fission_isolate_all)?.isChecked = settings.mercuryFissionIsolateAll
        findList(R.string.pref_key_mercury_performance_profile)?.value = settings.mercuryPerformanceProfile
        findSwitch(R.string.pref_key_mercury_show_sync_ui)?.isChecked = settings.mercuryShowSyncUi

        val prefNames =
            listOf(
                PREF_JIT_ALLOWLIST,
                PREF_PERFORMANCE_PROFILE,
                "gfx.font_rendering.fontations.enabled",
                "javascript.options.main_process_disable_jit",
                "privacy.query_stripping.redirect",
                "dom.storage_access.auto_grants",
                "dom.storage_access.headers.enabled",
                "network.captive-portal-service.enabled",
                "network.connectivity-service.enabled",
                "media.peerconnection.enabled",
                "webgl.disabled",
                "media.eme.enabled",
                "network.dns.disablePrefetch",
                "network.IDN_show_punycode",
                "gfx.canvas.accelerated",
                "gfx.webrender.all",
                "javascript.options.ion",
            )
        requireComponents.core.engine.getBrowserPrefs(
            prefs = prefNames,
            onSuccess = { prefs ->
                if (!isAdded) return@getBrowserPrefs
                val byName = prefs.associateBy { it.pref }
                (byName[PREF_JIT_ALLOWLIST]?.value as? String)?.let { raw ->
                    val normalized = formatJitAllowlist(raw)
                    findEditText(R.string.pref_key_mercury_jit_allowlist)?.apply {
                        text = normalized
                        summary = normalized.ifBlank { getString(R.string.mercury_jit_allowlist_summary_empty) }
                    }
                }
                (byName[PREF_PERFORMANCE_PROFILE]?.value as? String)?.let { profile ->
                    val normalized = normalizePerformanceProfile(profile)
                    findList(R.string.pref_key_mercury_performance_profile)?.value = normalized
                }
                (byName["gfx.font_rendering.fontations.enabled"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_fontations)?.isChecked = it
                }
                (byName["javascript.options.main_process_disable_jit"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_main_process_no_jit)?.isChecked = it
                }
                (byName["privacy.query_stripping.redirect"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_redirect_query_stripping)?.isChecked = it
                }
                val autoGrants = byName["dom.storage_access.auto_grants"]?.value as? Boolean
                val saHeaders = byName["dom.storage_access.headers.enabled"]?.value as? Boolean
                if (autoGrants != null || saHeaders != null) {
                    findSwitch(R.string.pref_key_mercury_block_storage_access_autogrants)?.isChecked =
                        (autoGrants == false) && (saHeaders != true)
                }
                val captivePortal = byName["network.captive-portal-service.enabled"]?.value as? Boolean
                val connectivity = byName["network.connectivity-service.enabled"]?.value as? Boolean
                if (captivePortal != null || connectivity != null) {
                    findSwitch(R.string.pref_key_mercury_captive_portal)?.isChecked =
                        (captivePortal == true) || (connectivity == true)
                }
                (byName["media.peerconnection.enabled"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_webrtc)?.isChecked = it
                }
                (byName["webgl.disabled"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_webgl)?.isChecked = !it
                }
                (byName["media.eme.enabled"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_drm)?.isChecked = it
                }
                (byName["network.dns.disablePrefetch"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_speculative_prefetch)?.isChecked = !it
                }
                (byName["network.IDN_show_punycode"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_punycode)?.isChecked = it
                }
                (byName["gfx.canvas.accelerated"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_gpu_canvas)?.isChecked = it
                }
                (byName["gfx.webrender.all"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_webrender)?.isChecked = it
                }
                (byName["javascript.options.ion"]?.value as? Boolean)?.let {
                    findSwitch(R.string.pref_key_mercury_js_jit)?.isChecked = it
                }
            },
            onError = {},
        )
    }

    private fun applyHardenedMode(enabled: Boolean) {
        val components = requireComponents
        val settings = components.settings
        val engine = components.core.engine
        settings.mercuryHardenedMode = enabled

        if (enabled) {
            setGeckoPrefs(
                listOf(
                    SetBrowserPreference.setBoolPref("mercury.hardened.enabled", true, Branch.USER),
                    SetBrowserPreference.setBoolPref("privacy.resistFingerprinting", true, Branch.USER),
                    SetBrowserPreference.setBoolPref("privacy.resistFingerprinting.letterboxing", true, Branch.USER),
                    SetBrowserPreference.setBoolPref("network.IDN_show_punycode", true, Branch.USER),
                ),
            )
            engine.settings.fingerprintingProtection = true
            engine.settings.fingerprintingProtectionPrivateBrowsing = true
            engine.settings.fingerprintingProtectionOverrides = RFP_PRESERVE_THEME_OVERRIDE

            applyStrictTrackingProtection(true)

            settings.shouldUseHttpsOnly = true
            settings.shouldUseHttpsOnlyInAllTabs = true
            settings.shouldUseHttpsOnlyInPrivateTabsOnly = false
            engine.settings.httpsOnlyMode = settings.getHttpsOnlyMode()

            settings.shouldDeleteBrowsingDataOnQuit = true

            // Upgrade DoH to Increased Protection if currently Off or Default (never downgrade Max).
            val dohMode = settings.getDohSettingsMode()
            if (dohMode == Engine.DohSettingsMode.OFF || dohMode == Engine.DohSettingsMode.DEFAULT) {
                val uri = settings.dohProviderUrl.ifBlank { DEFAULT_DOH_URI }
                settings.dohProviderUrl = uri
                settings.setDohSettingsMode(Engine.DohSettingsMode.INCREASED)
                engine.settings.dohSettingsMode = Engine.DohSettingsMode.INCREASED
                engine.settings.dohProviderUrl = uri
            }

            applySpeculativePrefetch(false)

            findSwitch(R.string.pref_key_mercury_https_only)?.isChecked = true
            findSwitch(R.string.pref_key_mercury_strict_etp)?.isChecked = true
            findSwitch(R.string.pref_key_mercury_speculative_prefetch)?.isChecked = false
            findSwitch(R.string.pref_key_mercury_punycode)?.isChecked = true
            findList(R.string.pref_key_mercury_doh_provider)?.value = currentDohPresetValue()
        } else {
            setGeckoPrefs(
                listOf(
                    SetBrowserPreference.setBoolPref("mercury.hardened.enabled", false, Branch.USER),
                    SetBrowserPreference.setBoolPref("privacy.resistFingerprinting", false, Branch.USER),
                    SetBrowserPreference.setBoolPref("privacy.resistFingerprinting.letterboxing", false, Branch.USER),
                    SetBrowserPreference.setBoolPref("network.IDN_show_punycode", false, Branch.USER),
                ),
            )
            applyCrowdBlendFpp(settings.mercuryCrowdBlendFpp)

            settings.shouldUseHttpsOnly = false
            engine.settings.httpsOnlyMode = settings.getHttpsOnlyMode()
            settings.shouldDeleteBrowsingDataOnQuit = false
            applySpeculativePrefetch(true)

            findSwitch(R.string.pref_key_mercury_https_only)?.isChecked = false
            findSwitch(R.string.pref_key_mercury_speculative_prefetch)?.isChecked = true
            findSwitch(R.string.pref_key_mercury_punycode)?.isChecked = false
        }
    }

    private fun applyCrowdBlendFpp(enabled: Boolean) {
        val settings = requireComponents.settings
        val engine = requireComponents.core.engine
        settings.mercuryCrowdBlendFpp = enabled
        engine.settings.fingerprintingProtection = enabled
        engine.settings.fingerprintingProtectionPrivateBrowsing = enabled
        engine.settings.fingerprintingProtectionOverrides =
            when {
                settings.mercuryHardenedMode -> RFP_PRESERVE_THEME_OVERRIDE
                enabled -> CROWD_BLEND_OVERRIDES
                else -> ""
            }
    }

    private fun applySecurityLevel(level: String) {
        val safeLevel = if (level == "safer" || level == "safest") level else "standard"
        requireComponents.settings.mercurySecurityLevel = safeLevel
        val engine = requireComponents.core.engine

        setStringPref("mercury.security.level", safeLevel)

        when (safeLevel) {
            "standard" -> {
                clearPrefs(
                    listOf(
                        "javascript.options.ion",
                        "javascript.options.baselinejit",
                        "javascript.options.blinterp",
                        "javascript.options.wasm",
                        "javascript.options.wasm_baselinejit",
                        "javascript.options.wasm_optimizingjit",
                        "mathml.disabled",
                        "gfx.font_rendering.opentype_svg.enabled",
                        "webgl.disabled",
                        "gfx.downloadable_fonts.enabled",
                    ),
                )
                engine.settings.webFontsEnabled = true
                findSwitch(R.string.pref_key_mercury_webgl)?.isChecked = true
                findSwitch(R.string.pref_key_mercury_js_jit)?.isChecked = true
            }

            "safer" -> {
                setGeckoPrefs(
                    listOf(
                        SetBrowserPreference.setBoolPref("javascript.options.ion", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("javascript.options.wasm", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("javascript.options.wasm_baselinejit", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("javascript.options.wasm_optimizingjit", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("mathml.disabled", true, Branch.USER),
                        SetBrowserPreference.setBoolPref("gfx.font_rendering.opentype_svg.enabled", false, Branch.USER),
                    ),
                )
                clearPrefs(
                    listOf(
                        "javascript.options.baselinejit",
                        "javascript.options.blinterp",
                        "webgl.disabled",
                        "gfx.downloadable_fonts.enabled",
                    ),
                )
                engine.settings.webFontsEnabled = true
                findSwitch(R.string.pref_key_mercury_webgl)?.isChecked = true
                findSwitch(R.string.pref_key_mercury_js_jit)?.isChecked = false
            }

            else -> {
                setGeckoPrefs(
                    listOf(
                        SetBrowserPreference.setBoolPref("javascript.options.ion", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("javascript.options.baselinejit", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("javascript.options.blinterp", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("javascript.options.wasm", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("javascript.options.wasm_baselinejit", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("javascript.options.wasm_optimizingjit", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("mathml.disabled", true, Branch.USER),
                        SetBrowserPreference.setBoolPref("gfx.font_rendering.opentype_svg.enabled", false, Branch.USER),
                        SetBrowserPreference.setBoolPref("webgl.disabled", true, Branch.USER),
                        SetBrowserPreference.setBoolPref("gfx.downloadable_fonts.enabled", false, Branch.USER),
                    ),
                )
                engine.settings.webFontsEnabled = false
                findSwitch(R.string.pref_key_mercury_webgl)?.isChecked = false
                findSwitch(R.string.pref_key_mercury_js_jit)?.isChecked = false
            }
        }
    }

    private fun isStrictTrackingProtectionActive(): Boolean {
        val settings = requireComponents.settings
        return settings.shouldUseTrackingProtection && settings.useStrictTrackingProtection
    }

    private fun applyStrictTrackingProtection(strict: Boolean) {
        val context = requireContext()
        val components = requireComponents
        val settings = components.settings
        settings.shouldUseTrackingProtection = true
        settings.preferences.edit {
            putBoolean(context.getPreferenceKey(R.string.pref_key_tracking_protection_strict_default), strict)
            putBoolean(context.getPreferenceKey(R.string.pref_key_tracking_protection_standard_option), !strict)
            putBoolean(context.getPreferenceKey(R.string.pref_key_tracking_protection_custom_option), false)
        }
        val policy = components.core.trackingProtectionPolicyFactory.createTrackingProtectionPolicy()
        components.useCases.settingsUseCases.updateTrackingProtection(policy)
        components.useCases.sessionUseCases.reload()
    }

    private fun currentDohPresetValue(): String {
        val settings = requireComponents.settings
        if (settings.getDohSettingsMode() == Engine.DohSettingsMode.OFF) {
            return DOH_OFF_VALUE
        }
        val uri = settings.dohProviderUrl.ifBlank { DEFAULT_DOH_URI }
        return if (uri in KNOWN_DOH_URIS) uri else DEFAULT_DOH_URI
    }

    private fun applyDohProvider(value: String) {
        val settings = requireComponents.settings
        val engineSettings = requireComponents.core.engine.settings
        if (value == DOH_OFF_VALUE) {
            settings.setDohSettingsMode(Engine.DohSettingsMode.OFF)
            engineSettings.dohSettingsMode = Engine.DohSettingsMode.OFF
            return
        }
        settings.dohProviderUrl = value
        if (settings.getDohSettingsMode() == Engine.DohSettingsMode.OFF ||
            settings.getDohSettingsMode() == Engine.DohSettingsMode.DEFAULT
        ) {
            settings.setDohSettingsMode(Engine.DohSettingsMode.INCREASED)
            engineSettings.dohSettingsMode = Engine.DohSettingsMode.INCREASED
        }
        engineSettings.dohProviderUrl = value
    }

    private fun applyPerformanceProfile(profile: String) {
        val safeProfile = normalizePerformanceProfile(profile)
        requireComponents.settings.mercuryPerformanceProfile = safeProfile

        val (canvasCacheMb, nurseryMaxKb, surfaceCacheKb, notifyIntervalUs) =
            when (safeProfile) {
                "turbo" -> Quad(1024, 65536, 1048576, 83333)
                "low-ram" -> Quad(128, 16384, 131072, 120000)
                else -> Quad(512, 32768, 524288, 100000)
            }

        setGeckoPrefs(
            listOf(
                SetBrowserPreference.setStringPref(PREF_PERFORMANCE_PROFILE, safeProfile, Branch.USER),
                SetBrowserPreference.setIntPref("gfx.canvas.accelerated.cache-size", canvasCacheMb, Branch.USER),
                SetBrowserPreference.setIntPref("javascript.options.mem.nursery.max_kb", nurseryMaxKb, Branch.USER),
                SetBrowserPreference.setIntPref("image.mem.surfacecache.max_size_kb", surfaceCacheKb, Branch.USER),
                SetBrowserPreference.setIntPref("content.notify.interval", notifyIntervalUs, Branch.USER),
            ),
        )
    }

    private data class Quad(val a: Int, val b: Int, val c: Int, val d: Int)

    private fun applySpeculativePrefetch(enabled: Boolean) {
        setGeckoPrefs(
            listOf(
                SetBrowserPreference.setBoolPref("network.dns.disablePrefetch", !enabled, Branch.USER),
                SetBrowserPreference.setBoolPref("network.dns.disablePrefetchFromHTTPS", !enabled, Branch.USER),
                SetBrowserPreference.setBoolPref("network.prefetch-next", enabled, Branch.USER),
                SetBrowserPreference.setIntPref(
                    "network.http.speculative-parallel-limit",
                    if (enabled) 20 else 0,
                    Branch.USER,
                ),
                SetBrowserPreference.setBoolPref("network.predictor.enabled", enabled, Branch.USER),
                SetBrowserPreference.setBoolPref("network.predictor.enable-prefetch", enabled, Branch.USER),
            ),
        )
    }

    override fun onPreferenceTreeClick(preference: Preference): Boolean {
        when (preference.key) {
            getPreferenceKey(R.string.pref_key_mercury_new_identity) -> {
                val components = requireComponents
                components.useCases.tabsUseCases.removeAllTabs()
                components.core.engine.clearData(Engine.BrowsingData.all())
                Toast.makeText(
                    requireContext(),
                    getString(R.string.mercury_new_identity_toast),
                    Toast.LENGTH_LONG,
                ).show()
                return true
            }

            getPreferenceKey(R.string.pref_key_mercury_open_doh) -> {
                findNavController().navigate(R.id.dohSettingsFragment)
                return true
            }

            getPreferenceKey(R.string.pref_key_mercury_open_etp) -> {
                findNavController().navigate(R.id.trackingProtectionFragment)
                return true
            }

            getPreferenceKey(R.string.pref_key_mercury_open_https_only) -> {
                findNavController().navigate(R.id.httpsOnlyFragment)
                return true
            }

            getPreferenceKey(R.string.pref_key_mercury_open_delete_on_quit) -> {
                findNavController().navigate(R.id.deleteBrowsingDataOnQuitFragment)
                return true
            }

            getPreferenceKey(R.string.pref_key_mercury_open_about_config) -> {
                findNavController().openToBrowser()
                requireComponents.useCases.fenixBrowserUseCases.loadUrlOrSearch(
                    searchTermOrURL = "about:config",
                    newTab = true,
                )
                return true
            }
        }
        return super.onPreferenceTreeClick(preference)
    }

    private fun findSwitch(keyResId: Int): SwitchPreferenceCompat? =
        findPreference(getPreferenceKey(keyResId))

    private fun findList(keyResId: Int): ListPreference? =
        findPreference(getPreferenceKey(keyResId))

    private fun findEditText(keyResId: Int): EditTextPreference? =
        findPreference(getPreferenceKey(keyResId))

    private fun setBoolPref(pref: String, value: Boolean) {
        requireComponents.core.engine.setBrowserPref(
            pref = pref,
            value = value,
            branch = Branch.USER,
            onSuccess = {},
            onError = {},
        )
    }

    private fun setStringPref(pref: String, value: String) {
        requireComponents.core.engine.setBrowserPref(
            pref = pref,
            value = value,
            branch = Branch.USER,
            onSuccess = {},
            onError = {},
        )
    }

    private fun setGeckoPrefs(prefs: List<SetBrowserPreference<*>>) {
        requireComponents.core.engine.setBrowserPrefs(
            prefs = prefs,
            onSuccess = {},
            onError = {},
        )
    }

    private fun clearPrefs(prefs: List<String>) {
        val engine = requireComponents.core.engine
        for (pref in prefs) {
            engine.clearBrowserUserPref(
                pref = pref,
                onSuccess = {},
                onError = {},
            )
        }
    }

    companion object {
        const val PREF_JIT_ALLOWLIST = "mercury.security.jitAllowlist"
        const val PREF_PERFORMANCE_PROFILE = "mercury.performance.profile"
        const val DEFAULT_DOH_URI = "https://dns.adguard-dns.com/dns-query"
        private const val DOH_OFF_VALUE = "off"
        const val RFP_PRESERVE_THEME_OVERRIDE = "-CSSPrefersColorScheme"

        fun normalizePerformanceProfile(profile: String?): String =
            when (profile) {
                "turbo", "low-ram" -> profile
                else -> "balanced"
            }

        /**
         * Normalizes a single JIT allowlist origin matching desktop MercuryHardened.normalizeJitOrigin
         * and 0043 C++ XPCJSContext rules: lowercase scheme://host[:port], bare host defaults to
         * https://, rejects wildcards, paths, queries, fragments, userinfo, and non-http(s) schemes.
         */
        fun normalizeJitOrigin(input: String): String? {
            var s = input.trim().lowercase(Locale.ROOT)
            if (s.isEmpty() || '*' in s || '?' in s || '#' in s || '@' in s || s.any { it.isWhitespace() }) {
                return null
            }
            val scheme: String
            var rest: String
            val schemeIdx = s.indexOf("://")
            if (schemeIdx >= 0) {
                scheme = s.substring(0, schemeIdx)
                if (scheme != "https" && scheme != "http") return null
                rest = s.substring(schemeIdx + 3)
            } else {
                if (':' in s && s.indexOf(':') < s.length && !s.startsWith("[")) {
                    val colon = s.indexOf(':')
                    val maybePort = s.substring(colon + 1).removeSuffix("/")
                    if (maybePort.isEmpty() || !maybePort.all { it.isDigit() }) return null
                }
                scheme = "https"
                rest = s
            }
            if (rest.endsWith("/")) {
                rest = rest.dropLast(1)
            }
            if (rest.isEmpty() || '/' in rest) return null

            val host: String
            var portStr: String? = null
            if (rest.startsWith("[")) {
                val close = rest.indexOf(']')
                if (close <= 1) return null
                host = rest.substring(0, close + 1)
                val tail = rest.substring(close + 1)
                if (tail.isNotEmpty()) {
                    if (!tail.startsWith(":")) return null
                    portStr = tail.substring(1)
                }
            } else {
                val colon = rest.indexOf(':')
                if (colon >= 0) {
                    host = rest.substring(0, colon)
                    portStr = rest.substring(colon + 1)
                } else {
                    host = rest
                }
                if (host.isEmpty() || host.startsWith(".") || host.endsWith(".") || ".." in host) {
                    return null
                }
                if (!host.all { it in 'a'..'z' || it in '0'..'9' || it == '.' || it == '-' }) {
                    return null
                }
            }

            val normalizedPort =
                if (portStr != null) {
                    if (portStr.isEmpty() || !portStr.all { it.isDigit() }) return null
                    val portNum = portStr.toIntOrNull() ?: return null
                    if (portNum !in 1..65535) return null
                    if ((scheme == "https" && portNum == 443) || (scheme == "http" && portNum == 80)) {
                        ""
                    } else {
                        ":$portNum"
                    }
                } else {
                    ""
                }

            return "$scheme://$host$normalizedPort"
        }

        fun parseJitAllowlist(raw: String): List<String> {
            val seen = LinkedHashSet<String>()
            for (token in raw.split(',', ' ', '\t', '\n', '\r')) {
                normalizeJitOrigin(token)?.let { seen.add(it) }
            }
            return seen.toList()
        }

        fun formatJitAllowlist(raw: String): String = parseJitAllowlist(raw).joinToString(",")

        const val CROWD_BLEND_OVERRIDES =
            "+EfficientCanvasRandomization,-CanvasRandomization,+CanvasExtractionFromThirdPartiesIsBlocked," +
                "+FontVisibilityLangPack,+ScreenAvailToResolution,+WindowScreenXY,+WindowInnerScreenXY," +
                "+ScreenPixelDepth,+MouseEventScreenPoint,+NavigatorHWConcurrencyTiered,+MaxTouchPointsCollapse," +
                "+IMEStyle,+WebGLRendererConstant,+WebGLVendorSanitize,+WebGLRandomization,+WebGLRenderCapability," +
                "+Gamepad,+DeviceSensors,+AudioSampleRate,+AudioContext,+MediaDevices,+MediaCapabilities," +
                "+WebCodecs,+SpeechSynthesis,+NetworkConnection,+DiskStorageLimit,+UseStandinsForNativeColors," +
                "+CSSColorInfo,+CSSVideoDynamicRange,+CSSPointerCapabilities,+CSSPrefersReducedTransparency," +
                "+CSSInvertedColors,+VideoElementPlaybackQuality,+PdfjsSpoof,-JSMathFdlibm,-CSSPrefersColorScheme"

        const val QUERY_STRIPPING_STRIP_LIST =
            "utm_source utm_medium utm_campaign utm_term utm_content utm_id utm_cid utm_name utm_reader " +
                "utm_referrer utm_social utm_social-type utm_pubreferrer utm_swu utm_brand utm_channel " +
                "utm_place gclid gclsrc dclid gbraid wbraid _ga _gl srsltid fbclid igshid igsh " +
                "fb_action_ids msclkid twclid ttclid rdt_cid li_fat_id sc_cid epik sccid mtm_campaign " +
                "tw_source tw_campaign mc_cid mc_eid mkt_tok _hsenc _hsmi hsa_acc hsa_cam hsa_grp " +
                "hsa_ad hsa_src hsa_tgt hsa_kw hsa_mt hsa_net hsa_ver yclid ymclid _openstat __s " +
                "vero_id vero_conv oly_anon_id oly_enc_id wickedid pk_campaign"

        private val KNOWN_DOH_URIS =
            setOf(
                "https://dns.adguard-dns.com/dns-query",
                "https://dns.quad9.net/dns-query",
                "https://adblock.dns.mullvad.net/dns-query",
                "https://mozilla.cloudflare-dns.com/dns-query",
                "https://firefox.dns.nextdns.io/",
            )
    }
}
