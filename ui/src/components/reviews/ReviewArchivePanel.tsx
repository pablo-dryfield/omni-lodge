import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Badge, Button, Checkbox, Group, MultiSelect, Pagination, Paper, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle, IconEdit, IconRefresh, IconSearch, IconStarFilled, IconTrash } from '@tabler/icons-react';
import axiosInstance from '../../utils/axiosInstance';

type Platform = 'google' | 'tripadvisor' | 'airbnb';
type User = { id: number; firstName: string; lastName: string; username: string };
type Review = { id: number; sourceReviewId: string; reviewerName: string; reviewerPhotoUrl: string | null; comment: string | null; rating: number | string; reviewCreatedAt: string; reviewUpdatedAt: string | null; isDeleted: boolean; isNoName: boolean; isBadReview: boolean; deletedDetectedAt: string | null; assignedUserIds: number[]; credit: number };
type GoogleMeta = { nextPageToken?: string | null; totalCount?: number; averageRating?: number };
const labels = { google: 'Google', tripadvisor: 'TripAdvisor', airbnb: 'Airbnb' };

export default function ReviewArchivePanel({ platform, canManage = false }: { platform: Platform; canManage?: boolean }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sourceStats, setSourceStats] = useState<{ totalCount?: number; averageRating?: number }>({});
  const fastSyncedPlatform = useRef<string | null>(null);

  const load = useCallback(async () => {
    const deleted = filter === 'all' ? 'all' : String(filter === 'deleted');
    const response = await axiosInstance.get('/reviews/archive', { params: { platform, deleted, search: search || undefined, page, pageSize: 24 } });
    setReviews(response.data.reviews); setUsers(response.data.users);
    setTotal(response.data.pagination.total); setTotalPages(response.data.pagination.totalPages);
  }, [filter, page, platform, search]);

  const sync = useCallback(async (full: boolean) => {
    setLoading(true); setError('');
    try {
      const syncBase = full ? '/reviews/archive/sync' : '/reviews/archive/sync/fast';
      const started = await axiosInstance.post(`${syncBase}/start`, { platform });
      const runId = started.data.run.id;
      let token: string | undefined, cursor: string | undefined, offset = 0;
      let sourceTotalCount: number | undefined, averageRating: number | undefined;
      for (let current = 0; current < (full ? 250 : 2); current++) {
        const response = platform === 'google'
          ? await axiosInstance.get('/reviews/googleReviews', { params: token ? { pageToken: token } : undefined })
          : platform === 'tripadvisor'
            ? await axiosInstance.get('/reviews/tripadvisorReviews', { params: offset ? { offset } : undefined })
            : await axiosInstance.get('/reviews/airbnbReviews', { params: cursor ? { cursor } : undefined });
        const payload = response.data[0], rows = payload.data ?? [], meta = payload.columns?.[0];
        await axiosInstance.post(`${syncBase}/${runId}/page`, { reviews: rows });
        if (platform === 'google') {
          const googleMeta = (typeof meta === 'object' ? meta : { nextPageToken: meta }) as GoogleMeta;
          sourceTotalCount = googleMeta.totalCount; averageRating = googleMeta.averageRating;
          token = googleMeta.nextPageToken || undefined;
          if (!token) break;
        } else if (platform === 'tripadvisor') {
          sourceTotalCount = meta?.totalCount ?? sourceTotalCount;
          if (!meta?.hasMore) break; offset = meta.nextOffset;
        } else {
          sourceTotalCount = meta?.totalCount ?? sourceTotalCount;
          if (!meta?.hasMore || !meta?.endCursor) break; cursor = meta.endCursor;
        }
      }
      await axiosInstance.post(`${syncBase}/${runId}/complete`, { sourceTotalCount, averageRating });
      setSourceStats({ totalCount: sourceTotalCount, averageRating }); setPage(1);
    } catch (caught: any) {
      setError(caught.response?.data?.error ?? caught.response?.data?.[0]?.message ?? caught.message);
    } finally { setLoading(false); }
  }, [platform]);

  useEffect(() => { if (fastSyncedPlatform.current !== platform) { fastSyncedPlatform.current = platform; void sync(false); } }, [platform, sync]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load, loading]);

  const assign = async (id: number, values: string[]) => {
    await axiosInstance.put(`/reviews/archive/${id}/assignments`, { userIds: values.map(Number) }); await load();
  };
  const setFlags = async (id: number, flags: { isNoName?: boolean; isBadReview?: boolean }) => {
    setReviews(current => current.map(review => review.id === id ? { ...review, ...flags } : review));
    try { await axiosInstance.put(`/reviews/archive/${id}/flags`, flags); } catch { await load(); }
  };
  const options = users.map(user => ({ value: String(user.id), label: `${user.firstName} ${user.lastName}`.trim() || user.username }));

  return <Stack gap="lg">
    <Paper p="lg" radius="lg" withBorder>
      <Group justify="space-between" align="flex-start">
        <div><Title order={3}>{labels[platform]} review archive</Title><Text c="dimmed" size="sm">Persistent history, deletion monitoring, edits, and shared staff credit.</Text></div>
        {canManage && <Button leftSection={<IconRefresh size={17}/>} loading={loading} onClick={() => void sync(true)}>Full sync</Button>}
      </Group>
      <Group mt="lg" gap="xl"><div><Text size="xs" c="dimmed">Reviews in this view</Text><Text fw={800} fz="xl">{total.toLocaleString()}</Text></div>{sourceStats.totalCount != null && <div><Text size="xs" c="dimmed">Google total</Text><Text fw={800} fz="xl">{sourceStats.totalCount.toLocaleString()}</Text></div>}{sourceStats.averageRating != null && <div><Text size="xs" c="dimmed">Average rating</Text><Text fw={800} fz="xl">{sourceStats.averageRating.toFixed(2)}</Text></div>}</Group>
      <Group mt="lg" justify="space-between"><TextInput leftSection={<IconSearch size={16}/>} placeholder="Search archived reviews" value={search} onChange={event => { setSearch(event.currentTarget.value); setPage(1); }} style={{ flex: 1, maxWidth: 420 }}/><SegmentedControl value={filter} onChange={value => { setFilter(value); setPage(1); }} data={[{ value: 'active', label: 'Active' }, { value: 'deleted', label: 'Deleted' }, { value: 'all', label: 'All' }]}/></Group>
      {error && <Text c="red" mt="sm">{error}</Text>}
    </Paper>
    <SimpleGrid cols={{ base: 1, xl: 2 }}>{reviews.map(review => {
      const created = new Date(review.reviewCreatedAt), updated = review.reviewUpdatedAt ? new Date(review.reviewUpdatedAt) : null;
      const wasUpdated = !!updated && updated.getTime() - created.getTime() > 60_000;
      const suspicious = wasUpdated && (created.getFullYear() !== updated!.getFullYear() || created.getMonth() !== updated!.getMonth());
      return <Paper key={review.id} p="lg" radius="lg" withBorder style={{ opacity: review.isDeleted ? .72 : 1 }}>
        <Group justify="space-between" align="flex-start"><Group><Avatar src={review.reviewerPhotoUrl} radius="xl"/><div><Text fw={700}>{review.reviewerName}</Text><Text size="xs" c="dimmed">Created {created.toLocaleDateString()} {created.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}{wasUpdated && ` · Updated ${updated!.toLocaleDateString()} ${updated!.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}</Text></div></Group><Group gap="xs"><Badge color="yellow" leftSection={<IconStarFilled size={12}/>}>{Number(review.rating).toFixed(1)}</Badge>{wasUpdated && <Badge color="blue" leftSection={<IconEdit size={12}/>}>Updated</Badge>}{suspicious && <Badge color="orange" leftSection={<IconAlertTriangle size={12}/>}>Suspicious</Badge>}{review.isDeleted && <Badge color="red" leftSection={<IconTrash size={12}/>}>Deleted at source</Badge>}</Group></Group>
        <Text my="md" size="sm" lineClamp={5}>{review.comment || 'No written comment'}</Text>
        <Group mb="md"><Checkbox color="gray" label="No name" checked={review.isNoName} disabled={!canManage} onChange={event => void setFlags(review.id, { isNoName: event.currentTarget.checked })}/><Checkbox color="red" label="Bad review" checked={review.isBadReview} disabled={!canManage} onChange={event => void setFlags(review.id, { isBadReview: event.currentTarget.checked })}/></Group>
        <MultiSelect searchable clearable disabled={!canManage} label="Credit this review to" description={review.assignedUserIds.length ? `${(1 / review.assignedUserIds.length).toFixed(3)} credit per person` : 'Unassigned — not counted for staff'} data={options} value={review.assignedUserIds.map(String)} onChange={values => void assign(review.id, values)}/>
      </Paper>;
    })}</SimpleGrid>
    {!reviews.length && !loading && <Paper p="xl" withBorder><Text ta="center" c="dimmed">No reviews match this view.</Text></Paper>}
    {totalPages > 1 && <Group justify="center"><Pagination value={page} onChange={setPage} total={totalPages}/></Group>}
  </Stack>;
}
