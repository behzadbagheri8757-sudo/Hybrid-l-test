/* db-hybrid.js — Experimental long-term persistence (collection-based + dirty tracking)
 *
 * SAFETY (revised):
 * - saveDataHybrid NEVER skips when forceFull=true
 * - persist-commit.js always sets dirty (hint or markAllDirty) before calling
 * - Missing collection on load → empty array (deterministic recovery)
 * - Corrupt JSON for one collection → that collection resets to []; others load
 * - Multi-collection write uses ONE transaction (browser) or one atomic batch (memory)
 *
 * Does NOT change business logic. Production Freeze uses db.js, not this file.
 */
'use strict';

const HYBRID_DB_NAME = 'baqeriDB_experimental';
const HYBRID_DB_VERSION = 2;
const HYBRID_STORE = 'collections';
const HYBRID_META_KEY = '__meta__';
const HYBRID_SCHEMA = 4;

const COLLECTION_KEYS = [
  'products',
  'customers',
  'invoices',
  'payments',
  'checks',
  'suppliers',
  'inventoryLayers',
];

const META_SCALAR_KEYS = ['invoiceSeq', 'schemaVersion'];

// ---------- dirty tracking ----------
const _dirty = Object.create(null);
let _hybridDb = null;

// ---------- memory backend (Node tests / no IndexedDB) ----------
let _useMemory = typeof indexedDB === 'undefined';
const _memoryStore = Object.create(null);

function useMemoryBackend(on) {
  _useMemory = !!on;
  if (_useMemory) {
    _hybridDb = null;
  }
}

function memoryClear() {
  Object.keys(_memoryStore).forEach(function (k) {
    delete _memoryStore[k];
  });
}

function markDirty(collection) {
  if (!collection) {
    COLLECTION_KEYS.forEach(function (k) {
      _dirty[k] = true;
    });
    _dirty[HYBRID_META_KEY] = true;
    return;
  }
  if (COLLECTION_KEYS.indexOf(collection) !== -1) _dirty[collection] = true;
  if (
    collection === HYBRID_META_KEY ||
    META_SCALAR_KEYS.indexOf(collection) !== -1
  ) {
    _dirty[HYBRID_META_KEY] = true;
  }
}

function markAllDirty() {
  markDirty(null);
}

function clearDirty() {
  COLLECTION_KEYS.forEach(function (k) {
    _dirty[k] = false;
  });
  _dirty[HYBRID_META_KEY] = false;
}

function anyDirty() {
  if (_dirty[HYBRID_META_KEY]) return true;
  return COLLECTION_KEYS.some(function (k) {
    return _dirty[k];
  });
}

function getDirtySnapshot() {
  const out = [];
  if (_dirty[HYBRID_META_KEY]) out.push(HYBRID_META_KEY);
  COLLECTION_KEYS.forEach(function (k) {
    if (_dirty[k]) out.push(k);
  });
  return out;
}

// ---------- IndexedDB ----------
function openHybridDB() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open(HYBRID_DB_NAME, HYBRID_DB_VERSION);
    req.onupgradeneeded = function (e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(HYBRID_STORE)) {
        db.createObjectStore(HYBRID_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = function (e) {
      resolve(e.target.result);
    };
    req.onerror = function (e) {
      reject(e.target.error);
    };
  });
}

async function getHybridDB() {
  if (_useMemory) return null;
  if (!_hybridDb) _hybridDb = await openHybridDB();
  return _hybridDb;
}

function hybridGet(db, key) {
  if (_useMemory) {
    return Promise.resolve(
      _memoryStore[key] != null ? { key: key, value: _memoryStore[key] } : null
    );
  }
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(HYBRID_STORE, 'readonly');
    const req = tx.objectStore(HYBRID_STORE).get(key);
    req.onsuccess = function () {
      resolve(req.result || null);
    };
    req.onerror = function (e) {
      reject(e.target.error);
    };
  });
}

function hybridPutMany(db, entries) {
  if (_useMemory) {
    for (let i = 0; i < entries.length; i++) {
      _memoryStore[entries[i].key] = entries[i].value;
    }
    return Promise.resolve();
  }
  return new Promise(function (resolve, reject) {
    if (!entries.length) {
      resolve();
      return;
    }
    const tx = db.transaction(HYBRID_STORE, 'readwrite');
    const store = tx.objectStore(HYBRID_STORE);
    for (let i = 0; i < entries.length; i++) {
      store.put({ key: entries[i].key, value: entries[i].value });
    }
    tx.oncomplete = function () {
      resolve();
    };
    tx.onerror = function (e) {
      reject(e.target.error);
    };
    tx.onabort = function (e) {
      reject((e && e.target && e.target.error) || new Error('transaction aborted'));
    };
  });
}

function safeParseArray(raw, key) {
  if (raw == null) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(v)) return v;
    console.warn('[hybrid] collection not array, resetting:', key);
    return [];
  } catch (e) {
    console.warn('[hybrid] corrupt collection JSON, resetting:', key, e);
    return [];
  }
}

function safeParseMeta(raw) {
  if (raw == null) return { invoiceSeq: 1000, schemaVersion: HYBRID_SCHEMA };
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      invoiceSeq: v && v.invoiceSeq != null ? v.invoiceSeq : 1000,
      schemaVersion: v && v.schemaVersion != null ? v.schemaVersion : HYBRID_SCHEMA,
    };
  } catch (e) {
    console.warn('[hybrid] corrupt meta, using defaults', e);
    return { invoiceSeq: 1000, schemaVersion: HYBRID_SCHEMA };
  }
}

async function loadDataHybrid() {
  const db = await getHybridDB();
  const d = {
    products: [],
    customers: [],
    invoices: [],
    payments: [],
    checks: [],
    suppliers: [],
    inventoryLayers: [],
    invoiceSeq: 1000,
    schemaVersion: HYBRID_SCHEMA,
  };

  const metaRec = await hybridGet(db, HYBRID_META_KEY);
  if (metaRec && metaRec.value != null) {
    const meta = safeParseMeta(metaRec.value);
    d.invoiceSeq = meta.invoiceSeq;
    d.schemaVersion = meta.schemaVersion;
  }

  for (let i = 0; i < COLLECTION_KEYS.length; i++) {
    const k = COLLECTION_KEYS[i];
    const rec = await hybridGet(db, k);
    if (rec && rec.value != null) {
      d[k] = safeParseArray(rec.value, k);
    }
  }

  clearDirty();
  return d;
}

/**
 * Persist dirty collections in ONE transaction.
 * @param {object} dataObj
 * @param {{ forceFull?: boolean }} [opts]
 *   forceFull: mark all dirty before write (safe path)
 */
async function saveDataHybrid(dataObj, opts) {
  if (!dataObj) throw new Error('saveDataHybrid: no data');
  opts = opts || {};
  if (opts.forceFull) markAllDirty();

  if (!anyDirty()) {
    // Intentional no-op only when nothing was marked (e.g. double-save).
    // persist-commit always marks at least full before calling — so this is rare.
    return { wrote: [], bytes: 0, skipped: true };
  }

  const db = await getHybridDB();
  const entries = [];
  let totalBytes = 0;
  const wrote = [];

  if (_dirty[HYBRID_META_KEY]) {
    const meta = {
      invoiceSeq: dataObj.invoiceSeq || 1000,
      schemaVersion: HYBRID_SCHEMA,
    };
    const s = JSON.stringify(meta);
    totalBytes += s.length;
    entries.push({ key: HYBRID_META_KEY, value: s });
    wrote.push(HYBRID_META_KEY);
  }

  for (let i = 0; i < COLLECTION_KEYS.length; i++) {
    const k = COLLECTION_KEYS[i];
    if (!_dirty[k]) continue;
    const s = JSON.stringify(dataObj[k] || []);
    totalBytes += s.length;
    entries.push({ key: k, value: s });
    wrote.push(k);
  }

  try {
    await hybridPutMany(db, entries);
  } catch (e) {
    // Do NOT clear dirty on failure — caller may retry; in-memory data still current
    throw e;
  }
  clearDirty();
  return { wrote: wrote, bytes: totalBytes, skipped: false };
}

/** Import a classic Full Snapshot (production backup / monolith payload) into hybrid stores */
async function migrateFromMonolithPayload(parsed) {
  const d = parsed;
  markAllDirty();
  await saveDataHybrid(d);
  return d;
}

function dirtyAfterInvoiceMutation() {
  markDirty('invoices');
  markDirty('payments');
  markDirty('checks');
  markDirty('inventoryLayers');
  markDirty('products');
  markDirty('invoiceSeq');
}
function dirtyAfterPaymentMutation() {
  markDirty('payments');
  markDirty('checks');
}
function dirtyAfterCustomerMutation() {
  markDirty('customers');
}
function dirtyAfterProductMutation() {
  markDirty('products');
  markDirty('inventoryLayers');
}
function dirtyAfterSupplierMutation() {
  markDirty('suppliers');
  markDirty('inventoryLayers');
  markDirty('products');
}

const api = {
  HYBRID_DB_NAME: HYBRID_DB_NAME,
  HYBRID_SCHEMA: HYBRID_SCHEMA,
  COLLECTION_KEYS: COLLECTION_KEYS,
  markDirty: markDirty,
  markAllDirty: markAllDirty,
  clearDirty: clearDirty,
  anyDirty: anyDirty,
  getDirtySnapshot: getDirtySnapshot,
  loadDataHybrid: loadDataHybrid,
  saveDataHybrid: saveDataHybrid,
  migrateFromMonolithPayload: migrateFromMonolithPayload,
  dirtyAfterInvoiceMutation: dirtyAfterInvoiceMutation,
  dirtyAfterPaymentMutation: dirtyAfterPaymentMutation,
  dirtyAfterCustomerMutation: dirtyAfterCustomerMutation,
  dirtyAfterProductMutation: dirtyAfterProductMutation,
  dirtyAfterSupplierMutation: dirtyAfterSupplierMutation,
  useMemoryBackend: useMemoryBackend,
  memoryClear: memoryClear,
  openHybridDB: openHybridDB,
  getHybridDB: getHybridDB,
};

if (typeof globalThis !== 'undefined') {
  globalThis.BaqeriHybrid = api;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
