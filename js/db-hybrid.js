/* db-hybrid.js — Experimental long-term persistence (collection-based + dirty tracking)
 *
 * SAFETY (revised):
 * - saveDataHybrid NEVER skips when forceFull=true
 * - persist-commit.js always sets dirty (hint or markAllDirty) before calling
 * - Missing collection on an initialized DB → FAIL CLOSED
 * - Corrupt JSON for a business collection → FAIL CLOSED (never silently reset)
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
const HYBRID_INIT_KEY = '__hybrid_init__';
const HYBRID_BACKUP_PREFIX = '__backup__:';
const HYBRID_OWNER_KEY = '__hybrid_owner__';
const HYBRID_OWNER_LEASE_MS = 15000;
const HYBRID_OWNER_HEARTBEAT_MS = 5000;

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
let _ownerToken = null;
let _ownerHeartbeat = null;

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


function makeOwnerToken() {
  return String(Date.now()) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
}

function ownerIsFresh(owner) {
  return !!(owner && typeof owner === 'object' && owner.expiresAt > Date.now());
}

async function acquireHybridOwner() {
  if (_ownerToken) return true;
  const token = makeOwnerToken();
  const now = Date.now();
  if (_useMemory) {
    const current = _memoryStore[HYBRID_OWNER_KEY] ? JSON.parse(_memoryStore[HYBRID_OWNER_KEY]) : null;
    if (ownerIsFresh(current) && current.token !== token) return false;
    _memoryStore[HYBRID_OWNER_KEY] = JSON.stringify({ token: token, acquiredAt: now, expiresAt: now + HYBRID_OWNER_LEASE_MS });
    _ownerToken = token;
    startOwnerHeartbeat();
    return true;
  }
  const db = await getHybridDB();
  const acquired = await new Promise(function(resolve, reject) {
    const tx = db.transaction(HYBRID_STORE, 'readwrite');
    const store = tx.objectStore(HYBRID_STORE);
    let ok = false;
    let owner = null;
    const getReq = store.get(HYBRID_OWNER_KEY);
    getReq.onsuccess = function() {
      owner = getReq.result ? (function(){ try { return JSON.parse(getReq.result.value); } catch(e){ return null; } })() : null;
      if (ownerIsFresh(owner)) return;
      const next = { token: token, acquiredAt: now, expiresAt: now + HYBRID_OWNER_LEASE_MS };
      store.put({ key: HYBRID_OWNER_KEY, value: JSON.stringify(next) });
      ok = true;
    };
    getReq.onerror = function(e){ try{ tx.abort(); }catch(_){} reject(e.target.error); };
    tx.oncomplete = function(){ resolve(ok); };
    tx.onerror = function(e){ reject(e.target.error || new Error('owner transaction failed')); };
    tx.onabort = function(e){ if(!ok) resolve(false); else reject((e && e.target && e.target.error) || new Error('owner transaction aborted')); };
  });
  if (!acquired) return false;
  _ownerToken = token;
  startOwnerHeartbeat();
  return true;
}

async function refreshHybridOwner() {
  if (!_ownerToken) return false;
  const now = Date.now();
  if (_useMemory) {
    const raw = _memoryStore[HYBRID_OWNER_KEY];
    if (!raw) return false;
    let owner; try { owner = JSON.parse(raw); } catch(e) { return false; }
    if (owner.token !== _ownerToken) return false;
    owner.expiresAt = now + HYBRID_OWNER_LEASE_MS;
    _memoryStore[HYBRID_OWNER_KEY] = JSON.stringify(owner);
    return true;
  }
  const db = await getHybridDB();
  return new Promise(function(resolve, reject){
    const tx = db.transaction(HYBRID_STORE, 'readwrite');
    const store = tx.objectStore(HYBRID_STORE);
    const req = store.get(HYBRID_OWNER_KEY);
    let ok = false;
    req.onsuccess = function(){
      let owner = null;
      try { owner = req.result ? JSON.parse(req.result.value) : null; } catch(e) { owner = null; }
      if(!owner || owner.token !== _ownerToken || !ownerIsFresh(owner)){ try{tx.abort();}catch(_){} return; }
      owner.expiresAt = now + HYBRID_OWNER_LEASE_MS;
      store.put({key:HYBRID_OWNER_KEY,value:JSON.stringify(owner)});
      ok = true;
    };
    req.onerror = function(e){ try{tx.abort();}catch(_){} reject(e.target.error); };
    tx.oncomplete = function(){ resolve(ok); };
    tx.onerror = function(e){ reject(e.target.error || new Error('owner refresh failed')); };
    tx.onabort = function(){ if(!ok) resolve(false); };
  });
}

function startOwnerHeartbeat() {
  if (_ownerHeartbeat || typeof setInterval !== 'function') return;
  _ownerHeartbeat = setInterval(function(){
    refreshHybridOwner().catch(function(){ /* save path re-validates ownership */ });
  }, HYBRID_OWNER_HEARTBEAT_MS);
  if (_ownerHeartbeat && typeof _ownerHeartbeat.unref === 'function') _ownerHeartbeat.unref();
}

function stopOwnerHeartbeat() {
  if (_ownerHeartbeat && typeof clearInterval === 'function') clearInterval(_ownerHeartbeat);
  _ownerHeartbeat = null;
}

async function assertHybridOwner() {
  if (!_ownerToken) throw new Error('Hybrid persistence owner is not acquired');
  const ok = await refreshHybridOwner();
  if (!ok) throw new Error('Hybrid persistence owner lost; write blocked to prevent stale overwrite');
  return true;
}

async function releaseHybridOwner() {
  if (!_ownerToken) return;
  const token = _ownerToken;
  _ownerToken = null;
  stopOwnerHeartbeat();
  if (_useMemory) {
    const raw = _memoryStore[HYBRID_OWNER_KEY];
    if (raw) { try { const owner = JSON.parse(raw); if(owner.token === token) delete _memoryStore[HYBRID_OWNER_KEY]; } catch(e){} }
    return;
  }
  try {
    const db = await getHybridDB();
    await new Promise(function(resolve, reject){
      const tx = db.transaction(HYBRID_STORE, 'readwrite');
      const store = tx.objectStore(HYBRID_STORE);
      const req = store.get(HYBRID_OWNER_KEY);
      req.onsuccess = function(){
        let owner=null; try{ owner=req.result?JSON.parse(req.result.value):null; }catch(e){}
        if(owner && owner.token===token) store.delete(HYBRID_OWNER_KEY);
      };
      req.onerror = function(e){ reject(e.target.error); };
      tx.oncomplete = resolve;
      tx.onerror = function(e){ reject(e.target.error); };
      tx.onabort = function(e){ reject((e&&e.target&&e.target.error)||new Error('owner release aborted')); };
    });
  } catch(e) { /* expiry protects future writers */ }
}

function getOwnerStatus() {
  return { owned: !!_ownerToken, token: _ownerToken ? 'held' : null };
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

function hybridDelete(db, key) {
  if (_useMemory) {
    delete _memoryStore[key];
    return Promise.resolve();
  }
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(HYBRID_STORE, 'readwrite');
    tx.objectStore(HYBRID_STORE).delete(key);
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function (e) { reject(e.target.error); };
    tx.onabort = function (e) { reject((e && e.target && e.target.error) || new Error('transaction aborted')); };
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

function parseCollection(raw, key) {
  if (raw == null) return { ok: false, missing: true, value: null };
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(v)) return { ok: true, missing: false, value: v };
    return { ok: false, missing: false, value: null, error: new Error('Hybrid collection is not an array: ' + key) };
  } catch (e) {
    return { ok: false, missing: false, value: null, error: new Error('Hybrid collection JSON is corrupt: ' + key) };
  }
}

function safeParseMeta(raw) {
  if (raw == null) return { invoiceSeq: 1000, schemaVersion: HYBRID_SCHEMA };
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('invalid hybrid meta');
    return {
      invoiceSeq: v.invoiceSeq != null ? v.invoiceSeq : 1000,
      schemaVersion: v.schemaVersion != null ? v.schemaVersion : HYBRID_SCHEMA,
    };
  } catch (e) {
    throw new Error('Hybrid metadata is corrupt');
  }
}

async function hybridHasAnyData() {
  const db = await getHybridDB();
  if (_useMemory) return Object.keys(_memoryStore).length > 0;
  const init = await hybridGet(db, HYBRID_INIT_KEY);
  if (init) return true;
  const meta = await hybridGet(db, HYBRID_META_KEY);
  if (meta) return true;
  for (let i = 0; i < COLLECTION_KEYS.length; i++) {
    if (await hybridGet(db, COLLECTION_KEYS[i])) return true;
  }
  return false;
}

async function hybridPutValue(key, value) {
  const db = await getHybridDB();
  await hybridPutMany(db, [{ key: key, value: value }]);
}

async function hybridGetValue(key) {
  const db = await getHybridDB();
  return hybridGet(db, key);
}

async function hybridDeleteValue(key) {
  const db = await getHybridDB();
  return hybridDelete(db, key);
}

async function loadDataHybrid() {
  const db = await getHybridDB();
  const initRec = await hybridGet(db, HYBRID_INIT_KEY);
  if (!initRec) return null;

  const d = {
    products: [], customers: [], invoices: [], payments: [], checks: [], suppliers: [],
    inventoryLayers: [], invoiceSeq: 1000, schemaVersion: HYBRID_SCHEMA,
  };

  const metaRec = await hybridGet(db, HYBRID_META_KEY);
  const meta = safeParseMeta(metaRec && metaRec.value);
  d.invoiceSeq = meta.invoiceSeq;
  d.schemaVersion = meta.schemaVersion;

  for (let i = 0; i < COLLECTION_KEYS.length; i++) {
    const k = COLLECTION_KEYS[i];
    const rec = await hybridGet(db, k);
    const parsed = parseCollection(rec && rec.value, k);
    if (parsed.missing) {
      throw new Error('Hybrid database is incomplete: missing collection ' + k);
    }
    if (!parsed.ok) throw parsed.error;
    d[k] = parsed.value;
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

function hybridPutManyOwned(db, entries, ownerToken) {
  if (_useMemory) {
    const raw = _memoryStore[HYBRID_OWNER_KEY];
    let owner = null; try { owner = raw ? JSON.parse(raw) : null; } catch(e) {}
    if (!owner || owner.token !== ownerToken || !ownerIsFresh(owner)) return Promise.reject(new Error('Hybrid persistence owner lost; write blocked'));
    owner.expiresAt = Date.now() + HYBRID_OWNER_LEASE_MS;
    _memoryStore[HYBRID_OWNER_KEY] = JSON.stringify(owner);
    for (let i = 0; i < entries.length; i++) _memoryStore[entries[i].key] = entries[i].value;
    return Promise.resolve();
  }
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(HYBRID_STORE, 'readwrite');
    const store = tx.objectStore(HYBRID_STORE);
    let allowed = false;
    const ownerReq = store.get(HYBRID_OWNER_KEY);
    ownerReq.onsuccess = function() {
      let owner = null; try { owner = ownerReq.result ? JSON.parse(ownerReq.result.value) : null; } catch(e) {}
      if (!owner || owner.token !== ownerToken || !ownerIsFresh(owner)) { try { tx.abort(); } catch(_) {} return; }
      owner.expiresAt = Date.now() + HYBRID_OWNER_LEASE_MS;
      store.put({ key: HYBRID_OWNER_KEY, value: JSON.stringify(owner) });
      for (let i = 0; i < entries.length; i++) store.put({ key: entries[i].key, value: entries[i].value });
      allowed = true;
    };
    ownerReq.onerror = function(e){ try{tx.abort();}catch(_){} reject(e.target.error); };
    tx.oncomplete = function(){ if(allowed) resolve(); else reject(new Error('Hybrid persistence owner lost; write blocked')); };
    tx.onerror = function(e){ reject(e.target.error || new Error('Hybrid write transaction failed')); };
    tx.onabort = function(e){ reject((e && e.target && e.target.error) || new Error('Hybrid write transaction aborted')); };
  });
}

async function saveDataHybrid(dataObj, opts) {
  if (!dataObj) throw new Error('saveDataHybrid: no data');
  await assertHybridOwner();
  for (let i = 0; i < COLLECTION_KEYS.length; i++) {
    const k = COLLECTION_KEYS[i];
    if (!Array.isArray(dataObj[k])) {
      throw new Error('Refusing Hybrid save: invalid collection ' + k);
    }
  }
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
  entries.push({ key: HYBRID_INIT_KEY, value: JSON.stringify({ initializedAt: Date.now(), schemaVersion: HYBRID_SCHEMA }) });
  totalBytes += entries[0].value.length;

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
    await hybridPutManyOwned(db, entries, _ownerToken);
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
  HYBRID_INIT_KEY: HYBRID_INIT_KEY,
  HYBRID_BACKUP_PREFIX: HYBRID_BACKUP_PREFIX,
  COLLECTION_KEYS: COLLECTION_KEYS,
  markDirty: markDirty,
  markAllDirty: markAllDirty,
  clearDirty: clearDirty,
  anyDirty: anyDirty,
  getDirtySnapshot: getDirtySnapshot,
  loadDataHybrid: loadDataHybrid,
  hybridHasAnyData: hybridHasAnyData,
  hybridPutValue: hybridPutValue,
  hybridGetValue: hybridGetValue,
  hybridDeleteValue: hybridDeleteValue,
  saveDataHybrid: saveDataHybrid,
  migrateFromMonolithPayload: migrateFromMonolithPayload,
  dirtyAfterInvoiceMutation: dirtyAfterInvoiceMutation,
  dirtyAfterPaymentMutation: dirtyAfterPaymentMutation,
  dirtyAfterCustomerMutation: dirtyAfterCustomerMutation,
  dirtyAfterProductMutation: dirtyAfterProductMutation,
  dirtyAfterSupplierMutation: dirtyAfterSupplierMutation,
  useMemoryBackend: useMemoryBackend,
  memoryClear: memoryClear,
  _testPoke: function (key, value) { if (!_useMemory) throw new Error('test poke requires memory backend'); _memoryStore[key] = value; },
  _testDelete: function (key) { if (!_useMemory) throw new Error('test delete requires memory backend'); delete _memoryStore[key]; },
  openHybridDB: openHybridDB,
  getHybridDB: getHybridDB,
  acquireHybridOwner: acquireHybridOwner,
  refreshHybridOwner: refreshHybridOwner,
  releaseHybridOwner: releaseHybridOwner,
  assertHybridOwner: assertHybridOwner,
  getOwnerStatus: getOwnerStatus,
  HYBRID_OWNER_KEY: HYBRID_OWNER_KEY,
};

if (typeof globalThis !== 'undefined') {
  globalThis.BaqeriHybrid = api;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
