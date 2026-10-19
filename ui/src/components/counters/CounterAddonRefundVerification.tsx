import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { counterAddonRefund, type CounterAddonRefundResult, type CounterAddonRefundVerification } from '../../api/counterAddonRefunds';
import type { OrderExtras } from '../../store/bookingPlatformsTypes';

type Props = {
  bookingId: number;
  extras: Partial<OrderExtras>;
  expectedExtras: OrderExtras;
  autoVerify?: boolean;
  refreshKey?: number;
  onVerificationChange?: (verification: CounterAddonRefundVerification | null) => void;
  onRectified: (result: CounterAddonRefundResult) => void | Promise<void>;
};

const CounterAddonRefundVerificationPanel = ({ bookingId, extras, expectedExtras, autoVerify = false, refreshKey = 0, onVerificationChange, onRectified }: Props) => {
  const [verification, setVerification] = useState<CounterAddonRefundVerification | null>(null);
  const [loading, setLoading] = useState(false);
  const [rectifying, setRectifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const callbacks = useRef({ onVerificationChange, onRectified });
  callbacks.current = { onVerificationChange, onRectified };
  const cocktails = extras.cocktails ?? 0;
  const tshirts = extras.tshirts ?? 0;
  const photos = extras.photos ?? 0;
  const quantities = useMemo(() => ({ cocktails, tshirts, photos }), [cocktails, tshirts, photos]);
  const expectedCocktails = expectedExtras.cocktails;
  const expectedTshirts = expectedExtras.tshirts;
  const expectedPhotos = expectedExtras.photos;
  const expected = useMemo(() => ({ cocktails: expectedCocktails, tshirts: expectedTshirts, photos: expectedPhotos }), [expectedCocktails, expectedTshirts, expectedPhotos]);

  const verify = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    setVerification(null);
    callbacks.current.onVerificationChange?.(null);
    try {
      const result = await counterAddonRefund(bookingId, 'verify', quantities, undefined, expected);
      if (sequence.current !== request) return;
      setVerification(result.verification);
      callbacks.current.onVerificationChange?.(result.verification);
    } catch (failure) {
      if (sequence.current !== request) return;
      setError((failure as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Stripe verification failed. Refund controls remain blocked until verification succeeds.');
    } finally {
      if (sequence.current === request) setLoading(false);
    }
  }, [bookingId, quantities, expected]);

  useEffect(() => {
    setVerification(null);
    setError(null);
    callbacks.current.onVerificationChange?.(null);
    if (autoVerify) void verify();
    return () => { sequence.current += 1; };
  }, [autoVerify, verify, refreshKey]);

  const rectify = async () => {
    if (!verification || verification.status !== 'verified') return;
    const request = ++sequence.current;
    setRectifying(true);
    setError(null);
    try {
      const result = await counterAddonRefund(bookingId, 'rectify', quantities, verification.selectionKey, expected);
      if (sequence.current !== request) return;
      if (!result.applied) throw new Error('The booking was not rectified. Verify its refund again.');
      await callbacks.current.onRectified(result);
      if (sequence.current === request) {
        setVerification(null);
        callbacks.current.onVerificationChange?.(null);
      }
    } catch (failure) {
      if (sequence.current !== request) return;
      setVerification(null);
      callbacks.current.onVerificationChange?.(null);
      setError((failure as { response?: { data?: { message?: string } } }).response?.data?.message ?? (failure instanceof Error ? failure.message : 'Rectification failed. Verify the refund again.'));
    } finally {
      if (sequence.current === request) setRectifying(false);
    }
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" onClick={() => void verify()} disabled={loading || rectifying}>
          {loading ? <><CircularProgress size={14} sx={{ mr: 1 }} />Verifying Stripe…</> : 'Verify'}
        </Button>
        {verification?.status === 'verified' && (
          <Button size="small" color="success" variant="contained" onClick={() => void rectify()} disabled={loading || rectifying}>
            {rectifying ? 'Rectifying…' : 'Rectify the booking'}
          </Button>
        )}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {verification && (
        <Alert severity={verification.status === 'verified' ? 'success' : verification.status === 'clear' ? 'info' : 'warning'}>
          <Typography variant="body2">{verification.message}</Typography>
          <Typography variant="caption" display="block">
            Add-ons: {(verification.amount / 100).toFixed(2)} {verification.currency} · Booking: {(verification.bookingAmount / 100).toFixed(2)} {verification.currency}
          </Typography>
          {verification.refunds.map((refund) => (
            <Typography variant="caption" display="block" key={refund.id}>
              {refund.id}: {(refund.amount / 100).toFixed(2)} {verification.currency} · {refund.status ?? 'unknown'}
            </Typography>
          ))}
        </Alert>
      )}
    </Stack>
  );
};

export default CounterAddonRefundVerificationPanel;
