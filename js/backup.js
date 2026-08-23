/* backup.js — export/import JSON, auto-backup, undo restore, excel export
   Phase 0 extract: no logic changes.
*/
// ---------- backup / restore ----------
async function downloadFile(filename, blobParts, mime){
  const blob = (blobParts instanceof Blob) ? blobParts : new Blob([blobParts], {type:mime});
  // iOS Safari often just previews a blob link instead of saving it — the
  // share sheet's "Save to Files" is the reliable path on iPhone.
  try{
    if(navigator.canShare){
      const file = new File([blob], filename, {type:mime});
      if(navigator.canShare({files:[file]})){
        await navigator.share({files:[file], title:filename});
        return;
      }
    }
  }catch(e){
    // user cancelled the share sheet, or share isn't available — fall back below
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

/** کلید اسنپ‌شات Prospect قبل از Restore (داخل همان baqeriDB، جدا از CRM) */
const PRERESTORE_PROSPECT_KEY = 'preRestoreProspect';

/**
 * دسترسی مستقیم به ProspectScoutDB (بدون وابستگی به لود بودن prospect-db.js)
 * تا Backup از صفحه تنظیمات هم کار کند.
 */
function openProspectScoutDbForBackup(){
  return new Promise((resolve, reject)=>{
    try{
      const req = indexedDB.open('ProspectScoutDB', 1);
      req.onupgradeneeded = (e)=>{
        const db = e.target.result;
        if(!db.objectStoreNames.contains('shops')) db.createObjectStore('shops',{keyPath:'id'});
        if(!db.objectStoreNames.contains('routes')) db.createObjectStore('routes',{keyPath:'id'});
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
      };
      req.onsuccess = (e)=> resolve(e.target.result);
      req.onerror = (e)=> reject(e.target.error);
    }catch(e){ reject(e); }
  });
}
function prospectBackupGetAll(db, storeName){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    r.onsuccess = ()=> resolve(r.result||[]);
    r.onerror = ()=> reject(r.error);
  });
}
function prospectBackupGet(db, storeName, key){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    r.onsuccess = ()=> resolve(r.result||null);
    r.onerror = ()=> reject(r.error);
  });
}
function prospectBackupPut(db, storeName, value){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    r.onsuccess = ()=> resolve(value);
    r.onerror = ()=> reject(r.error);
  });
}
function prospectBackupDelete(db, storeName, key){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    r.onsuccess = ()=> resolve(true);
    r.onerror = ()=> reject(r.error);
  });
}

/** Read the complete ProspectScout bundle. Any failure is fatal to a Full Backup. */
async function exportProspectScoutBundle(){
  const db = await openProspectScoutDbForBackup();
  try{
    const shops = await prospectBackupGetAll(db, 'shops');
    const routes = await prospectBackupGetAll(db, 'routes');
    const dtRec = await prospectBackupGet(db, 'meta', 'dailyTarget');
    return {
      version: 1,
      shops: shops || [],
      routes: routes || [],
      dailyTarget: dtRec && Object.prototype.hasOwnProperty.call(dtRec, 'value') ? dtRec.value : null,
    };
  } finally {
    try{ db.close(); }catch(e){}
  }
}

/** Replace shops/routes/meta in ONE ProspectScout transaction. */
async function restoreProspectScoutBundleInDb(db, bundle){
  if(!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('Invalid ProspectScout bundle');
  if(bundle.version !== 1 || !Array.isArray(bundle.shops) || !Array.isArray(bundle.routes)) throw new Error('Invalid ProspectScout bundle schema');
  return new Promise((resolve,reject)=>{
    let tx;
    try { tx = db.transaction(['shops','routes','meta'], 'readwrite'); } catch(e){ reject(e); return; }
    const shops = tx.objectStore('shops');
    const routes = tx.objectStore('routes');
    const meta = tx.objectStore('meta');
    let oldShops = null, oldRoutes = null, queued = false;
    const fail = e => { try{ tx.abort(); }catch(_){} reject(e || new Error('Prospect restore failed')); };
    const queueReplacement = () => {
      if(queued || !oldShops || !oldRoutes) return;
      queued = true;
      try{
        for(const row of oldShops) shops.delete(row.id);
        for(const row of oldRoutes) routes.delete(row.id);
        for(const row of bundle.shops) shops.put(row);
        for(const row of bundle.routes) routes.put(row);
        if(bundle.dailyTarget == null) meta.delete('dailyTarget');
        else meta.put({key:'dailyTarget', value:bundle.dailyTarget});
      }catch(e){ fail(e); }
    };
    const a = shops.getAll();
    a.onsuccess = () => { oldShops = a.result || []; queueReplacement(); };
    a.onerror = () => fail(a.error);
    const b = routes.getAll();
    b.onsuccess = () => { oldRoutes = b.result || []; queueReplacement(); };
    b.onerror = () => fail(b.error);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Prospect restore transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Prospect restore transaction aborted'));
  });
}

/** Replace ProspectScout data; errors propagate to the caller. */
async function restoreProspectScoutBundle(bundle){
  const db = await openProspectScoutDbForBackup();
  try{
    return await restoreProspectScoutBundleInDb(db, bundle);
  } finally {
    try{ db.close(); }catch(e){}
  }
}

function assertKnownKeys(obj, allowed, path){
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(path+' must be an object');
  for(const k of Object.keys(obj)) if(!allowed.has(k)) throw new Error(path+'.'+k+' is unknown');
}
function assertString(v, path, required){ if(v==null && !required) return; if(typeof v!=='string') throw new Error(path+' must be string'); }
function assertNumber(v, path, required){ if(v==null && !required) return; if(typeof v!=='number' || !Number.isFinite(v)) throw new Error(path+' must be finite number'); }
function assertBoolean(v, path, required){ if(v==null && !required) return; if(typeof v!=='boolean') throw new Error(path+' must be boolean'); }
function assertArray(v, path){ if(!Array.isArray(v)) throw new Error(path+' must be array'); }
function assertIdObject(o, path){ assertString(o.id, path+'.id', true); }

function validateBackupDeep(parsed){
  if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new Error('backup root must be object');
  const topAllowed = new Set(['backupVersion','schemaVersion','invoiceSeq','products','customers','invoices','payments','checks','suppliers','inventoryLayers','prospectScout']);
  assertKnownKeys(parsed, topAllowed, 'backup');
  const isCurrentBackup = parsed.backupVersion != null;
  if(isCurrentBackup){
    assertNumber(parsed.backupVersion,'backupVersion',true);
    if(parsed.backupVersion !== 2) throw new Error('unsupported backupVersion');
  }
  const schemaVersion = parsed.schemaVersion == null ? 1 : parsed.schemaVersion;
  assertNumber(schemaVersion,'schemaVersion',true);
  if(!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > (typeof CURRENT_SCHEMA_VERSION === 'number' ? CURRENT_SCHEMA_VERSION : 3)) throw new Error('unsupported backup schemaVersion');
  const currentSchemaVersion = (typeof CURRENT_SCHEMA_VERSION === 'number' ? CURRENT_SCHEMA_VERSION : 3);
  const legacyBackup = !isCurrentBackup && schemaVersion < currentSchemaVersion;
  const requiresFullProspect = isCurrentBackup;
  for(const k of ['products','customers','invoices','payments','checks','suppliers']) assertArray(parsed[k], k);
  if(requiresFullProspect) assertArray(parsed.inventoryLayers, 'inventoryLayers');
  else if(parsed.inventoryLayers != null) assertArray(parsed.inventoryLayers, 'inventoryLayers');
  if(parsed.invoiceSeq!=null) assertNumber(parsed.invoiceSeq,'invoiceSeq',false);

  parsed.products.forEach((p,i)=>{
    const path='products['+i+']'; assertKnownKeys(p,new Set(['id','name','category','packageWeight','buy','wholesale','retail','sell','stockQty','minStock','priceHistory','stockLog','active']),path); assertIdObject(p,path);
    for(const k of ['name','category']) assertString(p[k],path+'.'+k,true);
    for(const k of ['packageWeight','buy','wholesale','retail','sell','stockQty','minStock']) assertNumber(p[k],path+'.'+k,true);
    assertArray(p.priceHistory,path+'.priceHistory'); assertArray(p.stockLog,path+'.stockLog'); assertBoolean(p.active,path+'.active',true);
    p.priceHistory.forEach((h,j)=>{ const q=path+'.priceHistory['+j+']'; assertKnownKeys(h,new Set(['date','buy','wholesale','retail']),q); assertString(h.date,q+'.date',true); for(const k of ['buy','wholesale','retail']) assertNumber(h[k],q+'.'+k,true); });
    p.stockLog.forEach((l,j)=>{ const q=path+'.stockLog['+j+']'; assertKnownKeys(l,new Set(['id','date','type','qty','note','purchaseId','paymentId','invoiceId']),q); assertIdObject(l,q); assertString(l.date,q+'.date',true); assertString(l.type,q+'.type',true); assertNumber(l.qty,q+'.qty',true); if(l.note!=null) assertString(l.note,q+'.note',false); for(const k of ['purchaseId','paymentId','invoiceId']) if(l[k]!=null) assertString(l[k],q+'.'+k,false); });
  });

  parsed.customers.forEach((c,i)=>{
    const path='customers['+i+']'; assertKnownKeys(c,new Set(['id','name','ownerName','phone','address','region','route','note','openingBalance','visits','active']),path); assertIdObject(c,path);
    for(const k of ['name','ownerName','phone','address','region','route','note']) assertString(c[k],path+'.'+k,true); assertNumber(c.openingBalance,path+'.openingBalance',true); assertArray(c.visits,path+'.visits'); assertBoolean(c.active,path+'.active',true);
    c.visits.forEach((v,j)=>{ const q=path+'.visits['+j+']'; assertKnownKeys(v,new Set(['id','date','time','result','ordered','reason','opportunity','threat','nextAction','note','tags']),q); assertIdObject(v,q); assertString(v.date,q+'.date',true); for(const k of ['time','result','reason','opportunity','threat','nextAction','note']) if(v[k]!=null) assertString(v[k],q+'.'+k,false); if(v.ordered!=null) assertBoolean(v.ordered,q+'.ordered',false); if(v.tags!=null){ assertArray(v.tags,q+'.tags'); v.tags.forEach((t,z)=>assertString(t,q+'.tags['+z+']',true)); } });
  });

  parsed.invoices.forEach((inv,i)=>{
    const path='invoices['+i+']'; assertKnownKeys(inv,new Set(['id','number','customerId','date','items','total','discount','discountType','prevBalance','cashPaid','checkPaid','cardPaid','transferPaid','newBalance','editHistory']),path); assertIdObject(inv,path); assertNumber(inv.number,path+'.number',false); assertString(inv.customerId,path+'.customerId',true); assertString(inv.date,path+'.date',true); assertArray(inv.items,path+'.items');
    for(const k of ['total','discount','prevBalance','cashPaid','checkPaid','cardPaid','transferPaid','newBalance']) assertNumber(inv[k],path+'.'+k,false); if(inv.discountType!=null) assertString(inv.discountType,path+'.discountType',false); assertArray(inv.editHistory,path+'.editHistory');
    inv.items.forEach((it,j)=>{ const q=path+'.items['+j+']'; assertKnownKeys(it,new Set(['productId','name','qty','price','buyPrice','discount','weight','costAllocations','cogs']),q); assertString(it.productId,q+'.productId',true); assertString(it.name,q+'.name',true); for(const k of ['qty','price','buyPrice','discount','weight','cogs']) assertNumber(it[k],q+'.'+k,false); if(it.costAllocations!=null){ assertArray(it.costAllocations,q+'.costAllocations'); it.costAllocations.forEach((a,z)=>{ const r=q+'.costAllocations['+z+']'; assertKnownKeys(a,new Set(['layerId','qty','unitCost','cost','emergency']),r); if(a.layerId!=null) assertString(a.layerId,r+'.layerId',false); for(const k of ['qty','unitCost','cost']) assertNumber(a[k],r+'.'+k,true); if(a.emergency!=null) assertBoolean(a.emergency,r+'.emergency',false); }); } });
    inv.editHistory.forEach((h,j)=>{ const q=path+'.editHistory['+j+']'; if(!h || typeof h!=='object' || Array.isArray(h)) throw new Error(q+' must be object'); });
  });

  parsed.payments.forEach((p,i)=>{ const path='payments['+i+']'; assertKnownKeys(p,new Set(['id','customerId','date','amount','method','invoiceId','note','returnItems']),path); assertIdObject(p,path); assertString(p.customerId,path+'.customerId',true); assertString(p.date,path+'.date',true); assertNumber(p.amount,path+'.amount',true); assertString(p.method,path+'.method',true); if(p.invoiceId!=null) assertString(p.invoiceId,path+'.invoiceId',false); if(p.note!=null) assertString(p.note,path+'.note',false); assertArray(p.returnItems,path+'.returnItems'); p.returnItems.forEach((ri,j)=>{ const q=path+'.returnItems['+j+']'; assertKnownKeys(ri,new Set(['productId','name','qty','price','unitCost','max']),q); assertString(ri.productId,q+'.productId',true); if(ri.name!=null) assertString(ri.name,q+'.name',false); for(const k of ['qty','price','unitCost','max']) assertNumber(ri[k],q+'.'+k,false); }); });
  parsed.checks.forEach((c,i)=>{ const path='checks['+i+']'; assertKnownKeys(c,new Set(['id','customerId','amount','dueDate','checkNumber','status','invoiceId']),path); assertIdObject(c,path); assertString(c.customerId,path+'.customerId',true); assertNumber(c.amount,path+'.amount',true); assertString(c.dueDate,path+'.dueDate',true); assertString(c.checkNumber,path+'.checkNumber',true); assertString(c.status,path+'.status',true); if(c.invoiceId!=null) assertString(c.invoiceId,path+'.invoiceId',false); });
  parsed.suppliers.forEach((s,i)=>{ const path='suppliers['+i+']'; assertKnownKeys(s,new Set(['id','name','phone','openingBalance','active','purchases','payments']),path); assertIdObject(s,path); assertString(s.name,path+'.name',true); assertString(s.phone,path+'.phone',true); assertNumber(s.openingBalance,path+'.openingBalance',true); assertBoolean(s.active,path+'.active',true); assertArray(s.purchases,path+'.purchases'); assertArray(s.payments,path+'.payments');
    s.purchases.forEach((pu,j)=>{ const q=path+'.purchases['+j+']'; assertKnownKeys(pu,new Set(['id','date','amount','desc','productId','qty','items','returns']),q); assertIdObject(pu,q); assertString(pu.date,q+'.date',true); assertNumber(pu.amount,q+'.amount',true); assertString(pu.desc,q+'.desc',true); assertString(pu.productId,q+'.productId',true); assertNumber(pu.qty,q+'.qty',true); if(pu.items!=null){ assertArray(pu.items,q+'.items'); pu.items.forEach((it,z)=>{ const r=q+'.items['+z+']'; assertKnownKeys(it,new Set(['id','productId','name','qty','unitCost','lineAmount']),r); assertIdObject(it,r); assertString(it.productId,r+'.productId',true); assertString(it.name,r+'.name',true); for(const k of ['qty','unitCost','lineAmount']) assertNumber(it[k],r+'.'+k,true); }); } assertArray(pu.returns,q+'.returns'); pu.returns.forEach((ret,z)=>{ const r=q+'.returns['+z+']'; assertKnownKeys(ret,new Set(['id','date','qty','amount','items']),r); assertIdObject(ret,r); assertString(ret.date,r+'.date',true); assertNumber(ret.qty,r+'.qty',true); assertNumber(ret.amount,r+'.amount',true); if(ret.items!=null){ assertArray(ret.items,r+'.items'); ret.items.forEach((x,w)=>{ const t=r+'.items['+w+']'; assertKnownKeys(x,new Set(['itemId','productId','qty','amount']),t); if(x.itemId!=null) assertString(x.itemId,t+'.itemId',false); assertString(x.productId,t+'.productId',true); assertNumber(x.qty,t+'.qty',true); assertNumber(x.amount,t+'.amount',true); }); } }); });
    s.payments.forEach((pay,j)=>{ const q=path+'.payments['+j+']'; if(!pay || typeof pay!=='object' || Array.isArray(pay)) throw new Error(q+' must be object'); assertKnownKeys(pay,new Set(['id','date','amount','method','note','faceAmount','checkNumber','bank','issueDate','dueDate','status']),q); if(pay.id!=null) assertString(pay.id,q+'.id',false); assertString(pay.date,q+'.date',true); assertNumber(pay.amount,q+'.amount',true); if(pay.method!=null) assertString(pay.method,q+'.method',false); for(const k of ['note','checkNumber','bank','issueDate','dueDate','status']) if(pay[k]!=null) assertString(pay[k],q+'.'+k,false); if(pay.faceAmount!=null) assertNumber(pay.faceAmount,q+'.faceAmount',false); });
  });
  (parsed.inventoryLayers||[]).forEach((l,i)=>{ const path='inventoryLayers['+i+']'; assertKnownKeys(l,new Set(['id','purchaseId','productId','itemId','qtyOriginal','qtyRemaining','unitCost','status','source','date','note']),path); assertIdObject(l,path); if(l.purchaseId!=null) assertString(l.purchaseId,path+'.purchaseId',false); assertString(l.productId,path+'.productId',true); if(l.itemId!=null) assertString(l.itemId,path+'.itemId',false); for(const k of ['qtyOriginal','qtyRemaining','unitCost']) assertNumber(l[k],path+'.'+k,true); assertString(l.status,path+'.status',true); assertString(l.source,path+'.source',true); if(l.date!=null) assertString(l.date,path+'.date',false); if(l.note!=null) assertString(l.note,path+'.note',false); });

  if(parsed.prospectScout!=null){
    const b=parsed.prospectScout; assertKnownKeys(b,new Set(['version','shops','routes','dailyTarget']),'prospectScout'); if(b.version!==1) throw new Error('prospectScout.version invalid'); assertArray(b.shops,'prospectScout.shops'); assertArray(b.routes,'prospectScout.routes');
    b.shops.forEach((sh,i)=>{ const q='prospectScout.shops['+i+']'; assertKnownKeys(sh,new Set(['id','schemaVersion','name','routeId','neighborhoodId','status','linkedCustomerId','createdAt','updatedAt','latestScore','latestRank','visits']),q); assertIdObject(sh,q); assertNumber(sh.schemaVersion,q+'.schemaVersion',true); assertString(sh.name,q+'.name',true); for(const k of ['routeId','neighborhoodId','linkedCustomerId']) if(sh[k]!=null) assertString(sh[k],q+'.'+k,false); assertString(sh.status,q+'.status',true); assertString(sh.createdAt,q+'.createdAt',true); assertString(sh.updatedAt,q+'.updatedAt',true); assertNumber(sh.latestScore,q+'.latestScore',true); assertString(sh.latestRank,q+'.latestRank',true); assertArray(sh.visits,q+'.visits'); sh.visits.forEach((v,j)=>{ const r=q+'.visits['+j+']'; assertKnownKeys(v,new Set(['id','date','answers','score','rank','scoringVersion','tags']),r); assertIdObject(v,r); assertString(v.date,r+'.date',true); if(!v.answers || typeof v.answers!=='object' || Array.isArray(v.answers)) throw new Error(r+'.answers must be object'); assertNumber(v.score,r+'.score',true); assertString(v.rank,r+'.rank',true); assertNumber(v.scoringVersion,r+'.scoringVersion',true); assertArray(v.tags,r+'.tags'); v.tags.forEach((t,z)=>assertString(t,r+'.tags['+z+']',true)); }); });
    b.routes.forEach((rt,i)=>{ const q='prospectScout.routes['+i+']'; assertKnownKeys(rt,new Set(['id','schemaVersion','name','createdAt','neighborhoods']),q); assertIdObject(rt,q); assertNumber(rt.schemaVersion,q+'.schemaVersion',true); assertString(rt.name,q+'.name',true); assertString(rt.createdAt,q+'.createdAt',true); assertArray(rt.neighborhoods,q+'.neighborhoods'); rt.neighborhoods.forEach((n,j)=>{ const r=q+'.neighborhoods['+j+']'; assertKnownKeys(n,new Set(['id','name']),r); assertIdObject(n,r); assertString(n.name,r+'.name',true); }); });
    if(b.dailyTarget!=null){
      if(typeof b.dailyTarget==='number'){ assertNumber(b.dailyTarget,'prospectScout.dailyTarget',false); }
      else {
        assertKnownKeys(b.dailyTarget,new Set(['date','target','count','hit','lastMsg']),'prospectScout.dailyTarget');
        assertString(b.dailyTarget.date,'prospectScout.dailyTarget.date',true);
        assertNumber(b.dailyTarget.target,'prospectScout.dailyTarget.target',true);
        assertNumber(b.dailyTarget.count,'prospectScout.dailyTarget.count',true);
        if(b.dailyTarget.hit==null || typeof b.dailyTarget.hit!=='object' || Array.isArray(b.dailyTarget.hit)) throw new Error('prospectScout.dailyTarget.hit must be object');
        if(b.dailyTarget.lastMsg==null || typeof b.dailyTarget.lastMsg!=='object' || Array.isArray(b.dailyTarget.lastMsg)) throw new Error('prospectScout.dailyTarget.lastMsg must be object');
      }
    }
  } else if(requiresFullProspect) throw new Error('prospectScout bundle missing — Full Backup requires both databases');
  return true;
}

function validateBackupShape(parsed){
  try { validateBackupDeep(parsed); return true; } catch(e) { return false; }
}
if(typeof globalThis!=='undefined') globalThis.__validateBackupShape = validateBackupShape;
if(typeof globalThis!=='undefined') globalThis.__validateBackupDeep = validateBackupDeep;
if(typeof globalThis!=='undefined') globalThis.__restoreProspectScoutBundleInDb = restoreProspectScoutBundleInDb;

function backupPersistence() {
  if (window.BaqeriPersistCommit && typeof window.BaqeriPersistCommit.isInstalled === 'function' && window.BaqeriPersistCommit.isInstalled()) {
    return window.BaqeriPersistCommit;
  }
  return null;
}

async function crmPersistenceGet(key) {
  const p = backupPersistence();
  return p ? p.persistenceGet(key) : dbGet(key);
}
async function crmPersistencePut(key, value) {
  const p = backupPersistence();
  return p ? p.persistencePut(key, value) : dbPut(key, value);
}
async function crmPersistenceDelete(key) {
  const p = backupPersistence();
  return p ? p.persistenceDelete(key) : dbDelete(key);
}

async function exportBackupJSON(){
  const stamp = todayISO();
  const payload = JSON.parse(JSON.stringify(data));
  payload.backupVersion = 2;
  const prospect = await exportProspectScoutBundle();
  if(!prospect) throw new Error('ProspectScout backup unavailable');
  payload.prospectScout = prospect;
  validateBackupDeep(payload);
  await downloadFile(`baqeri-backup-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
  showToast('فایل بکاپ کامل آماده شد');
}

async function restoreCrmAndProspectAtomically(previousData, previousProspect, parsed){
  let crmChanged = false;
  let prospectChanged = false;
  const hasProspect = !!parsed.prospectScout;
  try{
    data = normalizeData(parsed);
    await saveData();
    crmChanged = true;
    if(hasProspect){
      const prospectTarget = JSON.parse(JSON.stringify(parsed.prospectScout));
      // Legacy ProspectScout backups stored dailyTarget as a numeric target.
      // Convert that legacy scalar to the current durable dailyTarget record.
      if(typeof prospectTarget.dailyTarget === 'number'){
        prospectTarget.dailyTarget = {date: todayISO(), target: prospectTarget.dailyTarget, count:0, hit:{}, lastMsg:{}};
      }
      await restoreProspectScoutBundle(prospectTarget);
      prospectChanged = true;
    }
  }catch(e){
    // Compensating rollback across the two independent IndexedDB databases.
    // Each side is atomic internally; cross-DB consistency is restored by
    // restoring the other side before reporting failure.
    try{
      if(crmChanged){ data = previousData; await saveData(); }
    }catch(rollbackErr){ console.error('CRM restore rollback failed', rollbackErr); }
    try{
      if(prospectChanged || crmChanged){ await restoreProspectScoutBundle(previousProspect); }
    }catch(rollbackErr){ console.error('Prospect restore rollback failed', rollbackErr); }
    data = previousData;
    throw e;
  }
  return true;
}

async function importBackupJSON(file){
  try{
    const text = await file.text();
    const parsed = JSON.parse(text);
    try{ validateBackupDeep(parsed); }catch(validationErr){ showToast('این فایل بکاپ معتبر نیست: '+validationErr.message); return; }
    const previousData = JSON.parse(JSON.stringify(data));
    const previousProspect = await exportProspectScoutBundle();
    await crmPersistencePut(PRERESTORE_KEY, JSON.stringify(previousData));
    await crmPersistencePut(PRERESTORE_PROSPECT_KEY, JSON.stringify(previousProspect));
    await restoreCrmAndProspectAtomically(previousData, previousProspect, parsed);
    render();
    showToast(parsed.prospectScout ? 'اطلاعات CRM و ProspectScout با موفقیت بازیابی شد' : 'اطلاعات CRM با موفقیت بازیابی شد؛ این بکاپ قدیمی ProspectScout ندارد');
  }catch(e){
    console.error(e);
    showToast('بازیابی انجام نشد؛ اطلاعات قبلی حفظ شد');
  }
}

async function undoLastRestore(){
  try{
    const snap = await crmPersistenceGet(PRERESTORE_KEY);
    const pSnap = await crmPersistenceGet(PRERESTORE_PROSPECT_KEY);
    if(!snap || !snap.value || !pSnap || !pSnap.value){ showToast('نسخه‌ی کامل قبل از بازیابی موجود نیست'); return; }
    const previousData = JSON.parse(JSON.stringify(data));
    const targetData = JSON.parse(snap.value);
    const targetProspect = JSON.parse(pSnap.value);
    validateBackupDeep(Object.assign({}, targetData, {prospectScout: targetProspect}));
    await restoreCrmAndProspectAtomically(previousData, await exportProspectScoutBundle(), Object.assign({}, targetData, {prospectScout: targetProspect}));
    try{ await crmPersistenceDelete(PRERESTORE_KEY); await crmPersistenceDelete(PRERESTORE_PROSPECT_KEY); }catch(e){ console.error('pre-restore snapshot cleanup failed', e); }
    render();
    showToast('به حالت قبل از بازیابی برگشت');
  }catch(e){
    console.error(e);
    showToast('بازگرداندن ممکن نشد؛ اطلاعات فعلی حفظ شد');
  }
}

// ---------- Local recovery snapshot (CRM + ProspectScout) ----------
async function getAutoBackupList(){
  const rec = await crmPersistenceGet(AUTO_BACKUP_LIST_KEY);
  if(!rec || !rec.value) return [];
  const list = JSON.parse(rec.value);
  if(!Array.isArray(list)) throw new Error('auto backup list corrupt');
  return list;
}

async function autoBackupTick(){
  const list = await getAutoBackupList();
  const last = list.length ? list[list.length-1].ts : 0;
  if(Date.now() - last < AUTO_BACKUP_INTERVAL_MS) return;
  const prospect = await exportProspectScoutBundle();
  if(!prospect) throw new Error('ProspectScout unavailable; auto backup not created');
  const snapshot = JSON.parse(JSON.stringify(data));
  snapshot.prospectScout = prospect;
  validateBackupDeep(snapshot);
  const ts = Date.now();
  const key = AUTO_BACKUP_PREFIX + ts;
  await crmPersistencePut(key, JSON.stringify(snapshot));
  list.push({key, ts});
  while(list.length > AUTO_BACKUP_MAX){
    const old = list.shift();
    try{ await crmPersistenceDelete(old.key); }catch(e){ /* retention cleanup only */ }
  }
  await crmPersistencePut(AUTO_BACKUP_LIST_KEY, JSON.stringify(list));
}

async function restoreFromAutoBackup(key){
  if(!confirm('مطمئنی؟ اطلاعات فعلی با این نسخه‌ی بازیابی محلی جایگزین می‌شه.')) return;
  try{
    const snap = await crmPersistenceGet(key);
    if(!snap || !snap.value){ showToast('این نسخه‌ی بکاپ پیدا نشد'); return; }
    const parsed = JSON.parse(snap.value);
    validateBackupDeep(parsed);
    const previousData = JSON.parse(JSON.stringify(data));
    const previousProspect = await exportProspectScoutBundle();
    await crmPersistencePut(PRERESTORE_KEY, JSON.stringify(previousData));
    await crmPersistencePut(PRERESTORE_PROSPECT_KEY, JSON.stringify(previousProspect));
    await restoreCrmAndProspectAtomically(previousData, previousProspect, parsed);
    render();
    showToast('بازیابی محلی کامل شد');
  }catch(e){
    console.error(e);
    showToast('بازیابی محلی انجام نشد؛ اطلاعات قبلی حفظ شد');
  }
}

function exportExcel(){
  if(typeof XLSX === 'undefined'){
    showToast('کتابخانه اکسل لود نشد؛ برای این خروجی به اینترنت نیاز است');
    return;
  }
  const wb = XLSX.utils.book_new();

  const custRows = data.customers.map(c=>{
    const t = customerTotals(c.id);
    return {
      'نام فروشگاه': c.name, 'صاحب فروشگاه': c.ownerName||'', 'شماره تماس': c.phone||'',
      'منطقه': c.region||'', 'مسیر': c.route||'',
      'جمع فاکتورها': t.invTotal, 'مانده حساب': t.balance,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(custRows.length?custRows:[{'نام فروشگاه':''}]), 'مشتریان');

  const invRows = [];
  data.invoices.forEach(i=>{
    const cust = data.customers.find(c=>c.id===i.customerId);
    i.items.forEach(it=>{
      invRows.push({
        'شماره فاکتور': i.number||'', 'تاریخ': i.date, 'مشتری': cust?cust.name:'',
        'کالا': it.name, 'تعداد': it.qty, 'قیمت واحد': it.price, 'جمع': it.qty*it.price - (it.discount||0),
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invRows.length?invRows:[{'شماره فاکتور':''}]), 'فاکتورها');

  const prodRows = data.products.map(p=>({
    'نام کالا': p.name, 'دسته‌بندی': p.category||'', 'قیمت خرید (FIFO)': Math.round(productFifoUnitCost(p.id)),
    'قیمت خرید (مبنای پیش‌فرض)': p.buy,
    'قیمت عمده': p.wholesale, 'قیمت مصرف‌کننده': p.retail, 'موجودی': p.stockQty,
    'ارزش ریالی موجودی (FIFO)': Math.round(productInventoryValue(p.id)),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows.length?prodRows:[{'نام کالا':''}]), 'کالاها');

  const supRows = data.suppliers.map(s=>{
    const t = supplierTotals(s.id);
    return { 'تامین‌کننده': s.name, 'جمع خرید': t.purchaseTotal, 'جمع پرداخت': t.payTotal, 'بدهی': t.balance };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(supRows.length?supRows:[{'تامین‌کننده':''}]), 'تامین‌کننده‌ها');

  const wbArray = XLSX.write(wb, {bookType:'xlsx', type:'array'});
  const blob = new Blob([wbArray], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  downloadFile(`baqeri-report-${todayISO()}.xlsx`, blob).then(()=>{
    showToast('فایل اکسل آماده شد');
  });
}

