# M2 — Test Matrix & Acceptance Gate

## A. Domain unit tests

- Stock-in allows positive safe-integer quantity; rejects zero, negative, fractional, NaN, Infinity and unsafe integers.
- Stock adjustment requires signed, nonzero safe integer and nonblank reason; rejects insufficient estimated stock.
- Sale requires >=1 line; rejects zero/negative/fractional quantities, duplicate invalid items, wrong store, archived products and absent products.
- Cart coalesces duplicate products and preserves exact per-product quantities.
- Exact integer money: `350000 * 3 = 1050000` kobo; rejects overflow of line and sale total.
- Optional customer name length and payment method enum validated.
- Price change between review and checkout blocks commit or demands re-review; do not silently persist new total.
- Product price edit AFTER checkout does not change historical line snapshots.

## B. SQLite migration and repository integration tests

- Clean-install migration succeeds and rerun is idempotent.
- Upgrade from populated M1 DB preserves products, local store identity, every existing outbox command UUID, `local_sequence`, type, payload and pending status.
- Outbox type CHECK accepts all new M2 commands and M1 command types.
- Failed migration does not advance version or lose M1 rows.
- `PRAGMA foreign_keys=ON` on actual transaction connection; inserting orphan sale item/movement fails.
- Store A cannot access or mutate store B products/sales/movements through an A-scoped repository.
- Stock-in +20 writes exactly one movement and one outbox command, and estimated quantity becomes 20.
- Inject failure after movement or balance update before outbox insert: entire stock-in rolls back.
- Adjustment -1 from 20 yields estimate 19 and records required reason. Adjustment -21 rejected without partial writes.
- Create three-line sale: one sale header, three line snapshots, three linked movements, one `sale.create` command, correct stock deltas.
- Inject outbox failure: no sale header, lines, movements, projection changes or command remain.
- Inject failure at each critical step, including line insertion and second stock decrement; rollback all.
- Overlapping checkout requests on the same last unit: only one can commit locally (with different attempt IDs).
- Repeat same `checkout_request_id`: exactly one sale / outbox command, returns original sale.
- Different `checkout_request_id`: a second legitimate sale is allowed when sufficient stock exists.
- Multiple sales plus stock adjustments preserve append-only movement and outbox order.
- `sale.create` creates NO independent inventory adjustment outbox commands for its line movements.
- Sale references unsynced product in same store: command order/dependency representation is preserved for future M4.
- SQL parameter binding: quotes and injection-looking text in customer name, reason, product names are treated as data.
- Restart test: close and reopen same physical native SQLite database file, verify stock balances, sales, items, movements, original M1 pending commands and M2 pending commands remain.

## C. UI/component tests

- Product stock summary: zero stock, low stock, available stock, and pending badge.
- Inventory adjustment form validates signed count and required reason.
- Cart empty, item added/removed, quantity changed, stale price and insufficient stock error states.
- Checkout button ignores repeated taps while saving; repository dedupe remains the actual final protection.
- Sales list shows loading/empty/error and pending/provisional sale; detail retains price snapshot after product edit.
- Daily summary includes saved provisional local sales, with an appropriate status explanation.
- Accessibility: field labels, errors, button names, keyboard behavior and touch targets.

## D. Physical Android airplane-mode scenario

1. Start with completed M1 app and one fictional product: `TEE-001`, `Basic Cotton Top`, price ₦3,500.00.
2. Enable airplane mode and verify offline status.
3. Stock in +20 units with note `Opening stock`. Estimated availability becomes 20.
4. Create one sale for 3 units of the product, `cash` payment label, no customer name. Expected sale total ₦10,500.00 and estimated stock 17.
5. Record `-1` adjustment with reason `Damaged item`. Estimated availability becomes 16.
6. Verify stock movement history contains exactly +20, -3 and -1, linked correctly; sale detail shows price ₦3,500 snapshot.
7. Force-stop through Android settings, relaunch still in airplane mode, verify same sales, stock estimate and pending outbox commands.
8. Edit product price to ₦4,000.00; sale history must still show ₦3,500.00 and total ₦10,500.00.
9. Try to sell 17 units with only 16 estimated available; blocked and no partial sale created.
10. Re-enable internet. Nothing changes to synchronized: `Pending sync` remains until M4.

## E. Exit checklist

- [ ] M1 regression and data-preserving migration tests pass
- [ ] Native transactional rollback tests pass (not just mocked repositories)
- [ ] Stock estimate never becomes negative in normal local operations
- [ ] Outbox commands remain ordered, stable, and pending
- [ ] Sale + items + movements + projection + command written atomically
- [ ] Local duplicate checkout replay does not create two sales
- [ ] Historical price snapshots and integer arithmetic correct
- [ ] Offline device force-stop test completed and evidence recorded honestly
- [ ] CI: lint, TypeScript, unit/integration tests, formatter, Expo dependency check
- [ ] README + ADR updates; separate review of data integrity risks
