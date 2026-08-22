# Missing files (verified absent)

These files are **referenced** by `index.html` but are **not present** in this experimental package.
They were never included in the attachment set used to build the experimental copy.

| File | Role | SPA impact if missing |
|------|------|------------------------|
| `js/stock.js` | FIFO / inventory layers / stock apply-revert | Invoice create/edit/delete/return will throw |
| `js/router.js` | `AppRouter` hash SPA router | Navigation / view mounting will not work |
| `js/payments.js` | Core: `pushInvoicePayments`, `revertInvoicePayments`, … | **Note:** `js/views/payments.js` is the *view* only, not the core |
| `js/prospect-scoring.js` | ProspectScout scoring helpers | Prospect evaluation may fail |

## How to complete the SPA from Production Freeze

Copy **only** these files from your Production Freeze package into this repo (do not overwrite hybrid files):

```text
js/stock.js
js/router.js
js/payments.js          # core module, not views/payments.js
js/prospect-scoring.js  # if used by your freeze build
```

After copying, the default (monolith) SPA path should match Production behavior.
Hybrid remains **opt-in** via `?hybrid=1` (see README).

## Hybrid tests do NOT require the missing files

```bash
node test/hybrid-integrity.test.js
node test/final-validation.test.js
```

Open in browser:

```text
test/idb-transaction-rollback.html
```
