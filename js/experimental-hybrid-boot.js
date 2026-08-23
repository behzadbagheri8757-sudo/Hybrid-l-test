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
  async function maybeInstallExperimentalHybrid() {
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
      const H = global.BaqeriHybrid;
      const C = global.BaqeriPersistCommit;

      // Hybrid is single-writer. A second tab may read, but it must never be
      // allowed to persist a stale RAM snapshot over the current owner.
      const ownsPersistence = await H.acquireHybridOwner();
      if (!ownsPersistence) {
        global.BaqeriExperimentalHybridReadOnly = true;
        banner('SECOND INSTANCE — read-only mode; Hybrid writes are blocked');
      } else {
        global.BaqeriExperimentalHybridReadOnly = false;
      }

      // First activation: migrate the existing monolithic snapshot exactly once.
      // Existing Hybrid data is authoritative; never silently fall back to monolith.
      const hasHybrid = await H.hybridHasAnyData();
      if (!hasHybrid) {
        let source = null;
        if (typeof global.dbGet === 'function') {
          const rec = await global.dbGet('main');
          if (rec && rec.value) source = JSON.parse(rec.value);
        }
        if (!source && typeof global.data !== 'undefined') source = global.data;
        if (typeof global.normalizeData === 'function') source = global.normalizeData(source || global.emptyData());
        await H.migrateFromMonolithPayload(source || global.data);
        banner('first activation — monolith snapshot migrated to Hybrid DB');
      }

      C.installExperimentalPersist();
      // installExperimentalPersist replaces both saveData and loadData.
      // Fail closed if the Hybrid store is incomplete/corrupt.
      await C.loadDataHybridAware();

      banner('ENABLED — load/save/backup use Hybrid collections (DB: ' +
        (H.HYBRID_DB_NAME || 'baqeriDB_experimental') + ')');
      return true;
    } catch (e) {
      banner('install failed: ' + (e && e.message ? e.message : e));
      return false;
    }
  }

  global.BaqeriExperimentalHybridBoot = {
    isHybridOptIn: isHybridOptIn,
    maybeInstallExperimentalHybrid: maybeInstallExperimentalHybrid,
    isReadOnly: function(){ return global.BaqeriExperimentalHybridReadOnly === true; },
  };

  // Auto-run install when this script loads (only if opt-in).
  // Boot is async; nav.js waits on this promise before the first loadData().
  global.BaqeriExperimentalHybridBoot.ready = isHybridOptIn()
    ? maybeInstallExperimentalHybrid()
    : Promise.resolve(false);
  if (!isHybridOptIn()) {
    banner('opt-in OFF — monolithic persistence');
  }
})(typeof window !== 'undefined' ? window : globalThis);
