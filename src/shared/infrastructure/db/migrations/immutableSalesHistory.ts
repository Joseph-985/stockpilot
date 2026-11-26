import type { DatabaseMigration } from './types';

const immutableSalesHistorySchema = `
  CREATE TRIGGER local_stock_movements_no_update
    BEFORE UPDATE ON local_stock_movements
    BEGIN SELECT RAISE(ABORT, 'stock movements are immutable'); END;
  CREATE TRIGGER local_stock_movements_no_delete
    BEFORE DELETE ON local_stock_movements
    BEGIN SELECT RAISE(ABORT, 'stock movements are immutable'); END;

  CREATE TRIGGER local_sale_items_no_update
    BEFORE UPDATE ON local_sale_items
    BEGIN SELECT RAISE(ABORT, 'sale item snapshots are immutable'); END;
  CREATE TRIGGER local_sale_items_no_delete
    BEFORE DELETE ON local_sale_items
    BEGIN SELECT RAISE(ABORT, 'sale item snapshots are immutable'); END;

  CREATE TRIGGER local_sales_no_delete
    BEFORE DELETE ON local_sales
    BEGIN SELECT RAISE(ABORT, 'sales are immutable'); END;
  CREATE TRIGGER local_sales_update_state_only
    BEFORE UPDATE ON local_sales
    WHEN NEW.id IS NOT OLD.id
      OR NEW.store_id IS NOT OLD.store_id
      OR NEW.checkout_request_id IS NOT OLD.checkout_request_id
      OR NEW.customer_name IS NOT OLD.customer_name
      OR NEW.payment_method IS NOT OLD.payment_method
      OR NEW.currency IS NOT OLD.currency
      OR NEW.total_minor IS NOT OLD.total_minor
      OR NEW.occurred_at IS NOT OLD.occurred_at
      OR NEW.created_at IS NOT OLD.created_at
      OR NOT (
        NEW.status IS OLD.status
        OR (OLD.status = 'pending' AND NEW.status IN ('confirmed', 'needs_attention'))
      )
    BEGIN SELECT RAISE(ABORT, 'sale snapshots are immutable'); END;

  CREATE TRIGGER sale_create_outbox_snapshot_immutable
    BEFORE UPDATE ON outbox_commands
    WHEN OLD.type = 'sale.create' AND (
      NEW.command_id IS NOT OLD.command_id
      OR NEW.store_id IS NOT OLD.store_id
      OR NEW.type IS NOT OLD.type
      OR NEW.entity_id IS NOT OLD.entity_id
      OR NEW.product_id IS NOT OLD.product_id
      OR NEW.payload_json IS NOT OLD.payload_json
      OR NEW.expected_server_version IS NOT OLD.expected_server_version
      OR NEW.depends_on_command_id IS NOT OLD.depends_on_command_id
      OR NEW.created_at IS NOT OLD.created_at
    )
    BEGIN SELECT RAISE(ABORT, 'sale command snapshot is immutable'); END;
`;

export const immutableSalesHistoryMigration: DatabaseMigration = {
  version: 6,
  name: 'immutable-local-sales-history',
  async up(database) {
    await database.execAsync(immutableSalesHistorySchema);
  },
};
