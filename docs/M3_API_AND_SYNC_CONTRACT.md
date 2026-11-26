# M3 Secure Command, Bootstrap and Pull Contracts (M4-ready, NOT M4 implementation)

## 1. Transport

Recommended M3 endpoints (or equivalent typed RPC facade, justified in ADR):

- `POST /functions/v1/process-command` — submit **one** authenticated command. Batching is an M4 optimization; one command at a time simplifies exactly-once-effects design.
- `POST /functions/v1/bootstrap-store` — authenticated consistent snapshot for a specified member store. Can return bounded paged snapshot with a correct stable revision boundary; if consistency cannot be guaranteed for large stores, explicitly limit to a small M3 fixture and document rebootstrap redesign.
- `POST /functions/v1/pull-changes` — authenticated ordered committed changes after `(revision, ordinal)` cursor, limited page size; no mobile call in M3.

The command processor may be implemented using a thin Edge Function that calls a restricted SQL RPC, or an equivalent architecture proving a SINGLE database transaction for all side effects. A sequence of independent PostgREST inserts/updates is forbidden. Validate JWT using current SDK. Authenticate and check live membership **inside the SQL transaction**.

## 2. Idempotency and concurrency (core algorithm)

Within a single database transaction:

1. Verify user identity from Supabase/JWT SQL context and CURRENT active store membership and role. Repeat this check on every invocation, including retries of stored commands.
2. Validate command protocol, store UUID, command type, stable IDs and request payload. Hash a deterministic, server-derived representation (after normalizing semantically equivalent JSON and defined omitted fields). Reject invalid/unknown versions.
3. Claim unique `(store_id, command_id)` by a unique index/row with row-level serialization, or a scoped transaction advisory lock. A concurrent duplicate waits and ultimately receives the committed result. No observable intermediate `processing` receipt can be left by a failed transaction.
4. If receipt exists: compare canonical request hash. If matching, return the exact stored terminal result; if different, return `idempotency_key_reuse` without side effects. Re-check current authorization **before** returning receipt.
5. Validate business prerequisites. For a sale, sort product UUIDs, lock relevant `stock_balances` rows in deterministic order, re-read products/prices/roles, and ensure available quantity remains nonnegative.
6. Apply all accepted changes and append audit rows; save **terminal business conflict** receipt if rejected for business reasons, with no domain mutation. Unexpected infrastructure errors roll back and remain retryable (no terminal receipt).
7. Increment `sync_clock` under a per-store `SELECT ... FOR UPDATE` row lock. Add ordered `change_log` rows in the same transaction for state-changing accepted commands. Write final processed-command receipt containing outcome and revision; commit.

Use a unique `(store_id, checkout_request_id)` for accepted sales as a separate defense. If the same checkout ID is submitted with another command ID, explicitly reject/resolve using stable identity, not silently sell twice.

**Ordering detail:** PostgreSQL sequences (`bigserial`) don't encode commit order under concurrency. A per-store clock row locked until commit produces a stable, committed revision order. One transaction may emit multiple changes with a monotonic `ordinal` within its revision. Never advance cursor beyond rows from a transaction still uncommitted.

## 3. Sample command payload: sale.create

```json
{
  "protocol_version": 1,
  "store_id": "<uuid>",
  "device_id": "<uuid>",
  "command_id": "<uuid>",
  "type": "sale.create",
  "payload": {
    "sale_id": "<uuid>",
    "checkout_request_id": "<uuid>",
    "currency": "NGN",
    "occurred_at": "2026-11-16T10:00:00.000Z",
    "total_minor": 1050000,
    "items": [
      {"product_id": "<uuid>", "quantity": 3, "unit_price_minor": 350000, "line_total_minor": 1050000}
    ]
  }
}
```

Do not assume this equals the M2 stored payload byte-for-byte. First inspect M2 `outbox_commands` and define stable schema adapters, versioning, or optional field defaults. Never mutate the M2 outbox automatically in M3.

Server rechecks price and stock and computes exact total. For a mismatch, return a structured terminal `price_changed` or `insufficient_stock` conflict and preserve receipt, rather than creating an inaccurate sale.

## 4. Example responses

Applied:

```json
{
  "protocol_version": 1,
  "command_id": "<uuid>",
  "outcome": "applied",
  "entity_id": "<uuid>",
  "server_revision": 18,
  "result": {"total_minor": 1050000}
}
```

Retry of the **same** command: return equivalent original committed outcome, `server_revision`, entity ID and result; optional transport-level `replayed: true` (do not change stored semantic outcome). Never recompute totals using changed current prices on replay.

Terminal business conflict:

```json
{
  "protocol_version": 1,
  "command_id": "<uuid>",
  "outcome": "conflict",
  "code": "insufficient_stock",
  "details": {"product_id": "<uuid>", "available": 0, "requested": 1}
}
```

Unknown timeout/5xx = retryable with same command ID. Auth/forbidden must not leak another tenant's records. Use stable error codes for M4 UI. Do not invent durable receipt for transient 5xx failures.

## 5. Pull changes

Request: `{ "store_id": "uuid", "cursor": {"revision": 10, "ordinal": 2}, "limit": 100 }`. Cursor is *exclusive*: return rows ordered by `(revision, ordinal)` where tuple is greater than request. Response includes `changes`, `next_cursor`, `has_more`, and protocol version. Cap page size; validate cursor not ahead of current revision. Treat cursor as client-controlled, never as authorization. If no changes, return request cursor unchanged.

No cursor skips: if a transaction creates multiple records in one revision, pagination must resume at the next `ordinal` of the same revision. Use stable order, and test page size 1 across a multi-row transaction. Only expose safe fields needed for on-device projection. A `change_log` is append-only and protected from direct mobile writes.

## 6. Bootstrap consistency

Bootstrap must have an internally consistent snapshot plus a **matching** store revision. Capturing a revision, then independently fetching unrelated pages without a consistent transaction snapshot can miss a concurrent write. Implement one database transaction at appropriate isolation or a correctly designed streaming snapshot protocol. For M3 demo-scale datasets, a bounded snapshot returned by one transactional RPC is acceptable; document payload limits and future pagination choices. Before M4, verify change-log replay after the snapshot is lossless.

If table snapshots are built in multiple RPCs, require snapshot revision/watermark logic, not an unverified 'fetch table A, B, C then read revision' pattern.

## 7. M3 / M4 boundary

M3 tests APIs using authenticated integration clients or disposable fixtures. The Expo app can log in and create/select stores, but does **not** call `process-command` for M1/M2 outbox records and does **not** pull change pages into SQLite. Those are M4 tasks. Show 'local-only / pending sync' labels honestly.
