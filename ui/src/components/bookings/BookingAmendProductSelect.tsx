import { Select, Text, Stack } from '@mantine/core';
import type { useBookingAmendProducts } from './useBookingAmendProducts';

export default function BookingAmendProductSelect({ products, disabled, onChange }: {
  products: ReturnType<typeof useBookingAmendProducts>; disabled: boolean; onChange?: () => void;
}) {
  return <Stack gap={4}>
    <Select label="Product" placeholder={products.loading ? 'Loading products…' : 'Keep current product'} searchable
      description="Changes the product assigned in OmniLodge. The booking price, payments and add-ons stay the same."
      data={products.options} value={products.selectedId} allowDeselect={false}
      disabled={disabled || products.loading || Boolean(products.error)}
      onChange={value => { products.setSelectedId(value); onChange?.(); }} />
    {products.error ? <Text size="sm" c="orange">{products.error}</Text> : null}
  </Stack>;
}
