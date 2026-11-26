# StockPilot M3 — Proposed Architecture Decision Records

Codex should create actual ADRs in `docs/decisions/` reflecting **implemented and tested** decisions. Document context, alternatives, pros/cons, chosen approach and operational limits.

## ADR-M3-001 — Supabase vs separate API server

**Decision:** Supabase Auth + PostgreSQL + Edge Function facade + SQL transactional commands. **Why:** minimal infrastructure, easy local database test setup, RLS, atomic DB business commits. **Trade-off:** SQL/PLpgSQL code becomes critical and must be security reviewed. **Alternative:** Node/NestJS + explicit pooled Postgres transaction; valuable at larger scale but overkill for a portfolio MVP.

## ADR-M3-002 — Publishable client key and user-scoped auth

**Decision:** mobile uses `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, a user JWT, and validated session storage. **Why:** app bundles are inspectable; privileged keys bypass RLS. **Trade-off:** storage and offline token expiry require explicit handling. **Alternative:** own auth service, unnecessary at MVP.

## ADR-M3-003 — Current database membership is authoritative

**Decision:** check `store_members` with `active` status inside each privileged DB command. **Why:** prevents revoked staff from writing with a still-valid JWT. **Trade-off:** extra DB checks; indexes and optimized helper needed. **Rejected:** client-selected role, cached JWT role without revocation handling.

## ADR-M3-004 — Direct database mutation prohibition

**Decision:** data API exposes constrained reads with RLS, while all financial and inventory mutations use authenticated transaction RPCs. **Why:** preserve invariants and audit trail. **Trade-off:** more backend code, but safer than multiple REST writes.

## ADR-M3-005 — Atomic idempotency receipts

**Decision:** unique `(store_id,command_id)` receipt and canonical server request hash, transactionally stored with accepted business writes or terminal conflicts. **Why:** safe retransmission after unknown network outcome. **Trade-off:** retained receipts and explicit handling of changed payloads. **Clarification:** delivery is at least once; BUSINESS EFFECT is deduplicated.

## ADR-M3-006 — Immutable sale history + row-locked stock

**Decision:** complete sale transaction with stable snapshots, sorted product stock locks, enforced stock >=0, recalculated integer-kobo totals. **Why:** prevent partial sales and concurrent oversell. **Trade-off:** low-contention system intentionally prioritizes correctness over maximum write throughput.

## ADR-M3-007 — Commit-ordered per-store revisions

**Decision:** per-store `sync_clock` row lock held until commit; `(revision,ordinal)` cursor. **Why:** prevents out-of-order commit gaps and pagination skips. **Rejected:** `BIGSERIAL` alone as high-water mark. **Trade-off:** serializes commits per store; appropriate for small-retailer workload.

## ADR-M3-008 — Preserve separate local demo and cloud identity

**Decision:** do not automatically link or upload M1/M2 demo store; explicit owner-authorized import/onboarding decision deferred to M4. **Why:** avoid wrong-account data leakage, duplicate inventory and accidental sales import. **Trade-off:** cloud account demo not populated from previous offline data until M4. **Caveat:** session and local database protection need tested account-switch behavior.

## ADR-M3-009 — Authentication-only scope for mobile in M3

**Decision:** Expo implements sign-in and store management, while the command API is exercised by integration tests/CLI fixtures. **Why:** isolates backend security/transaction failures from sync engine complexity. **Trade-off:** initial cloud signup may show empty remote store in M3, and this must be clearly communicated.
