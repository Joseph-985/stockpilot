import type { SQLiteConnection } from './SQLiteConnection';

const operationTails = new WeakMap<SQLiteConnection, Promise<void>>();

/** Serializes all repository queries sharing one Expo SQLite connection. */
export function withDatabaseOperation<T>(
  database: SQLiteConnection,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = operationTails.get(database) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  operationTails.set(
    database,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}
