import {
  assertNonzeroQuantityDelta,
  assertPositiveQuantity,
  calculateEstimatedQuantity,
} from '@/shared/domain/quantity';

describe('quantity helpers', () => {
  it('accepts positive safe whole quantities and signed nonzero deltas', () => {
    expect(assertPositiveQuantity(20)).toBe(20);
    expect(assertNonzeroQuantityDelta(-1)).toBe(-1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid positive quantity %s',
    (quantity) => {
      expect(() => assertPositiveQuantity(quantity)).toThrow(RangeError);
    },
  );

  it.each([0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid movement delta %s',
    (delta) => {
      expect(() => assertNonzeroQuantityDelta(delta)).toThrow(RangeError);
    },
  );

  it('calculates provisional availability and rejects negative or unsafe estimates', () => {
    expect(calculateEstimatedQuantity(0, 20)).toBe(20);
    expect(calculateEstimatedQuantity(20, -4)).toBe(16);
    expect(() => calculateEstimatedQuantity(20, -21)).toThrow(RangeError);
    expect(() => calculateEstimatedQuantity(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });
});
