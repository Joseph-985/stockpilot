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
