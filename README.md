# StockPilot

StockPilot is an Android-first, iOS-compatible inventory and sales app for small retailers. It is designed to keep core records available when mobile data is unreliable. The current M0 build is a navigation and design-system foundation; product, inventory, sales, authentication, and synchronization behavior are not implemented yet.

## Requirements

- Node.js 22.13 or newer
- npm
- Android Studio emulator or an Android device with Expo Go compatible with SDK 57

## Install and run

```bash
npm ci
npx expo start
```

To open on Android, start an Android emulator before running the command and press `a` in the Expo terminal. For a physical device, install the SDK 57-compatible Expo Go app, connect the phone and computer to the same network, scan the QR code, and allow local network access. If a future native dependency is not included in Expo Go, use a development build instead.

## Verification

```bash
npm run lint
npm run typecheck
npm run format:check
npm test
npx expo-doctor
```

## Project structure

- `src/app/` contains Expo Router routes and layouts.
- `src/features/` contains feature-owned presentation, application, and domain code when a feature is implemented.
- `src/shared/ui/` contains reusable accessible components.
- `src/shared/domain/` contains pure shared domain rules.
- `src/shared/infrastructure/db/` contains SQLite initialization and ordered migrations.

On Android and iOS, the SQLite database opens during app initialization, enables WAL and foreign keys, and reads the migration version. The M0 migration registry is intentionally empty: domain tables are added with M1 as additive, versioned migrations. Do not use destructive migrations to discard local records. Web currently renders the shell without opening SQLite; Expo SQLite web support remains experimental and needs separate headers/WASM setup before enabling persistence there.

See [the architecture](docs/ARCHITECTURE.md), [product requirements](docs/PRODUCT_REQUIREMENTS.md), [roadmap](docs/ROADMAP.md), and [ADR-005](docs/decisions/ADR-005-expo-sdk-nativewind.md).
