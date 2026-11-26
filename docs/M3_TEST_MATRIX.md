# StockPilot M3 — Test Matrix & Definition of Done

Do not represent this list as already passed. Automated tests should run against a disposable local Supabase/Postgres instance under realistic authenticated identities; RLS tests that run only as a superuser bypassing RLS are NOT sufficient.

## A — Authentication & sessions

| ID | Priority | Test | Expected result |
|---|---|---|---|
| AUTH-01 | P0 | Sign up, verify email as configured, sign in | Valid session and authenticated identity |
| AUTH-02 | P0 | Wrong password | Safe error, no session |
| AUTH-03 | P0 | Relaunch app | Session correctly restored where still valid |
| AUTH-04 | P0 | Expired/invalid access token | Protected endpoint rejects; refresh/re-login handles safely |
| AUTH-05 | P0 | Sign out with pending local M2 outbox | No data loss; no cross-account exposure |
| AUTH-06 | P1 | Open app offline with previously known session | M2 demo usable; no promise of verified remote role or successful sync |
| AUTH-07 | P1 | Password recovery / email redirect | Flow works if included; document exact deep link prerequisites |
| AUTH-08 | P0 | App compiled environment | No secret/server role key exposed |

## B — Schema / tenant isolation / RLS

| ID | Priority | Test | Expected result |
|---|---|---|---|
| DB-01 | P0 | Replay all migrations on fresh DB | Success, indexes/FKs/constraints active |
| DB-02 | P0 | Anon SELECT tenant tables | Denied or zero visible rows, no sensitive data |
| DB-03 | P0 | Auth user without membership reads Store A | Zero access |
| DB-04 | P0 | Owner A attempts Store B product/sale SELECT | Zero access, no ID leakage |
| DB-05 | P0 | Owner A passes Store B ID in command | Forbidden before any writes |
| DB-06 | P0 | Staff attempts product create/stock adjustment | Forbidden |
| DB-07 | P0 | Staff creates valid sale | Allowed, within own store |
| DB-08 | P0 | Direct REST insert/update to balances/receipts/sales | Denied for mobile role |
| DB-09 | P0 | SECURITY DEFINER permissions / search_path audit | Fixed empty path, correct grants, no anon execution |
| DB-10 | P0 | Owner onboarding create-store | Store+owner membership atomic; caller cannot choose another owner |
| DB-11 | P0 | Revoked member retries old command | Forbidden; current live membership checked |
| DB-12 | P0 | Wrong-store composite FK attempt | Rejected |

## C — Product/inventory command semantics

| ID | Priority | Test | Expected result |
|---|---|---|---|
| CMD-01 | P0 | Create product with stable client UUID | Product version 1, stock baseline zero, receipt and change record |
| CMD-02 | P0 | Repeat exact command ID/payload | Same result, no new side effects |
| CMD-03 | P0 | Same ID, different payload | `idempotency_key_reuse`, no changes |
| CMD-04 | P0 | Two simultaneous copies of same command | Exactly one business effect and identical final receipt |
| CMD-05 | P0 | Product edit expected_version stale | Version conflict, no overwrite |
| CMD-06 | P0 | Stock-in 20 then adjust -3 | Balance 17, two immutable movements |
| CMD-07 | P0 | Adjustment -18 when 17 available | Terminal conflict, balance stays 17 |
| CMD-08 | P1 | Product SKU collision within same store | Rejected; no orphan rows |
| CMD-09 | P0 | Force SQL error mid-write | All domain changes and receipt roll back |

## D — Sales, arithmetic & concurrency

| ID | Priority | Test | Expected result |
|---|---|---|---|
| SALE-01 | P0 | Sell 3 items @ ₦3,500 with stock 20 | Total 1,050,000 kobo, balance 17 |
| SALE-02 | P0 | Confirm accepted sale | Sale, item snapshot, -3 movement, one receipt/change set |
| SALE-03 | P0 | Change product price later | Original item snapshot remains ₦3,500 |
| SALE-04 | P0 | Client tampers with total | Server recomputes/rejects, never trusts value |
| SALE-05 | P0 | Price changed before commit | Terminal `price_changed` conflict |
| SALE-06 | P0 | Two distinct sale commands each sell final unit concurrently | At most one accepted, no negative stock |
| SALE-07 | P0 | Retry sale command after simulated lost response | Same persisted result, no second deduction |
| SALE-08 | P0 | Different command ID but same checkout request | No second sale |
| SALE-09 | P0 | One product belongs to other store | Rejected, no partial sale |
| SALE-10 | P0 | Unsupported currency/zero/fraction/overflow quantity | Rejected before writes |
| SALE-11 | P0 | Error after sale insert, before receipt | All partial writes rolled back |
| SALE-12 | P0 | Terminal insufficient stock rejected; retry same command | Same stored conflict, no later automatic re-evaluation |

## E — Change log / bootstrap / authorization

| ID | Priority | Test | Expected result |
|---|---|---|---|
| FEED-01 | P0 | Multi-row command generates revision with ordinals | All changes appear ordered |
| FEED-02 | P0 | Pull limit 1 across multi-row revision | No lost record on next cursor |
| FEED-03 | P0 | Concurrent commits with clock row lock | Revisions observable in commit order |
| FEED-04 | P0 | Bootstrap while product changes concurrently | Snapshot+revision yield no lost update when pulled |
| FEED-05 | P0 | Nonmember requests bootstrap or pull | Denied |
| FEED-06 | P1 | Oversized/invalid cursor, invalid limit | Validation error |
| FEED-07 | P0 | Retry same command | No duplicate change-log entries |

## F — M2 regression / physical-device tests

| ID | Priority | Test | Expected result |
|---|---|---|---|
| REG-01 | P0 | Original offline create/edit product | Still works disconnected |
| REG-02 | P0 | M2 offline stock-in + sale + adjustment | Balances and sale preserved through force-stop |
| REG-03 | P0 | Existing outbox count/IDs/sequences after M3 | Unchanged unless explicit local action adds new commands |
| REG-04 | P0 | New cloud sign-in | No automatic upload of local pending commands |
| REG-05 | P0 | Signout/switch accounts | Alice's local records not shown to Bob and not deleted |
| REG-06 | P1 | Physical Android connects to staging over HTTPS | Auth/store onboarding works; localhost not assumed reachable |

## How to run

Examples (adapt to actual scripts):

```powershell
npx supabase start
npx supabase db reset       # ONLY local disposable database
npx supabase test db
npm run lint
npm run typecheck
npm test -- --runInBand
npx expo install --check
```

Add a repeatable integration test command that creates Alice/Bob/Charlie test identities and authenticated clients. Verify cross-store API access under each actual JWT. Concurrency tests need **two distinct DB connections / request processes**, not `Promise.all` over a single synchronous fake; use a barrier that overlaps transactions.

## CI gate

- Existing React Native quality checks green.
- Separate Supabase CLI local stack + database migration/pgTAP job green in a Docker-compatible CI runner.
- Authenticated integration, replay and race tests actually executed.
- No credentials in repo or logs.
- On-device verification documented explicitly (pass/fail/not run).
- Independent read-only security review has no unresolved P0/P1 issues.

Remember: successful M3 does NOT mean M2 offline commands have been cloud-synchronized.
