# M3 Implementation Specification — Secure Backend and Auth

**Status:** proposal for Codex to adapt to the ACTUAL, completed M2 repository. No new local SQLite migration should be assumed necessary until the repository is inspected. M3 adds a PostgreSQL backend; actual device↔cloud queue processing is M4.

## Goals

1. Authenticated identities, safe session persistence, owner/staff roles, and authorized store onboarding.
2. PostgreSQL store-scoped data model covering exact M1 product and M2 stock/sales command semantics.
3. Secure transaction processor: validation, authorization, immutable accepted sales/movements, receipts, and race-safe inventory.
4. A commit-ordered server change log and consistent bootstrap/pull contract for M4.
5. Automated adversarial tests proving real tenant isolation and idempotency.
6. Preserve the existing SQLite offline-only demo, all outbox rows/sequences, local store ID, products, movements, and sales.

## Non-goals

- No automatic upload of local outbox commands or downloading cloud data to SQLite.
- No automatic migration of anonymous local demo store to a newly signed-in user.
- No multi-device realtime subscriptions, retry engine, conflict resolution UI, payment processing, barcode scanning, refunds, or offline auth onboarding.
- No new standalone Express/Nest server or unnecessary infrastructure.

## Architecture

- Expo UI: local demo mode works offline as before; online-only authentication & cloud store management are separate screens/mode.
- Supabase Auth: identity, access tokens, email sign-in/sign-up, logout, password recovery (test deep links/redirects if implemented).
- Supabase Edge Function `process-command`: authenticated JWT facade, schema validation, rate/size limits, response mapping. Use modern `@supabase/server` with `auth: 'user'` **if supported by current project/runtime**. Do not use privileged clients for ordinary reads. Do not turn off JWT verification to bypass an error.
- PostgreSQL: one transaction per command, in constrained, reviewed database functions with fixed `search_path`, current user/member check, stable idempotency receipts, stock row locks, and domain mutations. A `SECURITY DEFINER` function MUST be intentionally permissioned and independently validate actor/store; a user-scoped Edge Function alone cannot protect a privileged RPC.
- Database Data API: authenticated, RLS-filtered read access to explicitly permitted tables/views. No client direct INSERT/UPDATE/DELETE to server-owned stock/sale/command receipt tables.
- Versioned changes: server writes and ordered change records occur together. M4 will implement client pull/merge; no synced badge should change in M3.

## Authentication UX

- Sign in/sign up/sign out and session restoration; user-friendly errors and explicit offline status.
- A session stored locally is NOT a guarantee the user remains authorized while offline. Display session-unverified status if online verification/refresh is unavailable. Never submit commands without a verified working token.
- Store creation requires online auth; owner membership creation is atomic and server-authenticated, not a client-written `store_members` INSERT.
- Staff membership created only through owner-authorized flow or test fixture (onboarding invitation is optional for M3). No arbitrary self-join by knowing a store UUID.
- Current local demo store ID and future cloud store ID must be distinct/explicitly mapped. **Do not send M1/M2 local commands yet.** Avoid showing pending local demo data inside a newly selected cloud store.
- Sign-out with unsynced data: preserve it, warn clearly, avoid exposing another user's records; persist namespacing/scope rules and block unsafe account switches until a deliberate policy is implemented. Confirm by test.

## Roles (MVP decision)

- `owner`: store settings, product creation/edit/archive, inventory receiving/adjustments, sales and reports, membership management.
- `staff`: read product/inventory/sales in own store; create sales. Cannot manage products/stock manually/members.
- No membership: no store access. An authenticated account is not enough.

## Suggested application additions (adjust to real repo)

```
src/features/auth/{application,domain,presentation}/
src/features/stores/{application,domain,presentation}/
src/shared/infrastructure/api/{supabaseClient,commandClient}/
app/(auth)/{sign-in,sign-up}.tsx
app/store/{create,select}.tsx
supabase/config.toml
supabase/migrations/*.sql
supabase/functions/process-command/index.ts
supabase/functions/shared/{contracts,validation}.ts
supabase/tests/database/*.sql
supabase/tests/integration/*
docs/decisions/ADR-M3-*.md
```

Keep local SQLite repositories/transaction coordinator intact. Avoid duplicating domain rules unnecessarily: share schema package if practical, but server MUST validate independently.

## End-to-end M3 demonstration

1. Start from a **disposable staging** Supabase database. Alice signs up and creates Store A as owner; Bob signs up and creates Store B as owner.
2. Charlie joins Store A as staff through an authorized setup action or test fixture.
3. Anonymous user and Bob cannot read Store A. Charlie can read but cannot modify Store A products.
4. Alice submits `product.create`, `inventory.stock_in(+20)` and `sale.create(3 @ ₦3,500)` through the protected API. Server balance becomes 17, sale total 1,050,000 minor units; one sale movement -3 and one command receipt.
5. Re-send the **identical** sale command ID/payload: same receipt, same sale ID, no extra stock deduction.
6. Re-send same command ID with a different payload: `idempotency_key_reuse` response; no data change.
7. Concurrently sell last item from two separate authorized requests: one accepted, one business conflict, no negative balance.
8. Turn off internet: pre-existing M2 local demo still supports products, inventory and sales and its outbox remains pending. No automatic cloud syncing occurs.

## Exit criteria

- M2 offline regression suite unchanged and passing, populated local DB preserved.
- Auth lifecycle, store creation/membership, correct roles; no auth data leakage between profiles.
- Postgres schema migration replay on empty DB; RLS/grants tests under authenticated callers and nonmembers.
- Real transaction-level idempotency, version conflict and concurrent sale tests.
- Backend query APIs and change cursor contract documented with no accidental M4 scope creep.
- GitHub CI includes backend tests with Docker-capable runner where feasible; staging deployment manual verification documented.
- A README with diagrams, role matrix, security measures, limitations, setup and troubleshooting instructions.

## Known caveats

- A phone can be wiped before unsynced local data is backed up; M3 does not fix this.
- Offline cached sessions cannot prove real-time authorization after revocation.
- Auth email confirmation and Android deep linking require working redirect configuration and manual device testing.
- Client-side prices, totals and timestamps are untrusted; validate every command server-side.
