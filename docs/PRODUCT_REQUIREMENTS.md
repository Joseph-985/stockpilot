# StockPilot — Product Requirements (PRD v1)

## Problem

Small retailers need reliable product, inventory and sales records even when mobile data is unstable. Cloud-only applications can prevent them from selling, and ad-hoc manual reconciliation creates errors.

## Audience and assumptions

- Android-first; iOS-compatible Expo app.
- MVP supports **one store** with an `owner` and `staff` role; user identity and initial enrollment require connectivity.
- Default NGN currency, monetary values stored as integer **minor units** (kobo).
- MVP supports countable items with whole-number quantities. Weight/volume and fractional units are later scope.
- No payment processing; recording a sale is not processing a payment.
- Use fictional sample data for the public demo.

## Core jobs to be done

1. As a store owner, I can create products, set selling price, and record opening stock.
2. As a clerk, I can create a sale with multiple lines even when disconnected.
3. As an owner, I can adjust stock with a reason and see the movement history.
4. As a clerk, I can see which sales are pending, confirmed, or need attention.
5. As an owner, I can access sales and inventory across two devices once synchronized.
6. As an owner, I can see total sales and low-stock items from local data.

## In scope

- Initial online sign-in and store onboarding; session restoration on previously authorized device
- Product CRUD, categories, SKU, unit price, cost price (optional), low-stock threshold
- Stock-in and signed stock adjustments with audit reason
- Sales: cart, quantity, unit-price snapshot, totals, optional customer name, payment method label (cash/transfer/other) — no payment gateway
- Sales history and daily aggregates, including sync status labels
- Local-first operation for products, inventory changes, and sales
- Outbox, push/pull sync, progress, manual retry, failure/conflict UI
- Owner/staff authorization on backend; access to only the currently assigned store
- Responsive layouts for common phone sizes and accessible form interactions

## Explicitly out of scope for MVP

- Multiple branches, suppliers/purchase orders, barcode scanning, accounting/tax filing, receipts/printers, refunds, staff invitation flows, web admin, recurring billing, realtime push, 24/7 background sync guarantees

## Main flows

**Sale offline**: Open app with existing cached session > select products > review stock estimate > save sale locally in a SQLite transaction > display `Pending sync` > relaunch offline and see unchanged sale > reconnect > send queued operation > server validates role/stock, commits exactly once, returns confirmation > pull updated balances > show `Synced`.

**Stock adjustment**: Select product > enter signed quantity and reason > record an immutable local movement and outbox command transactionally > sync when possible > update authoritative on-hand quantity.

**Conflict**: If two devices sell the last unit while both are disconnected, both locally show a provisional sale. The server accepts the first eligible sale and rejects the conflicting command from the second device. The second device must show a persistent `Needs attention` state and a resolution action; no silent disappearance or duplicate retry.

## Product policies

- Offline sales are **provisional** until the server confirms; the UI must communicate this honestly.
- The server must not allow an accepted sale to make authoritative stock negative in MVP.
- A confirmed sale is immutable; corrections are separate reversal/return operations in a future release.
- A historical sale stores price snapshots, not a live reference to today's product price.
- Local stock is an **estimate** made from last server snapshot plus pending local movements; another disconnected device can change actual stock.
- Products use optimistic concurrency via a `version` value. Concurrent edits are rejected with a resolvable conflict, not automatically overwritten.
- The system does not promise that background tasks always execute after the app is killed.
- Unsent data can be lost if the device/storage is destroyed, app data is wiped, or the app is uninstalled before synchronization. Show this limitation in the product.

## MVP acceptance criteria

- New products remain visible after app force-stop while offline.
- Offline sale, stock adjustment and pending operation survive app restart.
- Every action that changes business data writes the local domain record and outbox record in the **same** SQLite transaction.
- Replaying an identical command twice at server causes only one effect.
- Two devices attempting to sell stock beyond availability cannot both be confirmed.
- Failed sync does not lose or silently delete a pending command.
- Pulling a remote change and updating the cursor is atomic locally; interruption causes a safe retry.
- Users cannot access another store's data through API calls or RPC arguments.
- Products and sale lists have empty/loading/error/permission/unsynced states.
- At least one Android physical device end-to-end demonstration and a documented installation path.

## Quality targets (goals, not pre-existing performance results)

- Support 1,000 products and 10,000 historical sales in representative test data without an unusable list experience.
- Typical local product lookup and sale-save operations should feel immediate on a mid-range Android device. Measure, document test hardware, and improve bottlenecks.
- Business rules covered by unit tests; sync engine has deterministic crash, retry, duplicate, and conflict tests; critical flows covered by mobile E2E tests.
