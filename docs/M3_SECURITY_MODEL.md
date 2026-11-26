# M3 Security Model — Auth, Tenancy, Permissions and Local Data

## 1. Threat model and trust boundaries

**Untrusted:** mobile UI, React navigation guards, JSON payload, actor ID, store ID, device clock, price/total, local SQLite content, `EXPO_PUBLIC_` vars, and even a valid signed-in user attempting a different store ID.

**Trust only after verification:** authenticated Supabase JWT (server verifies identity), database's live `store_members` lookup, PostgreSQL constraints, and transaction-time product/stock reads. Role claims embedded in potentially stale tokens do NOT substitute for fresh membership checks when a command is committed.

Top risks: horizontal privilege escalation (Store B data accessed by Store A user), owner-only mutations by staff, replay of sale, payload-swapped replay, overselling, client total tampering, data leakage on account switch, leaked server secrets, and excessive privilege in SECURITY DEFINER routines.

## 2. Permission matrix

| Operation | Anonymous | Auth/no membership | Owner | Staff |
|---|---|---|---|---|
| Create store and own membership | No | Yes (self only, controlled RPC) | Yes for new store | Yes for new store if business policy allows |
| Read own store/products/balances/sales | No | No | Yes | Yes |
| Product create/edit/archive | No | No | Yes | No |
| Stock in / adjustment | No | No | Yes | No |
| Sale create | No | No | Yes | Yes |
| Invite/remove members | No | No | Yes | No |
| Read Store B without active membership | No | No | No | No |
| Direct update to balances, sales, receipts, clock | No | No | No | No |

An 'owner' or 'staff' can create their **own** new store only through a separate authenticated onboarding RPC; privileges in one store do not confer rights in any other store. For M3 it's acceptable to defer full invitations and use owner-created membership in fixtures, while leaving a safe, well-tested authorization contract.

## 3. RLS and SQL privileges

- Enable RLS for `public` tenant-owned read tables. Design explicit `SELECT` policies using an active membership check, not only `auth.uid() IS NOT NULL`.
- Privileges (`GRANT`/`REVOKE`) precede RLS policies. Revoke unnecessary `anon` and `authenticated` DML; no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` for server-owned financial tables.
- Keep command receipts, revision clock and change log in an unexposed `private` schema where practical; write a narrowly scoped authenticated RPC for reads needed by M4.
- Build a `private.is_active_member(store_uuid, user_uuid)` helper with fixed `search_path=''` and minimum privileges; carefully avoid RLS policy recursion in membership checks. Where `SECURITY DEFINER` is used, explicitly revoke default EXECUTE from PUBLIC/anon and grant only intentional callers.
- For any exposed RPC such as `public.process_command(jsonb)`: explicitly `REVOKE EXECUTE ... FROM PUBLIC, anon` and `GRANT EXECUTE ... TO authenticated` *only if* it validates `auth.uid()` and active role internally. Prefer keeping internal mutation helpers entirely in the `private` schema and exposing one small controlled facade.
- Always schema-qualify relation/function names inside `SECURITY DEFINER` code; use `SET search_path = ''`, avoid dynamic SQL and arbitrary function/SQL-name input. Do not take actor ID or role from payload.
- Store creation + owner membership insertion must be one authorized transaction. Do not allow clients to insert memberships directly or join by guessed UUID.
- Staff policies and SQL function checks must agree; UI restrictions are convenience only.
- Test cross-store accesses not only on SELECT but RPC and any error details (avoid enumerating other stores' products or SKUs).

Official docs: https://supabase.com/docs/guides/database/postgres/row-level-security and https://supabase.com/docs/guides/database/functions

## 4. API and Edge authentication

- Use user JWT authorization, `supabase.functions.invoke` and `withSupabase({auth:'user'})` / equivalent SDK-verifiable user context for Edge Function.
- Leave `verify_jwt=true` for authenticated user endpoints unless current verified SDK docs demand another secure arrangement. No `--no-verify-jwt` workaround for general app endpoints.
- Use the caller-scoped Supabase client for unprivileged reads/calls. If a privileged client is used anywhere, centralize it, keep secrets server-side, and ensure the *database transaction function* independently checks the verified actor.
- Enforce Zod or equivalent schema validation for maximum batch size, supported protocol version, allowed fields, UUIDs, price bounds, text size, and untrusted metadata.
- Do not print JWTs, API secret keys, full customer data or auth payloads in logs. Use correlation/request IDs and redacted error classes.
- Return controlled `unauthorized` and `forbidden` without leaking cross-tenant state.

## 5. API keys and local session storage

- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only in shipped bundle.
- Never ship `sb_secret_...` key or legacy `service_role`; don't commit credentials to Git; use environment management on the server.
- Examine Supabase's current Expo React Native storage documentation (AsyncStorage or SecureStore/encrypted adapter). Use a tested adapter compatible with the exact installed Expo SDK and token length. `expo-secure-store` has practical storage/backup/reinstall semantics; document limitations rather than promising perfect secure storage.
- Persist only what is necessary to restore a session. Subscribe/unsubscribe to auth state events correctly; refresh on foreground as recommended by the current client SDK.
- Session persistence does not authorize offline mutation on remote store without server verification; offline local demo is a separate mode.

## 6. Offline data separation / sign-out

The local M1/M2 demo store has a preexisting local UUID and pending commands. It does not become the new cloud store automatically.

Required behavior:
1. Preserve all local SQLite rows/outbox on signup, login and signout.
2. Never show Alice's local private data to Bob after account switch. Scope local data to a distinct identity namespace or block switching with an explicit safe-state message until a migration/partition policy is implemented. Retain unsynced data for Alice.
3. Disable any automatic cloud import; future M4 will explicitly choose 'create new cloud store' vs 'import local demo store' with confirmation, ownership checking and duplicate safety.
4. When session cannot refresh offline, show an honest unverified state; don't falsely report account revocation or cloud sync success.
5. Inform user that offline unsynced data is not cloud backed up and may be lost on device wipe.

## 7. Test matrix for authorization

- Anonymous cannot read any store/tenant tables or call privileged endpoints.
- Authenticated user with no membership cannot view store or submit commands.
- Owner A cannot access any Store B data, including via guessed sale ID or command replay.
- Staff can submit sale, cannot mutate products, inventory, roles or receipts.
- Revoked member cannot submit commands, even using a valid unexpired token; membership is checked at execution.
- Client-supplied `actor_id`, `role`, and `store_id` never override verified membership.
- `SECURITY DEFINER` functions have safe `search_path` and no broad/implicit EXECUTE grants.
- Direct REST mutations blocked; no secret in JS bundle, .env template, logs, test snapshots, or committed files.
- Signed-out local data remains inaccessible to another account while still physically preserved for correct owner.
