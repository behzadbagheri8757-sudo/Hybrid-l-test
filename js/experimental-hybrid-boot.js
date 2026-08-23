/* experimental-hybrid-boot.js
 *
 * Hybrid persistence is enabled by default.
 * The legacy ?hybrid=1 / ?experimentalHybrid=1 parameters are retained for
 * backward compatibility but no longer control activation.
 *
 * Hybrid initialization is fail-closed: initialization failure never falls
 * back silently to the monolithic persistence path.
 */
(function (global) {
  'use strict';

  function isHybridOptIn() {
    // Legacy activation parameters are intentionally accepted but no longer
    // required: Hybrid is always enabled.
    return true;
  }

  function banner(msg) {
    try {
      console.info('%c[Experimental Hybrid] ' + msg, 'color:#c60;font-weight:bold');
    } catch (e) {}
  }

  /**
   * Call after db-hybrid.js + persist-commit.js are loaded, and ideally
   * before the first loadData/saveData during app boot.
   * Hybrid is always required; missing modules or initialization failures throw
   * so callers can fail closed instead of falling back to monolithic persistence.
   */
  async function maybeInstallExperimentalHybrid() {
    if (!global.BaqeriHybrid) {
      throw new Error('Hybrid persistence unavailable: load js/db-hybrid.js first');
    }
    if (!global.BaqeriPersistCommit) {
      throw new Error('Hybrid persistence unavailable: load js/persist-commit.js first');
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
      throw e;
    }
  }

  global.BaqeriExperimentalHybridBoot = {
    isHybridOptIn: isHybridOptIn,
    maybeInstallExperimentalHybrid: maybeInstallExperimentalHybrid,
    isReadOnly: function(){ return global.BaqeriExperimentalHybridReadOnly === true; },
  };

  // Auto-run install on every boot. nav.js waits on this promise before the
  // first loadData(); a rejection is handled as a fail-closed boot failure.
  global.BaqeriExperimentalHybridBoot.ready = maybeInstallExperimentalHybrid();
})(typeof window !== 'undefined' ? window : globalThis);
