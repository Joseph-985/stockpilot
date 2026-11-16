import { z } from 'zod';

import { parseMoneyToMinorUnits } from '@/shared/domain/money';

const MAX_PRODUCT_NAME_LENGTH = 120;
const MAX_SKU_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_CATEGORY_LENGTH = 80;

function moneyString(allowZero: boolean) {
  return z
    .string()
    .trim()
    .transform((value, context) => {
      try {
        return parseMoneyToMinorUnits(value, { allowZero });
      } catch {
        context.issues.push({
          code: 'custom',
          input: value,
          message: 'Enter a valid amount with up to two decimals.',
        });
        return z.NEVER;
      }
    });
}

const nullableMoneyString = z
  .union([moneyString(true), z.literal('').transform(() => null), z.null()])
  .optional()
  .transform((value) => value ?? null);

export const ProductDraftSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .min(1, 'SKU is required.')
      .max(MAX_SKU_LENGTH, `SKU must be ${MAX_SKU_LENGTH} characters or fewer.`)
      .transform((value) => value.normalize('NFC').toUpperCase()),
    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters.')
      .max(MAX_PRODUCT_NAME_LENGTH, `Name must be ${MAX_PRODUCT_NAME_LENGTH} characters or fewer.`),
    description: z
      .string()
      .trim()
      .max(
        MAX_DESCRIPTION_LENGTH,
        `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
      )
      .nullable()
      .optional()
      .transform((value) => value || null),
    category: z
      .string()
      .trim()
      .max(MAX_CATEGORY_LENGTH, `Category must be ${MAX_CATEGORY_LENGTH} characters or fewer.`)
      .nullable()
      .optional()
      .transform((value) => value || null),
    price: moneyString(false),
    cost: nullableMoneyString,
    lowStockThreshold: z.number().int().min(0, 'Threshold must be zero or greater.'),
  })
  .transform(({ price, cost, ...fields }) => ({
    ...fields,
    priceMinor: price,
    costMinor: cost,
  }));
