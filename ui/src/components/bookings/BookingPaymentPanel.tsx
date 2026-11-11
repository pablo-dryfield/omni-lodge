import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { Accordion, ActionIcon, Alert, Anchor, Badge, Box, Button, Code, CopyButton, Divider, Group, Loader, Paper, SimpleGrid, Skeleton, Stack, Table, Tabs, Text, ThemeIcon, Timeline, Tooltip } from '@mantine/core';
import { IconActivity, IconArrowUpRight, IconCheck, IconCopy, IconCreditCard, IconExternalLink, IconFileText, IconHistory, IconRefresh } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { getBookingPaymentDetails, getBookingPaymentEvents, type BookingPaymentDetails, type BookingPaymentEvents, type PaymentActivity, type PaymentItem, type PaymentRequestReference } from '../../api/bookingPayments';
import { formatPaymentMinor, formatRecordedPayment, paymentLabel, paymentMethodLabel, paymentStatusColor, stripeEventLabel } from '../../utils/stripePaymentDisplay';

const errorMessage = (error: unknown) => {
  if (isAxiosError(error)) {
    if (error.response?.status === 403) return 'You do not have access to this booking’s payment information.';
    if (error.response?.status === 401) return 'Sign in again to view payment information.';
    if (typeof error.response?.data?.message === 'string') return error.response.data.message;
  }
  return 'Payment information could not be loaded. Try again.';
};
const date = (seconds: number) => seconds > 0 ? dayjs.unix(seconds).format('D MMM YYYY, HH:mm:ss') : 'Time not available';
const externalProps = { target: '_blank', rel: 'noopener noreferrer' } as const;

function Reference({ value, url }: { value: string; url?: string | null }) {
  return <Group gap={5} justify="center" wrap="nowrap" maw="100%">
    {url ? <Anchor href={url} {...externalProps} size="xs" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{value}</Anchor>
      : <Text size="xs" ff="monospace" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{value}</Text>}
    <CopyButton value={value}>{({ copied, copy }) => <Tooltip label={copied ? 'Copied' : 'Copy reference'}><ActionIcon variant="subtle" size="sm" onClick={copy} aria-label={`Copy ${value}`} style={{ flexShrink: 0 }}>{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}</ActionIcon></Tooltip>}</CopyButton>
  </Group>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <Box ta="center" style={{ minWidth: 0, overflowWrap: 'anywhere' }}><Text size="xs" fw={600} c="dimmed" mb={4}>{label}</Text>{typeof children === 'string' ? <Text size="sm" fw={500}>{children}</Text> : children}</Box>;
}
function RequestRows({ rows }: { rows: PaymentRequestReference[] }) {
  if (!rows.length) return <Text size="sm" c="dimmed" ta="center">No request references were returned for these records.</Text>;
  return <Stack gap="sm">{rows.map(row => <Paper key={`${row.source}-${row.id}`} withBorder p="sm" radius="md">
    <Group justify="space-between" gap="xs" wrap="wrap">
      <Box style={{ flex: '1 1 230px', minWidth: 0 }}><Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>{row.method && row.path ? `${row.method} ${row.path}` : row.description}</Text><Text size="xs" c="dimmed">{row.source === 'refresh' ? 'Read during this refresh' : 'Request linked to a Stripe payment event'}</Text></Box>
      {row.status != null && <Badge variant="light" color={row.status >= 400 ? 'red' : 'teal'}>{row.status}</Badge>}
      <Text size="xs" c="dimmed">{date(row.created)}</Text>
    </Group><Box mt="xs"><Reference value={row.id} url={row.dashboardUrl || null} /></Box>
  </Paper>)}</Stack>;
}
function ItemRows({ rows }: { rows: PaymentItem[] }) {
  return <Stack gap="xs">{rows.map(row => <Paper key={row.id} withBorder p="sm" radius="md"><Group justify="space-between" gap="xs" wrap="wrap">
    <Text fw={600} size="sm">{formatPaymentMinor(row.amount, row.currency)}</Text><Badge color={paymentStatusColor(row.status)} variant="light">{paymentLabel(row.status)}</Badge><Text c="dimmed" size="xs">{date(row.created)}</Text>
  </Group>{row.reason && <Text size="xs" ta="center" mt={6}>{paymentLabel(row.reason)}</Text>}<Box mt={6}><Reference value={row.id} url={row.dashboardUrl} /></Box></Paper>)}</Stack>;
}

/** A separate, lazy payment read. Opening Emails or Booking events does not call Stripe. */
export default function BookingPaymentPanel({ bookingId, active }: { bookingId: number; active: boolean }) {
  const [data, setData] = useState<BookingPaymentDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<BookingPaymentEvents | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [view, setView] = useState<string | null>('activity');
  const sequence = useRef(0);
  const loaded = useRef<string | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; historyController.current?.abort(); }; }, []);
  useEffect(() => {
    if (!active || loaded.current === `${bookingId}:${version}`) return;
    const request = ++sequence.current;
    const controller = new AbortController();
    historyController.current?.abort(); setHistory(null); setHistoryError(null); setHistoryLoading(false);
    setLoading(true); setError(null);
    void getBookingPaymentDetails(bookingId, controller.signal).then(result => {
      if (sequence.current !== request || !mounted.current) return;
      setData(result); loaded.current = `${bookingId}:${version}`;
    }).catch(reason => {
      if (sequence.current === request && !controller.signal.aborted) setError(errorMessage(reason));
    }).finally(() => { if (sequence.current === request && !controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, bookingId, version]);

  const loadEvents = useCallback(async (cursor?: string) => {
    if (historyLoading) return;
    const request = sequence.current;
    const controller = new AbortController();
    historyController.current?.abort(); historyController.current = controller;
    setHistoryLoading(true); setHistoryError(null);
    try {
      const page = await getBookingPaymentEvents(bookingId, cursor, controller.signal);
      if (!mounted.current || sequence.current !== request || controller.signal.aborted) return;
      if (page.paymentId !== data?.payment?.id || page.mode !== data?.payment?.mode) {
        setHistoryError('The linked Stripe payment changed. Refresh the payment before continuing.');
        return;
      }
      setHistory(previous => cursor && previous ? { ...page, events: Array.from(new Map([...previous.events, ...page.events].map(row => [row.id, row])).values()), requests: Array.from(new Map([...previous.requests, ...page.requests].map(row => [`${row.source}-${row.id}`, row])).values()), scanned: previous.scanned + page.scanned } : page);
    } catch (reason) { if (mounted.current && sequence.current === request && !controller.signal.aborted) setHistoryError(errorMessage(reason)); }
    finally { if (mounted.current && sequence.current === request && !controller.signal.aborted) setHistoryLoading(false); }
  }, [bookingId, historyLoading, data?.payment?.id, data?.payment?.mode]);
  // Start one bounded history search after the payment itself has loaded.
  useEffect(() => {
    if (active && data?.payment && !loading && !history && !historyError && !historyLoading) void loadEvents();
  }, [active, data?.payment, loading, history, historyError, historyLoading, loadEvents]);

  const activity = useMemo(() => {
    const types = new Set(history?.events.map(row => row.type));
    const base = (data?.activity ?? []).filter(row => !(row.id.startsWith('payment-created-') && types.has('payment_intent.created')) && !(row.id.startsWith('payment-cancelled-') && types.has('payment_intent.canceled')));
    const live: PaymentActivity[] = (history?.events ?? []).map(row => ({ id: row.id, source: 'stripe', title: stripeEventLabel(row.type), created: row.created, status: row.status, amount: row.amount, currency: row.currency, actor: null, reference: row.objectId }));
    return [...base, ...live].sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  }, [data?.activity, history?.events]);
  const payment = data?.payment;
  const method = payment?.paymentMethod;
  const eventRequests = useMemo(() => Array.from(new Map((history?.requests ?? []).filter(row => row.source === 'event').map(row => [row.id, row])).values()), [history?.requests]);
  const refreshRequests = useMemo(() => Array.from(new Map([...(data?.requests ?? []), ...(history?.requests ?? []).filter(row => row.source === 'refresh')].map(row => [row.id, row])).values()), [data?.requests, history?.requests]);

  if (!data && loading) return <Stack aria-label="Loading payment details" gap="md"><Skeleton height={72} /><SimpleGrid cols={2}><Skeleton height={120} /><Skeleton height={120} /></SimpleGrid><Skeleton height={180} /></Stack>;
  if (!data) return <Alert color="red" title="Unable to load payment"><Stack gap="sm"><Text size="sm">{error || 'Open the Payment tab to load the payment.'}</Text><Button variant="light" onClick={() => setVersion(v => v + 1)}>Try again</Button></Stack></Alert>;
  return <Stack gap="lg" style={{ minWidth: 0 }} aria-label="Booking payment information">
    <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
      <Box style={{ minWidth: 0 }}>
        <Text size="xs" c="dimmed" fw={600}>{payment ? data.scope === 'order' ? 'ORDER PAYMENT TOTAL' : 'STRIPE PAYMENT' : 'RECORDED PAYMENT'}</Text>
        <Group align="center" gap="sm" wrap="wrap"><Text fz={{ base: 26, sm: 32 }} fw={800}>{payment ? formatPaymentMinor(payment.amount, payment.currency) : formatRecordedPayment(data.recorded.amount, data.recorded.currency)}</Text><Badge size="lg" variant="light" color={paymentStatusColor(payment?.status ?? data.recorded.paymentStatus)}>{paymentLabel(payment?.status ?? data.recorded.paymentStatus)}</Badge>{payment && payment.amountRefunded > 0 && <Badge variant="light" color="violet">{payment.amountReceived > 0 && payment.amountRefunded >= payment.amountReceived ? 'Fully refunded' : 'Partially refunded'}</Badge>}</Group>
        {payment?.receiptEmail && <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>Receipt: {payment.receiptEmail}</Text>}
        {data.merchant && <Group gap={6} mt={6}><Badge size="sm" variant="outline" color="gray">{data.merchant}</Badge><Badge size="sm" color={payment?.mode === 'test' ? 'orange' : 'teal'} variant="light">{payment?.mode === 'test' ? 'Test payment' : 'Live payment'}</Badge></Group>}
      </Box>
      <Group gap="xs" wrap="wrap"><Button size="xs" variant="light" leftSection={<IconRefresh size={15} />} loading={loading} onClick={() => setVersion(v => v + 1)}>Refresh payment</Button>{payment && <Button component="a" href={payment.dashboardUrl} {...externalProps} size="xs" variant="default" rightSection={<IconExternalLink size={14} />}>Open in Stripe</Button>}</Group>
    </Group>
    {error && <Alert color="red" title="Refresh failed">{error} The last retrieved information remains visible.</Alert>}
    {data.message && <Alert color={data.state === 'unavailable' ? 'orange' : 'blue'} title={data.state === 'not_stripe' ? 'Recorded payment information' : 'Stripe payment unavailable'}>{data.message}</Alert>}
    {data.warnings.map((warning, i) => <Alert key={i} color="orange">{warning}</Alert>)}
    {data.scope === 'order' && payment && <Alert color="blue" variant="light" style={{ overflowWrap: 'anywhere' }}>This Stripe transaction belongs to order {data.orderReference}. It can cover multiple bookings; the transaction and refund totals below are for the whole payment. This booking’s recorded total: {formatRecordedPayment(data.recorded.amount, data.recorded.currency)}.</Alert>}
    {payment ? <>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {[['Captured', payment.amountReceived], ['Authorized to capture', payment.amountCapturable], ['Refunded', payment.amountRefunded], ['Captured, not refunded', Math.max(0, payment.amountReceived - payment.amountRefunded)]].map(([label, amount]) => <Paper key={label} withBorder p="sm" radius="md"><Field label={String(label)}>{formatPaymentMinor(Number(amount), payment.currency)}</Field></Paper>)}
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper withBorder p="md" radius="md"><Stack align="center" gap="sm"><ThemeIcon variant="light" size={42} radius="md"><IconCreditCard size={23} /></ThemeIcon><Text fw={700}>Payment method</Text><Text fw={600}>{paymentMethodLabel(method ?? null)}</Text>
          {method && <Group gap={6} justify="center">{method.wallet && <Badge variant="light">{paymentLabel(method.wallet)}</Badge>}{method.funding && <Badge color="gray" variant="light">{paymentLabel(method.funding)}</Badge>}{method.country && <Badge variant="outline" color="gray">{method.country}</Badge>}</Group>}
          {method?.expiryMonth && method.expiryYear && <Text size="xs" c="dimmed">Expires {String(method.expiryMonth).padStart(2, '0')}/{method.expiryYear}</Text>}
          {payment.billingName && <Text size="sm">{payment.billingName}</Text>}
          {method?.threeDSecure && <Box ta="center"><Text size="xs" fw={600} c="dimmed">3D SECURE</Text><Text size="sm">{[paymentLabel(method.threeDSecure.result), method.threeDSecure.flow && paymentLabel(method.threeDSecure.flow), method.threeDSecure.version].filter(Boolean).join(' · ')}</Text></Box>}
        </Stack></Paper>
        <Paper withBorder p="md" radius="md"><Stack gap="md"><Field label="Payment ID"><Reference value={payment.id} url={payment.dashboardUrl} /></Field>{payment.chargeId && <Field label="Charge ID"><Reference value={payment.chargeId} /></Field>}<Field label="Payment started">{date(payment.created)}</Field>{payment.statementDescriptor && <Field label="Bank statement descriptor">{payment.statementDescriptor}</Field>}{payment.receiptUrl && <Anchor href={payment.receiptUrl} {...externalProps} size="sm" ta="center">View Stripe receipt <IconArrowUpRight size={13} /></Anchor>}</Stack></Paper>
      </SimpleGrid>
      {payment.description && <Text size="sm" c="dimmed" ta="center" style={{ overflowWrap: 'anywhere' }}>{payment.description}</Text>}
      <Accordion multiple variant="separated" radius="md">
        {(['charges', 'refunds', 'disputes'] as const).map(kind => data[kind].length > 0 || data.truncated.includes(kind) ? <Accordion.Item key={kind} value={kind}><Accordion.Control><Group gap="xs"><Text fw={600} size="sm">{kind === 'charges' ? 'Charge attempts' : paymentLabel(kind)}</Text><Badge color={kind === 'disputes' ? 'red' : 'gray'} variant="light" size="sm">{data[kind].length}{data.truncated.includes(kind) ? '+' : ''}</Badge></Group></Accordion.Control><Accordion.Panel><ItemRows rows={data[kind]} />{data.truncated.includes(kind) && <Text mt="sm" size="xs" c="dimmed">Only the most recent records are loaded. Open this payment in Stripe for the full list.</Text>}</Accordion.Panel></Accordion.Item> : null)}
        {payment.settlement && <Accordion.Item value="settlement"><Accordion.Control><Text fw={600} size="sm">Original Stripe settlement</Text></Accordion.Control><Accordion.Panel><SimpleGrid cols={3}><Field label="Gross">{formatPaymentMinor(payment.settlement.amount, payment.settlement.currency)}</Field><Field label="Stripe fees">{formatPaymentMinor(payment.settlement.fee, payment.settlement.currency)}</Field><Field label="Original net">{formatPaymentMinor(payment.settlement.net, payment.settlement.currency)}</Field></SimpleGrid><Text size="xs" c="dimmed" ta="center" mt="sm">In the settlement currency, before subsequent refunds or disputes.</Text></Accordion.Panel></Accordion.Item>}
      </Accordion>
    </> : <SimpleGrid cols={{ base: 1, sm: 3 }}><Field label="Recorded payment method">{paymentLabel(data.recorded.paymentMethod)}</Field><Field label="Recorded refunded amount">{formatRecordedPayment(data.recorded.refundedAmount, data.recorded.refundedCurrency ?? data.recorded.currency)}</Field><Field label="Data source">OmniLodge booking record</Field></SimpleGrid>}

    <Tabs value={view === 'events' && !payment ? 'activity' : view ?? 'activity'} onChange={setView} keepMounted={false}>
      <Tabs.List grow><Tabs.Tab value="activity" leftSection={<IconActivity size={15} />}>Activity</Tabs.Tab>{payment && <Tabs.Tab value="events" leftSection={<IconHistory size={15} />}>Stripe events</Tabs.Tab>}<Tabs.Tab value="logs" leftSection={<IconFileText size={15} />}>Logs</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="activity" pt="lg"><Stack gap="md">
        {historyLoading && <Group justify="center" gap="xs"><Loader size="xs" /><Text size="xs" c="dimmed">Checking recent Stripe activity…</Text></Group>}
        {activity.length ? <Timeline active={-1} bulletSize={12} lineWidth={2}>{activity.map(row => <Timeline.Item key={row.id} title={<Group justify="space-between" gap="xs" wrap="wrap"><Text fw={600} size="sm">{row.title}</Text><Text size="xs" c="dimmed">{date(row.created)}</Text></Group>}><Group gap={6} mt={4} wrap="wrap"><Badge variant="light" size="xs" color={row.source === 'omnilodge' ? 'gray' : 'indigo'}>{row.source === 'omnilodge' ? 'OmniLodge' : row.id.startsWith('evt_') ? 'Stripe event' : 'Stripe record'}</Badge>{row.status && <Badge size="xs" variant="light" color={paymentStatusColor(row.status)}>{paymentLabel(row.status)}</Badge>}{row.amount != null && row.currency && <Text size="xs">{formatPaymentMinor(row.amount, row.currency)}</Text>}{row.actor && <Text size="xs">{row.actor}</Text>}</Group>{row.reference && <Text mt={4} size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{row.reference}</Text>}</Timeline.Item>)}</Timeline> : <Text ta="center" size="sm" c="dimmed">No payment activity has been recorded.</Text>}
        {data.truncated.includes('activity') && <Text size="xs" c="dimmed">The most recent booking records were checked. The Booking events tab contains the longer local history.</Text>}
      </Stack></Tabs.Panel>
      {payment && <Tabs.Panel value="events" pt="lg"><Stack gap="md"><Text size="sm" c="dimmed">Stripe’s API retains events for 30 days. This search returns only events belonging to this payment. Older payment details and saved OmniLodge activity remain available.</Text>
        {history?.events.length ? <>
          <Stack hiddenFrom="sm" gap="sm">{history.events.map(row => <Paper key={row.id} withBorder p="sm" radius="md"><Stack gap={6} align="center"><Text fw={600} size="sm" ta="center">{stripeEventLabel(row.type)}</Text><Text size="xs" c="dimmed">{date(row.created)}</Text><Code fz="xs" style={{ overflowWrap: 'anywhere', maxWidth: '100%' }}>{row.type}</Code><Reference value={row.id} url={row.dashboardUrl} /></Stack></Paper>)}</Stack>
          <Box visibleFrom="sm"><Table.ScrollContainer minWidth={520}><Table verticalSpacing="sm" horizontalSpacing="sm"><Table.Thead><Table.Tr><Table.Th ta="center">Event</Table.Th><Table.Th ta="center">Time</Table.Th><Table.Th ta="center">Reference</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{history.events.map(row => <Table.Tr key={row.id}><Table.Td ta="center"><Text fw={500} size="sm">{stripeEventLabel(row.type)}</Text><Code fz="xs">{row.type}</Code></Table.Td><Table.Td ta="center"><Text size="xs">{date(row.created)}</Text></Table.Td><Table.Td ta="center"><Reference value={row.id} url={row.dashboardUrl} /></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></Box>
        </> : !historyLoading && <Text ta="center" c="dimmed" size="sm">No matching Stripe events found in the pages checked.</Text>}
        {history && <Text size="xs" c="dimmed" ta="center">Searched {history.scanned} account events · {date(history.from)} – {date(history.to)}{history.hasMore ? ' · More pages remain' : ' · Search complete for this window'}</Text>}
      </Stack></Tabs.Panel>}
      <Tabs.Panel value="logs" pt="lg"><Stack gap="md"><Alert color="blue" variant="light">Stripe’s full HTTP request logs are available in its Dashboard. Event request references below link to the original logs. Method and HTTP status are shown only when returned for requests made during this refresh.</Alert><Text fw={600}>Payment event request references</Text><RequestRows rows={eventRequests} /><Divider /><Text fw={600}>Requests made during this refresh</Text><RequestRows rows={refreshRequests} /></Stack></Tabs.Panel>
    </Tabs>
    {historyError && <Alert color="orange" title="Stripe event history unavailable"><Stack gap="xs"><Text size="sm">{historyError}</Text><Button variant="light" size="xs" loading={historyLoading} onClick={() => void loadEvents(history?.nextCursor ?? undefined)}>Retry event search</Button></Stack></Alert>}
    {payment && history?.hasMore && <Button variant="light" loading={historyLoading} onClick={() => void loadEvents(history.nextCursor ?? undefined)}>Search older Stripe events</Button>}
    <Text size="xs" c="dimmed" ta="center">Last payment check: {dayjs(data.checkedAt).format('D MMM YYYY, HH:mm:ss')} · Times shown in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</Text>
  </Stack>;
}
