import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProductDraftSchema } from '@/features/products/domain/validation';
import { initializeDatabase } from '@/shared/infrastructure/db/initializeDatabase';
import { getLocalDemoStoreIdentity } from '@/shared/infrastructure/db/localStoreIdentity';
import { SQLiteProductRepository } from '@/shared/infrastructure/db/repositories/SQLiteProductRepository';
import { SQLiteTestDatabase } from '@/test/helpers/SQLiteTestDatabase';

jest.mock('expo-crypto', () => ({
  randomUUID: () => '20000000-0000-4000-8000-000000000001',
}));

describe('file-backed SQLite product persistence', () => {
  it('reopens the same database with identity, product edits, archive, and ordered command IDs intact', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'stockpilot-m1-persistence-'));
    const filePath = join(directory, 'stockpilot.db');
    const databaseRef: { current: SQLiteTestDatabase | null } = { current: null };
    let idSequence = 0;

    const openAndInitialize = async () => {
      const connection = new SQLiteTestDatabase(filePath);
      databaseRef.current = connection;
      await initializeDatabase(connection);
      return connection;
    };
    const makeRepository = (connection: SQLiteTestDatabase) =>
      new SQLiteProductRepository(connection, {
        createId: () => {
          idSequence += 1;
          return `40000000-0000-4000-8000-${String(idSequence).padStart(12, '0')}`;
        },
        now: () => '2026-11-16T12:00:00.000Z',
      });

    try {
      const firstDatabase = await openAndInitialize();
      const firstIdentity = await getLocalDemoStoreIdentity(firstDatabase);
      const firstRepository = makeRepository(firstDatabase);
      const draft = ProductDraftSchema.parse({
        sku: 'TEE-001',
        name: 'Basic Cotton Top',
        price: '3500.00',
        lowStockThreshold: 3,
      });
      const created = await firstRepository.create(firstIdentity.storeId, draft);
      const updated = await firstRepository.update(
        firstIdentity.storeId,
        created.id,
        ProductDraftSchema.parse({ ...draft, price: '3800.00' }),
      );
      const firstCommandIds = await readCommandIds(firstDatabase);
      firstDatabase.close();
      databaseRef.current = null;

      const secondDatabase = await openAndInitialize();
      const secondIdentity = await getLocalDemoStoreIdentity(secondDatabase);
      const secondRepository = makeRepository(secondDatabase);
      expect(secondIdentity).toEqual(firstIdentity);
      expect(await secondRepository.list(secondIdentity.storeId)).toMatchObject([
        { id: created.id, priceMinor: 380000, localRevision: 2, syncStatus: 'pending' },
      ]);
      expect(await readCommandIds(secondDatabase)).toEqual(firstCommandIds);

      await secondRepository.archive(secondIdentity.storeId, updated.id);
      const archivedCommandIds = await readCommandIds(secondDatabase);
      secondDatabase.close();
      databaseRef.current = null;

      const thirdDatabase = await openAndInitialize();
      const thirdIdentity = await getLocalDemoStoreIdentity(thirdDatabase);
      const thirdRepository = makeRepository(thirdDatabase);
      expect(thirdIdentity.storeId).toBe(firstIdentity.storeId);
      expect(await thirdRepository.list(thirdIdentity.storeId)).toEqual([]);
      expect(
        await thirdRepository.getById(thirdIdentity.storeId, created.id, { includeArchived: true }),
      ).toMatchObject({
        id: created.id,
        priceMinor: 380000,
        localRevision: 3,
        deletedAt: expect.any(String),
      });
      expect(await readCommandIds(thirdDatabase)).toEqual(archivedCommandIds);
      expect(new Set(archivedCommandIds).size).toBe(3);
    } finally {
      databaseRef.current?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

async function readCommandIds(database: SQLiteTestDatabase): Promise<string[]> {
  const rows = await database.getAllAsync<{ command_id: string }>(
    'SELECT command_id FROM outbox_commands ORDER BY local_sequence ASC;',
    [],
  );
  return rows.map(({ command_id }) => command_id);
}
