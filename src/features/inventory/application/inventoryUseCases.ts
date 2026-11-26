import type { InventoryRepository } from '../domain/InventoryRepository';
import type {
  InventoryMutationResult,
  StockAdjustmentInput,
  StockInInput,
} from '../domain/inventory';
import { StockAdjustmentInputSchema, StockInInputSchema } from '../domain/validation';

export async function stockIn(
  repository: InventoryRepository,
  input: StockInInput,
): Promise<InventoryMutationResult> {
  const parsed = StockInInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'validation_error',
      message: parsed.error.issues[0]?.message ?? 'Invalid quantity.',
    };
  }
  return repository.stockIn(parsed.data);
}

export async function adjustStock(
  repository: InventoryRepository,
  input: StockAdjustmentInput,
): Promise<InventoryMutationResult> {
  const parsed = StockAdjustmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'validation_error',
      message: parsed.error.issues[0]?.message ?? 'Invalid adjustment.',
    };
  }
  return repository.adjustStock(parsed.data);
}
