import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { InventoryScreen } from '@/features/inventory/presentation/InventoryScreen';
import { StockMutationScreen } from '@/features/inventory/presentation/StockMutationScreen';
import { ProductMovementHistoryScreen } from '@/features/inventory/presentation/ProductMovementHistoryScreen';

const mockServices = {
  repository: { list: jest.fn(), getById: jest.fn() },
  inventoryRepository: {
    listBalances: jest.fn(),
    getBalance: jest.fn(),
    listMovements: jest.fn(),
    stockIn: jest.fn(),
    adjustStock: jest.fn(),
  },
  storeId: '20000000-0000-4000-8000-000000000001',
};
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: mockPush },
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/features/products/presentation/ProductServicesContext', () => ({
  useProductServices: () => ({ repository: mockServices.repository }),
}));
jest.mock('@/features/inventory/presentation/InventoryServicesContext', () => ({
  useInventoryServices: () => ({
    repository: mockServices.inventoryRepository,
    storeId: mockServices.storeId,
  }),
}));

describe('InventoryScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows estimated quantity, low-stock threshold and pending state, and opens the movement history', async () => {
    mockServices.repository.list.mockResolvedValue([
      {
        id: '40000000-0000-4000-8000-000000000001',
        name: 'Basic Cotton Top',
        sku: 'TEE-001',
        lowStockThreshold: 3,
      },
    ]);
    mockServices.inventoryRepository.listBalances.mockResolvedValue([
      {
        storeId: mockServices.storeId,
        productId: '40000000-0000-4000-8000-000000000001',
        baseQuantity: 0,
        pendingDelta: 2,
        estimatedAvailable: 2,
        hasPendingChanges: true,
        serverVersion: 0,
        updatedAt: '2026-11-16T10:00:00.000Z',
      },
    ]);

    render(<InventoryScreen />);
    expect(await screen.findByText('2 estimated available')).toBeTruthy();
    expect(screen.getByText('Low stock')).toBeTruthy();
    expect(screen.getByLabelText('Pending sync')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('View Basic Cotton Top movement history'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/inventory/[productId]',
      params: { productId: '40000000-0000-4000-8000-000000000001' },
    });
  });

  it('shows a clear empty state when there are no products', async () => {
    mockServices.repository.list.mockResolvedValue([]);
    mockServices.inventoryRepository.listBalances.mockResolvedValue([]);
    render(<InventoryScreen />);
    await waitFor(() => expect(screen.getByText('No products yet')).toBeTruthy());
  });

  it('shows an error state when local stock data cannot be read', async () => {
    mockServices.repository.list.mockRejectedValue(new Error('database unavailable'));
    mockServices.inventoryRepository.listBalances.mockResolvedValue([]);
    render(<InventoryScreen />);
    expect(await screen.findByText('Inventory unavailable')).toBeTruthy();
  });

  it('links a sale movement to the immutable sale detail', async () => {
    const productId = '40000000-0000-4000-8000-000000000001';
    const saleId = '50000000-0000-4000-8000-000000000001';
    mockServices.repository.getById.mockResolvedValue({
      id: productId,
      name: 'Basic Cotton Top',
      sku: 'TEE-001',
      deletedAt: null,
    });
    mockServices.inventoryRepository.getBalance.mockResolvedValue({ estimatedAvailable: 2 });
    mockServices.inventoryRepository.listMovements.mockResolvedValue([
      {
        id: '60000000-0000-4000-8000-000000000001',
        kind: 'sale',
        deltaQuantity: -1,
        reason: null,
        saleId,
        occurredAt: '2026-11-26T10:00:00.000Z',
      },
    ]);

    render(<ProductMovementHistoryScreen productId={productId} />);
    fireEvent.press(await screen.findByLabelText('View linked sale'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sale/[id]', params: { id: saleId } });
  });

  it('shows adjustment quantity and required-reason validation without calling persistence', async () => {
    mockServices.repository.getById.mockResolvedValue({
      id: '40000000-0000-4000-8000-000000000001',
      name: 'Basic Cotton Top',
      sku: 'TEE-001',
      deletedAt: null,
    });
    mockServices.inventoryRepository.getBalance.mockResolvedValue({
      estimatedAvailable: 4,
    });

    render(
      <StockMutationScreen mode="adjustment" productId="40000000-0000-4000-8000-000000000001" />,
    );
    fireEvent.changeText(await screen.findByLabelText('Signed quantity change'), '-1');
    fireEvent.press(screen.getByLabelText('Adjust stock'));

    expect(await screen.findByText('A reason is required for stock adjustments.')).toBeTruthy();
    expect(mockServices.inventoryRepository.adjustStock).not.toHaveBeenCalled();
  });
});
