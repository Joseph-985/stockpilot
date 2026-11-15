import { getPendingMigrations, type DatabaseMigration } from './types';

const migration = (version: number): DatabaseMigration => ({
  version,
  name: `migration-${version}`,
  up: async () => undefined,
});

describe('getPendingMigrations', () => {
  it('returns migrations after the current version in ascending order', () => {
    expect(getPendingMigrations(1, [migration(3), migration(1), migration(2)])).toEqual([
      expect.objectContaining({ version: 2 }),
      expect.objectContaining({ version: 3 }),
    ]);
  });

  it('rejects duplicate migration versions', () => {
    expect(() => getPendingMigrations(0, [migration(1), migration(1)])).toThrow(
      'Duplicate database migration version: 1',
    );
  });

  it('rejects gaps in the migration history', () => {
    expect(() => getPendingMigrations(0, [migration(1), migration(3)])).toThrow(
      'Missing database migration version: 2',
    );
  });
});
