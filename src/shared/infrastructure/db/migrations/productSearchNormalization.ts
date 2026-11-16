import { normalizeProductSearchText } from '@/features/products/domain/search';

import type { DatabaseMigration } from './types';

type ExistingProductSearchText = {
  id: string;
  store_id: string;
  sku: string;
  name: string;
};

export const productSearchNormalizationMigration: DatabaseMigration = {
  version: 2,
  name: 'unicode-product-search-normalization',
  async up(database) {
    await database.execAsync(`
      ALTER TABLE local_products ADD COLUMN sku_search TEXT NOT NULL DEFAULT '';
      ALTER TABLE local_products ADD COLUMN name_search TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS idx_local_products_store_name_search
        ON local_products(store_id, name_search);
    `);

    const products = await database.getAllAsync<ExistingProductSearchText>(
      'SELECT id, store_id, sku, name FROM local_products;',
      [],
    );
    for (const product of products) {
      await database.runAsync(
        `UPDATE local_products SET sku_search = ?, name_search = ?
         WHERE id = ? AND store_id = ?;`,
        [
          normalizeProductSearchText(product.sku),
          normalizeProductSearchText(product.name),
          product.id,
          product.store_id,
        ],
      );
    }
  },
};
