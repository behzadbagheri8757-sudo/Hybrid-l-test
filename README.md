# Baqeri CRM — Experimental Hybrid Persistence

**This is NOT Production Freeze.**  
Standalone repository for testing long-term Hybrid collection persistence.

| | |
|--|--|
| Default persistence | Monolithic `js/db.js` (`baqeriDB` / key `main`) |
| Hybrid persistence | Opt-in only: `?hybrid=1` → `baqeriDB_experimental` |
| Backup format | Full Snapshot (unchanged) |
| Business core | Must be restored from Production Freeze (see below) |

---

## Status

| Check | Result |
|-------|--------|
| Hybrid library tests (`node`) | Runnable now |
| IDB transaction rollback (browser) | Runnable now |
| Full SPA boot | **Incomplete** until missing cores are copied |
| Production code modified | **No** (separate tree) |

See `FINAL_VALIDATION.md`, `EXPERIMENT_STATUS.md`, `MISSING_FILES.md`.

---

## Missing files (required for full SPA)

Verified **absent** from this package:

```text
js/stock.js
js/router.js
js/payments.js          ← core module (NOT js/views/payments.js)
js/prospect-scoring.js
```

Copy them from your **Production Freeze** package into `js/`, then reload.

Until then:

- Hybrid **unit tests** still run.
- Opening `index.html` shows a missing-files message instead of a broken silent boot.

---

## Hybrid opt-in (never silent)

Hybrid is **OFF by default**.

Enable:

```text
index.html?hybrid=1
```

or:

```js
localStorage.setItem('baqeriExperimentalHybrid', '1');
location.reload();
```

Disable:

```js
localStorage.removeItem('baqeriExperimentalHybrid');
// open index.html without ?hybrid=1
```

When enabled, `js/experimental-hybrid-boot.js` calls  
`BaqeriPersistCommit.installExperimentalPersist()` which replaces `saveData` with the hybrid-aware path (full write if no collection hint).

Database name when hybrid is on: **`baqeriDB_experimental`** (does not write Production’s `baqeriDB`).

---

## Run tests

### 1) Hybrid integrity (Node — no browser)

```bash
cd baqeri-hybrid-experimental-repo
node test/hybrid-integrity.test.js
node test/final-validation.test.js
```

Expected: all PASS.

### 2) IndexedDB transaction rollback (browser)

Open in Chrome or Safari:

```text
test/idb-transaction-rollback.html
```

Expected: `RESULT: 6 PASS, 0 FAIL`.

On real **Safari / iPhone** (manual): open the same file and confirm 6 PASS.

### 3) SPA (after restoring missing files)

Serve the folder over HTTP (required for SW / modules in some browsers):

```bash
npx --yes serve -p 4173 .
# open http://localhost:4173/
# hybrid: http://localhost:4173/?hybrid=1
```

---

## New files (Hybrid experiment)

```text
js/db-hybrid.js
js/persist-commit.js
js/experimental-hybrid-boot.js
js/db-experimental-notes.md
test/hybrid-integrity.test.js
test/final-validation.test.js
test/idb-transaction-rollback.html
BENCHMARK_RESULTS.md
EXPERIMENT_STATUS.md
FINAL_VALIDATION.md
MISSING_FILES.md
README.md
```

---

## Architecture (target)

```text
Runtime:     in-memory `data`
Persistence: Hybrid collections (experimental, opt-in)
Backup:      Full Snapshot JSON (independent of IDB layout)
Business:    same as Production (stock / payments / calc unchanged)
```

Do **not** promote to Production until the checklist in `FINAL_VALIDATION.md` passes.

---

## License / origin

Derived from Baqeri CRM SPA for experimental persistence work only.  
Production Freeze remains the source of truth for business logic files listed in `MISSING_FILES.md`.
