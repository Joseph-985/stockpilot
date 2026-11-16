# M1 Test Matrix & Exit Gate

## Domain unit tests

- Valid name/SKU and `₦3500.50` parse to 350050 minor units (without floating-point error).
- Reject blank/whitespace-only name, blank SKU, duplicate active SKU case-insensitively, negative/zero price, malformed decimals, 3+ decimal places, NaN/Infinity/exponent and unsafe integer overflow.
- Optional cost is nullable; threshold is integer >=0; zero cost allowed.
- Validate string/number conversions with representative Nigerian Naira inputs and large values.

## SQLite integration tests

- Fresh database migration succeeds and rerun is no-op.
- Upgrade from an existing M0 DB preserves its existing tables/data.
- Failed migration does not silently advance schema version.
- Create writes product AND one outbox command.
- Inject failure into outbox insert: product insert rolls back.
- Update preserves product ID, increments local_revision, leaves server_version unchanged, enqueues immutable update payload.
- Archive sets deleted_at, hides product by default, retains row and appends delete command.
- Two successive offline edits append ordered commands with unique IDs, and an unsynced creation remains first.
- Concurrent creation of duplicate store/SKU yields one success and one validated failure without an orphaned product/command.
- Store A cannot list/store B's products when passing store A ID.
- Try SQL injection text as name and SKU; no code execution or data corruption.
- Closing and reopening the **same physical local DB file** preserves products and outbox; mocked DB memory persistence is insufficient evidence.
- Verify PRAGMA foreign_keys and transaction approach on target Android build. If using exclusive transactions, assess the separate-connection settings risk explicitly.

## UI and manual Android acceptance

1. Install the M1 app; create one fictional demo store if missing.
2. Switch to airplane mode (disable Wi-Fi and mobile data).
3. Open Products and add SKU `TEE-001`, name `Basic Cotton Top`, price `₦3,500.00`.
4. See it in list with `Pending sync`; search by `tee-001` and `Cotton`.
5. Edit price to `₦3,800.00`, save and verify updated value.
6. Force-stop app via Android settings or system UI; reopen **still in airplane mode**.
7. Confirm SKU, edited price, and pending badge persist.
8. Inspect outbox via an internal development-only diagnostic view/log or test harness; confirm stable create/update command IDs and correct sequence. Do not display secrets.
9. Archive product after confirmation; verify absent from normal list, but present in database with `deleted_at` and an archive command.
10. Re-enable internet: **do not** expect automatic sync yet. Status correctly stays pending until M4.

## M1 definition of done

- [ ] M0 still boots and all existing checks pass.
- [ ] M1 features operate without network calls.
- [ ] App closes/restarts without losing data or outbox entries.
- [ ] Product + command atomic rollback proven in SQLite integration test.
- [ ] DB migrations are safe, versioned, and repeatable.
- [ ] Product list/search/edit/archive have accessible loading/error/empty states.
- [ ] Outbox command IDs stable, unique, persisted and ordered.
- [ ] No inventory/sales/backend implementation was accidentally introduced.
- [ ] Tests and manual verification documented honestly.
- [ ] M1 committed on a feature branch; CI checks green.
