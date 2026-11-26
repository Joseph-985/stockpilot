# M3 PostgreSQL Data Contracts

**Proposed columns are not a copy-paste migration.** Codex must compare actual M1/M2 local schemas and command types. Use explicit migration files (`supabase/migrations/`), check constraints, FK constraints, defaults, indexes, RLS and least-privilege grants. Do not assume `public` defaults are secure.

## Entity tables

| Table | Key columns | Constraints / design notes |
|---|---|---|
| `stores` | `id uuid PK`, `name text`, `currency text`, `created_at timestamptz` | `currency='NGN'` MVP; creation only via authenticated atomic onboarding function |
| `store_members` | `(store_id,user_id) PK`, `role text`, `status text` | FK to `auth.users` and stores; `owner/staff`, `active/revoked`; restrict writes to owner-authorized flow |
| `products` | `id uuid`, `store_id uuid`, `sku`, `name`, `description`, `category`, `price_minor bigint`, `cost_minor bigint`, `low_stock_threshold integer`, `version bigint`, `created_at`, `updated_at`, `deleted_at` | Composite unique `(store_id,id)`, store-scoped normalized SKU uniqueness for active products, nonnegative price, conditional version update, archive soft-delete |
| `stock_balances` | `(store_id,product_id) PK`, `quantity bigint`, `version bigint`, `updated_at` | FK `(store_id,product_id)`→ products; `quantity>=0` for authoritative accepted state; lock rows in sorted product ID order |
| `stock_movements` | `id uuid PK`, `store_id`, `product_id`, `delta_quantity bigint`, `kind`, `reason`, `sale_id`, `source_command_id`, `occurred_at`, `server_committed_at` | Immutable append-only; signed nonzero delta; `(store_id,product_id)` FK; one sale produces one per line; don't unique `source_command_id` here |
| `sales` | `id uuid PK`, `store_id`, `checkout_request_id uuid`, `created_by uuid`, `currency`, `payment_method`, `customer_name`, `total_minor bigint`, `client_occurred_at`, `server_committed_at` | Unique `(store_id,checkout_request_id)`; immutable after acceptance; client time untrusted |
| `sale_items` | `sale_id`, `store_id`, `product_id`, `product_name_snapshot`, `sku_snapshot`, `quantity`, `unit_price_minor`, `line_total_minor` | FK to sale and product in same store; unique `(sale_id,product_id)` if cart coalesces; immutable historic snapshots |
| `processed_commands` | `(store_id,command_id) PK`, `actor_id`, `command_type`, `request_hash`, `outcome`, `result_json`, `created_at`, `completed_at` | Protected/internal; unique immutable receipts, replay checks exact original content; terminal business conflicts persisted |
| `sync_clock` | `store_id PK`, `revision bigint` | Protected/internal; revised in transaction under per-store row lock, never exposed for direct client write |
| `change_log` | `(store_id,revision,ordinal) PK`, `entity_type`, `entity_id`, `operation`, `payload_json`, `server_committed_at` | Protected internal feed; `revision` allocated under same store lock; ordered `ordinal` within transaction if multi-change |

Store UUID and actor from client MUST NOT establish authorization. Current authenticated identity from verified Supabase context is authoritative.

## Monetary and stock rules

- `minor` amounts are integer kobo for `NGN`. Reject NaN, fraction, negative values where not valid, JS unsafe integers, overly large values, empty product lines, integer overflow and duplicates.
- `quantity` is positive integer for sales, nonzero signed integer for adjustments; accepted server quantity remains nonnegative.
- Product price edits use optimistic concurrency with `expected_version`. Return terminal `version_conflict` on mismatch, not last-write-wins.
- Server recalculates line totals and overall total. **For the MVP, reject changed server price** with `price_changed`; include safe current price in conflict details. Do not silently charge the price implied by client.
- Product name, SKU, price snapshots in accepted sale are authoritative server values at commit; client snapshots are advisory/debug context only.
- `occurred_at` from device is for display/audit and never used as a security or cursor authority. Record server commit time separately.
- `sale.create` owns negative stock movements. Do not accept additional `inventory.adjust` commands for those deductions.
- Product create should establish an initial balance row (quantity 0); stock-in is separate command. This is required for row locking and never represents a second stock-in.

## Command envelope compatibility

M2 used this conceptual command shape; the M3 implementation MUST adapt it to the actual `outbox_commands` payload and existing `protocol_version`, rather than forcing a rewrite of M2 data.

```json
{
  "protocol_version": 1,
  "command_id": "123e4567-e89b-42d3-a456-426614174001",
  "store_id": "123e4567-e89b-42d3-a456-426614174002",
  "device_id": "123e4567-e89b-42d3-a456-426614174003",
  "type": "sale.create",
  "payload": {
    "sale_id": "123e4567-e89b-42d3-a456-426614174004",
    "checkout_request_id": "123e4567-e89b-42d3-a456-426614174005",
    "currency": "NGN",
    "total_minor": 1050000,
    "items": [{
      "product_id": "123e4567-e89b-42d3-a456-426614174006",
      "quantity": 3,
      "unit_price_minor": 350000,
      "line_total_minor": 1050000
    }]
  }
}
```

Supported command kinds:

1. `product.create`: enforce permitted fields, SKU uniqueness, uniqueness of UUID, 0 stock row and version 1.
2. `product.update`: enforce `expected_version` and same-store owner; version increments.
3. `product.delete`: soft archive with version check, no change to historic sales; define whether archived product can be restored (not in M3).
4. `inventory.stock_in`: positive qty, owner, active product, append movement, update balance.
5. `inventory.adjust`: signed nonzero qty, reason and owner, no negative balance.
6. `sale.create`: owner or staff, nonempty cart, price validation, stock locking, single atomic sale+items+movements+balance update.

Every stable command should carry the same IDs on retry. Canonicalize/hash command contents after server validation in a deterministic way (e.g., SHA-256 of canonical serialized protocol object). Hash entire meaningful request including store, type, IDs and payload; exclude transport-only retry metadata. Explicitly define normalization (JSON key order, numeric representation, omitted optional fields) and test changed payload rejection. Never trust a client-supplied hash.

## Response contract (illustrative)

```json
{
  "protocol_version": 1,
  "command_id": "123e4567-e89b-42d3-a456-426614174001",
  "outcome": "applied",
  "entity_id": "123e4567-e89b-42d3-a456-426614174004",
  "server_revision": 42,
  "result": {"sale_total_minor": 1050000, "quantity_remaining": 17}
}
```

Outcomes: `applied`, `already_applied` (same stored outcome with replay metadata), `conflict`, `validation_error`, `forbidden`, `unauthorized`, `retryable_error`, `idempotency_key_reuse`. Distinguish **durable terminal business conflicts** (e.g. insufficient stock) from *temporarily retryable infrastructure failures*. A terminal rejected command should not mutate business state, but its receipt can be stored. Use consistent code rather than accepting a mix of arbitrary SQL errors.

## Migration/index review

- Tenant uniqueness/indexes: `(store_id, sku_normalized)` active; `(store_id,id)`; `(store_id,server_committed_at,id)` for sales; `(store_id,revision,ordinal)`.
- FK store scope via composite FKs where possible; do not allow a sale in Store A to reference Store B product ID.
- `processed_commands` receipts cannot be overwritten by client updates.
- `change_log` cursor must be transactionally commit-ordered (see API contract); not `bigserial` alone.
- `store_members` membership uniqueness and active status indexes.
- RLS on all exposed tables, revoke direct mutation grants on protected tables; `anon` should have zero tenant-data access.
- No destructive migration of local SQLite in M3; backend migrations apply only to cloud/PostgreSQL.
