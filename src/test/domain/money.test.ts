import {
  formatMinorAsDecimal,
  formatMinorCurrency,
  parseMoneyToMinorUnits,
} from '../../shared/domain/money';

describe('formatMinorCurrency', () => {
  it('formats integer kobo as NGN with two decimal places', () => {
    expect(formatMinorCurrency(12345)).toBe('NGN 123.45');
  });

  it('rejects values that are not safe integers', () => {
    expect(() => formatMinorCurrency(1.5)).toThrow(RangeError);
  });
});

describe('money parsing and decimal formatting', () => {
  it.each([
    ['3500.50', 350050],
    ['3500.5', 350050],
    ['3500', 350000],
    ['0.01', 1],
  ])('parses %s into integer kobo', (input, expected) => {
    expect(parseMoneyToMinorUnits(input)).toBe(expected);
  });

  it('allows zero only when requested and returns exact decimal text', () => {
    expect(parseMoneyToMinorUnits('0.00', { allowZero: true })).toBe(0);
    expect(formatMinorAsDecimal(350050)).toBe('3500.50');
    expect(formatMinorAsDecimal(1)).toBe('0.01');
  });

  it.each(['', '  ', '-1.00', '+1.00', '1.001', '1.', '1e3', 'NaN', 'Infinity'])(
    'rejects invalid amount %s',
    (input) => {
      expect(() => parseMoneyToMinorUnits(input)).toThrow(RangeError);
    },
  );

  it('rejects values beyond the supported product money range', () => {
    expect(parseMoneyToMinorUnits('999999999.99')).toBe(99_999_999_999);
    expect(() => parseMoneyToMinorUnits('1000000000.00')).toThrow(RangeError);
    expect(() => parseMoneyToMinorUnits('90071992547409.92')).toThrow(RangeError);
  });
});
