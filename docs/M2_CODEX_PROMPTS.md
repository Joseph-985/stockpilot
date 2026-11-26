# StockPilot — M2 Codex Prompts

Run from repository root. **One prompt at a time.** Never ask Codex to implement the entire milestone in one turn. Review `git diff`, run checks, and commit between slices. Actual M1 code is the source for file paths, interfaces, migrations and transaction API decisions.

## Prompt 0 — Read-only audit and plan

```text
We are starting StockPilot milestone M2 (offline inventory and sales). Act as a senior React Native engineer specializing in SQLite transactional systems.

Read AGENTS.md, docs/PRODUCT_REQUIREMENTS.md, docs/ARCHITECTURE.md, docs/ROADMAP.md, docs/M2_IMPLEMENTATION_SPEC.md, docs/M2_DATA_CONTRACTS.md, docs/M2_TEST_MATRIX.md, and the actual M1 implementation.

DO NOT MODIFY FILES.

Inspect:
1. Installed Expo SDK and expo-sqlite API version.
2. M1 migration runner, existing schema, foreign-key PRAGMAs and transaction coordinator.
3. Existing product repository/domain types, demo-store ID, money helpers, UUID provider and outbox writer.
4. Whether the outbox commands table has a CHECK restriction on allowed types; how to extend it without data loss.
5. Reusable UI design system, tab routes, tests and CI scripts.
6. Existing conventions for errors, result types, local data refresh and screen state.

Propose a concrete M2 plan divided into slices A-E. Include:
- precise file-by-file changes
- versioned migration preserving all M1 rows/outbox sequences
- local_stock_balances baseline + pending delta model
- append-only stock movements, sale header + item snapshots
- atomic stock-in, adjustment and checkout transactions
- concurrency and repeat-checkout protection
- test plan including migration from POPULATED M1 DB and native Android rollback
- explicit uncertainties and trade-offs

Do not add backend, network sync, refunds, barcode, payment gateway or unnecessary packages. Stop after presenting the plan.
```

## Prompt A — M2 migration, domain contracts and test foundations

```text
Implement M2 slice A only, after reading AGENTS.md, docs/M2_IMPLEMENTATION_SPEC.md, docs/M2_DATA_CONTRACTS.md, docs/M2_TEST_MATRIX.md and inspecting current M1 code.

1. Add a new, versioned SQLite migration for local stock balances, stock movements, sales, sale items and appropriate indexes. Reuse M1 table naming conventions and migration framework.
2. Extend existing outbox to support inventory.stock_in, inventory.adjust and sale.create without erasing or replacing any pending product commands. Handle existing type CHECK restrictions through a safe, tested schema migration.
3. Create pure TS domain types, Zod validators, repository contracts, safe integer quantity/amount helpers and explicit errors or discriminated results.
4. Use store-scoped product IDs, stable expo-crypto UUID where already configured, product status/price definitions from M1. Do not duplicate existing shared types/helpers.
5. Establish a stock projection: base_quantity (last authoritative baseline, initially zero) + pending_delta (pending local movements); distinguish estimated vs confirmed.
6. Verify foreign key enforcement in the actual write transaction connection. Explain and test Expo SQLite's withExclusiveTransactionAsync vs withTransactionAsync behavior as applicable.
7. Add tests: fresh + populated-M1 upgrade, preserved outbox identifiers/order, rerun idempotence, FK integrity, failed migration rollback, quantity/money domain validation.

Do not implement screens, inventory mutation use cases, sale checkout use cases or network/backend. Run actual lint/typecheck/tests and report what ran and results. Stop after slice A.
```

## Prompt B — Stock-in, stock adjustment and history

```text
Implement M2 slice B only. Read AGENTS.md and M2 docs; inspect slice A and M1 implementations before changing anything.

1. Implement stock-in as a use case and SQLite repository mutation. Accept positive safe-integer quantity, optional note; verify active product belongs to current store.
2. Implement signed stock adjustments with a required audit reason. Reject zero, fractional, unsafe or insufficient-stock changes.
3. For each mutation atomically: create/upsert stock balance, append immutable movement, update pending_delta and insert exactly one immutable outbox command with stable UUID and order.
4. Prevent overlapping local operations from violating estimated quantity >=0. Reuse M1 transaction coordinator; test on native SQLite.
5. Implement stock-list/inventory screen, stock-in form, adjustment form and per-product movement history, reusing M1 UI components, navigation patterns and local data refresh.
6. Show estimated availability, low-stock threshold and `Pending sync`. No claim of server-confirmed availability.
7. Add domain/SQLite/component tests including injection of a failed outbox insert proving complete rollback.

Do not implement sales, backend or actual sync. No destructive migrations or unrelated refactors. Run checks; report file diff, tests and manual tasks. Stop after slice B.
```

## Prompt C — Atomic sale creation and checkout safeguards

```text
Implement M2 slice C only. Read AGENTS.md and M2 docs. Build the SALES DOMAIN and PERSISTENCE, not polished screens yet.

1. Define CheckoutInput/CheckoutResult, cart line validation, duplicate product coalescing, exact integer-kobo totals, optional customer name and payment-method label enum.
2. Create a SaleRepository / createSale use case that accepts a stable checkout_request_id. Reuse same IDs if retrying the same unknown-outcome checkout.
3. In ONE serialized SQLite transaction:
   - check whether checkout_request_id already committed (return existing)
   - fetch same-store, active products and stock projections
   - ensure quantities are positive and estimated availability sufficient
   - detect changed price since checkout review and require re-review
   - capture immutable product name, SKU and unit price snapshots
   - recompute exact line totals and sale total using integer checks
   - insert sale header and items
   - insert one negative movement per product linked to this sale
   - update pending stock deltas without allowing negative estimate
   - insert ONE immutable sale.create outbox command containing snapshot items
4. The sale must not enqueue separate inventory.adjust commands for its movements.
5. Distinguish insufficient_stock, product_unavailable, price_changed, duplicate_attempt, and persistence_failure UI-facing results.
6. Add true SQLite integration tests for failure at different steps, concurrent sales of last unit, repeat same checkout_request_id, sale price snapshots and outbox ordering with unsynced product creation.

No Supabase, actual sync, refunds or new UI flows yet. Run checks and provide observed test results and risk notes. Stop after slice C.
```

## Prompt D — Sales UI and provisional local reporting

```text
Implement M2 slice D only. Read AGENTS.md and M2 docs, review slices A-C, reuse existing Expo Router and M0/M1 design system.

Build:
- product picker/search for sale
- cart with adjustable integer quantities, removal, and safe local state
- checkout review with exact displayed totals and customer_name optional + cash/transfer/other label
- Create Sale button with busy state; preserve cart on validation/stock/price errors
- success confirmation only after local transaction commits
- sales list, detail with immutable item snapshots, pending badge
- dashboard daily local sales totals and low-stock summary
- inventory movement history link to relevant sale where present

Keep SQLite as screen read source for committed records. Cart may be ephemeral Zustand/component state. Explicitly label totals and stock as local/provisional while sync isn't implemented. Refresh SQLite-backed screens on focus/mutation; support loading/empty/error and accessible controls. Do not add third-party state libraries unless essential.

Add component tests for UX errors, pending state and price snapshots. Run lint/typecheck/tests. Stop after slice D.
```

## Prompt E — Reliability, testing, documentation, manual verification

```text
Harden StockPilot M2 against docs/M2_TEST_MATRIX.md. Read AGENTS.md and all M2 specs. Inspect full M2 diff versus M1 baseline.

- Add missing domain and SQLite integration tests including populated M1 migration, outbox continuity, FK enforcement, failing intermediate insert and outbox rollback, concurrent checkout last-unit race, duplicate retry with same checkout_request_id, product price change and store isolation.
- Verify sales and movement history remain append-only, UI cannot silently delete confirmed or pending records, and cart re-submit is not mistakenly treated as a new purchase.
- Check SQL parameterization, all money/quantity overflow guards, errors and accessibility.
- Document reproducible airplane-mode/force-stop Android runbook; do not claim it passed without actual device execution.
- Update README with M2 local demo, route/screens, scripts, limitations, and architecture decisions from M2_DECISIONS.md (adapt to actual code).
- Run npm scripts available in package.json, npx expo install --check, and actual integration tests. Report pass/fail/skipped accurately.
- Do not add backend, network sync, refunds or unrelated refactors.

Return: changed files, exact tests run, results, unverified native tests, known trade-offs and handoff to M3. Stop after M2.
```

## Independent reviewer prompt (read-only)

```text
Review only the M2 diff against the M1 baseline as a skeptical Staff-level mobile engineer. Do not modify files.

Prioritize P0/P1 issues: destructive migrations; loss/reordering of M1 outbox records; foreign keys not enforced within the chosen SQLite transaction; double-charging/double sale on repeated attempts; incomplete sale writes; negative stock from overlapping local transactions; wrong-store product linkage; integer money overflow; stale checkout pricing; mutable historic price snapshots; duplicate inventory adjustment command for a sale; misleading synced/confirmed labels; and unsanitized SQL.

For each finding show: severity, exact file/line if available, reproduction or failing test, minimal safe fix. Distinguish observed findings from plausible but unverified risks. Suggest tests first. Do not claim device testing happened unless evidenced.
```

## Suggested Git workflow (PowerShell)

```powershell
# After each completed slice
git status
git diff --check
npm run lint
npm run typecheck
npm test -- --runInBand
# if configured in your package.json
npm run format:check
npx expo install --check

git add .
git commit -m "feat(m2): implement inventory repository and ledger"
# Use a new, descriptive commit message for each subsequent slice.

# After final review
git push -u origin feat/m2-inventory-sales
```

Do not run a `format:check` script that is not present; check `package.json` first. Test scripts shown are examples, not verified commands in your repository.
