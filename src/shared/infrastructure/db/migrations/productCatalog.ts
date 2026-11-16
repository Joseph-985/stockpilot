import type { DatabaseMigration } from './types';

const productCatalogSchema = `
  CREATE TABLE IF NOT EXISTS local_store_identity (
    store_id TEXT PRIMARY KEY NOT NULL,
    identity_kind TEXT NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_local_store_identity_current
    ON local_store_identity(is_current) WHERE is_current = 1;

  CREATE TABLE IF NOT EXISTS local_products (
    id TEXT PRIMARY KEY NOT NULL,
    store_id TEXT NOT NULL,
    sku TEXT NOT NULL CHECK (length(trim(sku)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
    description TEXT NULL CHECK (description IS NULL OR length(description) <= 2000),
    category TEXT NULL CHECK (category IS NULL OR length(category) <= 80),
    price_minor INTEGER NOT NULL CHECK (price_minor > 0),
    cost_minor INTEGER NULL CHECK (cost_minor IS NULL OR cost_minor >= 0),
    low_stock_threshold INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
    server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
    local_revision INTEGER NOT NULL DEFAULT 1 CHECK (local_revision > 0),
    sync_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (sync_status IN ('pending', 'synced', 'conflict')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    UNIQUE (id, store_id),
    FOREIGN KEY (store_id) REFERENCES local_store_identity(store_id) ON DELETE RESTRICT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_local_products_active_sku
    ON local_products(store_id, sku COLLATE NOCASE)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_local_products_store_name
    ON local_products(store_id, name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS outbox_commands (
    local_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id TEXT NOT NULL UNIQUE,
    store_id TEXT NOT NULL,
    type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    expected_server_version INTEGER NULL
      CHECK (expected_server_version IS NULL OR expected_server_version >= 0),
    depends_on_command_id TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TEXT NULL,
    last_error TEXT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (store_id) REFERENCES local_store_identity(store_id) ON DELETE RESTRICT,
    FOREIGN KEY (entity_id, store_id) REFERENCES local_products(id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (depends_on_command_id) REFERENCES outbox_commands(command_id) ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_outbox_store_status_sequence
    ON outbox_commands(store_id, status, local_sequence);
  CREATE INDEX IF NOT EXISTS idx_outbox_store_entity_sequence
    ON outbox_commands(store_id, entity_id, local_sequence);
`;

export const productCatalogMigration: DatabaseMigration = {
  version: 1,
  name: 'product-catalog-and-outbox',
  async up(database) {
    await database.execAsync(productCatalogSchema);
  },
};
