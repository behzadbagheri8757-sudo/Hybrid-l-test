# Experimental Persistence (Long-term scalability)

## Decision: Hybrid Collection-Store (NOT full entity rows)

After benchmarking:
- 10k invoices ≈ 10 MB JSON
- Full stringify ≈ 50 ms
- Single-entity write ≈ 0 ms
- Clone for rollback ≈ 167 ms

Full per-record Object Stores would require rewriting every mutation path
(invoice+stock+payments+layers must stay atomic) and risk FIFO integrity.

Chosen architecture for experimental branch:
1. Keep in-memory `data` object unchanged (calc/stock/payments/views unchanged)
2. IndexedDB stores one key per top-level collection (not one giant blob)
3. Dirty-tracking: only serialize/write collections that changed
4. Backup remains full snapshot JSON (same format as production — restore compatible)
5. Schema version bump for migration from monolith key

This solves the "every save rewrites everything" bottleneck while preserving
business logic, atomic in-memory mutations, and simple restore.
