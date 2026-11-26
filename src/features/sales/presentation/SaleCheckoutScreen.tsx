import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';

import type { Product } from '@/features/products/domain/product';
import type { CheckoutLine, PaymentMethod, Sale } from '@/features/sales/domain/sale';
import { calculateCheckoutLineTotals } from '@/features/sales/domain/checkoutCalculations';
import { createSale } from '@/features/sales/application/saleUseCases';
import { useProductServices } from '@/features/products/presentation/ProductServicesContext';
import { useInventoryServices } from '@/features/inventory/presentation/InventoryServicesContext';
import { useSalesServices } from './SalesServicesContext';
import { formatMinorCurrency, multiplyMinorUnitsByQuantity } from '@/shared/domain/money';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ErrorState } from '@/shared/ui/ErrorState';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';
import { Screen } from '@/shared/ui/Screen';
import { TextField } from '@/shared/ui/TextField';

type PickerProduct = { product: Product; available: number };
const paymentMethods: PaymentMethod[] = ['cash', 'transfer', 'other'];

export function SaleCheckoutScreen() {
  const { repository: productRepository, storeId } = useProductServices();
  const { repository: inventoryRepository } = useInventoryServices();
  const { repository: saleRepository } = useSalesServices();
  const router = useRouter();
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [cart, setCart] = useState<CheckoutLine[]>([]);
  const [query, setQuery] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const latestRefresh = useRef(refresh);
  useEffect(() => {
    latestRefresh.current = refresh;
  }, [refresh]);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingPriceChange, setPendingPriceChange] = useState<{
    productId: string;
    currentPriceMinor: number;
  } | null>(null);
  const [successSale, setSuccessSale] = useState<Sale | null>(null);
  const requestId = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setLoadError(false);
      void Promise.all([productRepository.list(storeId), inventoryRepository.listBalances(storeId)])
        .then(([rows, balances]) => {
          if (!active || refresh !== latestRefresh.current) return;
          const balanceByProduct = new Map(
            balances.map((balance) => [balance.productId, balance.estimatedAvailable]),
          );
          setProducts(
            rows.map((product) => ({
              product,
              available: balanceByProduct.get(product.id) ?? 0,
            })),
          );
        })
        .catch(() => {
          if (active && refresh === latestRefresh.current) setLoadError(true);
        })
        .finally(() => {
          if (active && refresh === latestRefresh.current) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [inventoryRepository, productRepository, refresh, storeId]),
  );

  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return products.filter(
      ({ product }) =>
        !normalized ||
        product.name.toLocaleLowerCase().includes(normalized) ||
        product.sku.toLocaleLowerCase().includes(normalized),
    );
  }, [products, query]);

  const total = useMemo(() => {
    try {
      return cart.length ? calculateCheckoutLineTotals(cart).totalMinor : 0;
    } catch {
      return null;
    }
  }, [cart]);

  const displayLineTotal = (unitPriceMinor: number, quantity: number) => {
    try {
      return formatMinorCurrency(multiplyMinorUnitsByQuantity(unitPriceMinor, quantity));
    } catch {
      return 'Amount limit exceeded';
    }
  };

  const add = (entry: PickerProduct) => {
    setErrorMessage(null);
    setCart((current) => {
      const existing = current.find((line) => line.productId === entry.product.id);
      if (!existing) {
        return [
          ...current,
          {
            productId: entry.product.id,
            quantity: 1,
            expectedUnitPriceMinor: entry.product.priceMinor,
          },
        ];
      }
      if (!Number.isSafeInteger(existing.quantity + 1)) return current;
      return current.map((line) =>
        line.productId === entry.product.id ? { ...line, quantity: line.quantity + 1 } : line,
      );
    });
  };

  const changeQuantity = (productId: string, delta: number) => {
    setCart((current) =>
      current
        .map((line) =>
          line.productId === productId ? { ...line, quantity: line.quantity + delta } : line,
        )
        .filter((line) => line.quantity > 0),
    );
    setErrorMessage(null);
  };

  const saveSale = async () => {
    if (busy || cart.length === 0 || total === null) {
      setErrorMessage(
        cart.length === 0
          ? 'Add at least one product to the sale.'
          : 'The total is too large to save.',
      );
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    requestId.current ??= randomUUID();
    try {
      const result = await createSale(saleRepository, {
        storeId,
        checkoutRequestId: requestId.current,
        lines: cart,
        customerName: customerName.trim() || null,
        paymentMethod,
      });
      if (result.status === 'success' || result.status === 'duplicate_attempt') {
        setSuccessSale(result.sale);
        setCart([]);
        setCustomerName('');
        requestId.current = null;
        setPendingPriceChange(null);
        setRefresh((value) => value + 1);
      } else if (result.status === 'price_changed') {
        setPendingPriceChange({
          productId: result.productId,
          currentPriceMinor: result.currentUnitPriceMinor,
        });
        setErrorMessage(
          'The price changed since review. Refresh it and review the new total before saving.',
        );
      } else if (result.status === 'insufficient_stock') {
        setErrorMessage(
          `Only ${result.estimatedAvailable} units are estimated available. Adjust the cart and retry.`,
        );
      } else if (result.status === 'product_unavailable') {
        setErrorMessage('A cart product is unavailable. Remove it and retry.');
      } else {
        setErrorMessage(result.message);
      }
    } catch {
      setErrorMessage(
        'The sale could not be saved locally. Your cart is still here; retry safely.',
      );
    } finally {
      setBusy(false);
    }
  };

  const cartProducts = cart.flatMap((line) => {
    const entry = products.find(({ product }) => product.id === line.productId);
    return entry ? [{ line, entry }] : [];
  });

  return (
    <Screen>
      {successSale ? (
        <View className="flex-1 justify-center gap-4">
          <View accessibilityRole="alert" className="gap-2 rounded-2xl bg-successSurface p-5">
            <Text className="text-xl font-bold text-ink">Sale saved on this device</Text>
            <Text className="text-base text-ink">
              {formatMinorCurrency(successSale.totalMinor)}
            </Text>
            <Text className="text-sm text-muted">
              Pending sync · provisional local stock and sales totals. Not a payment confirmation.
            </Text>
          </View>
          <Button
            label="View saved sale"
            onPress={() =>
              router.replace({ pathname: '/sale/[id]', params: { id: successSale.id } })
            }
          />
          <Button label="Back to sales" onPress={() => router.back()} variant="secondary" />
        </View>
      ) : loading ? (
        <LoadingIndicator label="Loading products for checkout" />
      ) : loadError ? (
        <ErrorState
          message="Products and estimated stock could not be loaded."
          onRetry={() => setRefresh((value) => value + 1)}
          title="Checkout unavailable"
        />
      ) : (
        <FlatList
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, gap: 12, paddingBottom: 28 }}
          data={visibleProducts}
          keyboardShouldPersistTaps="handled"
          keyExtractor={({ product }) => product.id}
          ListHeaderComponent={
            <View className="gap-4 pb-2">
              <View className="gap-1">
                <Text className="text-sm font-medium text-brand-700">New sale</Text>
                <Text className="text-2xl font-bold text-ink">Choose products</Text>
                <Text className="text-sm text-muted">
                  Stock and totals are local estimates until sync. Pending data stays on this
                  device.
                </Text>
              </View>
              <TextField
                accessibilityLabel="Search sale products by name or SKU"
                label="Search products"
                onChangeText={setQuery}
                placeholder="Name or SKU"
                returnKeyType="search"
                value={query}
              />
              <Text className="text-lg font-bold text-ink">Cart ({cart.length})</Text>
              {cartProducts.length === 0 ? (
                <EmptyState
                  description="Choose a product below to add it to the sale."
                  title="Cart is empty"
                />
              ) : (
                <View className="gap-2">
                  {cartProducts.map(({ line, entry }) => (
                    <View
                      key={line.productId}
                      className="gap-2 rounded-2xl border border-border bg-surface p-4"
                    >
                      <Text className="font-semibold text-ink">{entry.product.name}</Text>
                      <Text className="text-sm text-muted">
                        {formatMinorCurrency(line.expectedUnitPriceMinor)} each
                      </Text>
                      <View className="flex-row items-center gap-3">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Decrease ${entry.product.name} quantity`}
                          accessibilityState={{ disabled: busy }}
                          className="min-h-12 min-w-12 items-center justify-center rounded-xl border border-border"
                          disabled={busy}
                          onPress={() => changeQuantity(line.productId, -1)}
                        >
                          <Text className="text-lg font-bold text-ink">−</Text>
                        </Pressable>
                        <Text
                          accessibilityLabel={`${line.quantity} units in cart`}
                          className="text-base font-bold text-ink"
                        >
                          {line.quantity}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Increase ${entry.product.name} quantity`}
                          accessibilityState={{ disabled: busy }}
                          className="min-h-12 min-w-12 items-center justify-center rounded-xl border border-border"
                          disabled={busy || line.quantity >= Number.MAX_SAFE_INTEGER}
                          onPress={() => changeQuantity(line.productId, 1)}
                        >
                          <Text className="text-lg font-bold text-ink">+</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${entry.product.name} from cart`}
                          className="min-h-12 flex-1 items-center justify-center rounded-xl border border-danger px-3"
                          disabled={busy}
                          onPress={() =>
                            setCart((current) =>
                              current.filter((item) => item.productId !== line.productId),
                            )
                          }
                        >
                          <Text className="font-semibold text-danger">Remove</Text>
                        </Pressable>
                      </View>
                      <Text className="text-sm font-semibold text-ink">
                        Line total: {displayLineTotal(line.expectedUnitPriceMinor, line.quantity)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              <View className="gap-3 rounded-2xl border border-border bg-surface p-4">
                <Text className="text-lg font-bold text-ink">Checkout review</Text>
                <Text className="text-sm text-muted">
                  Local provisional total:{' '}
                  {total === null ? 'Amount limit exceeded' : formatMinorCurrency(total)}
                </Text>
                <TextField
                  label="Customer name (optional)"
                  maxLength={120}
                  onChangeText={setCustomerName}
                  value={customerName}
                />
                <Text accessibilityRole="text" className="text-sm font-medium text-ink">
                  Payment method label
                </Text>
                <View className="flex-row gap-2">
                  {paymentMethods.map((method) => (
                    <Pressable
                      key={method}
                      accessibilityRole="radio"
                      accessibilityLabel={method}
                      accessibilityState={{ checked: paymentMethod === method }}
                      className={`min-h-12 flex-1 items-center justify-center rounded-xl border px-2 ${paymentMethod === method ? 'border-brand-600 bg-brand-50' : 'border-border bg-surface'}`}
                      onPress={() => setPaymentMethod(method)}
                    >
                      <Text className="font-semibold capitalize text-ink">{method}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text className="text-xs text-muted">
                  A label only; this does not process or confirm payment.
                </Text>
                {errorMessage ? (
                  <View accessibilityRole="alert" className="gap-2 rounded-xl bg-dangerSurface p-3">
                    <Text className="text-sm text-danger">{errorMessage}</Text>
                    {errorMessage.toLocaleLowerCase().includes('price changed') ? (
                      <Button
                        label="Review changed price"
                        onPress={() => {
                          if (!pendingPriceChange) return;
                          setCart((current) =>
                            current.map((line) =>
                              line.productId === pendingPriceChange.productId
                                ? {
                                    ...line,
                                    expectedUnitPriceMinor: pendingPriceChange.currentPriceMinor,
                                  }
                                : line,
                            ),
                          );
                          setProducts((current) =>
                            current.map((entry) =>
                              entry.product.id === pendingPriceChange.productId
                                ? {
                                    ...entry,
                                    product: {
                                      ...entry.product,
                                      priceMinor: pendingPriceChange.currentPriceMinor,
                                    },
                                  }
                                : entry,
                            ),
                          );
                          setPendingPriceChange(null);
                          setErrorMessage(
                            'Price refreshed. Review the updated total before saving this sale.',
                          );
                        }}
                        variant="secondary"
                      />
                    ) : null}
                  </View>
                ) : null}
                <Button
                  disabled={busy || cart.length === 0 || total === null}
                  label={busy ? 'Saving sale…' : 'Create Sale'}
                  onPress={() => void saveSale()}
                />
              </View>
              <Text className="pt-2 text-lg font-bold text-ink">Available products</Text>
            </View>
          }
          ListEmptyComponent={
            visibleProducts.length === 0 ? (
              <EmptyState
                description={
                  query.trim()
                    ? 'Try another product name or SKU.'
                    : 'Create products before recording a sale.'
                }
                title={query.trim() ? 'No matching products' : 'No products available'}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <View className="gap-2 rounded-2xl border border-border bg-surface p-4">
              <Text className="text-base font-semibold text-ink">{item.product.name}</Text>
              <Text className="text-sm text-muted">SKU: {item.product.sku}</Text>
              <Text className="text-base font-bold text-ink">
                {formatMinorCurrency(item.product.priceMinor)}
              </Text>
              <Text className="text-xs text-muted">
                {item.available} estimated available · local estimate
              </Text>
              <Button
                disabled={busy || Boolean(item.product.deletedAt)}
                label={`Add ${item.product.name} to sale`}
                onPress={() => add(item)}
                variant="secondary"
              />
            </View>
          )}
        />
      )}
    </Screen>
  );
}
