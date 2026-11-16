# ADR-002: Product mutations append immutable outbox commands atomically

- Status: Accepted for M1
- Date: 2026-11-16

## Context

When a product changes offline, the local product and the operation that may be synchronized later must not disagree. Rewriting one pending command with a newer product snapshot would erase the user's intermediate operation history and complicate dependency ordering.

## Decision

Each create, update, and archive runs in one SQLite transaction that changes `local_products` and inserts exactly one `outbox_commands` row. Every command receives a client-generated UUIDv4 and an immutable, protocol-versioned snapshot. `local_sequence` is the durable order. Updates and archives made before a pending create is acknowledged keep a dependency on that create; M1 does not coalesce commands or perform network delivery.

Keep the outbox command type column extensible for future M2 command kinds rather than constraining the table to only product commands. Product archive is a soft delete (`deleted_at` plus `product.delete` command); no physical delete is performed.

## Consequences

- Failure to append an outbox command rolls back the corresponding create, update, or archive.
- Reopening the local database preserves both product state and command IDs/order.
- Later sync retries must reuse the persisted command ID and preserve each payload; sync behavior is outside M1.
- Expo `withTransactionAsync` is retained because its transaction runs on the configured connection with foreign-key enforcement. A per-connection operation queue prevents repository reads/writes from interleaving into that transaction.

## Verification and limits

Real SQLite tests inject an outbox insert failure for create/update/archive and assert product/outbox rollback. File-backed integration tests close and reopen the same DB file and verify the durable local identity, edited/archived product, unique command IDs, and command order. Node's SQLite adapter is not the Expo native bridge. The SDK 57 Android build still requires the documented airplane-mode/force-stop device test before native persistence is considered verified.
