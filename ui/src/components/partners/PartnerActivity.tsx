import { useEffect, useState } from 'react';
import { Accordion, Alert, Badge, Card, Code, Group, Loader, Pagination, Stack, Text, Title } from '@mantine/core';
import { partnerApi, partnerError } from '../../api/partners';
type Event = { id: number; type: string; bookingId: number | null; actorId: number | null; createdAt: string; data: Record<string, unknown> };
export function PartnerActivity({ partnerId }: { partnerId: number }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Event[]; count: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true; setData(null); setError('');
    partnerApi.get<{ rows: Event[]; count: number }>(partnerId, 'activity', { offset: (page - 1) * 25 }).then(value => { if (current) setData(value); }).catch(e => { if (current) setError(partnerError(e)); });
    return () => { current = false; };
  }, [partnerId, page]);
  return <Stack><Title order={3}>Activity and audit history</Title><Text c="dimmed" size="sm">Bookings, payments, refunds, team and integration changes are recorded here.</Text>{error && <Alert color="red">{error}</Alert>}{!data && !error && <Loader mx="auto" />}{data && <>{!data.count && <Text ta="center">No activity recorded yet.</Text>}{data.rows.map(event => <Card withBorder key={event.id}><Group justify="space-between" wrap="wrap"><Text fw={600}>{event.type.replace(/[._]/g, ' ')}</Text><Badge variant="light">{new Date(event.createdAt).toLocaleString()}</Badge></Group><Text size="sm">{event.data.reference ? `Reference: ${String(event.data.reference)}` : event.bookingId ? `Booking #${event.bookingId}` : 'Company account'}{event.actorId ? ` | User #${event.actorId}` : ' | System / API'}</Text>{event.data.reason != null && <Text size="sm" mt="xs">{String(event.data.reason)}</Text>}<Accordion mt="xs" variant="contained"><Accordion.Item value="detail"><Accordion.Control>Event details</Accordion.Control><Accordion.Panel><Code block style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(event.data, null, 2)}</Code></Accordion.Panel></Accordion.Item></Accordion></Card>)}<Pagination value={page} onChange={setPage} total={Math.max(1, Math.ceil(data.count / 25))} mx="auto" /></>}</Stack>;
}
