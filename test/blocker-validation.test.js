'use strict';
const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'js', 'db-hybrid.js'));
require(path.join(__dirname, '..', 'js', 'persist-commit.js'));
require(path.join(__dirname, '..', 'js', 'backup.js'));

const H = globalThis.BaqeriHybrid;
const C = globalThis.BaqeriPersistCommit;
const validateBackupDeep = globalThis.__validateBackupDeep;
const restoreProspectScoutBundleInDb = globalThis.__restoreProspectScoutBundleInDb;
H.useMemoryBackend(true);

let passed=0, failed=0;
function test(name, fn){
  return Promise.resolve().then(fn).then(()=>{passed++;console.log('  PASS  '+name);}).catch(e=>{failed++;console.log('  FAIL  '+name+'\n        '+(e.stack||e));});
}
function validBackup(){
  return {
    schemaVersion:3, invoiceSeq:1001,
    products:[{id:'pr1',name:'عدس',category:'حبوبات',packageWeight:1,buy:100,wholesale:120,retail:150,sell:150,stockQty:10,minStock:2,priceHistory:[],stockLog:[],active:true}],
    customers:[{id:'c1',name:'فروشگاه',ownerName:'علی',phone:'1',address:'a',region:'رویان',route:'شرق',note:'',openingBalance:0,visits:[],active:true}],
    invoices:[{id:'i1',number:1001,customerId:'c1',date:'2026-08-23',items:[{productId:'pr1',name:'عدس',qty:1,price:150,buyPrice:100,discount:0,weight:1}],total:150,discount:0,cashPaid:150,checkPaid:0,cardPaid:0,transferPaid:0,editHistory:[]}],
    payments:[{id:'p1',customerId:'c1',date:'2026-08-23',amount:150,method:'cash',note:'',returnItems:[]}],
    checks:[{id:'ch1',customerId:'c1',amount:0,dueDate:'2026-08-23',checkNumber:'',status:'pending'}],
    suppliers:[{id:'s1',name:'تامین',phone:'',openingBalance:0,active:true,purchases:[],payments:[]}],
    inventoryLayers:[{id:'L1',purchaseId:null,productId:'pr1',itemId:null,qtyOriginal:10,qtyRemaining:9,unitCost:100,status:'open',source:'purchase',date:'2026-08-23',note:''}],
    prospectScout:{version:1,shops:[],routes:[],dailyTarget:5}
  };
}

class FakeRequest {
  constructor(executor){ this.result=undefined; this.error=null; this.onsuccess=null; this.onerror=null; executor(this); }
}
class FakeTx {
  constructor(db, failOnPut){ this.db=db; this.failOnPut=failOnPut; this.error=null; this.oncomplete=null; this.onerror=null; this.onabort=null; this.pending=0; this.aborted=false; this.staged={shops:new Map(db.shops),routes:new Map(db.routes),meta:new Map(db.meta)}; }
  objectStore(name){ return new FakeStore(this,name); }
  abort(){ if(this.aborted)return; this.aborted=true; this.error=this.error||new Error('fake abort'); if(this.onabort) setImmediate(()=>this.onabort()); }
  addPending(){ this.pending++; }
  done(){ this.pending--; this.finish(); }
  finish(){ if(!this.aborted && this.pending===0 && this.oncomplete) setImmediate(()=>this.oncomplete()); }
  commit(){ this.db.shops=this.staged.shops; this.db.routes=this.staged.routes; this.db.meta=this.staged.meta; }
}
class FakeStore {
  constructor(tx,name){this.tx=tx;this.name=name;}
  getAll(){ const tx=this.tx; tx.addPending(); return new FakeRequest(req=>setImmediate(()=>{req.result=[...tx.staged[txName(this.name)].values()]; req.onsuccess&&req.onsuccess(); tx.done();})); }
  delete(key){ const tx=this.tx; tx.addPending(); return new FakeRequest(req=>setImmediate(()=>{tx.staged[txName(this.name)].delete(key); req.result=undefined; req.onsuccess&&req.onsuccess(); tx.done();})); }
  put(value){ const tx=this.tx; tx.addPending(); return new FakeRequest(req=>setImmediate(()=>{
    if(tx.failOnPut && this.name==='shops'){ tx.error=new Error('injected put failure'); req.error=tx.error; req.onerror&&req.onerror(); tx.abort(); tx.done(); return; }
    const key=this.name==='meta'?value.key:value.id; tx.staged[txName(this.name)].set(key,value); req.result=value; req.onsuccess&&req.onsuccess(); tx.done();
  })); }
}
function txName(n){return n;}
class FakeDB {
  constructor(failOnPut){this.shops=new Map([['old',{id:'old',name:'old'}]]);this.routes=new Map([['rOld',{id:'rOld',name:'old'}]]);this.meta=new Map([['dailyTarget',{key:'dailyTarget',value:9}]]);this.failOnPut=failOnPut;}
  transaction(){ const tx=new FakeTx(this,this.failOnPut); const orig=tx.oncomplete; Object.defineProperty(tx,'oncomplete',{set(v){this._complete=v; if(this.pending===0&&!this.aborted)setImmediate(()=>{this.commit();v();});},get(){return this._complete;}}); const origFinish=tx.finish.bind(tx); tx.finish=function(){ if(!this.aborted&&this.pending===0&&this._complete)setImmediate(()=>{this.commit();this._complete();}); }; return tx; }
}

(async function run(){
  console.log('\n=== Blocker Validation Tests ===\n');
  await test('malformed backup: missing collection rejected',()=>{const x=validBackup();delete x.invoices;assert.throws(()=>validateBackupDeep(x));});
  await test('malformed backup: collection wrong type rejected',()=>{const x=validBackup();x.products='bad';assert.throws(()=>validateBackupDeep(x));});
  await test('malformed backup: item string/null rejected',()=>{for(const v of ['bad',null]){const x=validBackup();x.products=[v];assert.throws(()=>validateBackupDeep(x));}});
  await test('malformed backup: nested invalid field rejected',()=>{const x=validBackup();x.invoices[0].items[0].qty='1';assert.throws(()=>validateBackupDeep(x));});
  await test('malformed backup: unknown top-level field rejected',()=>{const x=validBackup();x.evil='overwrite';assert.throws(()=>validateBackupDeep(x));});
  await test('malformed backup: unknown nested field rejected',()=>{const x=validBackup();x.inventoryLayers[0].evil='overwrite';assert.throws(()=>validateBackupDeep(x));});
  await test('valid backup round-trip validation passes',()=>{const x=JSON.parse(JSON.stringify(validBackup()));assert.strictEqual(validateBackupDeep(x),true);});

  await test('single-writer owner blocks stale writer',async()=>{
    await H.releaseHybridOwner(); H.memoryClear(); await H.acquireHybridOwner();
    globalThis.data=validBackup(); delete globalThis.data.prospectScout; globalThis.data.inventoryLayers=validBackup().inventoryLayers;
    H.markAllDirty(); await H.saveDataHybrid(globalThis.data);
    // Simulate another tab taking the owner lease after this tab becomes stale.
    H._testPoke(H.HYBRID_OWNER_KEY, JSON.stringify({token:'TAB-B',acquiredAt:Date.now(),expiresAt:Date.now()+15000}));
    globalThis.data.payments.push({id:'new',customerId:'c1',date:'2026-08-23',amount:9,method:'cash',returnItems:[]});
    H.clearDirty(); H.markDirty('payments');
    await assert.rejects(()=>H.saveDataHybrid(globalThis.data));
    const disk=await H.loadDataHybrid(); assert.strictEqual(disk.payments.length,1); assert.strictEqual(disk.payments[0].id,'p1');
  });

  await test('legacy saveData path rolls RAM back on persistence failure',async()=>{
    await H.releaseHybridOwner(); H.memoryClear(); await H.acquireHybridOwner();
    C.installExperimentalPersist();
    globalThis.data=validBackup(); delete globalThis.data.prospectScout;
    H.markAllDirty(); await H.saveDataHybrid(globalThis.data);
    // Seed the commit layer's persisted snapshot exactly as boot/load does.
    await C.loadDataHybridAware();
    H.useMemoryBackend(false);
    globalThis.data.customers.push({id:'c2',name:'new',ownerName:'',phone:'',address:'',region:'',route:'',note:'',openingBalance:0,visits:[],active:true});
    await assert.rejects(()=>globalThis.saveData());
    H.useMemoryBackend(true);
    assert.strictEqual(globalThis.data.customers.length,1);
    const disk=await H.loadDataHybrid(); assert.strictEqual(disk.customers.length,1);
    C.uninstallExperimentalPersist();
  });

  await test('Prospect restore failure is atomic inside its DB transaction',async()=>{
    const db=new FakeDB(true);
    const bundle={version:1,shops:[{id:'new',name:'new'}],routes:[{id:'rNew',name:'new'}],dailyTarget:2};
    await assert.rejects(()=>restoreProspectScoutBundleInDb(db,bundle));
    assert.deepStrictEqual([...db.shops.keys()],['old']);
    assert.deepStrictEqual([...db.routes.keys()],['rOld']);
    assert.strictEqual(db.meta.get('dailyTarget').value,9);
  });

  console.log('\n=== BLOCKER RESULTS: '+passed+' PASS, '+failed+' FAIL ===\n');
  if(failed) process.exitCode=1;
})();
