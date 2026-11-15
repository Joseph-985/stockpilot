import type { SQLiteDatabase } from 'expo-sqlite';

export type DatabaseMigration = {
  version: number;
  name: string;
  up: (database: SQLiteDatabase) => Promise<void>;
};

export function getPendingMigrations(
  currentVersion: number,
  migrations: readonly DatabaseMigration[],
): DatabaseMigration[] {
  const orderedMigrations = [...migrations].sort((left, right) => left.version - right.version);
  const versions = new Set<number>();

  for (const migration of orderedMigrations) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(`Invalid database migration version: ${migration.version}`);
    }
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate database migration version: ${migration.version}`);
    }
    versions.add(migration.version);
  }

  orderedMigrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Missing database migration version: ${index + 1}`);
    }
  });

  return orderedMigrations.filter((migration) => migration.version > currentVersion);
}
