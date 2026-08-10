import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Anchor, Avatar, Badge, Button, Checkbox, Group, MultiSelect, Pagination, Paper, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle, IconEdit, IconRefresh, IconSearch, IconStarFilled, IconTrash } from '@tabler/icons-react';
import dayjs from 'dayjs';
import axiosInstance from '../../utils/axiosInstance';
import { effectiveReviewMonth, REVIEW_CREDIT_TIMEZONE, reviewMonthInWarsaw } from '../../utils/reviewCreditMonth';

type Platform = 'google' | 'tripadvisor' | 'airbnb' | 'getyourguide';
type User = { id: number; firstName: string; lastName: string; username: string };
type Review = { id: number; sourceReviewId: string; reviewerName: string; reviewerPhotoUrl: string | null; comment: string | null; rating: number | string; reviewCreatedAt: string; creditMonth: string | null; reviewUpdatedAt: string | null; isDeleted: boolean; isNoName: boolean; isBadReview: boolean; deletedDetectedAt: string | null; assignedUserIds: number[]; credit: number; rawPayload: { sourceCreatedAtLabel?: string | null; sourceDatePrecision?: string | null } | null };
type GoogleMeta = { nextPageToken?: string | null; totalCount?: number; averageRating?: number };
const labels = { google: 'Google', tripadvisor: 'TripAdvisor', airbnb: 'Airbnb', getyourguide: 'GetYourGuide' };
const formatWarsawDateTime = (value: Date): string =>
  `${value.toLocaleDateString(undefined, { timeZone: REVIEW_CREDIT_TIMEZONE })} ${value.toLocaleTimeString([], { timeZone: REVIEW_CREDIT_TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

export default function ReviewArchivePanel({ platform, canManage = false }: { platform: Platform; canManage?: boolean }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manualReviewUrl, setManualReviewUrl] = useState<string | null>(null);
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
    setLoading(true); setError(''); setManualReviewUrl(null);
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
            : platform === 'getyourguide'
              ? await axiosInstance.get('/reviews/getyourguideReviews', { params: offset ? { offset } : undefined })
              : await axiosInstance.get('/reviews/airbnbReviews', { params: cursor ? { cursor } : undefined });
        const payload = response.data[0], rows = payload.data ?? [], meta = payload.columns?.[0];
        await axiosInstance.post(`${syncBase}/${runId}/page`, { reviews: rows });
        if (platform === 'google') {
          const googleMeta = (typeof meta === 'object' ? meta : { nextPageToken: meta }) as GoogleMeta;
          sourceTotalCount = googleMeta.totalCount; averageRating = googleMeta.averageRating;
          token = googleMeta.nextPageToken || undefined;
          if (!token) break;
        } else if (platform === 'tripadvisor' || platform === 'getyourguide') {
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
      if (platform === 'getyourguide') {
        const responseUrl = caught.response?.data?.reviewsUrl;
        if (typeof responseUrl === 'string' && responseUrl.startsWith('http')) {
          setManualReviewUrl(responseUrl);
        } else {
          try {
            const linkResponse = await axiosInstance.get('/reviews/getyourguideLink');
            setManualReviewUrl(typeof linkResponse.data?.url === 'string' ? linkResponse.data.url : null);
          } catch {
            setManualReviewUrl(null);
          }
        }
      }
    } finally { setLoading(false); }
  }, [platform]);

  useEffect(() => { if (fastSyncedPlatform.current !== platform) { fastSyncedPlatform.current = platform; void sync(false); } }, [platform, sync]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load, loading]);

  const assign = async (id: number, values: string[]) => {
    setError('');
    try {
      await axiosInstance.put(`/reviews/archive/${id}/assignments`, { userIds: values.map(Number) });
      await load();
    } catch (caught: any) {
      setError(caught.response?.data?.[0]?.message ?? caught.message ?? 'Unable to assign the review.');
      await load();
    }
  };
  const setFlags = async (id: number, flags: { isNoName?: boolean; isBadReview?: boolean }) => {
    setReviews(current => current.map(review => review.id === id ? { ...review, ...flags } : review));
    try { await axiosInstance.put(`/reviews/archive/${id}/flags`, flags); } catch { await load(); }
  };
  const setCreditMonth = async (review: Review, value: string) => {
    const sourceMonth = reviewMonthInWarsaw(review.reviewCreatedAt);
    const creditMonth = !value || value === sourceMonth ? null : `${value}-01`;
    setReviews(current => current.map(item => item.id === review.id ? { ...item, creditMonth } : item));
    try {
      await axiosInstance.put(`/reviews/archive/${review.id}/credit-month`, { creditMonth });
    } catch (caught: any) {
      setError(caught.response?.data?.[0]?.message ?? caught.message ?? 'Unable to change the review month.');
      await load();
    }
  };
  const options = users.map(user => ({ value: String(user.id), label: `${user.firstName} ${user.lastName}`.trim() || user.username }));
  const userNames = new Map(options.map(option => [Number(option.value), option.label]));

  return <Stack gap="lg">
    <Paper p="lg" radius="lg" withBorder>
      <Group justify="space-between" align="flex-start">
        <div><Title order={3}>{labels[platform]} review archive</Title><Text c="dimmed" size="sm">Persistent history, deletion monitoring, edits, and shared staff credit.</Text></div>
        {canManage && <Button leftSection={<IconRefresh size={17}/>} loading={loading} onClick={() => void sync(true)}>Full sync</Button>}
      </Group>
      <Group mt="lg" gap="xl"><div><Text size="xs" c="dimmed">Reviews in this view</Text><Text fw={800} fz="xl">{total.toLocaleString()}</Text></div>{sourceStats.totalCount != null && <div><Text size="xs" c="dimmed">Source total</Text><Text fw={800} fz="xl">{sourceStats.totalCount.toLocaleString()}</Text></div>}{sourceStats.averageRating != null && <div><Text size="xs" c="dimmed">Average rating</Text><Text fw={800} fz="xl">{sourceStats.averageRating.toFixed(2)}</Text></div>}</Group>
      <Group mt="lg" justify="space-between"><TextInput leftSection={<IconSearch size={16}/>} placeholder="Search archived reviews" value={search} onChange={event => { setSearch(event.currentTarget.value); setPage(1); }} style={{ flex: 1, maxWidth: 420 }}/><SegmentedControl value={filter} onChange={value => { setFilter(value); setPage(1); }} data={[{ value: 'active', label: 'Active' }, { value: 'deleted', label: 'Deleted' }, { value: 'all', label: 'All' }]}/></Group>
      {error && manualReviewUrl ? <Alert color="red" mt="sm" title="GetYourGuide reviews could not be loaded">
        <Text size="sm">{error}</Text>
        <Text size="sm" mt="xs">Check the reviews directly on GetYourGuide:</Text>
        <Anchor href={manualReviewUrl} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>{manualReviewUrl}</Anchor>
      </Alert> : error && <Text c="red" mt="sm">{error}</Text>}
    </Paper>
    <SimpleGrid cols={{ base: 1, xl: 2 }}>{reviews.map(review => {
      const created = new Date(review.reviewCreatedAt), updated = review.reviewUpdatedAt ? new Date(review.reviewUpdatedAt) : null;
      const sourceCreatedAtLabel = platform === 'airbnb' ? review.rawPayload?.sourceCreatedAtLabel?.trim() : null;
      const monthOnly = platform === 'airbnb' && (review.rawPayload?.sourceDatePrecision === 'month' || (!sourceCreatedAtLabel && created.getUTCDate() === 1 && created.getUTCHours() === 0));
      const createdLabel = sourceCreatedAtLabel || (monthOnly
        ? created.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
        : formatWarsawDateTime(created));
      const sourceMonth = reviewMonthInWarsaw(review.reviewCreatedAt);
      const countedMonth = effectiveReviewMonth(review.reviewCreatedAt, review.creditMonth);
      const wasUpdated = !!updated && updated.getTime() - created.getTime() > 60_000;
      const suspicious = wasUpdated && reviewMonthInWarsaw(created) !== reviewMonthInWarsaw(updated!);
      const cardColor = review.isBadReview ? 'red' : review.isNoName ? 'yellow' : review.assignedUserIds.length ? 'green' : null;
      return <Paper key={review.id} p="lg" radius="lg" withBorder style={{ opacity: review.isDeleted ? .72 : 1, background: cardColor ? `var(--mantine-color-${cardColor}-light)` : undefined, borderColor: cardColor ? `var(--mantine-color-${cardColor}-light-color)` : undefined, transition: 'background-color 160ms ease, border-color 160ms ease' }}>
        <Group justify="space-between" align="flex-start"><Group><Avatar src={review.reviewerPhotoUrl} radius="xl"/><div><Text fw={700}>{review.reviewerName}</Text><Text size="xs" c="dimmed">Created {createdLabel}{wasUpdated && ` · Updated ${formatWarsawDateTime(updated!)}`}</Text></div></Group><Group gap="xs"><Badge color="yellow" leftSection={<IconStarFilled size={12}/>}>{Number(review.rating).toFixed(1)}</Badge>{wasUpdated && <Badge color="blue" leftSection={<IconEdit size={12}/>}>Updated</Badge>}{suspicious && <Badge color="orange" leftSection={<IconAlertTriangle size={12}/>}>Suspicious</Badge>}{review.isDeleted && <Badge color="red" leftSection={<IconTrash size={12}/>}>Deleted at source</Badge>}</Group></Group>
        <Text my="md" size="sm" lineClamp={5}>{review.comment || 'No written comment'}</Text>
        {canManage ? <><Group mb="md"><Checkbox color="gray" label="No name" checked={review.isNoName} onChange={event => void setFlags(review.id, { isNoName: event.currentTarget.checked })}/><Checkbox color="red" label="Bad review" checked={review.isBadReview} onChange={event => void setFlags(review.id, { isBadReview: event.currentTarget.checked })}/></Group><Group align="flex-end" mb="md"><TextInput type="month" label="Count in month" description={review.creditMonth ? "Manual month override" : `${labels[platform]} creation month · Warsaw time`} value={countedMonth} onChange={event => void setCreditMonth(review, event.currentTarget.value)} style={{ flex: 1 }}/>{review.creditMonth && <Button size="xs" variant="subtle" onClick={() => void setCreditMonth(review, sourceMonth)}>Use {labels[platform]} month</Button>}</Group><MultiSelect searchable clearable label="Credit this review to" description={review.assignedUserIds.length ? `${(1 / review.assignedUserIds.length).toFixed(3)} credit per person · counted in ${dayjs(`${countedMonth}-01`).format('MMMM YYYY')}` : `Unassigned — not counted for staff · target ${dayjs(`${countedMonth}-01`).format('MMMM YYYY')}`} data={options} value={review.assignedUserIds.map(String)} onChange={values => void assign(review.id, values)}/></> : <Stack gap="xs"><Group gap="xs">{review.isNoName && <Badge color="gray">No name</Badge>}{review.isBadReview && <Badge color="red">Bad review</Badge>}{!review.isNoName && !review.isBadReview && <Badge color="green" variant="light">No review flags</Badge>}</Group><div><Text size="xs" c="dimmed">Credited to · counted in {dayjs(`${countedMonth}-01`).format('MMMM YYYY')}</Text>{review.assignedUserIds.length ? <Group gap="xs" mt={4}>{review.assignedUserIds.map(userId => <Badge key={userId} variant="light">{userNames.get(userId) ?? `User #${userId}`} · {(1 / review.assignedUserIds.length).toFixed(3)}</Badge>)}</Group> : <Text size="sm" c="dimmed">Unassigned — not counted for staff</Text>}</div></Stack>}
      </Paper>;
    })}</SimpleGrid>
    {!reviews.length && !loading && <Paper p="xl" withBorder><Text ta="center" c="dimmed">No reviews match this view.</Text></Paper>}
    {totalPages > 1 && <Group justify="center"><Pagination value={page} onChange={setPage} total={totalPages}/></Group>}
  </Stack>;
}
