import { useEffect, useState } from 'react';
import axiosInstance from '../../utils/axiosInstance';

type Product = { id: number; name: string };
type ProductResponse = { currentProductId: number | null; currentProductName: string | null; products: Product[] };
const empty = { currentProductId: null, currentProductName: null, products: [] };

export function useBookingAmendProducts(bookingId: number | null, refresh = 0) {
  const [catalog, setCatalog] = useState<ProductResponse>(empty);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setCatalog(empty); setSelectedId(null); setError(null); setLoading(Boolean(bookingId));
    if (bookingId) {
      axiosInstance.get<ProductResponse>(`/bookings/${bookingId}/amend-products`).then(({ data }) => {
        if (!active) return;
        if (!Array.isArray(data.products)) throw new Error('Invalid product response');
        setCatalog(data); setSelectedId(data.currentProductId == null ? null : String(data.currentProductId));
      }).catch(() => { if (active) setError('Unable to load permitted products. You can still amend the date and time.'); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [bookingId, refresh]);
  const options = catalog.products.map(product => ({ value: String(product.id), label: product.name }));
  if (catalog.currentProductId != null && !options.some(option => option.value === String(catalog.currentProductId))) {
    options.unshift({ value: String(catalog.currentProductId), label: `${catalog.currentProductName || 'Current product'} (current, inactive)` });
  }
  const changed = selectedId !== null && selectedId !== String(catalog.currentProductId);
  return { options, selectedId, setSelectedId, loading, error, changed,
    productId: changed ? Number(selectedId) : undefined,
    currentName: catalog.currentProductName,
    selectedName: catalog.products.find(product => String(product.id) === selectedId)?.name ?? catalog.currentProductName };
}
