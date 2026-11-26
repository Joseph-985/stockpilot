import { fireEvent, render, screen } from '@testing-library/react-native';

import { SaleCheckoutScreen } from '@/features/sales/presentation/SaleCheckoutScreen';
import { SaleDetailScreen } from '@/features/sales/presentation/SaleDetailScreen';
import { SalesScreen } from '@/features/sales/presentation/SalesScreen';
import { DashboardScreen } from '@/features/dashboard/presentation/DashboardScreen';

const mockStoreId = '20000000-0000-4000-8000-000000000001';
const productId = '40000000-0000-4000-8000-000000000001';
const saleId = '50000000-0000-4000-8000-000000000001';
const mockServices = {
  products: { list: jest.fn(), getById: jest.fn() },
  inventory: { listBalances: jest.fn() },
  sales: { list: jest.fn(), getById: jest.fn(), create: jest.fn(), getDailySummary: jest.fn() },
};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-crypto', () => ({ randomUUID: () => '60000000-0000-4000-8000-000000000001' }));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
  useRouter: () => mockRouter,
}));
jest.mock('@/features/products/presentation/ProductServicesContext', () => ({
  useProductServices: () => ({ repository: mockServices.products, storeId: mockStoreId }),
}));
jest.mock('@/features/inventory/presentation/InventoryServicesContext', () => ({
  useInventoryServices: () => ({ repository: mockServices.inventory, storeId: mockStoreId }),
}));
jest.mock('@/features/sales/presentation/SalesServicesContext', () => ({
  useSalesServices: () => ({ repository: mockServices.sales, storeId: mockStoreId }),
}));

const product = {
  id: productId,
  name: 'Basic Cotton Top',
  sku: 'TEE-001',
  priceMinor: 350000,
  lowStockThreshold: 3,
  deletedAt: null,
};

describe('sales screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServices.products.list.mockResolvedValue([product]);
    mockServices.products.getById.mockResolvedValue(product);
    mockServices.inventory.listBalances.mockResolvedValue([{ productId, estimatedAvailable: 5 }]);
  });

  it('shows saved sales as pending and provisional', async () => {
    mockServices.sales.list.mockResolvedValue([
      {
        id: saleId,
        totalMinor: 350000,
        occurredAt: '2026-11-26T10:00:00.000Z',
        customerName: null,
        items: [{ productId }],
      },
    ]);

    render(<SalesScreen />);
    expect(await screen.findByText('Pending sync · provisional')).toBeTruthy();
    expect(
      screen.getByText(
        'Local records are provisional until they sync. Pending data is stored only on this device.',
      ),
    ).toBeTruthy();
  });

  it('preserves the cart and gives an actionable message when stock changes before save', async () => {
    mockServices.sales.create.mockResolvedValue({
      status: 'insufficient_stock',
      productId,
      requestedQuantity: 1,
      estimatedAvailable: 0,
    });
    render(<SaleCheckoutScreen />);
    fireEvent.press(await screen.findByLabelText('Add Basic Cotton Top to sale'));
    fireEvent.press(screen.getByLabelText('Create Sale'));

    expect(
      await screen.findByText('Only 0 units are estimated available. Adjust the cart and retry.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('1 units in cart')).toBeTruthy();
    expect(mockServices.sales.create).toHaveBeenCalledTimes(1);
  });

  it('reuses one checkout ID after an unknown outcome and shows the committed sale on retry', async () => {
    mockServices.sales.create
      .mockResolvedValueOnce({
        status: 'persistence_failure',
        message: 'Sale could not be saved locally. No partial sale was kept.',
      })
      .mockResolvedValueOnce({
        status: 'duplicate_attempt',
        sale: {
          id: saleId,
          storeId: mockStoreId,
          checkoutRequestId: '60000000-0000-4000-8000-000000000001',
          customerName: null,
          paymentMethod: 'cash',
          currency: 'NGN',
          totalMinor: 350000,
          status: 'pending',
          occurredAt: '2026-11-26T10:00:00.000Z',
          createdAt: '2026-11-26T10:00:00.000Z',
          items: [],
        },
      });
    render(<SaleCheckoutScreen />);
    fireEvent.press(await screen.findByLabelText('Add Basic Cotton Top to sale'));
    fireEvent.press(screen.getByLabelText('Create Sale'));
    expect(
      await screen.findByText('Sale could not be saved locally. No partial sale was kept.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Create Sale'));

    expect(await screen.findByText('Sale saved on this device')).toBeTruthy();
    const firstRequest = mockServices.sales.create.mock.calls[0][0];
    const retryRequest = mockServices.sales.create.mock.calls[1][0];
    expect(retryRequest.checkoutRequestId).toBe(firstRequest.checkoutRequestId);
    expect(mockServices.sales.create).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText('Create Sale')).toBeNull();
  });

  it('keeps the cart after a stale-price result and requires reviewing the refreshed total', async () => {
    mockServices.sales.create.mockResolvedValueOnce({
      status: 'price_changed',
      productId,
      expectedUnitPriceMinor: 350000,
      currentUnitPriceMinor: 360000,
    });
    mockServices.products.getById.mockResolvedValue({ ...product, priceMinor: 360000 });
    render(<SaleCheckoutScreen />);
    fireEvent.press(await screen.findByLabelText('Add Basic Cotton Top to sale'));
    fireEvent.press(screen.getByLabelText('Create Sale'));
    fireEvent.press(await screen.findByLabelText('Review changed price'));

    expect(
      await screen.findByText('Price refreshed. Review the updated total before saving this sale.'),
    ).toBeTruthy();
    expect(screen.getByText(/Local provisional total:.*3,600\.00/)).toBeTruthy();
    expect(screen.getByLabelText('1 units in cart')).toBeTruthy();
  });

  it('shows immutable product price snapshots from the saved sale record', async () => {
    mockServices.sales.getById.mockResolvedValue({
      id: saleId,
      totalMinor: 350000,
      occurredAt: '2026-11-26T10:00:00.000Z',
      paymentMethod: 'cash',
      customerName: null,
      items: [
        {
          productId,
          productNameSnapshot: 'Name at sale time',
          skuSnapshot: 'OLD-SKU',
          quantity: 1,
          unitPriceMinor: 350000,
          lineTotalMinor: 350000,
        },
      ],
    });
    render(<SaleDetailScreen saleId={saleId} />);

    expect(await screen.findByText('Name at sale time')).toBeTruthy();
    expect(screen.getByText('SKU: OLD-SKU')).toBeTruthy();
    expect(screen.getByText('Pending sync · provisional')).toBeTruthy();
  });

  it('shows daily provisional sales and low-stock counts from local repositories', async () => {
    mockServices.sales.getDailySummary.mockResolvedValue({
      count: 2,
      totalMinor: 700000,
      pendingCount: 2,
    });
    mockServices.inventory.listBalances.mockResolvedValue([{ productId, estimatedAvailable: 2 }]);

    render(<DashboardScreen />);

    expect(await screen.findByText('NGN 7,000.00')).toBeTruthy();
    expect(screen.getByText('Low-stock products')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText(/2 saved · 2 pending sync/)).toBeTruthy();
    expect(
      screen.getByText('Includes provisional sales recorded on this device; not server-confirmed.'),
    ).toBeTruthy();
  });
});
