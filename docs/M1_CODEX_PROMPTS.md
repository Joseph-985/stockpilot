# Codex Prompts — M1 (run sequentially)

**Important:** Paste **one task at a time**. Use Codex from your StockPilot repository root. After each task, review the diff and run available checks. Never assume files have the exact expected paths from the scaffold.

## Prompt 1 — Audit M0 and plan M1 (read-only)

```text
Read AGENTS.md, docs/PRODUCT_REQUIREMENTS.md, docs/ARCHITECTURE.md, docs/ROADMAP.md, docs/M1_IMPLEMENTATION_SPEC.md and the current code. Do not edit anything.

Inspect the actual Expo SDK version, SQLiteProvider setup, migrations, route structure, test configuration, and database transaction facilities. Compare the repository with the M1 spec and list existing modules to reuse.

Return:
1. Minimal file-by-file M1 plan, in four implementation slices.
2. Proposed versioned SQLite schema and migration strategy preserving M0 data.
3. Domain types, repository interface and app use cases.
4. Explicit SQLite transaction choice with assessment of exclusive-transaction FK caveat, serialization of concurrent writes, rollback testing, and database readiness.
5. How a durable, stable demo-store identity will work until M3 onboarding.
6. Risks, schema/versioning decisions and definition of done.

No Supabase or network sync, stock adjustments or sales. Do not modify files. Stop after the plan.
```

## Prompt 2 — Local schema, domain and repository

```text
Implement M1 slice A only according to docs/M1_IMPLEMENTATION_SPEC.md, after reading AGENTS.md and existing architecture documents.

- Extend existing M0 SQLite database and migration runner without deleting data. WAL/FK setup and migration versioning must be correct and tested.
- Introduce durable local demo-store identity, clearly not an authenticated cloud tenant.
- Define pure TypeScript product types, Zod validation, NGN string-to-kobo parsing and formatting, UUIDv4 generator using SDK-compatible expo-crypto where needed, and a ProductRepository contract.
- Implement local_products and outbox_commands schema/indexes consistent with M1 and future M2 commands.
- Implement SQLiteProductRepository create, update, archive, getById, list/search. Every mutation must change product and append unique stable outbox command atomically in one SQLite transaction.
- Preserve original server_version; use local_revision for local changes and stable ordered commands. Scope product queries by store_id and exclude soft-deleted products by default.
- Test active SKU uniqueness (case-insensitive), price validation, migration rerun, rollback on outbox failure, multiple queued edits, and overlapping write attempts.

Do not implement UI screens, Supabase, sales, sync transport, or product stock quantities.
Run lint, typecheck, and relevant tests; report actual outcomes and manual verification needed. Stop after slice A.
```

## Prompt 3 — Product screens and local data refresh

```text
Implement M1 slice B only. Read AGENTS.md and docs/M1_IMPLEMENTATION_SPEC.md and inspect slice A code before editing.

Build Products tab list (local SQLite, search by name/SKU, NGN price formatting, pending badge, empty/error/loading states), Add Product form and Edit Product form, with archive confirmation. Reuse the existing M0 design system components, Expo Router routes, NativeWind setup, and ProductRepository/use cases. Implement accessible input labels, keyboard behavior, validation messages and duplicate-submit prevention.

Data must remain available with airplane mode enabled. Refresh from SQLite after mutation and on screen focus (or a properly tested change-notification approach); no authoritative duplicate product cache in Zustand/TanStack Query. Archived products must be hidden by default but remain in SQLite.

Add component tests for form errors and list states. Run checks, report files and results. No Supabase, sales, remote synchronization or unrelated refactors. Stop after slice B.
```

## Prompt 4 — Hardening, Android verification and review

```text
Audit and harden all M1 changes against docs/M1_TEST_MATRIX.md. Add missing focused tests, especially true SQLite atomic rollback and native persistence (not only mocked repositories). Include a reproducible manual airplane-mode/force-stop test plan for Android. Review parameterized SQL, migration safety, unique active SKU, stable command identity, outbox order, offline edit/archive, and local store isolation. Fix identified bugs only within M1 scope.

Run the installed project's real lint, typecheck, formatting and test commands, and `npx expo install --check` when appropriate. Do not claim Android tests passed unless actually executed on a device or emulator.

Update README with M1 instructions, create ADR-001 SQLite-local-first and ADR-002 product mutation + outbox, and summarize the tested limitations and M2 handoff. Stop after M1.
```

## Reviewer-only prompt

```text
Review only the M1 diff vs the M0 baseline as a skeptical senior React Native reviewer. Do not modify files. Prioritize: data loss during failure, transaction/foreign-key behavior, duplicate or missing outbox commands, migration safety, integer price parsing, stable local-store identity, concurrent edits, unsynced archive semantics, wrong store scoping, and accessibility. Report severity, file path, reproduction steps, and minimal fix; separate observed failures from unverified risks.
```
