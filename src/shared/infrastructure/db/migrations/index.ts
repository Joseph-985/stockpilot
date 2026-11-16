import type { DatabaseMigration } from './types';
import { productCatalogMigration } from './productCatalog';
import { productSearchNormalizationMigration } from './productSearchNormalization';
import { localStoreIdentityCurrentMigration } from './localStoreIdentityCurrent';

export const migrations: readonly DatabaseMigration[] = [
  productCatalogMigration,
  productSearchNormalizationMigration,
  localStoreIdentityCurrentMigration,
];
