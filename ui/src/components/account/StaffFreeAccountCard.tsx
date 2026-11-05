import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { Accordion, ActionIcon, Alert, Badge, Box, Button, Card, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { getMyStaffFreeAccount, type StaffFreeAccount } from '../../api/staffFreeEntries';

const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeLabel = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/Warsaw' });
const errorMessage = (error: unknown) => isAxiosError(error)
  ? error.response?.data?.[0]?.message ?? error.message
  : 'Unable to load your free-crawl history.';

export default function StaffFreeAccountCard() {
  const [data, setData] = useState<StaffFreeAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [visibleRows, setVisibleRows] = useState(10);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void getMyStaffFreeAccount(controller.signal).then(next => {
      if (!controller.signal.aborted) setData(next);
    }).catch(err => {
      if (!controller.signal.aborted) setError(errorMessage(err));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [revision]);

  if (data && !data.visible && !error) return null;
  return <Card withBorder radius="lg" shadow="sm" component="section" aria-label="Staff free crawls" style={{ textAlign: 'center' }}>
    <Stack gap="md">
      <Box style={{ display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) 36px', alignItems: 'center' }}>
        <Box aria-hidden />
        <Title order={4}>Staff pub crawls</Title>
        <ActionIcon variant="subtle" aria-label="Refresh free-crawl history" loading={loading} onClick={() => setRevision(value => value + 1)}><IconRefresh size={18} /></ActionIcon>
      </Box>
      {error && <Alert color="red" title="Unable to load your free crawls">{error}</Alert>}
      {!data && loading && <Group justify="center"><Loader size="sm" aria-label="Loading free crawls" /></Group>}
      {data?.visible && <>
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
          <Paper withBorder radius="md" p="sm"><Text size="sm" c="dimmed">Free crawls remaining</Text><Text size="xl" fw={700}>{!data.eligible ? 'Unavailable' : data.unlimited ? 'Unlimited' : `${data.remaining} of ${data.allowance}`}</Text></Paper>
          <Paper withBorder radius="md" p="sm"><Text size="sm" c="dimmed">Allowance used</Text><Text size="xl" fw={700}>{data.used}</Text></Paper>
          <Paper withBorder radius="md" p="sm"><Text size="sm" c="dimmed">Total free visits</Text><Text size="xl" fw={700}>{data.totalVisits}</Text></Paper>
          <Paper withBorder radius="md" p="sm"><Text size="sm" c="dimmed">Paid visits</Text><Text size="xl" fw={700}>{data.paidVisits ?? 0}</Text>{Boolean(data.pendingPaidVisits) && <Text size="xs" c="dimmed">{data.pendingPaidVisits} awaiting payment</Text>}</Paper>
        </SimpleGrid>
        <Text size="sm" c="dimmed">{!data.eligible ? 'Your previous visits are kept here. Your current account or staff profile is not eligible for new staff free entries.'
          : data.unlimited ? 'Your role has unlimited off-duty entries.'
            : `Your allowance does not reset. Visits with ${data.busyThreshold} or more qualifying customers and approved overrides do not use it.`}</Text>
        <Accordion variant="separated" radius="md" styles={{ control: { textAlign: 'center' } }}>
          <Accordion.Item value="history">
            <Accordion.Control>Staff visit history ({data.history.length})</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                {!data.history.length && <Text size="sm" c="dimmed">No staff free visits have been recorded yet. Older anonymous free tickets are not attributed automatically.</Text>}
                {data.history.slice(0, visibleRows).map(entry => <Paper key={entry.id} withBorder radius="md" p="md" style={{ opacity: entry.cancelledAt ? 0.7 : 1 }}>
                  <Stack gap={6} align="center">
                    <Text fw={700}>{dateLabel(entry.date)}</Text>
                    <Badge color={entry.cancelledAt ? 'gray' : entry.benefit === 'allowance' ? 'blue' : 'teal'} variant="light">{entry.cancelledAt ? 'Cancelled' : entry.label}</Badge>
                    {entry.benefit === 'paid' ? <Text size="sm">{entry.payment?.currency ?? 'PLN'} {Number(entry.paidAmount).toFixed(2)} ? {entry.payment?.methodName} ? {entry.payment?.status === 'awaiting' ? 'Awaiting payment' : 'Received'}</Text> : <Text size="sm">{entry.checkedInBefore} qualifying customers at check-in</Text>}
                    <Text size="xs" c="dimmed">Recorded by {entry.recordedBy} · {dateTimeLabel(entry.recordedAt)}</Text>
                    {entry.overrideReason && <Text size="sm" style={{ overflowWrap: 'anywhere' }}>Override: {entry.overrideReason}</Text>}
                    {entry.allowanceReturnedAt && <Alert color="teal">Allowance returned when {entry.allowanceReturnedAtCount} qualifying customers were checked in · {dateTimeLabel(entry.allowanceReturnedAt)}</Alert>}
                    {entry.cancelledAt && <Text size="sm" style={{ overflowWrap: 'anywhere' }}>Correction by {entry.cancelledBy}: {entry.cancellationReason}</Text>}
                  </Stack>
                </Paper>)}
                {visibleRows < data.history.length && <Button variant="light" onClick={() => setVisibleRows(value => value + 10)}>Show more visits</Button>}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </>}
    </Stack>
  </Card>;
}
