# StockPilot — M3 Codex Prompts

**Workflow:** one prompt per Codex task. Before each implementation read `AGENTS.md` + actual source code + all `docs/M3_*.md`. Review diff and tests, then commit. Do not claim native test/remote deploy passed unless actually executed. User has completed M0–M2; their repository is ground truth, not this illustrative spec.

## Prompt 0 — READ-ONLY audit

```text
Act as a skeptical Staff Engineer experienced in Expo React Native, Supabase Auth, PostgreSQL RLS, PL/pgSQL, and offline-first synchronization.

We are starting StockPilot M3. Read AGENTS.md, docs/ARCHITECTURE.md, docs/ROADMAP.md, every docs/M3_*.md and the complete M2 implementation. DO NOT CHANGE ANY FILES.

Inspect:
- Actual Expo SDK, Supabase packages if any, navigation, user session/design, local demo store ID, device identity.
- Actual M1/M2 SQLite schema, product/version fields, `outbox_commands` types, IDs, payload snapshots/order.
- Existing money/quantity validation, error result codes, native SQLite transactions, offline regression tests.
- Testing conventions, package scripts, GitHub Actions, any existing supabase/config.toml.
- Whether M2's sale item snapshot and checkout_request_id fit proposed server command schema.

Produce a concrete six-slice implementation plan M3-A..F with file changes, schema choices, auth storage decision and platform compatibility, RLS permissions, one-transaction idempotent command protocol, commit-ordered change feed, test plan, environment setup, and risks. Mark any mismatch requiring an explicit adapter in M4. Do not install packages, change routes, connect servers, link local demo store, or implement sync. STOP.
```

## Prompt A — Local Supabase & Postgres schema / authorization

```text
Implement StockPilot M3-A ONLY. Read all M3 docs and inspect actual M2 code. Establish local Supabase CLI config/migrations. Do not change SQLite, do not implement mobile auth or Edge Functions.

1. Add local Supabase npm dev dependency, initialize config if missing, sample env, ignore secrets. Use current CLI docs and Docker local stack. Do not run destructive commands against remote DB.
2. Add migration files for stores, store_members, products, stock_balances, stock_movements, sales, sale_items, processed_commands, sync_clock and change_log. Use indexes, FKs with same-store constraints, unique store SKU, version/check constraints, immutable ledger/sales policy.
3. Enable RLS for all exposed tables; explicitly design read grants and membership policies for owners/staff; deny anon. Keep receipt/clock/ledger internal where feasible. Deny direct client writes to protected business data and membership.
4. Add atomic create-store-and-owner-membership authenticated RPC with safe SECURITY DEFINER usage: `SET search_path=''`, qualified names, explicit auth.uid(), limited EXECUTE grants, no owner spoofing.
5. Add pgTAP tests for fresh schema, grants, owner/staff/nonmember/anon reads, cross-store isolation, direct REST-DML denial, owner-only membership operations. Include tests for any SECURITY DEFINER entry point with unauthorized caller.
6. Run `npx supabase db reset` only on the disposable local DB and `npx supabase test db`. Report observed checks and known gaps. STOP after M3-A.

Never use SUPABASE_SECRET_KEY/service_role in Expo. Never expose privileged helper functions to public or anonymous roles. No cloud mobile sync yet.
```

## Prompt B — Mobile auth, session and cloud store onboarding

```text
Implement StockPilot M3-B ONLY. Read all M3 docs and current M2 UI/navigation. Keep M1/M2 local repositories/outbox untouched.

1. Integrate Supabase Auth using current SDK-compatible packages and publishable key (not legacy secret) and appropriate tested React Native session storage adapter.
2. Implement sign-up, sign-in, sign-out, session restore, auth loading/error states, email verification messaging, token refresh on app foreground where appropriate.
3. Implement cloud store onboarding via the secure create-store RPC and owner membership; add store selection/read-only metadata screen if useful.
4. Clearly separate 'Offline Demo / Local Store' mode from 'Cloud Account' mode. Never map existing local store UUID to a cloud store implicitly, never upload any M1/M2 outbox, never delete local records on auth state change.
5. Document account switching / sign-out safety: prevent one account from viewing another's local records while preserving unsynced data and require explicit future migration.
6. Add tests for auth state transitions, missing env, invalid credentials, local demo offline continuity, preserved pending commands, unauthorized store, session unavailable offline, no private values in logs.
7. Test on Android if device available and report manual steps if not. STOP after M3-B.

If current Supabase session-storage recommendations conflict, compare options and record the chosen implementation in an ADR. Avoid claiming secure at-rest SQLite encryption is automatically provided.
```

## Prompt C — Authenticated product and inventory command processing

```text
Implement StockPilot M3-C ONLY. Read all M3 docs and M2 command types. Backend integration tests must use real local PostgreSQL/RLS/auth context, not mocks alone.

1. Create authenticated Edge Function process-command using current verified Supabase user auth middleware, Zod validation, request size limits. Keep JWT verification enabled. No service credentials in client.
2. Define restricted PostgreSQL transaction command function and internal helpers. SECURITY DEFINER must independently verify auth.uid() and CURRENT active store membership/role; fixed search_path, qualified names and narrow EXECUTE grants.
3. Implement per-(store_id,command_id) exactly-once BUSINESS EFFECT through DB uniqueness/serialization and stored response. Calculate server-side normalized payload hash, reject changed-payload replays. Verify identity before returning receipt.
4. Implement product.create/update/delete with active SKU uniqueness, archive, version checking, initial 0 balance; inventory.stock_in and inventory.adjust with owner permissions, signed movements, row locks, nonnegative stock.
5. Append change records and update per-store sync_clock in the same DB transaction for accepted state mutations.
6. Distinguish terminal business conflict receipts from retryable infrastructure errors. Never allow arbitrary SQL execution or client-provided actor.
7. Test duplicate commands, payload-swapped retry, unauthorized role, cross-store product reference, product version stale, negative stock, atomic rollback, and unknown command type.
8. Stop after M3-C. Do not implement sales, client queue push or pull-to-SQLite.
```

## Prompt D — Atomic sale processor and concurrent transactions

```text
Implement StockPilot M3-D ONLY. Reuse M3-C security/idempotency/transaction infrastructure and compare actual M2 sale.create payload.

1. Implement sale.create with stable client-provided sale ID and checkout_request_id; one server transaction for sale header, immutable item snapshots, signed sale movements, quantity deductions, processed receipt, sync clock/change-log writes.
2. Membership role: owner or staff only. Validate same-store product existence, active state, exact NGN currency, quantity positive integer, safe kobo math, and expected unit prices.
3. Lock affected stock rows in deterministic product UUID order, re-read inside transaction, prevent oversell; server recomputes totals and immutable name/SKU/price snapshots. Reject stale price rather than silently charging new price.
4. Never enqueue separate inventory.adjust for sale deductions. Treat same checkout_request_id on a new command_id as a duplicate logical sale according to explicit policy.
5. Durable duplicate command replay must return original response, with no additional sale, movement, balance change or feed entry. Swapped payload must be rejected.
6. Persist business rejections as terminal receipts without stock changes; unexpected DB errors must roll back and remain retryable.
7. Run authentic concurrent transaction tests (two independent connections/sessions, one stock unit), replay-after-unknown-response, forced intermediate failure rollback, FK wrong-store, total mismatch, price change and membership revocation.
8. Stop after M3-D. No mobile outbox push or sync UI.
```

## Prompt E — Consistent bootstrap and ordered change API

```text
Implement StockPilot M3-E ONLY. Read docs/M3_API_AND_SYNC_CONTRACT.md carefully. Backend endpoints are tested independently; do not connect them to device SQLite.

1. Implement authenticated bounded bootstrap-store endpoint that obtains a consistent snapshot and matching sync revision. Show in tests that concurrent changes aren't missed. If size must be capped, return an explicit error instead of a partial snapshot masquerading as complete.
2. Implement authenticated paginated pull-changes endpoint with `(revision, ordinal)` exclusive cursor and stable ordering. Ensure page size 1 does not skip second/third changes from same command revision.
3. Store revisions under per-store row lock in the SAME transaction as business writes; no assumption that BIGSERIAL ordering equals commit ordering.
4. Restrict arbitrary cursor, limit and store values; check active membership on each request. Hide internal receipt/clock tables and avoid leaking other store IDs/error details.
5. Test empty feed, multiple changes per revision, concurrent commits, pagination, cursor tampering, nonmember access and stored snapshot correctness.
6. Document future M4 device-merge contract and current limitations. Do not implement actual SQLite pull, background tasks, cloud import or conflict UI.
7. Run tests, report actual results, stop after M3-E.
```

## Prompt F — Final hardening, tests, CI and staging walkthrough

```text
Implement StockPilot M3-F hardening ONLY. Review M3 diff against merged M2 baseline and all M3 docs.

1. Add missing pgTAP RLS/grants/privileged RPC tests and real authenticated integration tests for products, stock, sales, failed transaction rollback, duplicate replay and concurrent last-item sales.
2. Verify SQL function grants, search_path, cross-store queries, stale membership, `processed_commands` hashes, no secret in app bundle, migration replay. Run database linter/advisors where supported.
3. Test M2 airplane-mode local flows and prove all preexisting local SQLite product/sale/movement/outbox rows and IDs survive sign-in/out. Do not auto-upload pending data.
4. Improve errors/accessibility/recovery UX, create .env.example and safe local + staging setup documentation. Document physical Android localhost caveat and auth email redirect requirements.
5. Add GitHub Actions job for Supabase local DB/pgTAP tests on Docker-capable runner, alongside existing M2 lint/typecheck/unit tests. Tests must not use production secrets.
6. Update README, ADRs, API version and role matrix. Deploy migrations and Edge Function to disposable staging only after review; do not assume deployment succeeds until observed.
7. Run supported checks: `npx supabase test db`, integration tests, npm lint/typecheck/tests, `npx expo install --check`. Record exact commands and outcomes, failures, skipped checks, unverified manual tests.
8. End with changed files, security findings, risks, M4 handoff. STOP; do not implement M4.
```

## Independent skeptical review (READ-ONLY)

```text
Act as a red-team-minded Staff Security Engineer and database architect. Review M3 diff against M2 baseline. Read AGENTS.md and all M3 docs. DO NOT MODIFY FILES.

Prioritize P0/P1 vulnerabilities:
- service/secret key in Expo/public env or checked-in files
- RLS missing or permissive, unexpected Postgres grants, SECURITY DEFINER functions executable by wrong roles, mutable search_path, membership recursion
- authenticated user able to join other store, spoof owner/actor, enumerate cross-store data or receipts
- revoked staff member can still mutate using valid JWT
- non-atomic sale+stock+receipt, oversell under concurrent connections
- replay with changed payload, races in processed_commands, duplicate checkout_request_id on new command ID
- client-controlled totals/price snapshots, bad integer math, cross-store FKs
- inconsistent snapshot cursor, multi-change pagination skip, global sequence ordering mistaken for commit ordering
- signout/role change leaks locally stored demo data, M2 outbox destroyed, accidental M4 sync scope
- unsupported Auth/Edge SDK usage or unverified test/deploy claims.

Return findings ordered by severity, concrete file/line, exploit scenario, reproduction/test, remediation and residual risks. Do not give generic praise; state if unable to execute tests.
```
