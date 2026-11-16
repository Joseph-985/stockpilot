# StockPilot

StockPilot is an Android-first, iOS-compatible inventory and sales application for small retailers. M1 delivers a local-only product catalog backed by SQLite. There is no sign-in, cloud tenant, network synchronization, inventory quantity, or sales behavior yet.

## Requirements and setup

- Node.js 22.13 or newer
- npm
- Android Studio and Android SDK for local Android builds, or an Android device

Install and start the app:

```bash
npm ci
npx expo start
```

For a connected Android emulator, press `a` in the Expo terminal. A physical Android device can scan the development QR code while the phone and computer are on the same network. Expo Go is useful for interactive development; use a standalone Android build for force-stop/relaunch testing because the development server is not available after disconnecting the device.

For a standalone local Android release build (requires the Android SDK):

```bash
npx expo run:android --variant release
```

Expo generates the native Android project through Continuous Native Generation. Do not hand-edit generated `android/` or `ios/` files. The configured Android application ID is `com.stockpilot.mobile`.

## Verification

```bash
npm run lint
npm run typecheck
npm run format:check
npm test
npx expo install --check
npx expo-doctor
```

## M1 scope and architecture

- `app/` contains Expo Router routes and navigation; `src/features/products/` owns product presentation, application use cases, and domain contracts.
- `src/shared/ui/` contains reusable accessible controls; `src/shared/domain/` contains pure money helpers.
- `src/shared/infrastructure/db/` initializes SQLite and applies additive migrations tracked by `PRAGMA user_version`.
- SQLite is the product list's read source. The UI does not keep an independently authoritative product cache.
- `local_store_identity` stores one durable `local_demo` UUID. It is not authenticated and must not be treated as a cloud tenant or automatically uploaded.
- Product create, update, and archive each write the product row and one immutable outbox command in a single SQLite transaction. Archived rows stay in the database and are excluded from normal product queries.
- Prices are stored as integer kobo. Pending means queued locally; M1 does not send or synchronize commands.
- Migrations 1 and 2 create the catalog/outbox and add Unicode-normalized local search fields. Migration 2 backfills existing rows without replacing product records.

See [Architecture](docs/ARCHITECTURE.md), [Product requirements](docs/PRODUCT_REQUIREMENTS.md), [M1 implementation specification](docs/M1_IMPLEMENTATION_SPEC.md), and the [M1 test matrix](docs/M1_TEST_MATRIX.md). Decisions: [ADR-001](docs/decisions/ADR-001-sqlite-local-first.md), [ADR-002](docs/decisions/ADR-002-atomic-product-outbox.md), and [ADR-005](docs/decisions/ADR-005-expo-sdk-nativewind.md).

## Manual Android airplane-mode test

Use a standalone release build so the app can relaunch without Metro or internet. The app has no online sign-in or sync path in M1.

1. Build and install on an Android emulator or physical device with `npx expo run:android --variant release`. Record the build commit, device/emulator model, and Android version before testing.
2. Open StockPilot once and wait for the local database to initialize. Turn on airplane mode and confirm Wi-Fi and mobile data are off.
3. Open **Products**, tap **Add product**, and enter SKU `TEE-001`, name `Basic Cotton Top`, selling price `3500.00`, and threshold `3`. Save. Confirm the row shows `NGN 3,500.00` and `Pending sync`.
4. Search for `tee-001`, clear the search, then search for `Cotton`. Confirm each query finds the product. Try an existing SKU with different letter case and confirm the form shows a validation error without adding a second product.
5. Edit the product price to `3800.00`. Save and confirm the list shows `NGN 3,800.00` and `Pending sync`.
6. Leave airplane mode on. In Android Settings, force-stop StockPilot, then relaunch it from the app icon. Confirm the product, edited price, and pending badge remain.
7. Tap **Archive**, cancel once and verify the product remains. Tap **Archive** again and confirm. Verify it disappears from the normal list and search results.
8. The automated file-backed SQLite test closes and reopens the same database file and verifies the demo-store ID, product row (including archived state), ordered outbox rows, and original command IDs. Use that as the M1 outbox inspection harness; no diagnostic screen is shipped.
9. Re-enable connectivity. Confirm the product remains pending. M1 has no sync transport, so no command should be sent or marked synced.

Record each step as pass/fail and include any device-specific notes. Do not report Android/device acceptance as passed until this procedure has actually run on an Android device or emulator. Node's file-backed SQLite tests prove persistence and transaction behavior in the test runtime, but do not exercise Expo's native SQLite bridge.

## M2 handoff

M2 may add quantity, stock movements, inventory rules, and sale entities with their own domain contracts, migrations, and atomic outbox commands. Keep product records and their queued commands intact. Do not coalesce or rewrite M1 command payloads while adding later command types; preserve dependency order and keep the `local_demo` identity distinct until an explicit authenticated-store adoption flow is designed.
