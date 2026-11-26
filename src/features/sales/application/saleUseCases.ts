import type { SaleRepository } from '../domain/SaleRepository';
import { coalesceCheckoutLines } from '../domain/checkoutCalculations';
import type { CheckoutInput, CheckoutResult } from '../domain/sale';
import { CheckoutInputSchema } from '../domain/validation';

export async function createSale(
  repository: SaleRepository,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const parsed = CheckoutInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'validation_error',
      message: parsed.error.issues[0]?.message ?? 'Review the sale details and try again.',
    };
  }
  try {
    return await repository.create({
      ...parsed.data,
      lines: coalesceCheckoutLines(parsed.data.lines),
    });
  } catch (error) {
    return {
      status: 'persistence_failure',
      message:
        error instanceof Error
          ? error.message
          : 'Sale could not be saved locally. Retry with the same checkout request ID.',
    };
  }
}
