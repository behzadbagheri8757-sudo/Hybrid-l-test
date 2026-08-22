# Long-Term Scalability Experiment — Status Report

**Date:** 2026-08-22  
**Scope:** `/home/workdir/artifacts/baqeri-experimental/` only  
**Production Freeze:** UNTOUCHED

---

## PHASE A — Audit of experimental hybrid (actual code)

### 1. Where is saveData / persistence called?

| Location | Count | Notes |
|----------|------:|-------|
| `js/app.js` | 40 | Primary mutation surface (products, customers, invoices, payments, checks, returns, demo seed, …) |
| `js/views/supplier.js` | 10 | Purchase / payment / return / edit / toggle |
| `js/views/checks.js` | 1 | Check status toggle |
| `js/views/invoice.js` | 1 | Invoice delete |
| `js/backup.js` | 3 | import / undo / restoreFromAutoBackup |

Production path (still active in experimental copy of `db.js`):

```js
async function saveData(){
  data.schemaVersion = CURRENT_SCHEMA_VERSION;
  await dbPut(RECORD_KEY, JSON.stringify(data)); // one giant blob
  autoBackupTick().catch(...);
}
```

### 2. Where are mutations performed?

Almost entirely in `app.js` sheets + `supplier.js` SPA view. Pattern:

1. Optional `previousData = JSON.parse(JSON.stringify(data))`
2. Mutate in-memory `data`
3. Call stock helpers (when present)
4. `await saveData()`
5. On failure: `data = previousData`

### 3–6. markDirty coverage — CRITICAL FINDING

**Before this continuation:**

- `markDirty` / `dirtyAfter*` existed only inside `db-hybrid.js`
- **Zero call sites** in `app.js` or any view
- Hybrid was **not wired** into `saveData`
- If someone swapped `saveData` → `saveDataHybrid` without marking dirty, **every mutation would no-op persist** (`skipped: true`) → **silent data loss on reload**

This was the primary unsafe path.

### 7. Multi-collection transaction

`hybridPutMany` puts all dirty keys in **one** IDB transaction (browser). Memory backend applies the batch synchronously. **PASS** by design.

### 8–9. Rollback / kill during transaction

- Callers that snapshot `previousData` restore RAM on `saveData` throw. **PASS** where used.
- Not every `saveData` call site uses previousData (e.g. simple customer edit). Failure then leaves RAM advanced but disk old — same as production monolith.
- Browser kill mid-transaction: IDB transaction atomicity → previous persisted state remains. **Expected PASS** (not re-tested in browser here).

### 10. Missing / corrupt collection

Revised hybrid: missing → `[]`; corrupt JSON → that collection resets to `[]`, others load. Deterministic.

### 11. Migration from Production snapshot

`migrateFromMonolithPayload(parsed)` + integrity test: **PASS** (memory backend).

### Missing source files (cannot claim full SPA regression)

- `stock.js` — ABSENT
- `router.js` — ABSENT  
- core `payments.js` (pushInvoicePayments) — ABSENT (only view exists)
- `prospect-scoring.js` — ABSENT

**SPA end-to-end regression: UNVERIFIED**

---

## PHASE B/C — Safer commit boundary (implemented)

New file: `js/persist-commit.js`

Invariant:

> If a mutation calls `saveData()` and no valid collection hint is set, **full collection write** is performed. Never skip.

APIs:

```js
installExperimentalPersist()  // replaces global saveData with hybrid-aware version
__persistHint(['payments'])   // optional optimization for next save only
commitMutation({ collections:['payments'], mutate(){ ... } })  // preferred for new code
```

| Situation | Behavior |
|-----------|----------|
| Hint present & valid | Selective write (hybrid win) |
| Hint missing / invalid | Full write (safe) |
| Persist throws | `commitMutation` restores RAM snapshot; dirty not cleared in hybrid layer |

---

## PHASE D — Backup

Existing backup (`backup.js`):

- Full JSON snapshot of `data`
- Optional ProspectScout bundle
- `validateBackupShape` requires 6 arrays
- Pre-restore snapshot + undo
- Auto-backup list (max 5, 12h interval)

**Assessment:** Sufficient for 5–10 year single-user offline CRM.

**Not implementing now:** versioned envelope with checksum. Nice-to-have, not required for safety. Old backups remain restorable if `data` shape stays compatible and `normalizeData` continues to migrate.

Recommendation: keep Full Snapshot as backup format; keep it independent of hybrid IDB layout.

---

## PHASE E — Migration framework

Current experimental schema: `HYBRID_SCHEMA = 4` (collection keys).

Path:

```
schemaVersion 3 Full Snapshot (production export)
  → parse + normalizeData (when available)
  → migrateFromMonolithPayload
  → schemaVersion 4 hybrid stores
```

Sequential pure migrations beyond this are designed but not multi-step chained yet (only 3→4). Framework hook is the single migrate function + schema stamp in meta.

---

## PHASE F — Failure tests (executed)

Node memory-backend suite: `test/hybrid-integrity.test.js`

```
14 PASS, 0 FAIL
```

Covered:

1. Payment survives save/load  
2. Visit (customers) survives  
3. Invoice-set multi-collection batch  
4. Selective write does not wipe other collections  
5. Missing collection → []  
6. Failed write → previous disk state retained  
7. commitMutation selective  
8. commitMutation no-hint → full  
9. commitMutation persist fail → RAM rollback  
10. saveData without hint never silent-skip  
11. migrateFromMonolithPayload  
12. Repeated save/load cycles (20×)  
13. forceFull  

Not run (missing browser/stock.js):

- Real IndexedDB transaction abort  
- Full invoice create with FIFO  
- PWA kill mid-write  
- 383 regression suite  

Those remain **UNVERIFIED**.

---

## PHASE G — Benchmarks (serialization; Node)

Honest scope: **JSON serialize/parse only**. Real IDB write time on iOS Safari is **not** measured here.

| Scale | Size | Monolith save | Hybrid payment | Hybrid visit | Hybrid invoice-set | Heap |
|------:|-----:|--------------:|---------------:|---------------:|-------------------:|-----:|
| 1k | 1.2 MB | 8 ms | 1.4 ms | 0.6 ms | 12 ms | 12 MB |
| 5k | 4.8 MB | 90 ms | 2.3 ms | 1.3 ms | 22 ms | 43 MB |
| 10k | 9.4 MB | 79 ms | 4.4 ms | 1.8 ms | 46 ms | 65 MB |
| 25k | 22 MB | 323 ms | 11 ms | 4 ms | 110 ms | 114 MB |
| 50k | 44 MB | 342 ms | 24 ms | 6 ms | 211 ms | 359 MB |

Payment/visit stay largely decoupled from total dataset size under hybrid selective writes.  
Invoice-set remains heavy (dominated by `invoices[]`).  
At 50k, heap ~360 MB in Node during test — RAM is a real limit on mobile before serialize is.

---

## PHASE H — Long-term limit (measured + reasoned)

Likely bottleneck order for this CRM on mobile:

1. **RAM** holding full `data` (50k invoices already hundreds of MB with nested items)  
2. **Render / list virtualization** (not solved by hybrid)  
3. **Invoice-set serialize + IDB write**  
4. **Full load/parse on startup**  
5. **Backup generation** (full snapshot of 40+ MB)  
6. Safari quota / eviction under concurrent auto-backups  

Hybrid delays (1)–(3) for payment/visit-dominated days but does not remove RAM or full-load cost.

---

## PHASE I — Final decision

### A. CURRENT PRODUCTION

- **Keep unchanged.**  
- **No reason to break Production Freeze.**

### B. EXPERIMENTAL HYBRID

| Question | Answer |
|----------|--------|
| Safer than previous experimental? | **Yes** — full fallback eliminates silent skip |
| Faster for payment/visit? | **Yes** (serialization evidence) |
| Faster for invoice? | Marginal |
| Complexity justified? | As **experiment**, yes. For production **now**, no |
| What remains dangerous? | Forgetting that SPA regression is UNVERIFIED; real IDB/iOS unmeasured; invoice path still O(n) |

### C. BACKUP

- **Keep Full Snapshot.**  
- Format change (envelope/checksum) optional later; not required now.

### D. 5–10 YEAR SCALABILITY

| Data size | Recommendation |
|-----------|----------------|
| < ~3–5k invoices | Stay on monolith production |
| ~5–15k, payment/visit lag felt | Consider promoting hybrid |
| > ~25k | Hybrid helps writes; **RAM + UI** need separate work (pagination, archival) |
| Entity-per-record | Only if hybrid proven insufficient **and** measured on device |

### E. PROMOTION CHECKLIST (all must PASS)

- [ ] `stock.js`, `router.js`, core `payments.js` present in experimental tree  
- [ ] `installExperimentalPersist()` wired in experimental boot only  
- [ ] Integrity suite green (this report: 14/14)  
- [ ] Developer QA 383/383 on experimental with hybrid enabled  
- [ ] Manual QA: offline, reload, invoice CRUD, return, backup/restore, undo  
- [ ] Real-device measure: payment save, invoice save, cold load at production-like data size  
- [ ] Migration: production Full Snapshot → hybrid → export → clean restore  
- [ ] Kill/reload during save: no corruption  
- [ ] Auto-backup + PIN + ProspectScout unchanged behavior  
- [ ] Documented rollback plan to monolith if hybrid regresses  

---

## What was already correct

- In-memory `data` as runtime SoT  
- Production `saveData` throws on failure  
- Many mutation paths use previousData rollback  
- Full Snapshot backup + validateBackupShape  
- Hybrid multi-key one transaction design  

## What was unsafe (fixed in experimental)

- Dirty flags completely unwired → silent skip risk  
- No safe fallback when dirty unknown  

## What we changed (experimental only)

1. Rewrote `js/db-hybrid.js` — memory backend, corrupt recovery, forceFull, no dirty-clear on failure  
2. Added `js/persist-commit.js` — centralized commit, full fallback, commitMutation  
3. Added `test/hybrid-integrity.test.js` — 14/14 PASS  
4. Extended benchmarks to 25k / 50k  

## What we tested

- Hybrid integrity (Node memory): **14 PASS / 0 FAIL**  
- Serialization benchmarks 1k–50k: measured (table above)  
- Full SPA / FIFO / real IDB / 383 QA: **UNVERIFIED** (missing cores)

---

## Verdict line

**Production: keep frozen.**  
**Experimental hybrid: safer and promising; not promotion-ready until checklist completes.**  
**Backup: keep Full Snapshot.**  
**Do not introduce entity-per-record, event sourcing, or incremental backup at this time.**
