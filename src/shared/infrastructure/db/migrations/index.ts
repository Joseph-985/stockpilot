import type { DatabaseMigration } from './types';
import { productCatalogMigration } from './productCatalog';
import { productSearchNormalizationMigration } from './productSearchNormalization';
import { localStoreIdentityCurrentMigration } from './localStoreIdentityCurrent';
import { outboxEntityReferencesMigration } from './outboxEntityReferences';
import { inventorySalesMigration } from './inventorySales';
import { immutableSalesHistoryMigration } from './immutableSalesHistory';

export const migrations: readonly DatabaseMigration[] = [
  productCatalogMigration,
  productSearchNormalizationMigration,
  localStoreIdentityCurrentMigration,
  outboxEntityReferencesMigration,
  inventorySalesMigration,
  immutableSalesHistoryMigration,
];
