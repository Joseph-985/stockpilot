import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ProductForm } from '@/features/products/presentation/ProductForm';
import { ProductRepositoryError } from '@/features/products/domain/ProductRepository';
import type { ValidProductDraft } from '@/features/products/domain/product';

describe('ProductForm', () => {
  it('shows inline validation errors and does not submit invalid values', () => {
    const onSubmit = jest.fn<Promise<void>, [ValidProductDraft]>();
    render(<ProductForm onCancel={jest.fn()} onSubmit={onSubmit} submitLabel="Save product" />);

    fireEvent.press(screen.getByRole('button', { name: 'Save product' }));

    expect(screen.getByText('SKU is required.')).toBeTruthy();
    expect(screen.getByText('Name must be at least 2 characters.')).toBeTruthy();
    expect(screen.getByText('Enter a valid amount with up to two decimals.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prevents overlapping submissions while a valid save is in progress', async () => {
    let finishSave!: () => void;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    render(<ProductForm onCancel={jest.fn()} onSubmit={onSubmit} submitLabel="Save product" />);

    fireEvent.changeText(screen.getByLabelText('Product name'), 'Cotton shirt');
    fireEvent.changeText(screen.getByLabelText('SKU'), 'SHIRT-001');
    fireEvent.changeText(screen.getByLabelText('Selling price (NGN)'), '3500.50');

    const saveButton = screen.getByRole('button', { name: 'Save product' });
    fireEvent.press(saveButton);
    fireEvent.press(saveButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishSave();
    });
  });

  it('shows the active SKU conflict returned by the local repository', async () => {
    const onSubmit = jest
      .fn<Promise<void>, [ValidProductDraft]>()
      .mockRejectedValue(
        new ProductRepositoryError('duplicate_sku', 'An active product already uses this SKU.'),
      );
    render(<ProductForm onCancel={jest.fn()} onSubmit={onSubmit} submitLabel="Save product" />);

    fireEvent.changeText(screen.getByLabelText('Product name'), 'Cotton shirt');
    fireEvent.changeText(screen.getByLabelText('SKU'), 'TEE-001');
    fireEvent.changeText(screen.getByLabelText('Selling price (NGN)'), '3500.50');
    fireEvent.press(screen.getByRole('button', { name: 'Save product' }));

    expect(await screen.findByText('An active product already uses this SKU.')).toBeTruthy();
  });
});
