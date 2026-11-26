# M2 — SQLite Schema & Command Contracts

**Design specification, not a runnable migration.** Codex must inspect the M1 schema before generating SQL. Never blindly apply these table definitions to a populated database.

## 1. Local table proposals

### `local_stock_balances` (one row per store/product)

| Column | SQLite type | Invariant |
|---|---|---|
| `store_id` | TEXT | Persisted M1 local demo store UUID; part of PK |
| `product_id` | TEXT | Existing M1 product UUID; part of PK |
| `base_quantity` | INTEGER | >=0; known authoritative snapshot, starts at 0 in M2 demo |
| `pending_delta` | INTEGER | signed integer sum of unconfirmed local movements |
| `server_version` | INTEGER | >=0, reserved for M4 authoritative sync |
| `updated_at` | TEXT | ISO8601 display / local metadata |

Composite PK `(store_id, product_id)`; estimated available = `base_quantity + pending_delta`. Enforce nonnegative estimated balance for M2 mutations, ideally by conditional update and application transaction logic; do not assume this invariant can remain a database CHECK unchanged when future remote conflict resolution is added. If `local_products` does not currently support a matching composite FK `(store_id,id)`, add a verified unique index where possible and/or enforce tenant scope explicitly in repository writes. Test FK enforcement and cross-store rejection.

### `local_stock_movements` (append-only)

| Column | SQLite type | Invariant |
|---|---|---|
| `id` | TEXT | movement UUID, primary key |
| `store_id` | TEXT | store scope |
| `product_id` | TEXT | existing product |
| `delta_quantity` | INTEGER | signed, nonzero, safe integer |
| `kind` | TEXT | `stock_in`, `adjustment`, `sale` |
| `reason` | TEXT | required for adjustments; optional for stock-in; sale reference for sale |
| `sale_id` | TEXT NULL | assigned when kind is `sale` |
| `source_command_id` | TEXT | UUID of corresponding outbox command |
| `sync_status` | TEXT | initial `pending`; never mark synced in M2 |
| `occurred_at` | TEXT | locally recorded timestamp |

Indexes: `(store_id, product_id, occurred_at)`, `(store_id, source_command_id)`, and `(store_id, sale_id)`. Avoid uniqueness on `source_command_id`: one `sale.create` command can produce several stock movements (one per item).

### `local_sales`

| Column | SQLite type | Invariant |
|---|---|---|
| `id` | TEXT | client-generated sale UUID; primary key |
| `store_id` | TEXT | required store scope |
| `checkout_request_id` | TEXT | unique per store for a *single* logical checkout attempt |
| `customer_name` | TEXT NULL | trimmed, bounded length |
| `payment_method` | TEXT | `cash` / `transfer` / `other`; label only |
| `currency` | TEXT | `NGN` in MVP |
| `total_minor` | INTEGER | nonnegative, safe integer kobo |
| `status` | TEXT | `pending` for M2; server confirmation in M4 |
| `occurred_at` | TEXT | local timestamp, display only |
| `created_at` | TEXT | local timestamp |

Unique index `(store_id, checkout_request_id)`. Report `total_minor` represents provisional local sales until server confirmation. Optional: preserve `command_id` on sale for easier traceability; command ID must still be unique in `outbox_commands`.

### `local_sale_items`

| Column | SQLite type | Invariant |
|---|---|---|
| `sale_id` | TEXT | FK to local_sales |
| `store_id` | TEXT | store scope |
| `product_id` | TEXT | product reference |
| `product_name_snapshot` | TEXT | immutable |
| `sku_snapshot` | TEXT | immutable |
| `quantity` | INTEGER | positive safe integer |
| `unit_price_minor` | INTEGER | positive, safe integer kobo |
| `line_total_minor` | INTEGER | quantity * unit_price, safe integer |

Primary/unique key `(sale_id, product_id)` assumes duplicate cart lines are coalesced; otherwise use `line_id` UUID plus explicit ordering. Recommended indexes: `(store_id, sale_id)`, `(store_id, product_id)`.

### `outbox_commands` existing table

Keep *all* M1 fields, command UUIDs and `local_sequence` values. Extend permitted command types by safe migration if M1 constrained types to product operations.

Additional command types needed for M2:

- `inventory.stock_in`
- `inventory.adjust`
- `sale.create`

For M2, every created command remains pending. The outbox sequence should be durable and monotonically ordered. Foreign-key relationship between stock movements and outbox may complicate migrations; test against actual M1 schema.

## 2. Command schema v1 examples

### Stock-in

```json
{
  "protocol_version": 1,
  "command_id": "uuid-for-stock-in",
  "store_id": "local-demo-store-uuid",
  "type": "inventory.stock_in",
  "entity_id": "uuid-for-movement",
  "payload": {
    "movement_id": "uuid-for-movement",
    "product_id": "existing-product-uuid",
    "delta_quantity": 20,
    "note": "Opening stock"
  }
}
```

### Adjustment

```json
{
  "protocol_version": 1,
  "command_id": "uuid-for-adjustment",
  "store_id": "local-demo-store-uuid",
  "type": "inventory.adjust",
  "entity_id": "uuid-for-movement",
  "payload": {
    "movement_id": "uuid-for-movement",
    "product_id": "existing-product-uuid",
    "delta_quantity": -1,
    "reason": "Damaged item"
  }
}
```

### Sale (ONE command for all sale lines and stock deductions)

```json
{
  "protocol_version": 1,
  "command_id": "uuid-for-sale-command",
  "store_id": "local-demo-store-uuid",
  "type": "sale.create",
  "entity_id": "uuid-for-sale",
  "payload": {
    "sale_id": "uuid-for-sale",
    "checkout_request_id": "stable-uuid-for-attempt",
    "currency": "NGN",
    "occurred_at": "2026-11-16T10:00:00.000Z",
    "customer_name": null,
    "payment_method": "cash",
    "total_minor": 1050000,
    "items": [
      {
        "product_id": "existing-product-uuid",
        "product_name_snapshot": "Basic Cotton Top",
        "sku_snapshot": "TEE-001",
        "quantity": 3,
        "unit_price_minor": 350000,
        "line_total_minor": 1050000
      }
    ]
  }
}
```

Outbox payload must be a true snapshot at enqueue time. Never store a pointer to a mutable cart or live product values in place of the payload. Preserve M1's envelope shape and naming where already defined; use schema versioning and explicit code for any differences.

## 3. Domain use case interfaces (illustrative TypeScript)

```ts
export type StockInInput = {
  storeId: string;
  productId: string;
  quantity: number;
  note?: string;
};

export type AdjustStockInput = {
  storeId: string;
  productId: string;
  deltaQuantity: number; // signed, never zero
  reason: string;
};

export type CheckoutLine = {
  productId: string;
  quantity: number;
  expectedUnitPriceMinor: number; // price shown on review screen
};

export type CheckoutInput = {
  storeId: string;
  checkoutRequestId: string; // reuse across retry of same attempt
  lines: CheckoutLine[];
  customerName?: string;
  paymentMethod: 'cash' | 'transfer' | 'other';
};
```

The domain should not take trusted totals or stock as input. Repository performs a transaction-time re-read. Return a discriminated result (`success`, `insufficient_stock`, `price_changed`, `product_unavailable`, `validation_error`) that the UI can handle without losing the cart.

## 4. Safe migration checklist (critical)

1. Confirm actual `schema_migrations` implementation and last version from M1. Allocate a *new* migration number; do not rewrite applied M1 migrations.
2. Inspect `local_products` table and its `id`, `store_id`, archive fields before declaring FKs.
3. Inspect `outbox_commands` `sqlite_master.sql` / `PRAGMA table_info` and existing CHECK constraints.
4. Before migration, capture counts and command IDs from a populated M1 database. Prefer automated fixture snapshot.
5. Add new tables/indexes without modifying product content.
6. If outbox type CHECK must change, plan a safe copy-to-new-table migration that preserves every column, sequence/order, pending status, unique key and command payload. Respect SQLite FK toggle rules outside transaction and test with populated database.
7. Verify `PRAGMA foreign_keys=ON` on the connection actually doing transactional writes. `withExclusiveTransactionAsync` can use a different connection; test before choosing it.
8. Run `PRAGMA foreign_key_check` and integrity checks after migration.
9. Simulate failure during migration; confirm old rows are preserved and migration version does not advance.
10. Rerun migration; expect no unintended changes.
11. Reopen same file on Android; confirm all products and pending M1 commands still exist.

## 5. Indexing & query behavior

- Inventory list: join products to balance by store/product; left join should display zero for products without a balance row.
- Stock movement history: filter `(store_id, product_id)` and order by occurred_at plus stable tie-breaker.
- Sales history: filter by store, newest first, paginate when needed.
- Summary: derive daily totals from local_sales and label them provisional; specify store-local timezone for date grouping (do not inadvertently group a Nigerian day's evening sales into tomorrow using UTC).
- Always scope reads and writes by store; verify linked product is in same store rather than trusting ID alone.

## 6. Known M2-to-M4 bridge

- `base_quantity` and `pending_delta` are distinct to avoid overwriting unsynced local movements with a remote balance.
- M4 must atomically acknowledge commands, reconcile baseline/deltas, and avoid counting a confirmed movement in both layers. That algorithm is **not** implemented in M2.
- Client data can be lost if the device is wiped before syncing. A pending badge must not imply cloud backup.
- Two offline devices may temporarily disagree about stock. Server reconciliation and conflict UX are later milestones.
