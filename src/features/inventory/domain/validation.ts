import { z } from 'zod';

import { MAX_SAFE_QUANTITY } from '@/shared/domain/quantity';

const storeId = z.string().uuid();
const productId = z.string().uuid();
const positiveQuantity = z
  .number()
  .int()
  .min(1)
  .max(MAX_SAFE_QUANTITY)
  .refine(Number.isSafeInteger, 'Quantity must be a positive safe integer.');
const signedNonzeroQuantity = z
  .number()
  .int()
  .min(-MAX_SAFE_QUANTITY)
  .max(MAX_SAFE_QUANTITY)
  .refine(Number.isSafeInteger, 'Quantity change must be a safe integer.')
  .refine((value) => value !== 0, 'Quantity change cannot be zero.');

export const StockInInputSchema = z.object({
  storeId,
  productId,
  quantity: positiveQuantity,
  note: z
    .string()
    .trim()
    .max(500, 'Note must be 500 characters or fewer.')
    .nullable()
    .optional()
    .transform((value) => value || null),
});

export const StockAdjustmentInputSchema = z.object({
  storeId,
  productId,
  deltaQuantity: signedNonzeroQuantity,
  reason: z.string().trim().min(1, 'A reason is required.').max(500),
});
