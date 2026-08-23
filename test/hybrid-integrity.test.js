/**
 * Hybrid persistence integrity tests (Node, memory backend).
 * Does NOT require stock.js / browser / IndexedDB.
 * Run: node test/hybrid-integrity.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

// Load hybrid + commit modules in Node
const hybridPath = path.join(__dirname, '..', 'js', 'db-hybrid.js');
const commitPath = path.join(__dirname, '..', 'js', 'persist-commit.js');

// db-hybrid assigns globalThis.BaqeriHybrid
require(hybridPath);
require(commitPath);

const H = globalThis.BaqeriHybrid;
const C = globalThis.BaqeriPersistCommit;

H.useMemoryBackend(true);

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  return Promise.resolve()
    .then(function () {
      H.memoryClear();
      H.clearDirty();
      C.resetStats();
      globalThis.data = {
        products: [],
        customers: [],
        invoices: [],
        payments: [],
        checks: [],
        suppliers: [],
        inventoryLayers: [],
        invoiceSeq: 1000,
        schemaVersion: 3,
      };
      return fn();
    })
    .then(function () {
      passed++;
      results.push({ name: name, status: 'PASS' });
      console.log('  PASS  ' + name);
    })
    .catch(function (e) {
      failed++;
      results.push({ name: name, status: 'FAIL', error: String(e && e.message ? e.message : e) });
      console.log('  FAIL  ' + name);
      console.log('        ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n        ') : e));
    });
}

function emptyData() {
  return {
    products: [],
    customers: [],
    invoices: [],
    payments: [],
    checks: [],
    suppliers: [],
    inventoryLayers: [],
    invoiceSeq: 1000,
    schemaVersion: 3,
  };
}

async function run() {
  console.log('\n=== Hybrid Integrity Tests ===\n');

  // --- basic persist/load ---
  await test('full write then load preserves all collections', async function () {
    globalThis.data = emptyData();
    globalThis.data.payments.push({ id: 'p1', amount: 100, customerId: 'c1', date: '2024-01-01', method: 'cash' });
    globalThis.data.customers.push({ id: 'c1', name: 'Ali', visits: [] });
    globalThis.data.invoiceSeq = 1005;
    H.markAllDirty();
    const r = await H.saveDataHybrid(globalThis.data);
    assert.strictEqual(r.skipped, false);
    assert.ok(r.wrote.indexOf('payments') !== -1);
    assert.ok(r.wrote.indexOf('customers') !== -1);
    assert.ok(r.wrote.indexOf('__meta__') !== -1);

    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.payments.length, 1);
    assert.strictEqual(loaded.payments[0].id, 'p1');
    assert.strictEqual(loaded.customers[0].name, 'Ali');
    assert.strictEqual(loaded.invoiceSeq, 1005);
    assert.strictEqual(loaded.schemaVersion, H.HYBRID_SCHEMA);
  });

  await test('selective payment write does not wipe other collections', async function () {
    globalThis.data = emptyData();
    globalThis.data.customers.push({ id: 'c1', name: 'Sara', visits: [] });
    globalThis.data.invoices.push({ id: 'inv1', total: 500, number: 1001 });
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);

    // only add payment, selective write
    globalThis.data.payments.push({ id: 'pay1', amount: 50, method: 'cash' });
    H.clearDirty();
    H.markDirty('payments');
    const r = await H.saveDataHybrid(globalThis.data);
    assert.deepStrictEqual(r.wrote.sort(), ['payments'].sort());

    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.customers.length, 1);
    assert.strictEqual(loaded.invoices.length, 1);
    assert.strictEqual(loaded.payments.length, 1);
  });

  await test('visit mutation selective: customers only', async function () {
    globalThis.data = emptyData();
    globalThis.data.customers.push({ id: 'c1', name: 'A', visits: [] });
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);

    globalThis.data.customers[0].visits.push({ id: 'v1', date: '2024-06-01', result: 'سفارش' });
    H.clearDirty();
    H.markDirty('customers');
    const r = await H.saveDataHybrid(globalThis.data);
    assert.deepStrictEqual(r.wrote, ['customers']);

    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.customers[0].visits.length, 1);
  });

  await test('invoice-set multi-collection single transaction batch', async function () {
    globalThis.data = emptyData();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    globalThis.data.invoices.push({ id: 'i1', total: 100 });
    globalThis.data.payments.push({ id: 'p1', amount: 10 });
    globalThis.data.products.push({ id: 'pr1', stockQty: 5 });
    globalThis.data.inventoryLayers.push({ id: 'L1', qtyRemaining: 5 });
    globalThis.data.invoiceSeq = 1002;
    H.clearDirty();
    H.dirtyAfterInvoiceMutation();
    const dirty = H.getDirtySnapshot();
    assert.ok(dirty.indexOf('invoices') !== -1);
    assert.ok(dirty.indexOf('payments') !== -1);
    assert.ok(dirty.indexOf('products') !== -1);
    assert.ok(dirty.indexOf('inventoryLayers') !== -1);
    assert.ok(dirty.indexOf('__meta__') !== -1);

    const r = await H.saveDataHybrid(globalThis.data);
    // all marked written in one call (one tx in browser; one atomic batch in memory)
    assert.ok(r.wrote.indexOf('invoices') !== -1);
    assert.ok(r.wrote.indexOf('payments') !== -1);
    assert.ok(r.wrote.indexOf('products') !== -1);
    assert.ok(r.wrote.indexOf('inventoryLayers') !== -1);
    assert.ok(r.wrote.indexOf('__meta__') !== -1);

    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.invoices.length, 1);
    assert.strictEqual(loaded.invoiceSeq, 1002);
  });

  // --- corrupt / missing recovery ---
  await test('missing collection fails closed instead of silently resetting', async function () {
    globalThis.data = emptyData();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    if (typeof H._testDelete === 'function') H._testDelete('customers');
    let threw = false;
    try { await H.loadDataHybrid(); } catch (e) { threw = true; }
    assert.strictEqual(threw, true);
  });

  await test('corrupt collection JSON fails closed without resetting it', async function () {
    globalThis.data = emptyData();
    globalThis.data.customers.push({ id: 'c1', name: 'X' });
    globalThis.data.payments.push({ id: 'p1', amount: 9 });
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    H._testPoke('payments', '{not json');
    let threw = false;
    try { await H.loadDataHybrid(); } catch (e) { threw = true; }
    assert.strictEqual(threw, true);
  });

  // --- failed transaction keeps previous persisted state ---
  await test('failed write does not clear dirty; reload shows previous', async function () {
    globalThis.data = emptyData();
    globalThis.data.payments.push({ id: 'old', amount: 1 });
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);

    // mutate RAM
    globalThis.data.payments.push({ id: 'new', amount: 2 });
    H.clearDirty();
    H.markDirty('payments');

    // Simulate failure: temporarily break hybridPutMany via useMemoryBackend false without IDB
    const prevUse = true;
    H.useMemoryBackend(false); // will try real IDB and fail in Node
    let threw = false;
    try {
      await H.saveDataHybrid(globalThis.data);
    } catch (e) {
      threw = true;
    }
    H.useMemoryBackend(true);
    assert.ok(threw, 'expected save to throw without IDB');

    // memory store still has old data
    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.payments.length, 1);
    assert.strictEqual(loaded.payments[0].id, 'old');
  });

  // --- commitMutation API ---
  await test('commitMutation with collections hint does selective write', async function () {
    C.installExperimentalPersist();
    globalThis.data = emptyData();
    globalThis.data.customers.push({ id: 'c1', name: 'B', visits: [] });
    // seed full
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);

    C.resetStats();
    await C.commitMutation({
      collections: ['payments'],
      mutate: function () {
        globalThis.data.payments.push({ id: 'px', amount: 7, method: 'cash' });
      },
    });
    const st = C.getStats();
    assert.strictEqual(st.lastMode, 'selective');
    assert.ok(st.lastWrote.indexOf('payments') !== -1);

    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.payments.length, 1);
    assert.strictEqual(loaded.customers.length, 1);
    C.uninstallExperimentalPersist();
  });

  await test('commitMutation without collections falls back to FULL write', async function () {
    C.installExperimentalPersist();
    globalThis.data = emptyData();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);

    C.resetStats();
    await C.commitMutation({
      mutate: function () {
        globalThis.data.payments.push({ id: 'py', amount: 3 });
        globalThis.data.customers.push({ id: 'c2', name: 'C', visits: [] });
      },
    });
    const st = C.getStats();
    assert.strictEqual(st.lastMode, 'full');
    assert.ok(st.fullWrites >= 1);

    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.payments.length, 1);
    assert.strictEqual(loaded.customers.length, 1);
    C.uninstallExperimentalPersist();
  });

  await test('commitMutation rolls back RAM on persist failure', async function () {
    C.installExperimentalPersist();
    globalThis.data = emptyData();
    globalThis.data.payments.push({ id: 'keep', amount: 1 });
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);

    H.useMemoryBackend(false); // force IDB failure in Node
    let threw = false;
    try {
      await C.commitMutation({
        collections: ['payments'],
        mutate: function () {
          globalThis.data.payments.push({ id: 'lost', amount: 99 });
        },
      });
    } catch (e) {
      threw = true;
    }
    H.useMemoryBackend(true);
    assert.ok(threw);
    // RAM rolled back
    assert.strictEqual(globalThis.data.payments.length, 1);
    assert.strictEqual(globalThis.data.payments[0].id, 'keep');
    C.uninstallExperimentalPersist();
  });

  // --- missing dirty flag simulation: saveData without hint = full, NOT skip ---
  await test('saveData without hint never silent-skips (full fallback)', async function () {
    C.installExperimentalPersist();
    globalThis.data = emptyData();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);

    globalThis.data.payments.push({ id: 'must-survive', amount: 42 });
    // NO __persistHint — must full-write
    C.resetStats();
    await globalThis.saveData();
    const st = C.getStats();
    assert.strictEqual(st.lastMode, 'full');
    assert.ok(st.lastWrote.indexOf('payments') !== -1);

    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.payments.some(function (p) { return p.id === 'must-survive'; }), true);
    C.uninstallExperimentalPersist();
  });

  // --- migration from production full snapshot ---
  await test('migrateFromMonolithPayload imports classic snapshot', async function () {
    const snapshot = emptyData();
    snapshot.products.push({ id: 'pr', name: 'عدس', stockQty: 10 });
    snapshot.customers.push({ id: 'c', name: 'مشتری', visits: [{ id: 'v', date: '2024-01-01' }] });
    snapshot.invoices.push({ id: 'i', number: 1001, total: 1000 });
    snapshot.payments.push({ id: 'p', amount: 100 });
    snapshot.checks.push({ id: 'ch', amount: 50, status: 'pending' });
    snapshot.suppliers.push({ id: 's', name: 'تامین', purchases: [], payments: [] });
    snapshot.inventoryLayers.push({ id: 'L', qtyRemaining: 10 });
    snapshot.invoiceSeq = 1100;
    snapshot.schemaVersion = 3;

    H.memoryClear();
    await H.migrateFromMonolithPayload(snapshot);
    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.products.length, 1);
    assert.strictEqual(loaded.customers[0].visits.length, 1);
    assert.strictEqual(loaded.invoices.length, 1);
    assert.strictEqual(loaded.payments.length, 1);
    assert.strictEqual(loaded.checks.length, 1);
    assert.strictEqual(loaded.suppliers.length, 1);
    assert.strictEqual(loaded.inventoryLayers.length, 1);
    assert.strictEqual(loaded.invoiceSeq, 1100);
    assert.strictEqual(loaded.schemaVersion, H.HYBRID_SCHEMA);
  });

  // --- repeated save/load cycles ---
  await test('repeated save/load cycles preserve data', async function () {
    globalThis.data = emptyData();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    for (let i = 0; i < 20; i++) {
      globalThis.data.payments.push({ id: 'p' + i, amount: i });
      H.clearDirty();
      H.markDirty('payments');
      await H.saveDataHybrid(globalThis.data);
      const loaded = await H.loadDataHybrid();
      assert.strictEqual(loaded.payments.length, i + 1);
      globalThis.data = loaded;
    }
  });

  // --- forceFull option ---
  await test('forceFull writes all collections even if dirty empty', async function () {
    globalThis.data = emptyData();
    globalThis.data.payments.push({ id: 'a', amount: 1 });
    H.clearDirty();
    assert.strictEqual(H.anyDirty(), false);
    const r = await H.saveDataHybrid(globalThis.data, { forceFull: true });
    assert.strictEqual(r.skipped, false);
    assert.ok(r.wrote.length >= COLLECTION_KEYS_LEN());
    function COLLECTION_KEYS_LEN() {
      return H.COLLECTION_KEYS.length; // meta may also be written
    }
  });

  console.log('\n=== RESULTS: ' + passed + ' PASS, ' + failed + ' FAIL ===\n');
  if (failed) process.exitCode = 1;
}

run().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
