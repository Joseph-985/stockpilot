import type { DatabaseMigration } from './types';

const inventorySalesSchema = `
  CREATE TABLE local_stock_balances (
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    base_quantity INTEGER NOT NULL DEFAULT 0
      CHECK (typeof(base_quantity) = 'integer' AND base_quantity BETWEEN 0 AND 9007199254740991),
    pending_delta INTEGER NOT NULL DEFAULT 0
      CHECK (typeof(pending_delta) = 'integer' AND pending_delta BETWEEN -9007199254740991 AND 9007199254740991),
    server_version INTEGER NOT NULL DEFAULT 0
      CHECK (typeof(server_version) = 'integer' AND server_version >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (store_id, product_id),
    FOREIGN KEY (product_id, store_id) REFERENCES local_products(id, store_id) ON DELETE RESTRICT
  );
  CREATE INDEX idx_local_stock_balances_product_store
    ON local_stock_balances(product_id, store_id);

  CREATE TABLE local_sales (
    id TEXT PRIMARY KEY NOT NULL,
    store_id TEXT NOT NULL,
    checkout_request_id TEXT NOT NULL,
    customer_name TEXT NULL CHECK (customer_name IS NULL OR length(customer_name) <= 120),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer', 'other')),
    currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
    total_minor INTEGER NOT NULL
      CHECK (typeof(total_minor) = 'integer' AND total_minor BETWEEN 1 AND 99999999999),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'confirmed', 'needs_attention')),
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (id, store_id),
    UNIQUE (store_id, checkout_request_id),
    FOREIGN KEY (store_id) REFERENCES local_store_identity(store_id) ON DELETE RESTRICT
  );

  CREATE TABLE local_sale_items (
    store_id TEXT NOT NULL,
    sale_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name_snapshot TEXT NOT NULL CHECK (length(trim(product_name_snapshot)) BETWEEN 2 AND 120),
    sku_snapshot TEXT NOT NULL CHECK (length(trim(sku_snapshot)) > 0),
    quantity INTEGER NOT NULL
      CHECK (typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 9007199254740991),
    unit_price_minor INTEGER NOT NULL
      CHECK (typeof(unit_price_minor) = 'integer' AND unit_price_minor BETWEEN 1 AND 99999999999),
    line_total_minor INTEGER NOT NULL
      CHECK (typeof(line_total_minor) = 'integer' AND line_total_minor BETWEEN 1 AND 99999999999),
    PRIMARY KEY (store_id, sale_id, product_id),
    FOREIGN KEY (sale_id, store_id) REFERENCES local_sales(id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id, store_id) REFERENCES local_products(id, store_id) ON DELETE RESTRICT
  );

  CREATE TABLE local_stock_movements (
    id TEXT PRIMARY KEY NOT NULL,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    delta_quantity INTEGER NOT NULL
      CHECK (typeof(delta_quantity) = 'integer' AND delta_quantity BETWEEN -9007199254740991 AND 9007199254740991 AND delta_quantity <> 0),
    kind TEXT NOT NULL CHECK (kind IN ('stock_in', 'adjustment', 'sale')),
    reason TEXT NULL,
    sale_id TEXT NULL,
    source_command_id TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (sync_status IN ('pending', 'synced', 'conflict')),
    occurred_at TEXT NOT NULL,
    CHECK (kind <> 'stock_in' OR (delta_quantity > 0 AND sale_id IS NULL)),
    CHECK (kind <> 'adjustment' OR (length(trim(coalesce(reason, ''))) > 0 AND sale_id IS NULL)),
    CHECK (kind <> 'sale' OR (delta_quantity < 0 AND sale_id IS NOT NULL)),
    FOREIGN KEY (store_id) REFERENCES local_store_identity(store_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id, store_id) REFERENCES local_products(id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (sale_id, store_id) REFERENCES local_sales(id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_command_id, store_id) REFERENCES outbox_commands(command_id, store_id) ON DELETE RESTRICT
  );

  CREATE INDEX idx_local_sales_store_occurred
    ON local_sales(store_id, occurred_at DESC, id);
  CREATE INDEX idx_local_sale_items_store_sale
    ON local_sale_items(store_id, sale_id);
  CREATE INDEX idx_local_sale_items_store_product
    ON local_sale_items(store_id, product_id);
  CREATE INDEX idx_local_stock_movements_store_product_time
    ON local_stock_movements(store_id, product_id, occurred_at, id);
  CREATE INDEX idx_local_stock_movements_store_command
    ON local_stock_movements(store_id, source_command_id);
  CREATE INDEX idx_local_stock_movements_store_sale
    ON local_stock_movements(store_id, sale_id);
`;

export const inventorySalesMigration: DatabaseMigration = {
  version: 5,
  name: 'local-inventory-and-sales-schema',
  async up(database) {
    await database.execAsync(inventorySalesSchema);
  },
};
