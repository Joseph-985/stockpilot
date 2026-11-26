import type { CheckoutLine } from './sale';
import { addMinorUnitAmounts, multiplyMinorUnitsByQuantity } from '@/shared/domain/money';

export type CheckoutLineTotal = CheckoutLine & { lineTotalMinor: number };

/** Coalesces cart duplicates without changing order and rejects conflicting reviewed prices. */
export function coalesceCheckoutLines(lines: readonly CheckoutLine[]): CheckoutLine[] {
  const coalesced = new Map<string, CheckoutLine>();
  for (const line of lines) {
    const existing = coalesced.get(line.productId);
    if (!existing) {
      coalesced.set(line.productId, { ...line });
      continue;
    }
    if (existing.expectedUnitPriceMinor !== line.expectedUnitPriceMinor) {
      throw new RangeError('Duplicate product lines must use the same reviewed unit price.');
    }
    const quantity = existing.quantity + line.quantity;
    if (!Number.isSafeInteger(quantity)) {
      throw new RangeError('Combined product quantity exceeds the safe integer limit.');
    }
    coalesced.set(line.productId, { ...existing, quantity });
  }
  return [...coalesced.values()];
}

/** Computes all amounts using bounded integer minor-unit helpers. */
export function calculateCheckoutLineTotals(lines: readonly CheckoutLine[]): {
  items: CheckoutLineTotal[];
  totalMinor: number;
} {
  let totalMinor = 0;
  const items = lines.map((line) => {
    const lineTotalMinor = multiplyMinorUnitsByQuantity(line.expectedUnitPriceMinor, line.quantity);
    totalMinor = addMinorUnitAmounts(totalMinor, lineTotalMinor);
    return { ...line, lineTotalMinor };
  });
  return { items, totalMinor };
}
