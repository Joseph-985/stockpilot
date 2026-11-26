export const MAX_MONEY_MINOR = 99_999_999_999;

export type ParseMoneyOptions = {
  allowZero?: boolean;
};

/** Multiplies a kobo unit price by a whole-number quantity without accepting overflow. */
export function multiplyMinorUnitsByQuantity(unitPriceMinor: number, quantity: number): number {
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor <= 0) {
    throw new RangeError('Unit price must be a positive safe integer in minor units.');
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError('Quantity must be a positive safe integer.');
  }

  const lineTotal = unitPriceMinor * quantity;
  if (!Number.isSafeInteger(lineTotal) || lineTotal > MAX_MONEY_MINOR) {
    throw new RangeError('Line total exceeds the supported monetary limit.');
  }

  return lineTotal;
}

/** Adds nonnegative monetary totals while enforcing the shared project limit. */
export function addMinorUnitAmounts(totalMinor: number, amountMinor: number): number {
  if (
    !Number.isSafeInteger(totalMinor) ||
    totalMinor < 0 ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0
  ) {
    throw new RangeError('Amounts must be nonnegative safe integers in minor units.');
  }

  const nextTotal = totalMinor + amountMinor;
  if (!Number.isSafeInteger(nextTotal) || nextTotal > MAX_MONEY_MINOR) {
    throw new RangeError('Total exceeds the supported monetary limit.');
  }

  return nextTotal;
}

/** Parses a decimal amount as text so conversion never relies on floating-point multiplication. */
export function parseMoneyToMinorUnits(
  value: string,
  { allowZero = false }: ParseMoneyOptions = {},
): number {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);

  if (!match) {
    throw new RangeError('Amount must be a decimal string with no more than two decimal places.');
  }

  const whole = match[1];
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const minorUnits = Number(`${whole}${fraction}`);

  if (!Number.isSafeInteger(minorUnits) || minorUnits > MAX_MONEY_MINOR) {
    throw new RangeError('Amount exceeds the supported monetary limit.');
  }
  if (minorUnits === 0 && !allowZero) {
    throw new RangeError('Amount must be greater than zero.');
  }

  return minorUnits;
}

/** Formats integer minor units as a decimal input value without currency symbols. */
export function formatMinorAsDecimal(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError('Amount must be a safe integer in minor currency units.');
  }

  const sign = amountMinor < 0 ? '-' : '';
  const absoluteAmount = Math.abs(amountMinor);
  const major = Math.floor(absoluteAmount / 100);
  const minor = String(absoluteAmount % 100).padStart(2, '0');

  return `${sign}${major}.${minor}`;
}

/** Formats integer minor units without using floating-point arithmetic for calculations. */
export function formatMinorCurrency(
  amountMinor: number,
  currency = 'NGN',
  locale = 'en-NG',
): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError('Amount must be a safe integer in minor currency units.');
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(amountMinor / 100);
}
