import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { ProductRepositoryError } from '../domain/ProductRepository';
import type { ProductDraft, ValidProductDraft } from '../domain/product';
import { ProductDraftSchema } from '../domain/validation';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';

type ProductFormValues = {
  sku: string;
  name: string;
  price: string;
  cost: string;
  category: string;
  description: string;
  lowStockThreshold: string;
};

type ProductFormProps = {
  initialValues?: ProductFormValues;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (draft: ValidProductDraft) => Promise<void>;
  onArchive?: () => void;
};

type FormField = keyof ProductFormValues;
type FormErrors = Partial<Record<FormField, string>>;

const emptyValues: ProductFormValues = {
  sku: '',
  name: '',
  price: '',
  cost: '',
  category: '',
  description: '',
  lowStockThreshold: '0',
};

export function toProductFormValues(draft: ProductDraft): ProductFormValues {
  return {
    sku: draft.sku,
    name: draft.name,
    price: draft.price,
    cost: draft.cost == null ? '' : draft.cost,
    category: draft.category ?? '',
    description: draft.description ?? '',
    lowStockThreshold: String(draft.lowStockThreshold),
  };
}

export function ProductForm({
  initialValues = emptyValues,
  submitLabel,
  onCancel,
  onSubmit,
  onArchive,
}: ProductFormProps) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  function updateField(field: FormField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  async function handleSubmit() {
    if (submittingRef.current) return;
    setFormError(null);

    const thresholdInput = values.lowStockThreshold.trim();
    const threshold =
      thresholdInput !== '' &&
      /^\d+$/.test(thresholdInput) &&
      Number.isSafeInteger(Number(thresholdInput))
        ? Number(thresholdInput)
        : Number.NaN;
    const result = ProductDraftSchema.safeParse({
      ...values,
      lowStockThreshold: threshold,
    });

    if (!result.success) {
      const nextErrors: FormErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && field in values && !nextErrors[field as FormField]) {
          nextErrors[field as FormField] = issue.message;
        }
      }
      if (!nextErrors.lowStockThreshold && !Number.isFinite(threshold)) {
        nextErrors.lowStockThreshold = 'Enter a whole-number threshold.';
      }
      setErrors(nextErrors);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit(result.data);
    } catch (error) {
      if (error instanceof ProductRepositoryError && error.code === 'duplicate_sku') {
        setErrors((current) => ({ ...current, sku: error.message }));
      } else {
        setFormError('The product could not be saved locally. Please try again.');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <TextField
          autoCapitalize="words"
          errorMessage={errors.name}
          label="Product name"
          onChangeText={(value) => updateField('name', value)}
          placeholder="e.g. Cotton shirt"
          returnKeyType="next"
          value={values.name}
        />
        <TextField
          autoCapitalize="characters"
          autoCorrect={false}
          errorMessage={errors.sku}
          label="SKU"
          onChangeText={(value) => updateField('sku', value)}
          placeholder="e.g. SHIRT-001"
          returnKeyType="next"
          value={values.sku}
        />
        <TextField
          errorMessage={errors.price}
          keyboardType="decimal-pad"
          label="Selling price (NGN)"
          onChangeText={(value) => updateField('price', value)}
          placeholder="0.00"
          returnKeyType="next"
          value={values.price}
        />
        <TextField
          errorMessage={errors.cost}
          keyboardType="decimal-pad"
          label="Cost price (NGN, optional)"
          onChangeText={(value) => updateField('cost', value)}
          placeholder="Leave blank if unknown"
          returnKeyType="next"
          value={values.cost}
        />
        <TextField
          autoCapitalize="words"
          errorMessage={errors.category}
          label="Category (optional)"
          onChangeText={(value) => updateField('category', value)}
          placeholder="e.g. Clothing"
          returnKeyType="next"
          value={values.category}
        />
        <TextField
          errorMessage={errors.description}
          label="Description (optional)"
          multiline
          onChangeText={(value) => updateField('description', value)}
          placeholder="Add product details"
          returnKeyType="default"
          style={{ minHeight: 96, textAlignVertical: 'top' }}
          value={values.description}
        />
        <TextField
          errorMessage={errors.lowStockThreshold}
          keyboardType="number-pad"
          label="Low-stock threshold"
          onChangeText={(value) => updateField('lowStockThreshold', value)}
          returnKeyType="done"
          value={values.lowStockThreshold}
        />
        {formError ? (
          <View accessibilityRole="alert" className="rounded-xl bg-dangerSurface p-3">
            <Text className="text-sm text-danger">{formError}</Text>
          </View>
        ) : null}
        <Button
          disabled={submitting}
          label={submitting ? 'Saving product…' : submitLabel}
          onPress={() => void handleSubmit()}
        />
        <Button disabled={submitting} label="Cancel" onPress={onCancel} variant="secondary" />
        {onArchive ? (
          <Button
            disabled={submitting}
            label="Archive product"
            onPress={onArchive}
            variant="secondary"
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
