import { CheckoutInputSchema } from '@/features/sales/domain/validation';
import {
  coalesceCheckoutLines,
  calculateCheckoutLineTotals,
} from '@/features/sales/domain/checkoutCalculations';
import { MAX_MONEY_MINOR } from '@/shared/domain/money';
import { createSale } from '@/features/sales/application/saleUseCases';
import type { SaleRepository } from '@/features/sales/domain/SaleRepository';

const checkout = {
  storeId: '10000000-0000-4000-8000-000000000001',
  checkoutRequestId: '30000000-0000-4000-8000-000000000001',
  lines: [
    {
      productId: '20000000-0000-4000-8000-000000000001',
      quantity: 3,
      expectedUnitPriceMinor: 350000,
    },
  ],
  paymentMethod: 'cash',
} as const;

describe('CheckoutInputSchema', () => {
  it('accepts a sale request without trusting a view-provided total', () => {
    const parsed = CheckoutInputSchema.parse({ ...checkout, totalMinor: 1050000 });
    expect(parsed).toMatchObject({
      checkoutRequestId: checkout.checkoutRequestId,
      customerName: null,
      lines: [{ quantity: 3, expectedUnitPriceMinor: 350000 }],
    });
    expect(parsed).not.toHaveProperty('totalMinor');
  });

  it('rejects empty carts, invalid quantities, and invalid prices', () => {
    expect(CheckoutInputSchema.safeParse({ ...checkout, lines: [] }).success).toBe(false);
    for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        CheckoutInputSchema.safeParse({
          ...checkout,
          lines: [{ ...checkout.lines[0], quantity }],
        }).success,
      ).toBe(false);
    }
    expect(
      CheckoutInputSchema.safeParse({
        ...checkout,
        lines: [
          { ...checkout.lines[0], expectedUnitPriceMinor: 0 },
          { ...checkout.lines[0], productId: '40000000-0000-4000-8000-000000000001' },
        ],
      }).success,
    ).toBe(false);
    expect(
      CheckoutInputSchema.safeParse({
        ...checkout,
        lines: [...checkout.lines, checkout.lines[0]],
      }).success,
    ).toBe(true);
  });

  it('coalesces duplicate cart lines and computes safe integer-kobo totals', () => {
    const parsed = CheckoutInputSchema.parse({
      ...checkout,
      lines: [...checkout.lines, { ...checkout.lines[0], quantity: 2 }],
    });
    const lines = coalesceCheckoutLines(parsed.lines);
    expect(lines).toEqual([{ ...checkout.lines[0], quantity: 5 }]);
    expect(calculateCheckoutLineTotals(lines)).toEqual({
      items: [{ ...checkout.lines[0], quantity: 5, lineTotalMinor: 1750000 }],
      totalMinor: 1750000,
    });
  });

  it('rejects duplicate lines with inconsistent reviewed prices and quantity overflow', () => {
    expect(
      CheckoutInputSchema.safeParse({
        ...checkout,
        lines: [...checkout.lines, { ...checkout.lines[0], expectedUnitPriceMinor: 360000 }],
      }).success,
    ).toBe(false);
    expect(
      CheckoutInputSchema.safeParse({
        ...checkout,
        lines: [
          { ...checkout.lines[0], quantity: Number.MAX_SAFE_INTEGER },
          { ...checkout.lines[0], quantity: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects line and sale totals above the project kobo limit', () => {
    expect(() =>
      calculateCheckoutLineTotals([
        {
          productId: checkout.lines[0].productId,
          quantity: 2,
          expectedUnitPriceMinor: MAX_MONEY_MINOR,
        },
      ]),
    ).toThrow('Line total exceeds the supported monetary limit.');
    expect(() =>
      calculateCheckoutLineTotals([
        {
          productId: checkout.lines[0].productId,
          quantity: 1,
          expectedUnitPriceMinor: MAX_MONEY_MINOR,
        },
        {
          productId: '40000000-0000-4000-8000-000000000001',
          quantity: 1,
          expectedUnitPriceMinor: 1,
        },
      ]),
    ).toThrow('Total exceeds the supported monetary limit.');
  });

  it('validates payment method and trims bounded customer names', () => {
    expect(
      CheckoutInputSchema.parse({ ...checkout, customerName: ' Ada ', paymentMethod: 'transfer' }),
    ).toMatchObject({ customerName: 'Ada', paymentMethod: 'transfer' });
    expect(CheckoutInputSchema.safeParse({ ...checkout, paymentMethod: 'card' }).success).toBe(
      false,
    );
    expect(
      CheckoutInputSchema.safeParse({ ...checkout, customerName: 'x'.repeat(121) }).success,
    ).toBe(false);
  });
});

describe('createSale', () => {
  it('maps asynchronous repository failures to a persistence result', async () => {
    const repository = {
      create: jest.fn().mockRejectedValue(new Error('SQLite unavailable')),
      getById: jest.fn(),
      list: jest.fn(),
      getDailySummary: jest.fn(),
    } satisfies SaleRepository;

    await expect(
      createSale(repository, { ...checkout, lines: [...checkout.lines] }),
    ).resolves.toEqual({
      status: 'persistence_failure',
      message: 'SQLite unavailable',
    });
  });
});
