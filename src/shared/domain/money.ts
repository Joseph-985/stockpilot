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
