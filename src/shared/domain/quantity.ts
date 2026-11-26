export const MAX_SAFE_QUANTITY = Number.MAX_SAFE_INTEGER;

/** Returns whether a value can be represented as a whole quantity without precision loss. */
export function isSafeIntegerQuantity(value: number): boolean {
  return Number.isSafeInteger(value);
}

export function assertPositiveQuantity(value: number): number {
  if (!isSafeIntegerQuantity(value) || value <= 0) {
    throw new RangeError('Quantity must be a positive safe integer.');
  }
  return value;
}

export function assertNonzeroQuantityDelta(value: number): number {
  if (!isSafeIntegerQuantity(value) || value === 0) {
    throw new RangeError('Quantity change must be a nonzero safe integer.');
  }
  return value;
}

/** Computes the local estimate from a baseline and pending movements, rejecting invalid totals. */
export function calculateEstimatedQuantity(baseQuantity: number, pendingDelta: number): number {
  if (!Number.isSafeInteger(baseQuantity) || baseQuantity < 0) {
    throw new RangeError('Base quantity must be a nonnegative safe integer.');
  }
  if (!Number.isSafeInteger(pendingDelta)) {
    throw new RangeError('Pending quantity change must be a safe integer.');
  }

  const estimatedQuantity = baseQuantity + pendingDelta;
  if (!Number.isSafeInteger(estimatedQuantity) || estimatedQuantity < 0) {
    throw new RangeError('Estimated available quantity must be a nonnegative safe integer.');
  }

  return estimatedQuantity;
}
