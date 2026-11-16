# ADR-001: SQLite is the local product source of truth

- Status: Accepted for M1
- Date: 2026-11-16

## Context

StockPilot must keep product records usable without connectivity. A remote-first screen or a second authoritative in-memory product cache could make offline edits disappear or diverge from the persisted catalog. M1 has no authentication or server tenant to reconcile.

## Decision

Use Expo SQLite as the persisted product read model and mutation store. Product screens load and search through `ProductRepository`; component state is only transient presentation state. The app creates one persistent `local_demo` UUID and scopes product and outbox operations by `store_id`. That identity is local-only and is not an authenticated cloud tenant.

Use additive, ordered migrations tracked through SQLite `PRAGMA user_version`. Migration 1 creates the catalog and outbox; migration 2 adds normalized Unicode search text and backfills existing rows without replacing them. Archived products remain stored and are filtered from active queries.

## Consequences

- Product screens can list and mutate cached data without a network request.
- An Android force-stop/relaunch must retain the database file and local demo identity.
- M1 pending state means a command is durable locally, not that a server accepted it.
- A future authenticated-store adoption must explicitly map the local demo data; no automatic upload or identity reassignment is permitted.
- Expo SDK 57's asynchronous transaction API can include unrelated connection queries. Repository operations and local identity reads therefore share a per-connection serial queue. Startup migrations and initial identity creation complete before routes render.

## Verification and limits

Jest integration tests use Node's built-in SQLite engine, not a mocked repository. They cover file reopen, migration rerun/rollback, WAL and FK configuration, scoped reads/writes, SKU uniqueness, and local product search. These tests do not exercise Expo SQLite's native Android bridge; the README contains the required Android airplane-mode and force-stop procedure.
