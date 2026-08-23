/* experimental-hybrid-boot.js — Hybrid default-on activation boundary */
(function (global) {
  'use strict';

  function isHybridOptIn() {
    // Backward-compatible API name; Hybrid is now always enabled.
    return true;
  }

  function banner(msg) {
    try { console.info('%c[Hybrid] ' + msg, 'color:#276;font-weight:bold'); } catch (e) {}
  }

  let _readyPromise = null;

  async function maybeInstallExperimentalHybrid() {
    if (!global.BaqeriHybrid) {
      throw new Error('Hybrid persistence module is not loaded');
    }
    if (!global.BaqeriPersistCommit) {
      throw new Error('Hybrid persistence commit module is not loaded');
    }

    const H = global.BaqeriHybrid;
    const C = global.BaqeriPersistCommit;

    try {
      // Existing Hybrid data is authoritative. Only migrate when Hybrid is empty.
      const hasHybrid = await H.hybridHasAnyData();
      if (!hasHybrid) {
        let source = null;
        if (typeof global.dbGet === 'function') {
          const rec = await global.dbGet('main');
          if (rec && rec.value) source = JSON.parse(rec.value);
        }
        if (!source && typeof global.data !== 'undefined') source = global.data;
        if (typeof global.normalizeData === 'function') {
          source = global.normalizeData(source || global.emptyData());
        }
        await H.migrateFromMonolithPayload(source || global.data);
        banner('first activation — monolith snapshot migrated to Hybrid DB');
      }

      // Critical ordering: install the Hybrid load/save replacements BEFORE any
      // application load or user mutation can occur.
      C.installExperimentalPersist();
      await C.loadDataHybridAware();

      banner('READY — Hybrid persistence active');
      return true;
    } catch (e) {
      banner('BOOT FAILED — Hybrid persistence not installed: ' + (e && e.message ? e.message : e));
      throw e;
    }
  }

  function ensureReady() {
    if (!_readyPromise) _readyPromise = maybeInstallExperimentalHybrid();
    return _readyPromise;
  }

  global.BaqeriExperimentalHybridBoot = {
    isHybridOptIn: isHybridOptIn,
    maybeInstallExperimentalHybrid: maybeInstallExperimentalHybrid,
    ensureReady: ensureReady,
    // Kept for compatibility; activation is lazy and starts when bootSpaShell awaits ensureReady().
    get ready() { return ensureReady(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
