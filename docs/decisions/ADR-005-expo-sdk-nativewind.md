# ADR-005: Expo SDK and styling foundation

- **Status:** Accepted
- **Date:** 2026-11-15

## Decision

Target Expo SDK 57 with its compatible React Native, React, Expo Router, and native module versions. Use NativeWind 4.2.7 with Tailwind CSS 3 for shared cross-platform styling. Keep the initial interface light themed.

## Rationale

The SDK 57 package set is verified against the versioned Expo documentation. NativeWind 4.2.7 documents SDK 57 support while retaining its Tailwind 3, Babel preset, and Metro integration. Pin NativeWind to avoid an unreviewed major or configuration change. Expo-managed packages are installed through `expo install` so their versions follow the selected SDK.

## Consequences

- SDK and native module updates must be checked against Expo SDK 57 documentation and `expo-doctor`.
- Metro uses NativeWind's wrapper and imports one global CSS file from the root route layout.
- Native styling must be verified on Android and iOS; web output alone is insufficient.
- Reevaluate this decision before upgrading Expo or adopting NativeWind 5 / Tailwind 4.
