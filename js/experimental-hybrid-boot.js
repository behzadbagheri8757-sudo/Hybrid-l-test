/* experimental-hybrid-boot.js
 *
 * EXPERIMENTAL / OPT-IN ONLY — does nothing unless explicitly enabled.
 *
 * Enable Hybrid persistence:
 *   1. URL query:  ?hybrid=1
 *   2. or localStorage: localStorage.setItem('baqeriExperimentalHybrid', '1')
 *
 * When disabled (default): SPA uses production-style js/db.js saveData (monolith blob).
 * When enabled: replaces global saveData via BaqeriPersistCommit.installExperimentalPersist()
 *               and uses baqeriDB_experimental (separate from production DB name).
 *
 * NEVER enable this in Production Freeze builds.
 */
(function (global) {
  'use strict';

  function isHybridOptIn() {
    try {
      var q = (global.location && global.location.search) || '';
      if (/[?&]hybrid=1(?:&|$)/.test(q)) return true;
      if (/[?&]experimentalHybrid=1(?:&|$)/.test(q)) return true;
      if (global.localStorage && global.localStorage.getItem('baqeriExperimentalHybrid') === '1') {
        return true;
      }
    } catch (e) { /* private mode etc. */ }
    return false;
  }

  function banner(msg) {
    try {
      console.info('%c[Experimental Hybrid] ' + msg, 'color:#c60;font-weight:bold');
    } catch (e) {}
  }

  /**
   * Call after db-hybrid.js + persist-commit.js are loaded, and ideally
   * before the first loadData/saveData during app boot.
   * Safe no-op when opt-in is off or modules missing.
   */
  function maybeInstallExperimentalHybrid() {
    if (!isHybridOptIn()) {
      banner('opt-in OFF — using monolithic db.js (default)');
      return false;
    }
    if (!global.BaqeriHybrid) {
      banner('opt-in ON but BaqeriHybrid missing — load js/db-hybrid.js first');
      return false;
    }
    if (!global.BaqeriPersistCommit) {
      banner('opt-in ON but BaqeriPersistCommit missing — load js/persist-commit.js first');
      return false;
    }
    try {
      global.BaqeriPersistCommit.installExperimentalPersist();
      banner('ENABLED — saveData → hybrid collections (DB: ' +
        (global.BaqeriHybrid.HYBRID_DB_NAME || 'baqeriDB_experimental') + ')');
      // Optional: replace loadData for hybrid stores (caller may still use monolith load)
      if (typeof global.BaqeriPersistCommit.loadDataHybridAware === 'function') {
        global.loadDataHybridExperimental = global.BaqeriPersistCommit.loadDataHybridAware;
      }
      return true;
    } catch (e) {
      banner('install failed: ' + (e && e.message ? e.message : e));
      return false;
    }
  }

  global.BaqeriExperimentalHybridBoot = {
    isHybridOptIn: isHybridOptIn,
    maybeInstallExperimentalHybrid: maybeInstallExperimentalHybrid,
  };

  // Auto-run install when this script loads (only if opt-in).
  // Scripts must be ordered: db-hybrid → persist-commit → experimental-hybrid-boot
  if (isHybridOptIn()) {
    maybeInstallExperimentalHybrid();
  } else {
    banner('opt-in OFF — monolithic persistence');
  }
})(typeof window !== 'undefined' ? window : globalThis);
