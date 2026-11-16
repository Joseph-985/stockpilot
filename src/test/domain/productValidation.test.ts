import { ProductDraftSchema } from '@/features/products/domain/validation';

const validDraft = {
  sku: ' tee-001 ',
  name: ' Basic Cotton Top ',
  description: '  Soft cotton  ',
  category: ' Clothing ',
  price: '3500.50',
  cost: '0.00',
  lowStockThreshold: 3,
};

describe('ProductDraftSchema', () => {
  it('normalizes fields and converts prices to integer kobo', () => {
    expect(ProductDraftSchema.parse(validDraft)).toEqual({
      sku: 'TEE-001',
      name: 'Basic Cotton Top',
      description: 'Soft cotton',
      category: 'Clothing',
      priceMinor: 350050,
      costMinor: 0,
      lowStockThreshold: 3,
    });
  });

  it.each([
    { ...validDraft, sku: '  ' },
    { ...validDraft, name: 'x' },
    { ...validDraft, name: '   ' },
    { ...validDraft, name: 'x'.repeat(121) },
    { ...validDraft, description: 'x'.repeat(2001) },
    { ...validDraft, category: 'x'.repeat(81) },
    { ...validDraft, price: '0.00' },
    { ...validDraft, price: '-1.00' },
    { ...validDraft, price: '+1.00' },
    { ...validDraft, price: '1.001' },
    { ...validDraft, price: '1e3' },
    { ...validDraft, price: 'NaN' },
    { ...validDraft, price: 'Infinity' },
    { ...validDraft, price: '1000000000.00' },
    { ...validDraft, cost: '-0.01' },
    { ...validDraft, lowStockThreshold: -1 },
    { ...validDraft, lowStockThreshold: 1.5 },
  ])('rejects invalid draft $price', (draft) => {
    expect(ProductDraftSchema.safeParse(draft).success).toBe(false);
  });

  it('allows an omitted optional cost and normalizes empty optional text', () => {
    const { cost: _cost, ...draft } = validDraft;
    expect(ProductDraftSchema.parse({ ...draft, description: '', category: '' })).toMatchObject({
      costMinor: null,
      description: null,
      category: null,
    });
  });
});
