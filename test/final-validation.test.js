/**
 * Final Experimental Validation — Hybrid Persistence
 * Node + memory backend. Does not touch Production.
 *
 * Run: node test/final-validation.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'js', 'db-hybrid.js'));
require(path.join(__dirname, '..', 'js', 'persist-commit.js'));

const H = globalThis.BaqeriHybrid;
const C = globalThis.BaqeriPersistCommit;

H.useMemoryBackend(true);

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(function () {
      H.memoryClear();
      H.clearDirty();
      C.resetStats();
      globalThis.data = emptyData();
      return fn();
    })
    .then(function () {
      passed++;
      console.log('  PASS  ' + name);
    })
    .catch(function (e) {
      failed++;
      console.log('  FAIL  ' + name);
      console.log('        ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n        ') : e));
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

/** Classic production-shaped Full Snapshot (schemaVersion 3) */
function makeProductionSnapshot() {
  return {
    products: [
      {
        id: 'pr1',
        name: 'عدس',
        category: 'حبوبات',
        buy: 10000,
        wholesale: 12000,
        retail: 15000,
        sell: 15000,
        stockQty: 20,
        minStock: 5,
        priceHistory: [{ date: '2024-01-01', buy: 10000, wholesale: 12000, retail: 15000 }],
        stockLog: [{ id: 'sl1', date: '2024-01-01', type: 'in', qty: 20, note: 'seed' }],
        active: true,
        packageWeight: 1,
      },
    ],
    customers: [
      {
        id: 'c1',
        name: 'فروشگاه نمونه',
        ownerName: 'علی',
        phone: '09120000000',
        region: 'رویان',
        route: 'شرق',
        address: 'آدرس',
        note: '',
        openingBalance: 0,
        visits: [{ id: 'v1', date: '2024-06-01', time: '10:00', result: 'سفارش گرفته شد' }],
        active: true,
      },
    ],
    invoices: [
      {
        id: 'inv1',
        number: 1001,
        customerId: 'c1',
        date: '2024-06-15',
        items: [
          {
            productId: 'pr1',
            name: 'عدس',
            qty: 2,
            price: 15000,
            buyPrice: 10000,
            discount: 0,
            costAllocations: [{ layerId: 'L1', qty: 2, unitCost: 10000, cost: 20000 }],
          },
        ],
        total: 30000,
        discount: 0,
        cashPaid: 10000,
        cardPaid: 0,
        transferPaid: 0,
        checkPaid: 0,
        editHistory: [],
      },
    ],
    payments: [
      {
        id: 'pay1',
        customerId: 'c1',
        date: '2024-06-15',
        amount: 10000,
        method: 'cash',
        invoiceId: 'inv1',
        note: '',
      },
    ],
    checks: [
      {
        id: 'chk1',
        customerId: 'c1',
        amount: 5000,
        dueDate: '2024-12-01',
        checkNumber: 'CH1',
        status: 'pending',
      },
    ],
    suppliers: [
      {
        id: 's1',
        name: 'تامین‌کننده',
        phone: '021',
        openingBalance: 0,
        active: true,
        purchases: [
          {
            id: 'pur1',
            date: '2024-01-01',
            amount: 200000,
            productId: 'pr1',
            qty: 20,
            returns: [],
          },
        ],
        payments: [{ date: '2024-02-01', amount: 50000, method: 'cash' }],
      },
    ],
    inventoryLayers: [
      {
        id: 'L1',
        purchaseId: 'pur1',
        productId: 'pr1',
        qtyOriginal: 20,
        qtyRemaining: 18,
        unitCost: 10000,
        status: 'open',
        source: 'purchase',
        date: '2024-01-01',
      },
    ],
    invoiceSeq: 1001,
    schemaVersion: 3,
  };
}

function businessFingerprint(d) {
  return JSON.stringify({
    products: (d.products || []).map(function (p) {
      return { id: p.id, name: p.name, stockQty: p.stockQty, active: p.active !== false };
    }),
    customers: (d.customers || []).map(function (c) {
      return {
        id: c.id,
        name: c.name,
        visits: (c.visits || []).length,
        openingBalance: c.openingBalance || 0,
      };
    }),
    invoices: (d.invoices || []).map(function (i) {
      return { id: i.id, number: i.number, total: i.total, customerId: i.customerId, items: (i.items || []).length };
    }),
    payments: (d.payments || []).map(function (p) {
      return { id: p.id, amount: p.amount, method: p.method, customerId: p.customerId, invoiceId: p.invoiceId || null };
    }),
    checks: (d.checks || []).map(function (c) {
      return { id: c.id, amount: c.amount, status: c.status };
    }),
    suppliers: (d.suppliers || []).map(function (s) {
      return {
        id: s.id,
        name: s.name,
        purchases: (s.purchases || []).length,
        payments: (s.payments || []).length,
      };
    }),
    layers: (d.inventoryLayers || []).map(function (l) {
      return { id: l.id, productId: l.productId, qtyRemaining: l.qtyRemaining, unitCost: l.unitCost };
    }),
    invoiceSeq: d.invoiceSeq,
  });
}

async function run() {
  console.log('\n=== FINAL EXPERIMENTAL VALIDATION ===\n');

  // ---- A coverage invariant: no-hint full write ----
  await test('A1: saveData without hint writes ALL collections (no silent skip)', async function () {
    C.installExperimentalPersist();
    globalThis.data = makeProductionSnapshot();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data); // seed
    globalThis.data.payments.push({ id: 'payX', amount: 1, method: 'cash', customerId: 'c1', date: '2024-07-01' });
    C.resetStats();
    // no __persistHint
    await globalThis.saveData();
    const st = C.getStats();
    assert.strictEqual(st.lastMode, 'full');
    assert.ok(st.lastWrote.indexOf('payments') !== -1);
    assert.ok(st.lastWrote.indexOf('customers') !== -1);
    assert.ok(st.lastWrote.indexOf('invoices') !== -1);
    const loaded = await H.loadDataHybrid();
    assert.ok(loaded.payments.some(function (p) { return p.id === 'payX'; }));
    C.uninstallExperimentalPersist();
  });

  await test('A2: selective payment hint writes only payments(+meta if marked)', async function () {
    C.installExperimentalPersist();
    globalThis.data = makeProductionSnapshot();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    globalThis.data.payments.push({ id: 'payY', amount: 2, method: 'cash', customerId: 'c1', date: '2024-07-02' });
    C.resetStats();
    globalThis.__persistHint(['payments']);
    await globalThis.saveData();
    const st = C.getStats();
    assert.strictEqual(st.lastMode, 'selective');
    assert.deepStrictEqual(st.lastWrote.sort(), ['payments'].sort());
    const loaded = await H.loadDataHybrid();
    assert.ok(loaded.payments.some(function (p) { return p.id === 'payY'; }));
    assert.strictEqual(loaded.customers.length, 1);
    C.uninstallExperimentalPersist();
  });

  await test('A3: visit mutation with customers hint preserves other collections', async function () {
    C.installExperimentalPersist();
    globalThis.data = makeProductionSnapshot();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    globalThis.data.customers[0].visits.push({ id: 'v2', date: '2024-08-01', time: '11:00', result: 'پیگیری' });
    globalThis.__persistHint(['customers']);
    await globalThis.saveData();
    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.customers[0].visits.length, 2);
    assert.strictEqual(loaded.invoices.length, 1);
    assert.strictEqual(loaded.payments.length, 1);
    C.uninstallExperimentalPersist();
  });

  await test('A4: invoice-set COMMIT_SETS.invoice writes all dependent collections', async function () {
    C.installExperimentalPersist();
    globalThis.data = makeProductionSnapshot();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    globalThis.data.invoices.push({ id: 'inv2', number: 1002, total: 100, customerId: 'c1', items: [], date: '2024-08-01' });
    globalThis.data.payments.push({ id: 'payZ', amount: 50, method: 'cash', invoiceId: 'inv2' });
    globalThis.data.products[0].stockQty = 18;
    globalThis.data.inventoryLayers[0].qtyRemaining = 16;
    globalThis.data.invoiceSeq = 1002;
    globalThis.__persistHint(C.COMMIT_SETS.invoice);
    await globalThis.saveData();
    const st = C.getStats();
    assert.strictEqual(st.lastMode, 'selective');
    ['invoices', 'payments', 'products', 'inventoryLayers', '__meta__'].forEach(function (k) {
      assert.ok(st.lastWrote.indexOf(k) !== -1, 'missing ' + k + ' in ' + st.lastWrote.join(','));
    });
    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.invoices.length, 2);
    assert.strictEqual(loaded.invoiceSeq, 1002);
    assert.strictEqual(loaded.products[0].stockQty, 18);
    C.uninstallExperimentalPersist();
  });

  // ---- B atomicity ----
  await test('B1: multi-collection batch is one saveDataHybrid call (atomic batch)', async function () {
    globalThis.data = makeProductionSnapshot();
    H.clearDirty();
    H.dirtyAfterInvoiceMutation();
    const dirty = H.getDirtySnapshot();
    assert.ok(dirty.length >= 5);
    const r = await H.saveDataHybrid(globalThis.data);
    assert.strictEqual(r.skipped, false);
    assert.ok(r.wrote.length >= 5);
  });

  await test('B2: failed transaction does not clear dirty; prior disk intact; retry works', async function () {
    globalThis.data = makeProductionSnapshot();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    globalThis.data.payments.push({ id: 'retry-me', amount: 99 });
    H.clearDirty();
    H.markDirty('payments');
    H.useMemoryBackend(false);
    let threw = false;
    try {
      await H.saveDataHybrid(globalThis.data);
    } catch (e) {
      threw = true;
    }
    H.useMemoryBackend(true);
    assert.ok(threw);
    // prior state
    let loaded = await H.loadDataHybrid();
    assert.ok(!loaded.payments.some(function (p) { return p.id === 'retry-me'; }));
    // retry
    H.markDirty('payments');
    await H.saveDataHybrid(globalThis.data);
    loaded = await H.loadDataHybrid();
    assert.ok(loaded.payments.some(function (p) { return p.id === 'retry-me'; }));
  });

  // ---- C rollback via commitMutation ----
  await test('C1: commitMutation rolls back RAM on persist failure', async function () {
    C.installExperimentalPersist();
    globalThis.data = makeProductionSnapshot();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    const beforeLen = globalThis.data.payments.length;
    H.useMemoryBackend(false);
    let threw = false;
    try {
      await C.commitMutation({
        collections: ['payments'],
        mutate: function () {
          globalThis.data.payments.push({ id: 'ghost', amount: 1 });
        },
      });
    } catch (e) {
      threw = true;
    }
    H.useMemoryBackend(true);
    assert.ok(threw);
    assert.strictEqual(globalThis.data.payments.length, beforeLen);
    C.uninstallExperimentalPersist();
  });

  await test('C2: mutation then reload preserves data (full path)', async function () {
    C.installExperimentalPersist();
    globalThis.data = makeProductionSnapshot();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    await C.commitMutation({
      collections: ['payments', 'checks'],
      mutate: function () {
        globalThis.data.payments.push({ id: 'p-reload', amount: 7, method: 'cash' });
        globalThis.data.checks.push({ id: 'chk-reload', amount: 3, status: 'pending' });
      },
    });
    const loaded = await H.loadDataHybrid();
    assert.ok(loaded.payments.some(function (p) { return p.id === 'p-reload'; }));
    assert.ok(loaded.checks.some(function (c) { return c.id === 'chk-reload'; }));
    C.uninstallExperimentalPersist();
  });

  await test('C3: repeated commit cycles (30x) stable', async function () {
    C.installExperimentalPersist();
    globalThis.data = emptyData();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    for (let i = 0; i < 30; i++) {
      await C.commitMutation({
        collections: ['payments'],
        mutate: function () {
          globalThis.data.payments.push({ id: 'c' + i, amount: i });
        },
      });
    }
    const loaded = await H.loadDataHybrid();
    assert.strictEqual(loaded.payments.length, 30);
    C.uninstallExperimentalPersist();
  });

  // ---- D production snapshot compatibility ----
  await test('D1: Production Full Snapshot → Hybrid → load preserves business fingerprint', async function () {
    const snap = makeProductionSnapshot();
    const fpBefore = businessFingerprint(snap);
    await H.migrateFromMonolithPayload(snap);
    const loaded = await H.loadDataHybrid();
    // schemaVersion becomes hybrid 4; fingerprint ignores schemaVersion
    const fpAfter = businessFingerprint(loaded);
    assert.strictEqual(fpAfter, fpBefore);
  });

  await test('D2: Hybrid → export Full Snapshot object → second DB migrate → equivalent', async function () {
    const snap = makeProductionSnapshot();
    await H.migrateFromMonolithPayload(snap);
    const loaded1 = await H.loadDataHybrid();
    // Export as classic Full Snapshot (same shape production uses)
    const exported = {
      products: loaded1.products,
      customers: loaded1.customers,
      invoices: loaded1.invoices,
      payments: loaded1.payments,
      checks: loaded1.checks,
      suppliers: loaded1.suppliers,
      inventoryLayers: loaded1.inventoryLayers,
      invoiceSeq: loaded1.invoiceSeq,
      schemaVersion: 3, // classic export stamps production-compatible version for interchange
    };
    // Clean second DB
    H.memoryClear();
    await H.migrateFromMonolithPayload(exported);
    const loaded2 = await H.loadDataHybrid();
    assert.strictEqual(businessFingerprint(loaded2), businessFingerprint(snap));
  });

  // ---- E migration safety ----
  await test('E1: failed migrate does not leave half state when pre-seeded then fail mid-write', async function () {
    // Seed valid state
    const good = makeProductionSnapshot();
    await H.migrateFromMonolithPayload(good);
    // Attempt write that fails
    H.useMemoryBackend(false);
    let threw = false;
    try {
      H.markAllDirty();
      await H.saveDataHybrid({ payments: [{ id: 'x' }] });
    } catch (e) {
      threw = true;
    }
    H.useMemoryBackend(true);
    assert.ok(threw);
    const loaded = await H.loadDataHybrid();
    assert.strictEqual(businessFingerprint(loaded), businessFingerprint(good));
  });

  await test('C4: installed Hybrid replaces BOTH loadData and saveData and exposes backup storage adapter', async function () {
    const originalLoad = async function () { return 'monolith'; };
    const originalSave = async function () { return 'monolith-save'; };
    globalThis.loadData = originalLoad;
    globalThis.saveData = originalSave;
    globalThis.data = makeProductionSnapshot();
    H.markAllDirty();
    await H.saveDataHybrid(globalThis.data);
    C.installExperimentalPersist();
    assert.notStrictEqual(globalThis.loadData, originalLoad);
    assert.notStrictEqual(globalThis.saveData, originalSave);
    globalThis.data = emptyData();
    await globalThis.loadData();
    assert.strictEqual(globalThis.data.customers.length, 1);
    assert.strictEqual(globalThis.data.invoices.length, 1);
    await C.persistencePut('preRestoreSnapshot', JSON.stringify({ marker: 'hybrid' }));
    const rec = await C.persistenceGet('preRestoreSnapshot');
    assert.strictEqual(rec && JSON.parse(rec.value).marker, 'hybrid');
    await C.persistenceDelete('preRestoreSnapshot');
    assert.strictEqual(await C.persistenceGet('preRestoreSnapshot'), null);
    C.uninstallExperimentalPersist();
    assert.strictEqual(globalThis.loadData, originalLoad);
    assert.strictEqual(globalThis.saveData, originalSave);
  });

  // ---- Default-on boot wiring + ordering ----
  await test('W1: Hybrid is default-on and boot boundary is explicit', async function () {
    const fs = require('fs');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const boot = fs.readFileSync(path.join(__dirname, '..', 'js', 'experimental-hybrid-boot.js'), 'utf8');
    const nav = fs.readFileSync(path.join(__dirname, '..', 'js', 'nav.js'), 'utf8');
    assert.ok(html.indexOf('db.js') !== -1, 'monolith compatibility source referenced');
    assert.ok(html.indexOf('db-hybrid.js') !== -1, 'Hybrid module loaded');
    assert.ok(html.indexOf('persist-commit.js') !== -1, 'Hybrid commit loaded');
    assert.ok(html.indexOf('experimental-hybrid-boot.js') !== -1, 'Hybrid boot loaded');
    assert.ok(boot.indexOf('return true;') !== -1, 'Hybrid default-on');
    assert.ok(boot.indexOf('ensureReady') !== -1, 'explicit boot boundary present');
    assert.ok(nav.indexOf('ensureReady()') !== -1, 'nav awaits Hybrid before loadData');
  });

  await test('W2: no-query boot ordering reaches Hybrid load before UI mutation', async function () {
    const vm = require('vm');
    const fs = require('fs');
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'experimental-hybrid-boot.js'), 'utf8');
    const order = [];
    const ctx = {
      console,
      location: { search: '' },
      data: { customers: [], products: [], invoices: [], payments: [], checks: [], suppliers: [], inventoryLayers: [] },
      emptyData: function(){ return {customers:[],products:[],invoices:[],payments:[],checks:[],suppliers:[],inventoryLayers:[]}; },
      normalizeData: function(d){ order.push('normalize'); return d; },
      dbGet: async function(){ order.push('dbGet'); return null; },
      BaqeriHybrid: {
        hybridHasAnyData: async function(){ order.push('hybridHasAnyData'); return true; },
        migrateFromMonolithPayload: async function(){ order.push('migrate'); },
      },
      BaqeriPersistCommit: {
        installExperimentalPersist: function(){ order.push('install'); },
        loadDataHybridAware: async function(){ order.push('hybridLoad'); return {}; },
      }
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    order.push('appStart');
    await ctx.BaqeriExperimentalHybridBoot.ensureReady();
    order.push('uiReady');
    order.push('customerMutation');
    order.push('saveDataHybrid');
    assert.deepStrictEqual(order, ['appStart','hybridHasAnyData','install','hybridLoad','uiReady','customerMutation','saveDataHybrid']);
    assert.strictEqual(ctx.BaqeriExperimentalHybridBoot.isHybridOptIn(), true);
  });

  console.log('\n=== FINAL VALIDATION: ' + passed + ' PASS, ' + failed + ' FAIL ===\n');
  if (failed) process.exitCode = 1;
}

run().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
