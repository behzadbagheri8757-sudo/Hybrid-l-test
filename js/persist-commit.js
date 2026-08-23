/* persist-commit.js — Experimental SAFE commit boundary for Hybrid persistence
 *
 * Design goals (Phase B/C):
 * 1. In-memory `data` remains the runtime source of truth (unchanged contract).
 * 2. Never silently lose a mutation because a dirty flag was forgotten.
 * 3. Optional collection hints enable selective writes (hybrid benefit).
 * 4. Missing / invalid hint → FULL collection write (safe fallback ≈ monolith cost).
 * 5. One logical save = one IndexedDB transaction (all dirty keys together).
 * 6. On persistence failure, callers keep their existing previousData rollback.
 * 7. Does NOT rewrite FIFO/COGS/payments business logic.
 *
 * Integration (experimental only):
 *   - Call installExperimentalPersist() once after models.js + db-hybrid.js load.
 *   - Existing `await saveData()` call sites keep working.
 *   - Optional optimization at call sites:
 *       __persistHint(['payments']);
 *       await saveData();
 *     or:
 *       await commitMutation({ collections:['payments'], mutate(){ ... } });
 *
 * Production Freeze is never loaded with this file.
 */
'use strict';

(function (global) {
  const COLLECTION_KEYS = [
    'products',
    'customers',
    'invoices',
    'payments',
    'checks',
    'suppliers',
    'inventoryLayers',
  ];

  /** @type {string[]|null} */
  let _hint = null;
  /** @type {boolean} */
  let _installed = false;
  /** @type {Function|null} */
  let _originalSaveData = null;
  let _originalLoadData = null;
  let _lastPersistedData = null;
  /** stats for tests */
  const _stats = {
    fullWrites: 0,
    selectiveWrites: 0,
    skippedEmpty: 0,
    lastWrote: [],
    lastBytes: 0,
    lastMode: null,
  };

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Optional optimization: declare which collections a following saveData will touch.
   * Cleared after one saveData. Invalid values are ignored → full write.
   */
  function __persistHint(collections) {
    if (!Array.isArray(collections) || !collections.length) {
      _hint = null;
      return;
    }
    const cleaned = [];
    for (let i = 0; i < collections.length; i++) {
      const c = collections[i];
      if (c === 'meta' || c === '__meta__' || c === 'invoiceSeq' || c === 'schemaVersion') {
        if (cleaned.indexOf('__meta__') === -1) cleaned.push('__meta__');
        continue;
      }
      if (COLLECTION_KEYS.indexOf(c) !== -1 && cleaned.indexOf(c) === -1) {
        cleaned.push(c);
      }
    }
    _hint = cleaned.length ? cleaned : null;
  }

  function clearPersistHint() {
    _hint = null;
  }

  /**
   * Centralized mutation + persist helper (preferred for new experimental code).
   * mutate may be sync or async. On persist failure, data is restored from snapshot.
   */
  async function commitMutation(opts) {
    if (!opts || typeof opts.mutate !== 'function') {
      throw new Error('commitMutation requires { mutate }');
    }
    const collections = Array.isArray(opts.collections) ? opts.collections.slice() : null;
    const previousData = deepClone(global.data);
    try {
      const ret = opts.mutate();
      if (ret && typeof ret.then === 'function') await ret;
      if (collections && collections.length) {
        __persistHint(collections);
      } else {
        // no collections declared → force full write
        clearPersistHint();
      }
      await global.saveData();
      return true;
    } catch (e) {
      global.data = previousData;
      clearPersistHint();
      throw e;
    }
  }

  /**
   * Hybrid-aware saveData replacement.
   * SAFETY: if no valid hint → markAllDirty / write every collection.
   * Never no-ops a save after a mutation path that called saveData().
   */
  async function saveDataHybridAware() {
    const H = global.BaqeriHybrid;
    if (!H || typeof H.saveDataHybrid !== 'function') {
      throw new Error('Hybrid module not available; persistence blocked');
    }

    // Global safety net: every legacy mutation path gets an automatic RAM
    // snapshot, so a persistence failure cannot leave RAM ahead of disk.
    const previousData = deepClone(global.data);
    if (global.data) {
      global.data.schemaVersion = H.HYBRID_SCHEMA || global.data.schemaVersion;
    }

    const hint = _hint;
    _hint = null; // consume once

    try {
      if (hint && hint.length) {
        H.clearDirty();
        for (let i = 0; i < hint.length; i++) {
          if (hint[i] === '__meta__') H.markDirty('invoiceSeq');
          else H.markDirty(hint[i]);
        }
        _stats.selectiveWrites++;
        _stats.lastMode = 'selective';
      } else {
        H.markAllDirty();
        _stats.fullWrites++;
        _stats.lastMode = 'full';
      }

      const result = await H.saveDataHybrid(global.data);
      _stats.lastWrote = (result && result.wrote) || [];
      _stats.lastBytes = (result && result.bytes) || 0;
      if (result && result.skipped) _stats.skippedEmpty++;
      _lastPersistedData = deepClone(global.data);

      if (typeof global.autoBackupTick === 'function') {
        global.autoBackupTick().catch(function (e) {
          console.error('auto backup failed', e);
        });
      }
      return result;
    } catch (e) {
      global.data = _lastPersistedData ? deepClone(_lastPersistedData) : previousData;
      H.clearDirty();
      _hint = null;
      throw e;
    }
  }

  function isInstalled() { return _installed; }

  async function getCurrentSnapshot() {
    if (!_installed) return deepClone(global.data);
    return deepClone(global.data);
  }

  function backupKey(name) {
    return (global.BaqeriHybrid.HYBRID_BACKUP_PREFIX || '__backup__:') + name;
  }

  async function persistenceGet(name) {
    if (_installed && global.BaqeriHybrid && typeof global.BaqeriHybrid.hybridGetValue === 'function') {
      return global.BaqeriHybrid.hybridGetValue(backupKey(name));
    }
    return global.dbGet(name);
  }

  async function persistencePut(name, value) {
    if (_installed && global.BaqeriHybrid && typeof global.BaqeriHybrid.hybridPutValue === 'function') {
      return global.BaqeriHybrid.hybridPutValue(backupKey(name), value);
    }
    return global.dbPut(name, value);
  }

  async function persistenceDelete(name) {
    if (_installed && global.BaqeriHybrid && typeof global.BaqeriHybrid.hybridDeleteValue === 'function') {
      return global.BaqeriHybrid.hybridDeleteValue(backupKey(name));
    }
    return global.dbDelete(name);
  }

  /**
   * Install experimental persist: replaces both saveData and loadData so Hybrid
   * is a complete persistence backend rather than a write-only side path.
   */
  function installExperimentalPersist() {
    if (_installed) return;
    if (typeof global.saveData === 'function') _originalSaveData = global.saveData;
    if (typeof global.loadData === 'function') _originalLoadData = global.loadData;
    global.saveData = saveDataHybridAware;
    global.loadData = loadDataHybridAware;
    global.__persistHint = __persistHint;
    global.clearPersistHint = clearPersistHint;
    global.commitMutation = commitMutation;
    global.__persistStats = _stats;
    _installed = true;
  }

  function uninstallExperimentalPersist() {
    if (!_installed) return;
    if (_originalSaveData) global.saveData = _originalSaveData;
    if (_originalLoadData) global.loadData = _originalLoadData;
    _installed = false;
    _hint = null;
    _originalSaveData = null;
    _originalLoadData = null;
    _lastPersistedData = null;
  }

  /**
   * Experimental load: assemble data from hybrid stores, then normalize if available.
   */
  async function loadDataHybridAware() {
    const H = global.BaqeriHybrid;
    if (!H || typeof H.loadDataHybrid !== 'function') {
      throw new Error('Hybrid module not available');
    }
    let d = await H.loadDataHybrid();
    if (typeof global.normalizeData === 'function') {
      d = global.normalizeData(d);
    }
    global.data = d;
    _lastPersistedData = deepClone(d);
    return d;
  }

  // Known collection dependency sets (derived from SPA code audit — advisory only)
  // Callers may use these with __persistHint / commitMutation.
  const COMMIT_SETS = {
    payment: ['payments', 'checks'],
    // visits live on customers[]
    visit: ['customers'],
    customer: ['customers'],
    product: ['products', 'inventoryLayers'],
    // invoice create/edit/delete typically touches stock + payments + checks
    invoice: ['invoices', 'payments', 'checks', 'inventoryLayers', 'products', '__meta__'],
    // supplier purchase / payment / return
    supplier: ['suppliers', 'inventoryLayers', 'products'],
    // sales return is a payment with returnItems + stock
    salesReturn: ['payments', 'inventoryLayers', 'products'],
    // check status toggle
    check: ['checks'],
    // full / unknown
    full: COLLECTION_KEYS.concat(['__meta__']),
  };

  global.BaqeriPersistCommit = {
    COLLECTION_KEYS,
    COMMIT_SETS,
    __persistHint,
    clearPersistHint,
    commitMutation,
    installExperimentalPersist,
    uninstallExperimentalPersist,
    loadDataHybridAware,
    saveDataHybridAware,
    isInstalled,
    getCurrentSnapshot,
    persistenceGet,
    persistencePut,
    persistenceDelete,
    getStats: function () {
      return {
        fullWrites: _stats.fullWrites,
        selectiveWrites: _stats.selectiveWrites,
        skippedEmpty: _stats.skippedEmpty,
        lastWrote: _stats.lastWrote.slice(),
        lastBytes: _stats.lastBytes,
        lastMode: _stats.lastMode,
      };
    },
    resetStats: function () {
      _stats.fullWrites = 0;
      _stats.selectiveWrites = 0;
      _stats.skippedEmpty = 0;
      _stats.lastWrote = [];
      _stats.lastBytes = 0;
      _stats.lastMode = null;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
