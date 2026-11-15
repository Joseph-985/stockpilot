This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

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

# StockPilot — Architecture v1

## Decision

Use a **feature-based modular monolith** with clear UI/application/domain/infrastructure boundaries and a **SQLite-local-first persistence model**. PostgreSQL is the authoritative multi-device system of record. A single, explicit sync engine exchanges domain commands and versioned changes.

This is deliberately not microservices or a fully generalized sync platform: one app, one backend, and a small protocol make it understandable and testable.

## Dependency direction

UI (`app/` routes + features/\*/presentation) -> application use cases -> domain types/contracts. Infrastructure implements repository contracts and sync transport. Domain does not import Expo, React, SQLite, or Supabase.

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

| Table                | Principal fields                                                    | Notes                                                       |
| -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `stores`             | id, name, currency                                                  | One store in MVP                                            |
| `store_members`      | store_id, user_id, role, status                                     | Owner/staff authorization                                   |
| `products`           | id, store_id, sku, name, price_minor, version, deleted_at           | Unique store SKU; soft deletion                             |
| `stock_balances`     | store_id, product_id, quantity, version                             | Fast authoritative available quantity                       |
| `stock_movements`    | id, store_id, product_id, delta_quantity, reason, source_command_id | Append-only audit trail                                     |
| `sales`              | id, store_id, created_by, total_minor, occurred_at, status          | Immutable on confirmation                                   |
| `sale_items`         | sale_id, product_id, quantity, unit_price_minor, line_total_minor   | Historical snapshots                                        |
| `processed_commands` | store_id, command_id, result_json, outcome                          | Unique idempotency key                                      |
| `sync_clock`         | store_id, revision                                                  | Monotonic commit-ordered store counter, locked during write |
| `change_log`         | store_id, revision, entity_type, entity_id, operation, payload      | Server delta-feed cursor                                    |

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

| Conflict                             | MVP policy                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Duplicate submission                 | Return original outcome; do not apply twice                                                                      |
| Concurrent sale of last unit         | First valid committed sale wins; later command rejected, visible `Needs attention`                               |
| Product edited on two devices        | Version check; reject stale update; show both values and allow user to resubmit                                  |
| Product deleted while offline        | Reject references as appropriate; retain local command and resolution path                                       |
| Membership revoked offline           | Local records remain provisional; server refuses writes; lock/clear per privacy policy after verified revocation |
| Network timeout after server success | Retry exact command ID; server responds with original result                                                     |

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

# StockPilot — Implementation Roadmap

Milestones are sequential **delivery gates**, not promises of how many days development will take. Each gate should be a separate PR/commit group, verified before progressing.

## M0 — Repository and foundations

- Create Expo/TypeScript app, configure formatter/lint/type-check, gitignore, GitHub, README, CI.
- Choose a verified SDK/NativeWind pairing; install Expo Codex plugin; check device/emulator boot.
- Create product spec, architecture doc, ADRs and issue board.
- Create a design system skeleton: colors, spacing, text, Button, TextField, EmptyState, ErrorState.

**Exit:** App launches on Android; `npm run lint`, `npm run typecheck`, tests/CI run; no secrets committed.

## M1 — Local database and core product catalog

- Versioned SQLite migrations; WAL, FK behavior, index strategy.
- Shared `Money` and `Quantity` domain types/validators and pure use cases.
- Product list/search, add/edit, persistence, soft-delete semantics and seed fixtures.
- Business mutations write local record + outbox entry in one SQLite transaction.

**Exit:** Device in airplane mode can create/edit a product, force-stop, relaunch and still see correct data and pending state.

## M2 — Inventory and sales domain

- Inventory stock-in/adjust with immutable movement record and reason.
- Cart UI, multi-line sale creation, snapshots of price, calculations using integer minor units.
- Transactional local sale + sale lines + stock estimate + outbox command.
- Daily summary and sales history from SQLite.

**Exit:** Offline multi-item sale survives restart; invalid/zero quantities and incorrect totals are prevented; deterministic domain tests pass.

## M3 — Backend schema and security

- Supabase CLI local setup, migrations for stores/members/products/stocks/sales/lines/commands/change log.
- Initial online sign-in, store bootstrap, role checks and row-level policies.
- Atomic server-side command executor; stock-row locks and idempotency receipts.
- Tests for cross-store access, duplicate commands, insufficient stock and forged totals.

**Exit:** Server mutation cannot be applied by nonmember or twice by the same command ID; overselling is rejected.

## M4 — Sync engine

- Versioned push/pull contracts, ordered outbox, retriable errors, stored backoff metadata.
- Consistent snapshot bootstrap, cursor-based pull, atomic local apply+cursor.
- Single-flight foreground sync; retry on resume/network restore/manual button.
- Distinct pending/synced/conflict statuses; preserve rejected commands for resolution.

**Exit:** Airplane-mode sale -> force-stop -> reconnect -> exactly-once server effect -> second-device pull -> correct stock. Timeout-after-commit and crash-during-pull tests pass.

## M5 — Conflict handling and UX polish

- Conflict screen for oversell and stale product edits.
- Sync indicator with last success, pending count and retry button.
- Loading/empty/error states; accessibility labels, touch targets and responsive layout.
- Tune product list rendering (FlashList or FlatList profiling) and queries/indexes.

**Exit:** Nontechnical tester can tell which transactions are confirmed and which require action. No silent data loss.

## M6 — Testing and resilience

- Unit tests: money, totals, stock invariants, entity validation.
- Integration tests: SQLite transactions, command persistence, migrations, retries and cursor.
- Server tests: authorization, duplicate command, row-lock concurrency.
- Device E2E: login, offline sale, restart, reconnect, conflict resolution.
- Simulate 401, 500, flaky network, app kill, database migration from older version.

**Exit:** All relevant checks pass on CI and critical flow on physical Android device; document known limitations and test evidence.

## M7 — Portfolio launch

- Seed demo store with fictional products, users and sample sales.
- Produce an installable Android preview APK through EAS; add setup instructions for iOS if available.
- README: live/demo link, screenshots, GIF/video, system architecture, ADR links, testing, troubleshooting.
- GitHub Actions for lint, type-check, tests; configure GitHub issue labels and clean commits.

**Exit:** A recruiter can understand the project in 2 minutes and run/review it without requesting real credentials.

## Suggested first 10 GitHub issues

1. Initialize Expo / TypeScript and quality tooling
2. Design local SQLite schema and migrations
3. Build product repository and fake for tests
4. Implement product list/create/edit and pending badge
5. Implement stock movements and inventory balance calculation
6. Implement sale creation with price snapshots and transactional outbox
7. Create Supabase schema, auth, membership and RLS policies
8. Implement idempotent authenticated `sale.create` server executor
9. Implement push/pull synchronization and cursor atomicity
10. Add conflict UI and Android offline E2E test

## Risk register

| Risk                                  | Mitigation                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| Two devices oversell                  | Provisional local records; server checks under lock; conflict UI               |
| Duplicate sales on retry              | Unique command ID, idempotency receipts and transactional executor             |
| Data loss on app termination          | Local domain + outbox atomic transaction; persistence tests                    |
| Cursor skips server updates           | Commit-ordered per-store revision + transactional snapshot/pull                |
| Device lost before sync               | Visible pending indicator; users informed local data is not remotely backed up |
| Platform background constraints       | Foreground/resume/manual sync primary; background optional                     |
| Auth/permission changes while offline | Server authorization always rechecked when reconnecting                        |
| Library version conflicts             | Version pinning, `expo install`, physical-device smoke tests                   |
| Bloated Codex changes                 | Small task scopes, reviewer gates, required tests and diffs                    |

## GitHub Definition of Done for each feature

- Feature works with network disabled where required
- Feature has persistent and valid domain state after restart
- Errors and conflicts have visible UI states
- Business rules tested; migrations and access control considered
- Lint/type-check/tests pass; no bypasses or unchecked casts
- README/ADR updated when behavior or architecture changed
- Focused commit/PR, no unrelated refactors

# StockPilot — Ready-to-use Codex prompts

First copy `PRODUCT_REQUIREMENTS.md`, `ARCHITECTURE.md` and `ROADMAP.md` into your repository root or `docs/` and adjust agent references accordingly. Append `AGENTS_ADDENDUM.md` to the existing root `AGENTS.md`.

## Prompt 0 — Repository audit and implementation plan

> Read AGENTS.md, PRODUCT_REQUIREMENTS.md, ARCHITECTURE.md and ROADMAP.md completely. Inspect package.json and current code. Do not implement application features yet. Produce: (1) proposed module tree, (2) exact dependencies with verified Expo SDK compatibility, (3) first 10 issues sorted by dependency, (4) risks and open decisions, and (5) a small first milestone. Preserve Expo-generated agent instructions. Explicitly flag SDK/NativeWind compatibility risks. Do not invent test outcomes.

## Prompt 1 — Local persistence vertical slice

> Implement milestone M1 only. Build versioned expo-sqlite migrations, typed product domain entities and repository interface, a SQLite repository implementation, an atomic local product-create/update + outbox transaction, and product list/create/edit screens. Screens must read SQLite, not Supabase. Use integer minor units for prices and client-generated UUIDs for offline entities. Include migration, repository and domain tests, and document any Expo SDK-specific transaction limitations. Run lint, type-check and tests. Stop and summarize changed files and verification.

## Prompt 2 — Inventory and sales

> Implement M2 with pure domain functions for stock adjustments and multi-line sales, typed validation, a transactional SQLite sale write (sale, lines, provisional movements, outbox command), and readable pending states. Do not call a server before allowing an offline sale. Persist price snapshots and use integer minor units. Add tests for totals, invalid quantities, negative-stock estimates, process restart persistence and rollback. Avoid changes to unrelated modules.

## Prompt 3 — Secure PostgreSQL backend

> Implement M3 with versioned Supabase SQL migrations, one-store membership and roles, products, stock balances, immutable movements, sales, sale items, processed command receipts and a commit-ordered per-store change feed. Add RLS and minimal grants. Implement an authenticated atomic sale.create operation that locks stock rows, checks membership and available stock, recomputes totals, ensures idempotency by (store_id, command_id), and records a durable outcome. Create tests for duplicate commands, unauthorized cross-store calls, concurrent last-unit sales and malformed totals. Never use service-role secrets in the mobile app.

## Prompt 4 — Reliable synchronization

> Implement M4 using the protocol specified in ARCHITECTURE.md. Build a single-flight foreground sync coordinator, persistent outbox retries, ordered command push, stable command IDs, safe server-result reconciliation, snapshot bootstrap, ordered cursor-based pull and atomic local cursor advancement. Only the server can confirm sales. Trigger sync on app resume, network recovery and manual retry. Write deterministic tests for timeout after server commit, crash before cursor commit, duplicated responses, out-of-order operations, and partial network outages. Do not claim exactly-once network delivery; implement idempotent effect despite at-least-once retries.

## Prompt 5 — Conflict resolution and polish

> Implement M5: persistent conflict records and visible UI for insufficient-stock and stale-product-version errors; last sync time, pending count, retry and explanations; accessible empty/error/loading states. Ensure a rejected sale is never shown as confirmed or silently removed. Measure on-device list behavior with representative data; optimize only measured bottlenecks. Add tests and summarize accessibility results.

## Prompt 6 — Recruiter-ready release

> Implement M6–M7 without changing core business invariants: audit tests, setup GitHub Actions, add seed data using fictional identities, build a demo-friendly sign-in experience, add architecture diagram and 3 ADR documents, write clear README with screenshots placeholders, add EAS preview build configuration, and document how to verify airplane-mode, force-stop, reconnect and two-device sync. Execute available checks and list any manual checks still needed. Keep all secrets out of Git.

## Reviewer prompt (after every milestone)

> Act as a skeptical senior React Native reviewer. Review only the diff against the current milestone. Prioritize data-loss risk, transaction atomicity, stale/cross-user data, concurrency, SQL/RLS, type safety, list performance and accessibility. Report concrete issues with file paths and reproductions, ordered by severity. Suggest minimum fixes. Do not rewrite files unless I explicitly ask.

## Test generation prompt

> Read the feature contract and current tests. Identify the five highest-risk untested behaviors, add focused automated tests for them, execute the test suite, and explain any failures. Prioritize retry idempotency, partial sync, inventory invariants, restart persistence and authorization.
