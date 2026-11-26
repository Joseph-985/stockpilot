import { z } from 'zod';

import { MAX_MONEY_MINOR } from '@/shared/domain/money';
import { MAX_SAFE_QUANTITY } from '@/shared/domain/quantity';

const checkoutLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(MAX_SAFE_QUANTITY)
    .refine(Number.isSafeInteger, 'Quantity must be a positive safe integer.'),
  expectedUnitPriceMinor: z
    .number()
    .int()
    .min(1)
    .max(MAX_MONEY_MINOR)
    .refine(Number.isSafeInteger, 'Unit price must be a positive safe integer in kobo.'),
});

export const CheckoutInputSchema = z
  .object({
    storeId: z.string().uuid(),
    checkoutRequestId: z.string().uuid(),
    lines: z.array(checkoutLineSchema).min(1, 'Add at least one product to the sale.'),
    customerName: z
      .string()
      .trim()
      .max(120, 'Customer name must be 120 characters or fewer.')
      .nullish()
      .transform((value) => value || null),
    paymentMethod: z.enum(['cash', 'transfer', 'other']),
  })
  .superRefine(({ lines }, context) => {
    const seenProducts = new Map<string, { price: number; quantity: number; index: number }>();
    lines.forEach((line, index) => {
      const existing = seenProducts.get(line.productId);
      if (existing && existing.price !== line.expectedUnitPriceMinor) {
        context.addIssue({
          code: 'custom',
          path: ['lines', index, 'productId'],
          message: 'Duplicate product lines must use the same reviewed unit price.',
        });
      }
      const quantity = (existing?.quantity ?? 0) + line.quantity;
      if (!Number.isSafeInteger(quantity)) {
        context.addIssue({
          code: 'custom',
          path: ['lines', index, 'quantity'],
          message: 'Combined product quantity exceeds the safe integer limit.',
        });
      }
      seenProducts.set(line.productId, {
        price: existing?.price ?? line.expectedUnitPriceMinor,
        quantity,
        index: existing?.index ?? index,
      });
    });
  });
