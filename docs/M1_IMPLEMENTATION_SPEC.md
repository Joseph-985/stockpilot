# M1 Implementation Specification — Offline Product Catalog

## Goal

On an Android device in airplane mode, users can create, find, edit, and archive products. Data survives force-close/relaunch. Every mutation produces exactly one durable outbox command in the same SQLite transaction. No network request is required to complete an operation.

## Explicit scope

- In scope: migration(s), product domain and validators, SQLite repository, atomic outbox writes, list/search/detail/create/edit/archive UI, pending sync badge, DB-backed refresh, automated tests, manual Android verification.
- Out of scope: stock quantities/stock movements and sales (M2); Supabase/auth/store enrollment (M3); push/pull sync and conflicts (M4-M5); web dashboard.

## Architecture

`React Native screen -> presentation hook -> use case -> repository contract -> SQLite implementation (product + outbox transaction)`.

Pure domain types and validation cannot import React, Expo, or SQLite. Presentation reads product data from SQLite, never from Zustand or a network cache. State for form input is local ephemeral state.

Reuse the M0 SQLiteProvider, UI components, navigation, error boundary, and migration coordinator. New modules should be reasonably feature-focused. No speculative repository factory or generic sync framework.

## Proposed entity

- `id`: client-generated UUIDv4, immutable
- `store_id`: UUID for the local demo store, immutable per product
- `sku`: required; trimmed; unique among non-archived products within the store (case-insensitive)
- `name`: required trimmed; 2-120 characters
- `description`: nullable text, max 2000 characters
- `category`: nullable text, max 80 characters; free text for MVP
- `price_minor`: positive safe integer kobo (`>=1`), formatted from a string value such as `3500.50`
- `cost_minor`: optional nonnegative safe integer kobo; null means unspecified
- `low_stock_threshold`: nonnegative whole number (future use in M2)
- `server_version`: nonnegative integer, initially 0 (server-acknowledged version only)
- `local_revision`: positive integer, incremented on each local edit/archive; not substituted for server version
- `sync_status`: pending | synced | conflict (all new M1 writes pending)
- `created_at`, `updated_at`: ISO8601 local metadata (not authoritative for server ordering)
- `deleted_at`: nullable ISO8601 timestamp; archived records hidden by default but not physically removed

`price_minor` is an integer: `₦3,500.00` = `350000` kobo. Parse a decimal string using decimal text processing, never binary floating point multiplication. Reject unsupported negative values, excess decimal places, exponent notation, NaN, Infinity and unsafe integers. Choose a sensible upper bound and test it.

## Store identity before auth

M1 has no real online enrollment. Create a **persistent local demo-store UUID** if none exists. Never generate a fresh store ID on every launch. Mark store as `local_demo` and prevent it being treated as an authenticated remote tenant. In M3, offer deliberate adoption/mapping into an authenticated store without silent reassignment; document the migration plan now. Avoid automatic demo data upload.

## Local schema (conceptual, adapt to M0 migrations)

`local_products` fields:
- id TEXT PRIMARY KEY
- store_id TEXT NOT NULL
- sku TEXT NOT NULL
- name TEXT NOT NULL
- description TEXT NULL
- category TEXT NULL
- price_minor INTEGER NOT NULL CHECK(price_minor > 0)
- cost_minor INTEGER NULL CHECK(cost_minor IS NULL OR cost_minor >= 0)
- low_stock_threshold INTEGER NOT NULL DEFAULT 0 CHECK(low_stock_threshold >= 0)
- server_version INTEGER NOT NULL DEFAULT 0 CHECK(server_version >= 0)
- local_revision INTEGER NOT NULL DEFAULT 1 CHECK(local_revision > 0)
- sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending','synced','conflict'))
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL
- deleted_at TEXT NULL

Add index for `(store_id, name)` and a case-insensitive unique active SKU index, e.g. `ON local_products(store_id, sku COLLATE NOCASE) WHERE deleted_at IS NULL`. Choose explicit SKU normalization and test case-insensitive collisions. Scope every query to store_id. Preserve archived rows for history and future sync.

`outbox_commands` fields:
- local_sequence INTEGER PRIMARY KEY AUTOINCREMENT (durable ordering)
- command_id TEXT UNIQUE NOT NULL (UUIDv4; stable across retries)
- store_id TEXT NOT NULL
- type TEXT NOT NULL CHECK(type IN ('product.create','product.update','product.delete')) for M1; design migration-friendly check for M2 types
- entity_id TEXT NOT NULL
- payload_json TEXT NOT NULL (versioned schema)
- expected_server_version INTEGER NULL
- depends_on_command_id TEXT NULL (when updating an unsynced creation; optional if rigorous ordered design documented)
- status TEXT NOT NULL DEFAULT 'pending'
- attempts INTEGER NOT NULL DEFAULT 0
- next_attempt_at TEXT NULL
- last_error TEXT NULL
- created_at TEXT NOT NULL

Think ahead about future command types so that an overly restrictive CHECK constraint does not require destructive table replacement. Payload retains the snapshot/delta for **each** operation at time of creation, not a pointer to current mutable product data.

One possible command object:

```json
{
  "protocol_version": 1,
  "command_id": "uuid",
  "store_id": "local-store-uuid",
  "type": "product.create",
  "entity_id": "product-uuid",
  "payload": {
    "id": "product-uuid",
    "sku": "SKU-101",
    "name": "Basic Cotton Top",
    "price_minor": 350000,
    "cost_minor": null,
    "category": "Clothing",
    "description": null,
    "low_stock_threshold": 3
  }
}
```

**Atomicity requirement:** For create/update/archive, commit product row change and outbox command in the same transaction. On forced failure after first write, rollback both. Use SQL bind parameters for user data. `execAsync` is only for trusted static SQL/migrations.

## Expo SQLite caution

As of Expo SDK 57, `withTransactionAsync` may incidentally include unrelated concurrent queries; `withExclusiveTransactionAsync` uses an independent connection, so `PRAGMA foreign_keys=ON` applied to the original connection does not automatically apply there. Propose and test a transaction coordinator that protects atomicity, serializes writes and enforces the intended FK contract. Do not use `withExclusiveTransactionAsync` automatically without addressing and testing this connection distinction. This is important for M2 foreign keys.

Run initial PRAGMAs appropriately (`journal_mode=WAL`, `foreign_keys=ON`). Implement versioned, additive migrations; ensure migration version changes and schema modifications are recoverable, do not wipe an existing M0 database. Run migration twice (idempotence) and simulate failure/rollback. Verify database readiness before rendering product-dependent screens.

## UI

- Products tab: offline banner when relevant (optional), title, search input, Add Product button, FlatList, pending badges, empty/error/loading states.
- Product item: name, SKU, category, NGN formatted price, pending badge, edit/archive actions.
- Add/edit screen: required name, SKU, selling price; optional description, category, cost and threshold; inline validation; disabled double-submit; accessible labels.
- Archive: user confirmation and soft-delete; archived products disappear from default list but remain in DB/outbox. Do not add hard delete.
- Search is local, debounced only if needed; case-insensitive name/SKU matching; apply store scope and deleted_at filter; maintain stable list keys.
- Refresh after writes via tested repository change notification or screen focus refresh. Don't require connectivity to list or save.

## Revision/dependency semantics for future M4

- `server_version` reflects last server acknowledgement, NOT count of local updates.
- Never rewrite an already enqueued command's payload just because the local product changes again.
- Multiple offline edits of the same product result in ordered, durable commands (or a documented and safe coalescing policy, but no coalescing needed in M1).
- If a product has not yet been uploaded, its update/archive operations depend on create. Keep dependency info or an explicit ordered-processing contract. Actual server version rebasing/reconciliation belongs to M4.

## Quality constraints

- Strict TS, avoid `any` and unchecked casts.
- Unit tests for parsing, schema validation, identity and product rules.
- Native SQLite integration tests for migration, query filtering, uniqueness and rollback; Jest mock tests alone do not prove durable native behavior.
- No cloud SDK, auth, service-role secret or network dependency in M1.
- GitHub Actions continues to pass; update README/ADR and leave a measured manual-test record.
