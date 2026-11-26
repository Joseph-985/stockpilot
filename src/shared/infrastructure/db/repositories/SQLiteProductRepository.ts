import { randomUUID } from 'expo-crypto';

import type { ProductRepository } from '@/features/products/domain/ProductRepository';
import { ProductRepositoryError } from '@/features/products/domain/ProductRepository';
import type {
  Product,
  ProductId,
  ProductListOptions,
  StoreId,
  ValidProductDraft,
} from '@/features/products/domain/product';
import { normalizeProductSearchText } from '@/features/products/domain/search';
import { withDatabaseOperation } from '@/shared/infrastructure/db/DatabaseOperationQueue';
import type { SQLiteConnection } from '@/shared/infrastructure/db/SQLiteConnection';

type ProductRow = {
  id: string;
  store_id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  price_minor: number;
  cost_minor: number | null;
  low_stock_threshold: number;
  server_version: number;
  local_revision: number;
  sync_status: Product['syncStatus'];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type QueuedCreateRow = { command_id: string };
type ProductCommandType = 'product.create' | 'product.update' | 'product.delete';

type ProductCommandSnapshot = {
  protocol_version: 1;
  payload: {
    id: string;
    store_id: string;
    sku: string;
    name: string;
    description: string | null;
    category: string | null;
    price_minor: number;
    cost_minor: number | null;
    low_stock_threshold: number;
    server_version: number;
    local_revision: number;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };
};

export type SQLiteProductRepositoryOptions = {
  createId?: () => string;
  now?: () => string;
};

const productColumns = `
  id, store_id, sku, name, description, category, price_minor, cost_minor,
  low_stock_threshold, server_version, local_revision, sync_status,
  created_at, updated_at, deleted_at`;

export class SQLiteProductRepository implements ProductRepository {
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly database: SQLiteConnection,
    options: SQLiteProductRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async create(storeId: StoreId, draft: ValidProductDraft): Promise<Product> {
    const productId = this.createId();
    const commandId = this.createId();
    const createdAt = this.now();
    const product = fromDraft(productId, storeId, draft, createdAt);

    return withDatabaseOperation(this.database, async () => {
      try {
        await this.database.withTransactionAsync(async () => {
          await this.database.runAsync(
            `INSERT INTO local_products (
              id, store_id, sku, sku_search, name, name_search, description, category, price_minor, cost_minor,
              low_stock_threshold, server_version, local_revision, sync_status,
              created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'pending', ?, ?, NULL);`,
            [
              product.id,
              product.storeId,
              product.sku,
              normalizeProductSearchText(product.sku),
              product.name,
              normalizeProductSearchText(product.name),
              product.description,
              product.category,
              product.priceMinor,
              product.costMinor,
              product.lowStockThreshold,
              product.createdAt,
              product.updatedAt,
            ],
          );
          await this.insertCommand(product, commandId, 'product.create', null, null);
        });
      } catch (error) {
        throw mapProductWriteError(error);
      }
      return product;
    });
  }

  async update(storeId: StoreId, productId: ProductId, draft: ValidProductDraft): Promise<Product> {
    return withDatabaseOperation(this.database, async () => {
      try {
        let updatedProduct: Product | null = null;
        const commandId = this.createId();
        const updatedAt = this.now();

        await this.database.withTransactionAsync(async () => {
          const current = await this.getByIdInOperation(storeId, productId, false);
          if (!current) throw productNotFound();

          const dependsOnCommandId = await this.getPendingCreateCommandId(current);
          const nextProduct = fromDraft(
            current.id,
            current.storeId,
            draft,
            current.createdAt,
            updatedAt,
            current.localRevision + 1,
            current.serverVersion,
          );
          nextProduct.deletedAt = null;

          await this.database.runAsync(
            `UPDATE local_products SET
              sku = ?, sku_search = ?, name = ?, name_search = ?, description = ?, category = ?, price_minor = ?, cost_minor = ?,
              low_stock_threshold = ?, local_revision = ?, sync_status = 'pending', updated_at = ?
             WHERE id = ? AND store_id = ? AND deleted_at IS NULL;`,
            [
              nextProduct.sku,
              normalizeProductSearchText(nextProduct.sku),
              nextProduct.name,
              normalizeProductSearchText(nextProduct.name),
              nextProduct.description,
              nextProduct.category,
              nextProduct.priceMinor,
              nextProduct.costMinor,
              nextProduct.lowStockThreshold,
              nextProduct.localRevision,
              updatedAt,
              productId,
              storeId,
            ],
          );
          await this.insertCommand(
            nextProduct,
            commandId,
            'product.update',
            dependsOnCommandId ? null : current.serverVersion,
            dependsOnCommandId,
          );
          updatedProduct = nextProduct;
        });

        if (!updatedProduct) throw productNotFound();
        return updatedProduct;
      } catch (error) {
        throw mapProductWriteError(error);
      }
    });
  }

  async archive(storeId: StoreId, productId: ProductId): Promise<Product> {
    return withDatabaseOperation(this.database, async () => {
      try {
        let archivedProduct: Product | null = null;
        const commandId = this.createId();
        const archivedAt = this.now();

        await this.database.withTransactionAsync(async () => {
          const current = await this.getByIdInOperation(storeId, productId, false);
          if (!current) throw productNotFound();

          const dependsOnCommandId = await this.getPendingCreateCommandId(current);
          const nextProduct: Product = {
            ...current,
            localRevision: current.localRevision + 1,
            syncStatus: 'pending',
            updatedAt: archivedAt,
            deletedAt: archivedAt,
          };

          await this.database.runAsync(
            `UPDATE local_products SET
              local_revision = ?, sync_status = 'pending', updated_at = ?, deleted_at = ?
             WHERE id = ? AND store_id = ? AND deleted_at IS NULL;`,
            [nextProduct.localRevision, archivedAt, archivedAt, productId, storeId],
          );
          await this.insertCommand(
            nextProduct,
            commandId,
            'product.delete',
            dependsOnCommandId ? null : current.serverVersion,
            dependsOnCommandId,
          );
          archivedProduct = nextProduct;
        });

        if (!archivedProduct) throw productNotFound();
        return archivedProduct;
      } catch (error) {
        throw mapProductWriteError(error);
      }
    });
  }

  getById(
    storeId: StoreId,
    productId: ProductId,
    options: Pick<ProductListOptions, 'includeArchived'> = {},
  ): Promise<Product | null> {
    return withDatabaseOperation(this.database, () =>
      this.getByIdInOperation(storeId, productId, options.includeArchived ?? false),
    );
  }

  list(storeId: StoreId, options: ProductListOptions = {}): Promise<Product[]> {
    return withDatabaseOperation(this.database, async () => {
      const query = options.query?.trim() ?? '';
      const includeArchived = options.includeArchived ?? false;
      const activeFilter = includeArchived ? '' : 'AND deleted_at IS NULL';
      const searchFilter = query
        ? 'AND (instr(name_search, ?) > 0 OR instr(sku_search, ?) > 0)'
        : '';
      const normalizedQuery = normalizeProductSearchText(query);
      const params = query ? [storeId, normalizedQuery, normalizedQuery] : [storeId];
      const rows = await this.database.getAllAsync<ProductRow>(
        `SELECT ${productColumns}
         FROM local_products
         WHERE store_id = ? ${activeFilter} ${searchFilter}
         ORDER BY name COLLATE NOCASE ASC, id ASC;`,
        params,
      );
      return rows.map(toProduct);
    });
  }

  private async getByIdInOperation(
    storeId: StoreId,
    productId: ProductId,
    includeArchived: boolean,
  ): Promise<Product | null> {
    const activeFilter = includeArchived ? '' : 'AND deleted_at IS NULL';
    const row = await this.database.getFirstAsync<ProductRow>(
      `SELECT ${productColumns}
       FROM local_products
       WHERE store_id = ? AND id = ? ${activeFilter}
       LIMIT 1;`,
      [storeId, productId],
    );
    return row ? toProduct(row) : null;
  }

  private async getPendingCreateCommandId(product: Product): Promise<string | null> {
    const row = await this.database.getFirstAsync<QueuedCreateRow>(
      `SELECT command_id
       FROM outbox_commands
       WHERE store_id = ? AND entity_id = ? AND type = 'product.create' AND status = 'pending'
       ORDER BY local_sequence ASC
       LIMIT 1;`,
      [product.storeId, product.id],
    );
    return row?.command_id ?? null;
  }

  private async insertCommand(
    product: Product,
    commandId: string,
    type: ProductCommandType,
    expectedServerVersion: number | null,
    dependsOnCommandId: string | null,
  ): Promise<void> {
    const payload: ProductCommandSnapshot = {
      protocol_version: 1,
      payload: {
        id: product.id,
        store_id: product.storeId,
        sku: product.sku,
        name: product.name,
        description: product.description,
        category: product.category,
        price_minor: product.priceMinor,
        cost_minor: product.costMinor,
        low_stock_threshold: product.lowStockThreshold,
        server_version: product.serverVersion,
        local_revision: product.localRevision,
        created_at: product.createdAt,
        updated_at: product.updatedAt,
        deleted_at: product.deletedAt,
      },
    };

    await this.database.runAsync(
      `INSERT INTO outbox_commands (
        command_id, store_id, type, entity_id, product_id, payload_json, expected_server_version,
        depends_on_command_id, status, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?);`,
      [
        commandId,
        product.storeId,
        type,
        product.id,
        product.id,
        JSON.stringify(payload),
        expectedServerVersion,
        dependsOnCommandId,
        product.updatedAt,
      ],
    );
  }
}

function fromDraft(
  id: string,
  storeId: string,
  draft: ValidProductDraft,
  createdAt: string,
  updatedAt = createdAt,
  localRevision = 1,
  serverVersion = 0,
): Product {
  return {
    id,
    storeId,
    ...draft,
    serverVersion,
    localRevision,
    syncStatus: 'pending',
    createdAt,
    updatedAt,
    deletedAt: null,
  };
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    storeId: row.store_id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category,
    priceMinor: row.price_minor,
    costMinor: row.cost_minor,
    lowStockThreshold: row.low_stock_threshold,
    serverVersion: row.server_version,
    localRevision: row.local_revision,
    syncStatus: row.sync_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function productNotFound(): ProductRepositoryError {
  return new ProductRepositoryError('not_found', 'Product was not found in this store.');
}

function mapProductWriteError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes('unique constraint failed') &&
    normalized.includes('local_products.store_id') &&
    normalized.includes('local_products.sku')
  ) {
    return new ProductRepositoryError('duplicate_sku', 'An active product already uses this SKU.');
  }
  return error;
}
