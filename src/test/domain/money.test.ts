import { formatMinorCurrency } from '../../shared/domain/money';

describe('formatMinorCurrency', () => {
  it('formats integer kobo as NGN with two decimal places', () => {
    expect(formatMinorCurrency(12345)).toBe('NGN 123.45');
  });

  it('rejects values that are not safe integers', () => {
    expect(() => formatMinorCurrency(1.5)).toThrow(RangeError);
  });
});
