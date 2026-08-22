# Persistence Benchmark Results (Node.js, experimental)

Measured on synthetic datasets matching CRM shape (invoices with items+costAllocations, visits on customers, stockLog, inventoryLayers, supplier purchases).

| Scale | Size | Monolith save | Hybrid payment | Hybrid visit | Hybrid invoice-set | Monolith load |
|-------|------|---------------|----------------|--------------|--------------------|---------------|
| 500 inv | 1.0 MB | 5 ms | 0.6 ms (9x) | 0.4 ms (13x) | 3 ms | 5 ms |
| 1k inv | 1.8 MB | 11 ms | 1.2 ms (9x) | 0.8 ms (13x) | 6 ms | 9 ms |
| 5k inv | 6.9 MB | 45 ms | 5.5 ms (8x) | 1.7 ms (26x) | 29 ms | 41 ms |
| 10k inv | 13.3 MB | 95 ms | 12 ms (8x) | 2.9 ms (32x) | 82 ms | 90 ms |

Bytes written (10k scale):
- Monolith every save: ~13.3 MB
- Payment only (hybrid): ~2.6 MB (payments array)
- Visit only (hybrid): ~0.9 MB (customers array)
- Invoice mutation set: ~12.6 MB (almost full)

True per-record Object Store would reduce payment write to ~0.2 KB and ~0 ms, independent of dataset size — but requires multi-store atomic transactions and mutation-path rewrites.
