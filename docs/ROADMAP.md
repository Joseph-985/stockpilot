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

| Risk | Mitigation |
|---|---|
| Two devices oversell | Provisional local records; server checks under lock; conflict UI |
| Duplicate sales on retry | Unique command ID, idempotency receipts and transactional executor |
| Data loss on app termination | Local domain + outbox atomic transaction; persistence tests |
| Cursor skips server updates | Commit-ordered per-store revision + transactional snapshot/pull |
| Device lost before sync | Visible pending indicator; users informed local data is not remotely backed up |
| Platform background constraints | Foreground/resume/manual sync primary; background optional |
| Auth/permission changes while offline | Server authorization always rechecked when reconnecting |
| Library version conflicts | Version pinning, `expo install`, physical-device smoke tests |
| Bloated Codex changes | Small task scopes, reviewer gates, required tests and diffs |

## GitHub Definition of Done for each feature

- Feature works with network disabled where required
- Feature has persistent and valid domain state after restart
- Errors and conflicts have visible UI states
- Business rules tested; migrations and access control considered
- Lint/type-check/tests pass; no bypasses or unchecked casts
- README/ADR updated when behavior or architecture changed
- Focused commit/PR, no unrelated refactors
