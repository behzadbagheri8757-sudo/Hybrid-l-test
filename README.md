# Baqeri CRM — Experimental Hybrid Persistence

**This is NOT Production Freeze.**  
Standalone repository for testing long-term Hybrid collection persistence.

| | |
|--|--|
| Default persistence | Monolithic `js/db.js` (`baqeriDB` / key `main`) |
| Hybrid persistence | Opt-in only: `?hybrid=1` → `baqeriDB_experimental`; load/save/backup/restore all use the Hybrid backend |
| Backup format | Full Snapshot (unchanged) |
| Business core | Included in this package; `MISSING_FILES.md` is now informational only |

---

## Status

| Check | Result |
|-------|--------|
| Hybrid library tests (`node`) | Runnable now |
| IDB transaction rollback (browser) | Runnable now |
| Full SPA boot | Included and wired |
| Production code modified | **No** (separate tree) |

See `FINAL_VALIDATION.md`, `EXPERIMENT_STATUS.md`, `MISSING_FILES.md`.

---

## Packaging note

The original experimental package contained a stale `MISSING_FILES.md` that incorrectly listed several core files as absent. The current package includes and loads:

```text
js/stock.js
js/router.js
js/payments.js
js/prospect-scoring.js
```

`MISSING_FILES.md` is retained only as a historical note.

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

When enabled, `js/experimental-hybrid-boot.js` first migrates the existing monolithic snapshot into Hybrid if the Hybrid DB has not been initialized. It then installs a single Hybrid persistence boundary for **both `loadData()` and `saveData()`**. Backup pre-restore snapshots and auto-backups also use the same backend. Missing/corrupt Hybrid collections fail closed instead of silently becoming empty arrays.

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

### 3) SPA

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

Do **not** promote to Production until the E2E Hybrid reload/backup/restore checklist passes on the target browser/device.

---

## License / origin

Derived from Baqeri CRM SPA for experimental persistence work only.  
Production Freeze remains the source of truth for business logic; this repository contains the current experimental copy of the business core.
