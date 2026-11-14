import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Box, Button, Center, Group, Loader, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { IconCheck, IconExternalLink, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import { useAppSelector } from '../../store/hooks';
import { useExternalRefundAction, useHomeExternalRefunds, externalRefundError,
  type ExternalRefundAction, type PendingExternalRefundBooking } from '../../api/homeExternalRefunds';
import { canLoadHomeExternalRefunds } from './homeExternalRefundAccess';

const ADDONS = { cocktails: 'Cocktails', tshirts: 'T-Shirts', photos: 'Photos' };
const PLATFORMS: Record<string, string> = { getyourguide: 'GetYourGuide', viator: 'Viator',
  airbnb: 'Airbnb', freetour: 'FreeTour', civitatis: 'Civitatis', rezdy: 'Rezdy' };
type Decision = { booking: PendingExternalRefundBooking; action: ExternalRefundAction; operation: 'complete' | 'delete' };

export default function HomeExternalRefunds({ configuredVisible, audienceReady, compact = false }: {
  configuredVisible: boolean; audienceReady: boolean; compact?: boolean;
}) {
  const access = useModuleAccess('booking-management');
  const role = useAppSelector(state => state.session.roleSlug);
  const enabled = configuredVisible && audienceReady && canLoadHomeExternalRefunds(access.ready, access.canView, role);
  const [offset, setOffset] = useState(0);
  const limit = compact ? 4 : 8;
  const query = useHomeExternalRefunds(enabled, offset, limit);
  const mutation = useExternalRefundAction();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const total = query.data?.meta.totalBookings ?? 0;
  useEffect(() => {
    if (query.data && offset > 0 && offset >= total) setOffset(Math.max(0, Math.ceil(total / limit) * limit - limit));
  }, [query.data, total, offset, limit]);
  if (!enabled || (!query.isLoading && !query.error && total === 0 && !notice)) return null;
  const submit = async () => {
    if (!decision) return;
    setError(null);
    try {
      await mutation.mutateAsync({ bookingId: decision.booking.bookingId, actionId: decision.action.id, operation: decision.operation });
      setNotice(decision.operation === 'complete'
        ? 'Refund marked completed. Booking add-ons and counter metrics updated.'
        : 'Pending refund deleted. No refund was recorded.');
      setDecision(null);
    } catch (failure) { setError(externalRefundError(failure)); }
  };
  return <Box component="section" aria-label="Pending External Refunds">
    <Stack gap="sm">
      <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="xs"><Title order={2} size="h3">Pending External Refunds</Title>
          {query.data && <Badge color="orange">{total} {total === 1 ? 'booking' : 'bookings'}</Badge>}</Group>
        <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} loading={query.isFetching}
          onClick={() => { void query.refetch(); }}>Refresh</Button>
      </Group>
      {notice && <Alert color="green" withCloseButton onClose={() => setNotice(null)}>{notice}</Alert>}
      {query.error && <Alert color="red" title="Unable to load pending refunds">{externalRefundError(query.error)}</Alert>}
      {query.isLoading && <Center p="md"><Loader size="sm" /></Center>}
      {query.data?.data.map(booking => <Paper key={booking.bookingId} withBorder radius="lg" p="md">
        <Stack align="center" gap="xs">
          <Group justify="center" gap="xs"><Text fw={700}>{booking.customerName}</Text>
            <Badge variant="light">{PLATFORMS[booking.platform.toLowerCase()] ?? booking.platform}</Badge></Group>
          <Text size="sm" c="dimmed" ta="center" style={{ overflowWrap: 'anywhere' }}>{[booking.productName, booking.experienceDate, booking.platformBookingId].filter(Boolean).join(' · ')}</Text>
          {booking.actions.map(action => <Group key={action.id} justify="center" gap="xs" w="100%" wrap="wrap">
            <Text size="sm" fw={600}>{action.quantity} × {ADDONS[action.addonKey]}</Text>
            <Button size="xs" color="green" leftSection={<IconCheck size={14} />} disabled={!access.canUpdate || mutation.isPending}
              aria-label={`Complete ${ADDONS[action.addonKey]} refund for ${booking.customerName}`}
              onClick={() => { setError(null); setDecision({ booking, action, operation: 'complete' }); }}>Complete</Button>
            <Button size="xs" color="red" variant="light" leftSection={<IconTrash size={14} />} disabled={!access.canUpdate || mutation.isPending}
              aria-label={`Delete ${ADDONS[action.addonKey]} refund for ${booking.customerName}`}
              onClick={() => { setError(null); setDecision({ booking, action, operation: 'delete' }); }}>Delete</Button>
            {action.counterId && <Button component={Link} to={`/counters?counterId=${action.counterId}&mode=edit&step=summary`}
              variant="subtle" size="xs" rightSection={<IconExternalLink size={13} />}>Counter</Button>}
          </Group>)}
        </Stack>
      </Paper>)}
      {total > limit && <Group justify="center">
        <Button variant="default" size="xs" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
        <Text size="sm">{offset + 1}–{Math.min(offset + limit, total)} of {total} bookings</Text>
        <Button variant="default" size="xs" disabled={offset + limit >= total || query.isFetching} onClick={() => setOffset(offset + limit)}>Next</Button>
      </Group>}
    </Stack>
    <Modal opened={decision !== null} onClose={() => { if (!mutation.isPending) setDecision(null); }} centered
      title={decision?.operation === 'complete' ? 'Complete external refund' : 'Delete pending refund'}>
      {decision && <Stack>
        <Text ta="center" fw={600}>{decision.booking.customerName} · {decision.action.quantity} × {ADDONS[decision.action.addonKey]}</Text>
        <Text size="sm" ta="center">{decision.operation === 'complete'
          ? 'Confirm the refund has already been made on the external platform. This removes these add-ons from the booking and updates its counter. It does not send money.'
          : 'This removes the pending task without recording a refund. The linked counter will be recalculated, just as in Counter Summary.'}</Text>
        {error && <Alert color="red" title="Unable to update refund">{error}</Alert>}
        <Group justify="center"><Button variant="default" disabled={mutation.isPending} onClick={() => setDecision(null)}>Cancel</Button>
          <Button color={decision.operation === 'complete' ? 'green' : 'red'} loading={mutation.isPending} onClick={() => { void submit(); }}>
            {decision.operation === 'complete' ? 'Confirm completed' : 'Delete task'}</Button></Group>
      </Stack>}
    </Modal>
  </Box>;
}
