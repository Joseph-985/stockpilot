# ADR-M2: Local inventory ledger and sales

## Status

Accepted for M2; sync reconciliation is deferred to M4.

## Decisions

- Inventory history is append-only. A cached local estimate is `base_quantity + pending_delta`; each inventory write updates the projection, movement, and one outbox command in the same serialized SQLite transaction.
- A sale produces one `sale.create` outbox command containing immutable item snapshots. Its negative movements reference that command and do not create separate inventory adjustment commands.
- Prices and totals use bounded integer kobo. Checkout re-reads products and stock inside the transaction, rejects a stale reviewed price, and stores name/SKU/unit-price snapshots.
- Local writes are serialized through the shared database operation queue and check estimated stock under the transaction. This protects one local database; it cannot coordinate separate disconnected devices.
- Each logical checkout has a stable `checkout_request_id`. The unique store/request key returns the original committed sale when the same attempt is retried. A new intentional checkout gets a new request ID.
- Additive migrations preserve M1 products/outbox. Migration 6 makes movements and sale items append-only, protects sale financial/customer snapshots, and permits only pending-to-confirmed/needs-attention status changes for future reconciliation. Sale outbox payload fields are immutable while delivery metadata remains mutable.

## Trade-offs and follow-up

The balance projection duplicates information available in movement history and must be reconciled carefully in M4. Local stock checks do not guarantee authoritative stock. Request ID deduplication is local database idempotency, separate from M3 server command idempotency. SQLite integration tests currently run with Node's native SQLite, so Expo's native transaction behavior and force-stop persistence remain a device verification item.
