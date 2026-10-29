import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import axiosInstance from '../../utils/axiosInstance';
import type { UnifiedOrder } from '../../store/bookingPlatformsTypes';

dayjs.extend(utc);
dayjs.extend(timezone);
type Operation = 'amend' | 'cancel';
type Preview = { booking: { id: number; status: string; productName: string; platform: string;
  platformBookingId: string; experienceStartAt: string | null; updatedAt: string }; hasCustomerEmail: boolean };
type Delivery = { status: 'sent' | 'skipped' | 'failed'; reason?: string };
type Result = { message: string; notifications: { customer: Delivery; internal: Delivery }; notificationAuditSaved: boolean };
const errorMessage = (error: unknown) => {
  const e = error as { response?: { data?: { message?: string } }; message?: string };
  return e.response?.data?.message || e.message || 'Unable to update the booking.';
};

export default function BookingLocalActionModal({ bookingId, order, operation, canManage, onClose, onSaved }: {
  bookingId: number; order: UnifiedOrder; operation: Operation; canManage: boolean; onClose: () => void; onSaved: () => void;
}) {
  const mobile = useMediaQuery('(max-width: 48em)');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [sendCustomerEmail, setSendCustomerEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setPreview(null);
    axiosInstance.get<Preview>(`/bookings/${bookingId}/local-actions/preview`).then(response => {
      if (!active) return;
      setPreview(response.data);
      const start = response.data.booking.experienceStartAt;
      setDate(start ? dayjs(start).tz('Europe/Warsaw').format('YYYY-MM-DD') : order.date);
      setTime(start ? dayjs(start).tz('Europe/Warsaw').format('HH:mm') : order.timeslot);
    }).catch(e => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bookingId, order.date, order.timeslot, refresh]);
  const scheduleChanged = preview?.booking.experienceStartAt
    ? `${date} ${time}` !== dayjs(preview.booking.experienceStartAt).tz('Europe/Warsaw').format('YYYY-MM-DD HH:mm')
    : Boolean(date && time);
  const canSubmit = canManage && preview && !loading && !submitting && !result
    && preview.booking.status !== 'cancelled' && reason.trim()
    && (operation === 'cancel' || (date && time && scheduleChanged));
  const submit = async () => {
    if (!canSubmit || !preview) return;
    setSubmitting(true); setError(null);
    try {
      const response = await axiosInstance.post<Result>(`/bookings/${bookingId}/local-actions/${operation}`, {
        expectedUpdatedAt: preview.booking.updatedAt, reason: reason.trim(), sendCustomerEmail,
        ...(operation === 'amend' ? { pickupDate: date, pickupTime: time } : {}),
      });
      setResult(response.data); onSaved();
    } catch (e) { setError(errorMessage(e)); } finally { setSubmitting(false); }
  };
  return <Modal opened onClose={() => { if (!submitting) onClose(); }} fullScreen={mobile} centered size="lg"
    title={`Force ${operation} — OmniLodge only`} closeOnClickOutside={!submitting} closeOnEscape={!submitting} withCloseButton={!submitting}>
    <Stack gap="md">
      <Alert color="orange" title="Local reservation correction">
        This changes OmniLodge only. It does not update {order.platform}, contact its API, or process a payment or refund.
        Handle platform changes and refunds separately. Older replayed emails will not undo this correction; newer platform updates can still apply.
      </Alert>
      <Stack gap={4} align="center">
        <Text fw={700} ta="center">{order.customerName || 'Guest'} · {order.productName}</Text>
        <Group justify="center"><Badge variant="light">{order.platform}</Badge><Text size="sm">{order.platformBookingId}</Text></Group>
        <Text size="sm" c="dimmed" ta="center">{order.quantity} guests · Current start: {preview?.booking.experienceStartAt
          ? dayjs(preview.booking.experienceStartAt).tz('Europe/Warsaw').format('D MMM YYYY, HH:mm') : `${order.date} ${order.timeslot}`} · Europe/Warsaw</Text>
      </Stack>
      {loading ? <Group justify="center"><Loader size="sm" /><Text size="sm">Checking booking access and latest details…</Text></Group> : null}
      {!canManage ? <Alert color="red">Your current account cannot force booking changes.</Alert> : null}
      {preview?.booking.status === 'cancelled' && !result ? <Alert color="yellow">This booking is already cancelled.</Alert> : null}
      {!result && operation === 'amend' ? <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput type="date" label="New date (Warsaw)" value={date} required disabled={submitting || loading}
          onChange={event => setDate(event.currentTarget.value)} />
        <TextInput type="time" label="New time (Warsaw)" value={time} required disabled={submitting || loading}
          onChange={event => setTime(event.currentTarget.value)} />
      </SimpleGrid> : null}
      {!result ? <>
        <Textarea label="Reason for this force action" description="Recorded in the internal audit history; not included in the customer email."
          value={reason} onChange={event => setReason(event.currentTarget.value)} required maxLength={2000} autosize minRows={2}
          disabled={submitting || loading} />
        <Checkbox label="Send customer notification" checked={sendCustomerEmail} disabled={submitting || loading || !preview?.hasCustomerEmail}
          onChange={event => setSendCustomerEmail(event.currentTarget.checked)} />
        <Text size="sm" c="dimmed">An internal notification will also be sent using the existing Control Panel email settings.</Text>
        {preview && !preview.hasCustomerEmail ? <Alert color="yellow">No customer email is saved. The correction is still available; only the internal notification can be sent.</Alert> : null}
      </> : <Alert color="teal" title="Booking change saved">
        <Stack gap="xs"><Text size="sm">{result.message}</Text>
          {(['customer', 'internal'] as const).map(target => <Text size="sm" key={target}>
            {target === 'customer' ? 'Customer email' : 'Internal email'}: {result.notifications[target].status}
            {result.notifications[target].reason ? ` — ${result.notifications[target].reason}` : ''}
          </Text>)}
          {!result.notificationAuditSaved ? <Text size="sm" c="red">Notification audit could not be saved. Do not repeat the booking action; contact an administrator.</Text> : null}
          <Text size="sm">No refund was issued. Do not repeat the action to retry an email.</Text>
        </Stack>
      </Alert>}
      {error ? <Alert color="red" title="Action not completed">{error}</Alert> : null}
      <Group justify="flex-end" wrap="wrap">
        <Button variant="default" onClick={onClose} disabled={submitting}>{result ? 'Done' : 'Keep booking unchanged'}</Button>
        {!result && !submitting ? <Button variant="subtle" onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh booking</Button> : null}
        {!result ? <Button color={operation === 'cancel' ? 'red' : 'blue'} loading={submitting} disabled={!canSubmit} onClick={() => void submit()}>
          {operation === 'cancel' ? 'Confirm force cancellation' : 'Confirm force amendment'}
        </Button> : null}
      </Group>
    </Stack>
  </Modal>;
}
