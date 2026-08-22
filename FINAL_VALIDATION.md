# FINAL EXPERIMENTAL VALIDATION — Hybrid Persistence

**Date:** 2026-08-23 (final validation re-confirmed)  
**Scope:** `/home/workdir/artifacts/baqeri-experimental/` only  
**Production Freeze:** UNTOUCHED

---

## FINAL VERDICT

### **EXPERIMENTAL ONLY — NEEDS MORE WORK**

The Hybrid **library layer** is safe under its documented contract (full fallback, atomic batch, migration round-trip).  
It is **not** integrated into the experimental app boot path, required business cores are missing from the tree, and Safari/device validation is incomplete.  
It must **not** be promoted to Production.

**Re-confirmed 2026-08-23:** integrity 14/14 PASS · final-validation 13/13 PASS · hybrid not in `index.html` · `stock.js`/`router.js` still ABSENT.

---

## Production status

| Item | Status |
|------|--------|
| Production Freeze | **Untouched** |
| Monolithic `saveData` / Full Snapshot backup | **Unchanged** |
| Reason to break freeze | **None** |

Production should remain on the current monolithic architecture for now.

---

## Experimental status

| Component | Status |
|-----------|--------|
| `js/db-hybrid.js` | Present, memory + IDB paths, forceFull, corrupt recovery |
| `js/persist-commit.js` | Present, full fallback when no hint |
| Wired into `index.html` / app boot | **NO** — app still loads only `db.js` |
| `installExperimentalPersist()` in app/views | **Never called** outside tests |
| `stock.js` / `router.js` / core `payments.js` | **ABSENT** from experimental tree |
| Integrity suite | 14 PASS / 0 FAIL |
| Final validation suite | 13 PASS / 0 FAIL |
| IDB rollback (Chromium) | 6 PASS / 0 FAIL |
| Safari / real iPhone | **UNVERIFIED** |

---

## A) Mutation → persistence coverage (code audit)

All CRM mutations call `await saveData()` (≈54 sites: 40 app.js + 12 views + 3 backup).  
**None** pass `__persistHint` or `commitMutation` in the app.  

**If hybrid were installed today without hints:** every `saveData()` → **full write** (safe; no silent loss).  
**If hybrid were used without install (raw `saveDataHybrid` + empty dirty):** silent skip risk — **mitigated only when using persist-commit**.

| Mutation | Collections changed (in-memory) | Safe hint set | Actual app behavior today |
|----------|----------------------------------|---------------|---------------------------|
| Product create/edit / toggle active | products (+ layers if stock adjust) | `product` | monolith `saveData` |
| Stock in/out/adjust | products, inventoryLayers | `product` | monolith |
| Customer create/edit | customers | `customer` | monolith |
| Visit add/edit | customers (visits nested) | `visit` | monolith |
| Check create / status | checks (+ payments if linked) | `check` / `payment` | monolith |
| Customer payment / sales return | payments, checks?, products, layers | `payment` / `salesReturn` | monolith |
| Invoice create/edit/delete | invoices, payments, checks, products, layers, meta | `invoice` | monolith |
| Supplier create/edit | suppliers | `supplier` (partial) | monolith |
| Supplier purchase / return / payment / check | suppliers, products, layers | `supplier` | monolith |
| Backup import / undo / auto-restore | all | `full` | monolith |
| ProspectScout | separate IDB | n/a | unchanged |

**Silent data loss with current experimental app:** **No** — because hybrid is not installed; monolith always writes full blob.

**Silent data loss if someone swaps only `saveDataHybrid` without persist-commit:** **Yes** — that path is unsafe and must never ship.

---

## Confirmed PASS

1. Integrity suite (Node memory): **14/14**  
2. Final validation suite: **13/13**  
   - no-hint → full write  
   - selective payment / visit / invoice-set  
   - atomic multi-collection batch  
   - fail → prior disk intact + retry  
   - commitMutation RAM rollback on fail  
   - 30× commit cycles  
   - Production snapshot → hybrid → fingerprint match  
   - hybrid → export Full Snapshot → re-import equivalent  
3. Chromium IDB transaction rollback: **6/6**  
4. Full Snapshot backup format left unchanged  
5. Business core not rewritten  

---

## Confirmed FAIL

**None** in the hybrid library tests that were executed.

**Integration gap (not a test failure, blocking promotion):**

- Hybrid scripts not loaded by `index.html`  
- No app-level `installExperimentalPersist()`  
- Missing `stock.js`, `router.js`, core `payments.js`  

---

## UNVERIFIED

| Item | Reason |
|------|--------|
| Full SPA boot with hybrid | Missing cores + not wired |
| FIFO/COGS after hybrid save/load | `stock.js` absent |
| Developer QA 383/383 on hybrid | Cannot run |
| Manual QA / offline / PWA | Not run in this environment |
| Safari / iOS IndexedDB abort & quota | No WebKit runtime |
| Real IDB write latency on device | Only Node serialize measured |
| Auto-backup + PIN + Prospect under hybrid install | Not integrated |

---

## Performance (measured vs inferred)

**Measured (Node serialization only):**

| Scale | Monolith save | Hybrid payment | Hybrid visit | Invoice-set | Heap (approx) |
|------:|--------------:|---------------:|-------------:|--------------:|--------------:|
| 1k | ~8 ms | ~1.4 ms | ~0.6 ms | ~12 ms | ~12 MB |
| 5k | ~90 ms | ~2.3 ms | ~1.3 ms | ~22 ms | ~43 MB |
| 10k | ~79 ms | ~4.4 ms | ~1.8 ms | ~46 ms | ~65 MB |
| 25k | ~323 ms | ~11 ms | ~4 ms | ~110 ms | ~114 MB |
| 50k | ~342 ms | ~24 ms | ~6 ms | ~211 ms | ~359 MB |

**Inferred:** Hybrid helps frequent payment/visit writes; invoice remains heavy; RAM dominates before serialize on mobile at very large scale.

**Unverified:** Safari IDB transaction time, iPhone memory pressure, cold start with hybrid multi-get.

---

## Remaining risks

1. **Integration risk** — hybrid not in boot; wiring must use persist-commit full fallback  
2. **Hint incompleteness** — wrong selective hint under-persists; full fallback is the safety net  
3. **Missing cores** — cannot prove FIFO integrity under hybrid in this tree  
4. **Safari/iOS** — transaction/quota/eviction untested  
5. **Invoice collection still O(n)** — hybrid does not fix large invoice-array writes  
6. **Operational complexity** — two persistence modes until migration completes  

---

## Recommended next step

1. Keep Production frozen.  
2. Restore missing cores into experimental (`stock.js`, `router.js`, core `payments.js`).  
3. Add **opt-in** experimental boot flag that loads `db-hybrid.js` + `persist-commit.js` and calls `installExperimentalPersist()` only when enabled.  
4. Run 383 QA + Manual QA with hybrid on.  
5. User runs `test/idb-transaction-rollback.html` on real Safari/iPhone.  
6. Only after checklist (see below) consider future migration.

---

## Migration trigger (future)

Promote hybrid only when **all** are true:

- [ ] Experimental app boots with hybrid opt-in  
- [ ] 383/383 QA PASS with hybrid  
- [ ] Manual QA PASS (offline, reload, invoice CRUD, returns, backup/restore)  
- [ ] Safari IDB rollback page PASS on device  
- [ ] Production snapshot → hybrid → export → restore verified on device  
- [ ] Real-device metrics: payment save, cold load at realistic data size  
- [ ] Documented rollback to monolith  

**Until then: Production stays monolithic.**

---

## Architecture target (unchanged)

```
Runtime:     in-memory `data`
Persistence: Hybrid collection IndexedDB (experimental candidate)
Backup:      Full Snapshot (independent of IDB layout)
Restore:     validate → load → migrate if needed
Business:    UNCHANGED
```
