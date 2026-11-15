# StockPilot — Architecture v1

## Decision

Use a **feature-based modular monolith** with clear UI/application/domain/infrastructure boundaries and a **SQLite-local-first persistence model**. PostgreSQL is the authoritative multi-device system of record. A single, explicit sync engine exchanges domain commands and versioned changes.

This is deliberately not microservices or a fully generalized sync platform: one app, one backend, and a small protocol make it understandable and testable.

## Dependency direction

UI (`app/` routes + features/*/presentation) -> application use cases -> domain types/contracts. Infrastructure implements repository contracts and sync transport. Domain does not import Expo, React, SQLite, or Supabase.

```
React Native screens -> feature hooks / use cases -> repository interface
                                            |                    |
                                            +-> SQLite repository + outbox
                                            +-> Sync engine -> Supabase RPC -> PostgreSQL
```

### Local store policy

- SQLite is the source read model for screens. Do not maintain duplicate independently authoritative product/sale datasets in Zustand and TanStack Query.
- Zustand, if used, holds **ephemeral UI state** (e.g., current cart and filters) only.
- TanStack Query is optional for authenticated online-only/admin endpoints; it is **not** the source of truth for core offline products and sales.
- Database subscriptions/useLiveQuery or repository-level change notifications should refresh screens after SQLite changes.
- Use prepared/parameterized SQL; enable WAL and foreign keys where supported; manage versioned migrations. Validate transaction behavior against the installed Expo SDK.

## Suggested directory structure

```
stockpilot/
  app/                        # Expo Router, navigation shells, auth and tabs
    (auth)/
    (tabs)/
    product/[id].tsx
    sale/[id].tsx
  src/
    features/
      auth/{presentation,application,domain}/
      products/{presentation,application,domain}/
      inventory/{presentation,application,domain}/
      sales/{presentation,application,domain}/
      dashboard/{presentation,application}/
      sync/{presentation,application,domain}/
    shared/
      ui/                     # Cross-feature, accessible components
      domain/                 # Money, IDs, shared invariants
      infrastructure/
        db/{migrations,queries,repositories}/
        api/
        sync/
        security/
      utils/
    test/{fixtures,fakes,helpers}/
  supabase/
    migrations/              # Versioned PostgreSQL schema / RLS / RPC
    tests/                   # RLS, idempotency, concurrency tests
  docs/{architecture,decisions,testing}/
  .github/workflows/
  AGENTS.md
  README.md
```

Avoid per-feature layering if a module is very small; the goal is clear boundaries, not maximum folders.

## Domain model

All IDs are UUIDs (client-generated for offline operations). Each tenant-scoped row has `store_id`.

### Server PostgreSQL

| Table | Principal fields | Notes |
|---|---|---|
| `stores` | id, name, currency | One store in MVP |
| `store_members` | store_id, user_id, role, status | Owner/staff authorization |
| `products` | id, store_id, sku, name, price_minor, version, deleted_at | Unique store SKU; soft deletion |
| `stock_balances` | store_id, product_id, quantity, version | Fast authoritative available quantity |
| `stock_movements` | id, store_id, product_id, delta_quantity, reason, source_command_id | Append-only audit trail |
| `sales` | id, store_id, created_by, total_minor, occurred_at, status | Immutable on confirmation |
| `sale_items` | sale_id, product_id, quantity, unit_price_minor, line_total_minor | Historical snapshots |
| `processed_commands` | store_id, command_id, result_json, outcome | Unique idempotency key |
| `sync_clock` | store_id, revision | Monotonic commit-ordered store counter, locked during write |
| `change_log` | store_id, revision, entity_type, entity_id, operation, payload | Server delta-feed cursor |

**Revision correctness:** Do not rely solely on PostgreSQL `BIGSERIAL` arrival order for delta sync; concurrent transactions can commit out of order. Allocate revisions under a per-store `sync_clock` row lock in the same transaction as domain writes. If one transaction changes multiple rows, use an ordered batch/change envelope or a sub-sequence within the revision, with cursor semantics carefully specified.

### Local SQLite

- `local_products`, `local_stock_balances`, `local_sales`, `local_sale_items`, `local_stock_movements`: read models and provisional local entities
- `outbox_commands`: command_id, store_id, type, payload_json, expected_version, created_at, status, attempts, next_attempt_at, last_error
- `sync_state`: store_id, server_cursor, last_success_at, bootstrap_completed_at
- `sync_conflicts`: command_id, code, server_snapshot_json, local_payload_json, resolution_state
- `schema_migrations`: migration version

Indexes on `store_id`, product SKU/name, sale occurred_at, pending outbox status and `(store_id, revision)` change-feed queries. Add local `sync_status` as a visible read-model attribute.

## Domain invariants

- Quantity is integer >= 0 for confirmed stock balance.
- Price stored in minor currency units, no JavaScript floating-point arithmetic for totals. Validate bounds.
- An accepted sale must have >=1 line, positive integer quantity, valid product IDs, exact server-calculated total.
- Client timestamps are useful for display but not trusted for command ordering/authorization.
- Confirmed stock movements and sales are immutable. Use new correction events for future undo/returns.
- Only server commits final stock state; device can compute and label a provisional balance.

## Sync contract (versioned application protocol)

### Envelope

```
{
  "protocol_version": 1,
  "store_id": "uuid",
  "device_id": "uuid",
  "commands": [
    {
      "command_id": "uuid",
      "type": "sale.create",
      "created_at": "ISO-8601",
      "payload": { "sale_id": "uuid", "items": [{ "product_id": "uuid", "quantity": 2, "unit_price_minor": 350000 }] }
    }
  ]
}
```

The HTTP transport is an authenticated Supabase Edge Function or RPC facade; **business commit happens in one PostgreSQL transaction**. This is a design contract, not a runnable endpoint.

### Push algorithm

1. Establish single-flight sync per store/device and verify authenticated session.
2. Read next due pending command in creation order, respecting dependencies (e.g., `product.create` precedes `sale.create`).
3. Send command with stable `command_id` and authenticated user context; never trust client-provided actor/role.
4. Server starts a transaction. If `(store_id, command_id)` already exists, return original outcome unchanged.
5. Validate membership, role, schema, price rules, product state and stock availability. Lock affected stock rows in deterministic product-ID order to avoid deadlocks.
6. Apply sale + lines + signed stock movements + updated balances + change-feed entry + processed-command receipt, then commit atomically. Save rejected **business conflicts** as terminal processed outcomes as well.
7. Client handles `applied`/`already_applied`, retryable error, or terminal `conflict` distinctly. Mark acknowledged commands locally without losing the history. Unknown response/network failure means **retry same command ID**, not invent a new one.

### Pull algorithm

1. `pull(store_id, cursor, limit)` checks membership using authenticated user; fetch a stable ordered page of committed changes after cursor.
2. Apply all changes and move local cursor to returned cursor **in the same SQLite transaction**.
3. Do not overwrite unacknowledged local mutations silently. Keep authoritative baseline and pending local deltas separately, or rebuild a materialized projection after reconciling acknowledgements.
4. If the process crashes before SQLite commit, cursor stays old and the page may be fetched again; upserts are idempotent.
5. Repeat pages until caught up; handle revoked membership, pagination, missing history and forced rebootstrap.

### Bootstrap

Initial login and full store download require internet. Fetch a consistent snapshot with a server revision token. Atomically load snapshot and checkpoint; then pull changes after snapshot revision. Do not capture cursor in a separate query without snapshot consistency guarantees. A later offline app restart uses persisted data even if auth refresh is temporarily impossible, but remote writes remain blocked until a valid token is available.

### Trigger policy

Sync on app launch, foreground/resume, connectivity recovery, manual user action, and soon after mutations when online. Add exponential backoff with jitter and persisted retry metadata. Treat network state as a hint; still handle real request failures. Optional platform background scheduling is best effort, never guaranteed (especially after force-close).

## Conflict policy

| Conflict | MVP policy |
|---|---|
| Duplicate submission | Return original outcome; do not apply twice |
| Concurrent sale of last unit | First valid committed sale wins; later command rejected, visible `Needs attention` |
| Product edited on two devices | Version check; reject stale update; show both values and allow user to resubmit |
| Product deleted while offline | Reject references as appropriate; retain local command and resolution path |
| Membership revoked offline | Local records remain provisional; server refuses writes; lock/clear per privacy policy after verified revocation |
| Network timeout after server success | Retry exact command ID; server responds with original result |

## Security and privacy

- Supabase Auth manages identities. Token persistence should follow current Supabase React Native guidance; for sensitive secrets prefer device secure storage with appropriate size/behavior constraints.
- `EXPO_PUBLIC_` variables are visible in the built app: only publishable key + project URL belong there. Never ship secret/service-role keys.
- Enable and test RLS for exposed tables; restrict direct client mutations of server-owned sales, balances, and command receipts.
- Secure server functions: minimal grants, explicit role checks, restrictive function permissions, fixed `search_path` if using security definer, auth-derived caller; test with another store's ID.
- Demo should use fictional data. Real production use requires a dedicated at-rest data protection/privacy design for SQLite and local account switching.
- Logout with unsynced changes: block destructive cleanup until user explicitly confirms the loss, or keep isolated data safely and require same-user reauthentication.

## Architectural decision records to write

- ADR-001: SQLite as UI source of truth vs remote-query-first
- ADR-002: Domain commands + outbox vs syncing raw table mutations
- ADR-003: Rejection policy for offline oversell vs permitting negative stock
- ADR-004: Optimistic concurrency for product edits vs last-write-wins
- ADR-005: Expo SDK 57 + NativeWind stable pairing vs newest SDK

## Limitations to document

Offline device cannot guarantee inventory global truth across unsynchronized devices; background sync is not guaranteed; local unsynced data is not remotely backed up; auth revocation cannot be known until connectivity returns; no payment processing or fiscal tax compliance in MVP.
