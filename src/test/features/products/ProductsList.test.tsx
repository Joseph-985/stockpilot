import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import type { Product } from '@/features/products/domain/product';
import { ProductsList } from '@/features/products/presentation/ProductsList';

const product: Product = {
  id: 'product-1',
  storeId: 'demo-store',
  sku: 'SHIRT-001',
  name: 'Cotton shirt',
  description: null,
  category: 'Clothing',
  priceMinor: 350050,
  costMinor: null,
  lowStockThreshold: 0,
  serverVersion: 0,
  localRevision: 1,
  syncStatus: 'pending',
  createdAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
  deletedAt: null,
};

function renderList(overrides: Partial<ComponentProps<typeof ProductsList>> = {}) {
  return render(
    <ProductsList
      error={null}
      loading={false}
      onAdd={jest.fn()}
      onArchive={jest.fn()}
      onEdit={jest.fn()}
      onQueryChange={jest.fn()}
      onRetry={jest.fn()}
      products={[]}
      query=""
      {...overrides}
    />,
  );
}

describe('ProductsList', () => {
  it('shows an accessible loading state', () => {
    renderList({ loading: true });
    expect(screen.getByLabelText('Loading products')).toBeTruthy();
  });

  it('shows the empty catalog state', () => {
    renderList();
    expect(screen.getByText('No products yet')).toBeTruthy();
  });

  it('shows a no-search-results state', () => {
    renderList({ query: 'not-found' });
    expect(screen.getByText('No matching products')).toBeTruthy();
  });

  it('shows an error state and retries on request', () => {
    const onRetry = jest.fn();
    renderList({ error: 'Database unavailable', onRetry });

    expect(screen.getByText('Database unavailable')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows local product data, NGN price, pending status and actions', () => {
    const onEdit = jest.fn();
    const onArchive = jest.fn();
    renderList({ products: [product], onEdit, onArchive });

    expect(screen.getByText('Cotton shirt')).toBeTruthy();
    expect(screen.getByText('NGN 3,500.50')).toBeTruthy();
    expect(screen.getByLabelText('Pending sync')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Edit Cotton shirt' }));
    fireEvent.press(screen.getByRole('button', { name: 'Archive Cotton shirt' }));
    expect(onEdit).toHaveBeenCalledWith(product);
    expect(onArchive).toHaveBeenCalledWith(product);
  });
});
