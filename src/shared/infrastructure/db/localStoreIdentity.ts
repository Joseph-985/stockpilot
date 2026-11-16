import { randomUUID } from 'expo-crypto';

import { withDatabaseOperation } from './DatabaseOperationQueue';
import type { SQLiteConnection } from './SQLiteConnection';

type LocalStoreIdentityRow = {
  store_id: string;
  identity_kind: string;
};

export type LocalStoreIdentity = {
  storeId: string;
  kind: 'local_demo';
};

export async function ensureLocalDemoStoreIdentity(
  database: SQLiteConnection,
  createId: () => string = randomUUID,
  now: () => string = () => new Date().toISOString(),
): Promise<LocalStoreIdentity> {
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT OR IGNORE INTO local_store_identity
        (store_id, identity_kind, is_current, created_at)
       SELECT ?, 'local_demo', 1, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM local_store_identity WHERE is_current = 1
       );`,
      [createId(), now()],
    );
  });

  return getLocalDemoStoreIdentity(database);
}

export function getLocalDemoStoreIdentity(database: SQLiteConnection): Promise<LocalStoreIdentity> {
  return withDatabaseOperation(database, async () => {
    const identity = await database.getFirstAsync<LocalStoreIdentityRow>(
      `SELECT store_id, identity_kind
       FROM local_store_identity
       WHERE is_current = 1;`,
      [],
    );

    if (!identity) {
      throw new Error('Local demo-store identity could not be initialized.');
    }
    if (identity.identity_kind !== 'local_demo') {
      throw new Error('The active local store is not a demo store.');
    }

    return { storeId: identity.store_id, kind: 'local_demo' };
  });
}
