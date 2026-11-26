# M2 Android airplane-mode and force-stop runbook

This is a reproducible manual procedure, not evidence that it has already passed. Record the build commit, build variant, device/emulator model, Android version, date, and each observed result. Do not mark the native scenario passed based only on Jest or Node SQLite.

## Prepare

1. Install dependencies with `npm ci` and build/install a standalone release variant using `npx expo run:android --variant release` (Android SDK required).
2. Launch StockPilot once so the local SQLite database initializes. Record the device/build details above.
3. In Products, create `TEE-001`, `Basic Cotton Top`, price `3500.00`, threshold `3` if it does not exist.
4. Enable Android airplane mode and verify both Wi-Fi and mobile data are off.

## Offline scenario

1. In Inventory, record stock-in of `20` with note `Opening stock`. Verify estimated availability is 20 and the operation is pending.
2. In Sales, sell `3` units for cash with no customer name. Verify the saved local total is NGN 10,500.00, the sale is marked pending/provisional, and estimated availability is 17.
3. Record adjustment `-1` with reason `Damaged item`. Verify availability is 16.
4. Verify movement history contains `+20`, `-3`, and `-1`; the `-3` movement links to the saved sale. Verify sale detail stores the original product name, SKU, unit price NGN 3,500.00, and total NGN 10,500.00.
5. Force-stop through Android Settings (or `adb shell am force-stop com.stockpilot.mobile`), keep airplane mode enabled, and relaunch from the app icon. Verify the same product, estimate, pending history, sale details, and snapshots remain.
6. Change the product price to NGN 4,000.00. Verify the existing sale detail still shows NGN 3,500.00 and NGN 10,500.00.
7. Attempt to sell 17 units when estimated availability is 16. Verify checkout explains insufficient stock, preserves the cart for correction, and creates no sale or movement.
8. Re-enable connectivity. M2 has no sync transport: verify records remain pending. Do not interpret network availability as confirmation.

## Record results

For every step write **Pass**, **Fail**, or **Not run**, with a brief observation. Attach device screenshots/logs if available. A development build requiring Metro is not a substitute for step 5 with the app process stopped and the device offline. Node file-backed SQLite tests validate SQL and rollback behavior in their runtime but do not validate Expo's native bridge, Android storage lifecycle, or this manual scenario.
