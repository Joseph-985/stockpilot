import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { adjustStock, stockIn } from '@/features/inventory/application/inventoryUseCases';
import type { StockBalance } from '@/features/inventory/domain/inventory';
import type { Product } from '@/features/products/domain/product';
import { useProductServices } from '@/features/products/presentation/ProductServicesContext';
import { useInventoryServices } from './InventoryServicesContext';
import { Button } from '@/shared/ui/Button';
import { ErrorState } from '@/shared/ui/ErrorState';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';
import { Screen } from '@/shared/ui/Screen';
import { TextField } from '@/shared/ui/TextField';

type MutationMode = 'stock_in' | 'adjustment';

export function StockMutationScreen({
  mode,
  productId,
}: {
  mode: MutationMode;
  productId?: string;
}) {
  const { repository } = useProductServices();
  const { repository: inventoryRepository, storeId } = useInventoryServices();
  const [product, setProduct] = useState<Product | null>(null);
  const [balance, setBalance] = useState<StockBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [quantityError, setQuantityError] = useState<string | undefined>();
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setLoadError(false);
      if (!productId) {
        setProduct(null);
        setLoadError(true);
        setLoading(false);
        return;
      }
      void Promise.all([
        repository.getById(storeId, productId),
        inventoryRepository.getBalance(storeId, productId),
      ])
        .then(([foundProduct, currentBalance]) => {
          if (!active) return;
          if (!foundProduct) {
            setProduct(null);
            setLoadError(true);
            return;
          }
          setProduct(foundProduct);
          setBalance(currentBalance);
        })
        .catch(() => {
          if (active) setLoadError(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [inventoryRepository, productId, repository, storeId]),
  );

  async function submit() {
    if (savingRef.current) return;
    setFormError(null);
    setQuantityError(undefined);
    setReasonError(undefined);
    const rawQuantity = quantity.trim();
    const validInteger =
      mode === 'stock_in' ? /^\d+$/.test(rawQuantity) : /^[+-]?\d+$/.test(rawQuantity);
    const parsedQuantity = validInteger ? Number(rawQuantity) : Number.NaN;
    if (
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity === 0 ||
      (mode === 'stock_in' && parsedQuantity < 0)
    ) {
      setQuantityError(
        mode === 'stock_in'
          ? 'Enter a positive whole-number quantity.'
          : 'Enter a nonzero signed whole-number change.',
      );
      return;
    }
    if (mode === 'adjustment' && !reason.trim()) {
      setReasonError('A reason is required for stock adjustments.');
      return;
    }
    if (!product) {
      setFormError('This active product could not be found in the current store.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const result =
        mode === 'stock_in'
          ? await stockIn(inventoryRepository, {
              storeId,
              productId: product.id,
              quantity: parsedQuantity,
              note: note.trim() || null,
            })
          : await adjustStock(inventoryRepository, {
              storeId,
              productId: product.id,
              deltaQuantity: parsedQuantity,
              reason,
            });
      if (result.status === 'success') {
        router.back();
      } else if (result.status === 'insufficient_stock') {
        setQuantityError(
          `Only ${result.estimatedAvailable} units are estimated available. The adjustment would go below zero.`,
        );
      } else if (result.status === 'validation_error') {
        setFormError(result.message);
      } else if (result.status === 'product_unavailable') {
        setFormError('This product is no longer active in the current store.');
      } else {
        setFormError(result.message);
      }
    } catch {
      setFormError('Inventory could not be saved locally. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const title = mode === 'stock_in' ? 'Stock in' : 'Adjust stock';
  return (
    <Screen>
      {loading ? (
        <LoadingIndicator label="Loading product inventory" />
      ) : loadError || !product ? (
        <ErrorState
          message="Choose an active product from the inventory list and try again."
          onRetry={() => router.back()}
          title="Product unavailable"
        />
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerClassName="gap-4 pb-8" keyboardShouldPersistTaps="handled">
            <View className="gap-1">
              <Text className="text-sm font-medium text-brand-700">{product.name}</Text>
              <Text className="text-2xl font-bold text-ink">{title}</Text>
              <Text className="text-sm text-muted">
                Estimated available: {balance?.estimatedAvailable ?? 0}. This is local provisional
                stock.
              </Text>
            </View>
            <TextField
              accessibilityHint={
                mode === 'stock_in'
                  ? 'Enter a positive whole number.'
                  : 'Enter a signed whole number; negative values reduce estimated availability.'
              }
              errorMessage={quantityError}
              keyboardType="numbers-and-punctuation"
              label={mode === 'stock_in' ? 'Quantity to add' : 'Signed quantity change'}
              onChangeText={(value) => {
                setQuantity(value);
                setQuantityError(undefined);
              }}
              placeholder={mode === 'stock_in' ? 'e.g. 20' : 'e.g. -1 or 5'}
              returnKeyType={mode === 'stock_in' ? 'next' : 'next'}
              value={quantity}
            />
            {mode === 'stock_in' ? (
              <TextField
                label="Note (optional)"
                maxLength={500}
                onChangeText={setNote}
                placeholder="e.g. Opening stock"
                value={note}
              />
            ) : (
              <TextField
                accessibilityHint="Required audit reason for this adjustment."
                errorMessage={reasonError}
                label="Reason (required)"
                maxLength={500}
                onChangeText={(value) => {
                  setReason(value);
                  setReasonError(undefined);
                }}
                placeholder="e.g. Damaged item"
                value={reason}
              />
            )}
            <Text accessibilityRole="text" className="text-sm text-muted">
              This change will be saved locally and marked Pending sync.
            </Text>
            {formError ? (
              <Text
                accessibilityRole="alert"
                className="rounded-xl bg-dangerSurface p-3 text-sm text-danger"
              >
                {formError}
              </Text>
            ) : null}
            <Button
              disabled={saving}
              label={saving ? 'Saving inventory…' : title}
              onPress={() => void submit()}
            />
            <Button
              disabled={saving}
              label="Cancel"
              onPress={() => router.back()}
              variant="secondary"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}
