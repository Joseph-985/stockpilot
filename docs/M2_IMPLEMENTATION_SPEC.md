# M2 — Offline Inventory & Sales: Implementation Specification

## 1. Outcome and scope

Users can receive stock, adjust stock with a required audit reason, create a multi-item sale offline, see the estimated available quantity immediately, inspect sale history, and recover all committed operations after force-stop. Every mutation persists the domain state and one outbox command atomically. No cloud communication yet.

### In scope
- Existing M1 products and local demo store reused, no re-creation of the product catalog
- Integer, countable quantities for each product, starting with an estimated quantity of zero for products lacking inventory records
- Stock-in, positive/negative signed stock adjustments, required reason for manual adjustments, movement timeline
- Estimated available quantity and low-stock indicator using existing product threshold
- Create sale from one or more cart lines, local availability validation, optional customer name, payment method label cash/transfer/other (not payment processing)
- Sale items retain product ID, name/SKU snapshots, unit price, quantity and line totals
- A single atomic SQLite write for sale + sale items + stock movements + pending stock projection + outbox command
- Sales list and detail, local daily sales summary and low-stock count; pending badge
- Versioned additive migrations or safe-preserving rebuild when M1 outbox CHECK is restrictive
- Unit, SQLite integration and Android manual tests

### Explicitly out of scope
- Supabase, authentication/RLS, sync transport, acknowledged/synced status transitions, multi-device conflict resolution
- Payment gateway, invoicing, receipts, refunds, purchase orders, barcode scanning, fractional quantities, coupons, tax automation
- Real-time/background sync and customer directory. Sale customer_name is optional text only.

## 2. Architectural boundaries

`Screen -> hook/view model -> use case -> repository contract -> SQLite implementation`.

- The inventory and sales domain modules import no React, Expo or SQLite symbols.
- UI reads SQLite/repository projections; an ephemeral cart can use local component state or Zustand. The cart is not the authoritative source of a committed sale.
- Do not duplicate the product dataset in Zustand/TanStack Query.
- Reuse M1 db initialization, transaction coordinator, UUID generator, money helpers, store scope and outbox writer.
- SQLite inventory and sale writes must be serialized sufficiently to prevent two overlapping local checkouts from both consuming the last item. Database atomicity plus conditional updates / serialization required, not just React `disabled` buttons.
- No new repository abstraction without a practical seam for isolated domain tests.

## 3. Inventory rules

- `base_quantity` represents last known confirmed/authoritative stock (zero for local-demo products in M2).
- `pending_delta` represents the net effect of unconfirmed local stock movements.
- `estimated_available = base_quantity + pending_delta`. It must remain >= 0 for the MVP.
- `local_stock_movements` is append-only and records each positive/negative delta with reason, type and source linkage. A movement has one stable UUID and store/product scope.
- `stock.in`: positive integer count, optional note, event type `stock_in`, `inventory.stock_in` command.
- `stock.adjust`: signed nonzero integer delta; required nonblank reason; event type `adjustment`, `inventory.adjust` command. Locally disallow adjustment below zero.
- Every stock operation updates pending delta, writes one movement and appends one outbox command in a single SQLite transaction.
- A sale creates one movement per product with a negative delta, linked to the sale ID and to the **same** sale command ID. Do not issue separate `inventory.adjust` commands for sale-created movements.
- Do not mutate or delete historic stock movements in M2. Corrections require new movements.
- Initial stock entered after product creation is a separate stock-in command, never embedded into `product.create` M1 command.
- Archived products remain part of history. They are not sellable or newly adjustable through normal screens.
- Products with no stock row should display `0` locally; first stock-in creates row transactionally.

## 4. Sale rules

- A sale must have at least one item. Quantity is a positive safe integer; product ID must belong to the active store and not be archived.
- An item should appear only once in the persisted sale (coalesce duplicates in cart), with a unique product ID and positive quantity.
- Re-read the current local product fields and estimated stock inside the commit transaction. Reject stock shortages even if a prior cart check passed.
- If product price has changed since the checkout review, require the user to review the refreshed total before finalizing; do not silently charge a new amount.
- Capture product `name`, `sku`, and `price_minor` snapshots on each sale item.
- Compute `line_total_minor = unit_price_minor * quantity` and `sale_total_minor = sum(line_total_minor)` using safe-integer checks and an appropriate maximum. Do not trust amounts supplied by the view; SQL constraints provide a second layer.
- Optional `customer_name` is plain text; validate maximum length and trim. Payment method is an accounting label, not proof of payment.
- `local_sales` and sale items are immutable after committing in M2; do not implement edit, cancel, or refund.
- Completed sale gets `pending` status and one `sale.create` command with immutable item snapshots and stable command UUID.
- Outbox ordering must remain compatible with M1 unsynced product create/update commands; preserve M1 sequence and payloads.
- App termination before local commit leaves no partial sale. App termination after commit leaves the entire sale and pending command intact.

### Idempotent local submit

A React double-tap guard is necessary but insufficient. Use a client-generated stable `checkout_request_id` (or preallocated stable `sale_id` with unique constraint) for a single checkout attempt. The repository must ensure that repeating the **same attempt** does not create a second sale/outbox command; a *new* checkout attempt intentionally creates a new sale. Persist the attempt identifier in the sale row or command payload, and test repeated submission. Distinguish app-local idempotency from future server-command idempotency.

## 5. Atomic sale flow

1. Validate cart input and current store ID.
2. Allocate sale UUID, command UUID and stable checkout request ID before attempting commit. A retry of an unknown-result attempt reuses the same IDs.
3. Enter the existing serialized, native-verified SQLite write transaction.
4. Check if checkout request ID has already committed; if yes, return existing sale rather than writing again.
5. Re-read each active product, SKU/name/price, estimated quantity and store scope inside transaction, in stable product-ID order.
6. Recalculate totals and check safe integer arithmetic. Reject changed price / insufficient local stock explicitly.
7. Insert sale header and sale item snapshots.
8. Insert one negative movement per unique product and update estimated stock projection using conditional/serialized updates.
9. Insert one `sale.create` outbox command with snapshot payload and dependency on prior relevant pending product commands if the M1 implementation requires this.
10. Commit all or roll back all. Return persisted sale ID. Refresh the UI from SQLite.

### Failure behavior

- Validation error: no writes, actionable user message.
- Insufficient local stock: no writes, show quantity available and allow editing cart.
- Outbox insert failure: roll back sale, items, movements and balance projection.
- App killed after commit before UI confirmation: original sale exists; resuming an attempt with the same checkout_request_id returns original sale.
- No network: no change to behavior; `Pending sync` remains.

## 6. SQLite migration and transaction caveats

- Do not reset any M1 table. Preserve M1 product rows, demo-store ID, all outbox command IDs/sequences, `server_version`, and migration metadata.
- Add local stock balance, movement, sales and sale item tables with foreign keys and indexes. Scope every repository query by `store_id`.
- Check M1 outbox schema. If `type CHECK` accepts only product commands, implement a tested safe table rebuild OR a compatible forward schema change, copying all data and verifying row count/order/content; never delete original commands.
- If rebuilding with foreign-key enforcement considerations, follow SQLite's documented process for schema updates; `PRAGMA foreign_keys` cannot be toggled inside an active transaction. Run `PRAGMA foreign_key_check` following migrations; verify FK behavior in the write transaction/connection selected.
- Ensure schema migration version is advanced only after successful migration. Failed migrations must leave the old database usable and must not wipe existing data.
- Re-running migrations is safe. Test an upgrade on a copy of a populated M1 DB as well as a fresh install.
- Prefer conditional SQL updates (`... WHERE estimated availability >= requested delta`) or a proven writer queue to guard against overlapping local sales. Document exactly how concurrency is handled.
- Parameterize all user data. Use `execAsync` only for trusted migration/static SQL, not interpolated inputs.

Expo SQLite docs: https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/
SQLite FKs: https://www.sqlite.org/foreignkeys.html

## 7. Suggested UI and navigation

### Inventory
- Product list or product detail: estimated available quantity and low-stock badge
- Inventory tab/route: searchable product stock list, stock-in button, adjust button
- Stock-in form: product, quantity, optional note, confirmation state
- Adjustment form: product, +/- delta, required reason, confirmation of new estimated balance
- Product movement history: date, signed delta, reason, linked sale, pending badge

### Sales
- Product picker/search, quantity control, cart summary, editable cart lines
- Checkout review: item names, quantities, unit prices, total, customer name (optional), payment method selection
- Save Sale action protected against repeated taps; validation errors without lost cart
- Sales history with pending badge and sale detail showing immutable snapshots
- Basic daily total and count from local sales; clarify values include *provisional* sales until confirmed in M4
- All list screens support loading, empty, error, scroll and accessibility states

### Optional sample route paths

`app/(tabs)/inventory.tsx`, `app/inventory/[productId].tsx`, `app/sale/new.tsx`, `app/(tabs)/sales.tsx`, `app/sale/[id].tsx`

Use existing M0/M1 conventions; do not create duplicate route ownership or tab layouts.

## 8. M2 acceptance example (airplane mode)

- Open the pre-existing demo store and create a fictional product in M1 if needed: SKU TEE-001, price ₦3,500.00.
- Enable airplane mode. Record stock-in +20. Estimated stock = 20.
- Create a sale of 3 units. Total = ₦10,500.00; stock estimate = 17.
- Record adjustment -1 for `Damaged item`. Estimated stock = 16.
- See one stock-in, one sale movement and one adjustment movement; see sale history.
- Force-stop and relaunch the app **still offline**. Same stock estimate, history, sale item snapshots, and pending commands persist.
- Product price updated to ₦4,000 after sale does not alter sale history.
- Attempt a sale of 17 units (16 available): blocked with no partial writes.
- Re-enable internet: no sync yet; pending remains until M4.

## 9. Definition of done

- [ ] M1 product CRUD/search/archive remains working, including all prior outbox rows
- [ ] Native SQLite migration from a populated M1 DB passes and is repeatable
- [ ] Stock-in and adjustment operations are atomic and auditable
- [ ] Local estimated stock never becomes negative through normal M2 flows
- [ ] Sale, line items, movements, projections and one outbox command commit together
- [ ] No duplicate sale on repeated same checkout attempt
- [ ] Price snapshots and safe monetary arithmetic validated
- [ ] Physical-device force-stop survival recorded
- [ ] Domain tests, native persistence integration checks, UI tests and CI checks pass
- [ ] Screens show pending/provisional vs authoritative terminology accurately
- [ ] Architecture/limitations documented and M2 diff reviewed independently
