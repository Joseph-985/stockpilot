import {
  StockAdjustmentInputSchema,
  StockInInputSchema,
} from '@/features/inventory/domain/validation';

const input = {
  storeId: '10000000-0000-4000-8000-000000000001',
  productId: '20000000-0000-4000-8000-000000000001',
};

describe('inventory input schemas', () => {
  it('accepts positive safe stock-in and normalizes optional note', () => {
    expect(StockInInputSchema.parse({ ...input, quantity: 20 })).toMatchObject({
      quantity: 20,
      note: null,
    });
    expect(
      StockInInputSchema.parse({ ...input, quantity: 20, note: ' Opening stock ' }),
    ).toMatchObject({
      note: 'Opening stock',
    });
  });

  it.each([0, -1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects stock-in quantity %s',
    (quantity) => {
      expect(StockInInputSchema.safeParse({ ...input, quantity }).success).toBe(false);
    },
  );

  it('accepts nonzero signed adjustment with a required trimmed reason', () => {
    expect(
      StockAdjustmentInputSchema.parse({
        ...input,
        deltaQuantity: -1,
        reason: ' Damaged item ',
      }),
    ).toMatchObject({ deltaQuantity: -1, reason: 'Damaged item' });
  });

  it.each([0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects adjustment delta %s',
    (deltaQuantity) => {
      expect(
        StockAdjustmentInputSchema.safeParse({ ...input, deltaQuantity, reason: 'Correction' })
          .success,
      ).toBe(false);
    },
  );

  it('rejects a blank adjustment reason and malformed store/product IDs', () => {
    expect(
      StockAdjustmentInputSchema.safeParse({ ...input, deltaQuantity: 1, reason: '  ' }).success,
    ).toBe(false);
    expect(
      StockInInputSchema.safeParse({ ...input, storeId: 'not-a-uuid', quantity: 1 }).success,
    ).toBe(false);
  });
});
