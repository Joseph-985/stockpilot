import type { DatabaseMigration } from './types';

type SequenceRow = { seq: number };

const outboxTable = `
  CREATE TABLE outbox_commands (
    local_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id TEXT NOT NULL UNIQUE,
    store_id TEXT NOT NULL,
    type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    product_id TEXT NULL,
    payload_json TEXT NOT NULL,
    expected_server_version INTEGER NULL
      CHECK (expected_server_version IS NULL OR expected_server_version >= 0),
    depends_on_command_id TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TEXT NULL,
    last_error TEXT NULL,
    created_at TEXT NOT NULL,
    CHECK (
      (type IN ('product.create', 'product.update', 'product.delete') AND product_id = entity_id)
      OR
      (type NOT IN ('product.create', 'product.update', 'product.delete') AND product_id IS NULL)
    ),
    UNIQUE (command_id, store_id),
    FOREIGN KEY (store_id) REFERENCES local_store_identity(store_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id, store_id) REFERENCES local_products(id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (depends_on_command_id) REFERENCES outbox_commands(command_id) ON DELETE RESTRICT
  );
`;

export const outboxEntityReferencesMigration: DatabaseMigration = {
  version: 4,
  name: 'polymorphic-outbox-entity-reference',
  requiresForeignKeysDisabled: true,
  async up(database) {
    const sequence = await database.getFirstAsync<SequenceRow>(
      "SELECT seq FROM sqlite_sequence WHERE name = 'outbox_commands';",
      [],
    );

    await database.execAsync('ALTER TABLE outbox_commands RENAME TO outbox_commands_legacy;');
    await database.execAsync(outboxTable);
    await database.runAsync(
      `INSERT INTO outbox_commands (
        local_sequence, command_id, store_id, type, entity_id, product_id, payload_json,
        expected_server_version, depends_on_command_id, status, attempts,
        next_attempt_at, last_error, created_at
      )
      SELECT local_sequence, command_id, store_id, type, entity_id,
        CASE WHEN type IN ('product.create', 'product.update', 'product.delete')
          THEN entity_id ELSE NULL END,
        payload_json, expected_server_version, depends_on_command_id, status, attempts,
        next_attempt_at, last_error, created_at
      FROM outbox_commands_legacy
      ORDER BY local_sequence;`,
      [],
    );
    await database.execAsync(`
      DROP TABLE outbox_commands_legacy;
      CREATE INDEX idx_outbox_store_status_sequence
        ON outbox_commands(store_id, status, local_sequence);
      CREATE INDEX idx_outbox_store_entity_sequence
        ON outbox_commands(store_id, entity_id, local_sequence);
      CREATE INDEX idx_outbox_store_product_sequence
        ON outbox_commands(store_id, product_id, local_sequence);
    `);

    if (sequence) {
      const currentSequence = await database.getFirstAsync<SequenceRow>(
        "SELECT seq FROM sqlite_sequence WHERE name = 'outbox_commands';",
        [],
      );
      if (!currentSequence || currentSequence.seq < sequence.seq) {
        if (currentSequence) {
          await database.runAsync(
            "UPDATE sqlite_sequence SET seq = ? WHERE name = 'outbox_commands';",
            [sequence.seq],
          );
        } else {
          await database.runAsync('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?);', [
            'outbox_commands',
            sequence.seq,
          ]);
        }
      }
    }
  },
};
