import type { SQLiteConnection } from '../SQLiteConnection';

export type DatabaseMigration = {
  version: number;
  name: string;
  up: (database: SQLiteConnection) => Promise<void>;
};

export function getPendingMigrations(
  currentVersion: number,
  migrations: readonly DatabaseMigration[],
): DatabaseMigration[] {
  const orderedMigrations = [...migrations].sort((left, right) => left.version - right.version);
  const versions = new Set<number>();

  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error(`Invalid database schema version: ${currentVersion}`);
  }

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

  const latestVersion = orderedMigrations.at(-1)?.version ?? 0;
  if (currentVersion > latestVersion) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than the supported version ${latestVersion}.`,
    );
  }

  return orderedMigrations.filter((migration) => migration.version > currentVersion);
}
