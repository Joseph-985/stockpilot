import type { DatabaseMigration } from './types';

/** Add-only, monotonically versioned SQLite migrations are introduced with M1 features. */
export const migrations: readonly DatabaseMigration[] = [];
