# StockPilot

StockPilot is an Android-first, iOS-compatible offline inventory and sales app for small retailers. M2 provides a local product catalog, inventory ledger, provisional sales, and a SQLite outbox. There is no sign-in, backend, network synchronization, or payment processing.

## Requirements and setup

- Node.js 22.13 or newer and npm
- Android Studio/Android SDK for local Android builds, or an Android device

```bash
npm ci
npx expo start
```

For a connected emulator press `a` in the Expo terminal. A physical device can scan the development QR code on the same network. Use a standalone Android build for force-stop testing when Metro is unavailable:

```bash
npx expo run:android --variant release
```

Expo generates native projects through Continuous Native Generation. Do not edit generated `android/` or `ios/` directories by hand. The configured Android application ID is `com.stockpilot.mobile`.

## M2 local demo

1. In **Products**, create a fictional product (for example SKU `TEE-001`, name `Basic Cotton Top`, price `3500.00`, threshold `3`). Product create/edit/archive commands remain in the same ordered outbox as M1.
2. In **Inventory**, open the product, record stock-in, adjust stock with a reason, and inspect its movement history. Availability is an estimate on this device.
3. In **Sales**, choose products, adjust quantities, review the integer-kobo total and optional customer name, select the cash/transfer/other payment label, then save. A success message appears only after the local SQLite transaction commits.
4. Open **Sales** history and a sale detail to review pending status and the saved name/SKU/price snapshots. The Dashboard shows today's local provisional total and low-stock summary.
5. Follow [the Android airplane-mode and force-stop runbook](docs/testing/M2_ANDROID_RUNBOOK.md). Device execution has not been recorded by this repository yet.

All M2 sales and inventory changes are local and provisional. `Pending sync` means queued on this device; it does not mean backed up. Data may be lost if app storage is wiped or the app is uninstalled before future synchronization. Two disconnected devices can disagree about stock. Payment method is a label and does not process or confirm payment. M2 has no conflict resolution, refunds, receipts, or server validation.

## Routes and architecture

- `app/(tabs)/index.tsx`: Dashboard, local daily sales totals and low-stock summary.
- `app/(tabs)/products.tsx`, `app/products/new.tsx`, `app/products/[id]/edit.tsx`: product catalog and edits.
- `app/(tabs)/inventory.tsx`, `app/inventory/[productId].tsx`, `app/inventory/stock-in.tsx`, `app/inventory/adjust.tsx`: estimated balances, stock mutations, movement history, and links from sale movements to sale details.
- `app/(tabs)/sales.tsx`, `app/sale/new.tsx`, `app/sale/[id].tsx`: product picker/cart/checkout, local sales list, and immutable snapshot detail.
- `src/features/{products,inventory,sales}/`: feature contracts, use cases, repositories, and presentation. SQLite is the read source for committed records; the active cart is ephemeral component state.
- `src/shared/infrastructure/db/`: Expo SQLite initialization, serialized repository writes, and additive migrations. M1 product commands remain ordered; a sale emits one `sale.create` command with snapshot lines, not per-line `inventory.adjust` commands.

Implementation decisions adapted from [M2 decisions](docs/M2_DECISIONS.md): immutable stock movements plus a cached `base_quantity + pending_delta` estimate; one command per sale; integer-kobo snapshots and re-review after a price change; serialized local writes and local stock rejection; stable checkout request IDs for retry idempotency; preserving outbox migration. Migration 6 adds database triggers that prevent edits/deletes of sale item and movement history and protects sale snapshots while allowing only forward pending-status transitions reserved for later sync.

## Scripts and verification

Available `package.json` scripts:

```bash
npm run lint
npm run typecheck
npm run format:check
npm test
npx expo install --check
```

Expo SDK is 57 (`expo ~57.0.0`); use its versioned documentation when changing Expo APIs. M2 integration tests use real file-backed SQLite through Node's `node:sqlite`; they do not exercise Expo's native SQLite bridge. See the Android runbook for device verification steps and the [M2 test matrix](docs/M2_TEST_MATRIX.md) for coverage expectations.

## M3 handoff

M3 should add the authoritative PostgreSQL/Supabase schema and secure command executor without changing M2's local command intent or snapshots. The server must authorize store membership, validate active products/prices and stock atomically, and deduplicate the stable command ID. M4 must reconcile acknowledged local movements against the authoritative stock baseline without counting a movement twice. No server or sync path exists in this M2 implementation.

See [Architecture](docs/ARCHITECTURE.md), [Product requirements](docs/PRODUCT_REQUIREMENTS.md), [M2 implementation specification](docs/M2_IMPLEMENTATION_SPEC.md), [M2 data contracts](docs/M2_DATA_CONTRACTS.md), and [M2 test matrix](docs/M2_TEST_MATRIX.md). Foundation decisions: [ADR-001](docs/decisions/ADR-001-sqlite-local-first.md), [ADR-002](docs/decisions/ADR-002-atomic-product-outbox.md), [ADR-005](docs/decisions/ADR-005-expo-sdk-nativewind.md), and [ADR-M2](docs/decisions/ADR-M2-local-sales-inventory.md).
