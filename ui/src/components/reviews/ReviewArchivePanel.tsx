import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Anchor,
  Avatar,
  Badge,
  Button,
  Checkbox,
  Group,
  MultiSelect,
  Pagination,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconEdit,
  IconRefresh,
  IconSearch,
  IconStarFilled,
  IconTrash,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import axiosInstance from '../../utils/axiosInstance';
import {
  effectiveReviewMonth,
  REVIEW_CREDIT_TIMEZONE,
  reviewMonthInWarsaw,
} from '../../utils/reviewCreditMonth';

type Platform = 'google' | 'tripadvisor' | 'airbnb' | 'getyourguide';
type User = { id: number; firstName: string; lastName: string; username: string };
type Review = {
  id: number;
  sourceReviewId: string;
  reviewerName: string;
  reviewerPhotoUrl: string | null;
  comment: string | null;
  rating: number | string;
  reviewCreatedAt: string;
  creditMonth: string | null;
  reviewUpdatedAt: string | null;
  isDeleted: boolean;
  isNoName: boolean;
  isBadReview: boolean;
  deletedDetectedAt: string | null;
  assignedUserIds: number[];
  credit: number;
  rawPayload: {
    sourceCreatedAtLabel?: string | null;
    sourceDatePrecision?: string | null;
  } | null;
};
type GoogleMeta = { nextPageToken?: string | null; totalCount?: number; averageRating?: number };

const labels = {
  google: 'Google',
  tripadvisor: 'TripAdvisor',
  airbnb: 'Airbnb',
  getyourguide: 'GetYourGuide',
};

const centeredFieldStyles = {
  label: { width: '100%', textAlign: 'center' as const },
  description: { width: '100%', textAlign: 'center' as const },
};

const formatWarsawDateTime = (value: Date): string =>
  `${value.toLocaleDateString(undefined, {
    timeZone: REVIEW_CREDIT_TIMEZONE,
  })} ${value.toLocaleTimeString([], {
    timeZone: REVIEW_CREDIT_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`;

export default function ReviewArchivePanel({
  platform,
  canManage = false,
}: {
  platform: Platform;
  canManage?: boolean;
}) {
  const isMobile = useMediaQuery('(max-width: 48em)');
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
    const response = await axiosInstance.get('/reviews/archive', {
      params: { platform, deleted, search: search || undefined, page, pageSize: 24 },
    });
    setReviews(response.data.reviews);
    setUsers(response.data.users);
    setTotal(response.data.pagination.total);
    setTotalPages(response.data.pagination.totalPages);
  }, [filter, page, platform, search]);

  const sync = useCallback(
    async (full: boolean) => {
      setLoading(true);
      setError('');
      setManualReviewUrl(null);
      try {
        const syncBase = full ? '/reviews/archive/sync' : '/reviews/archive/sync/fast';
        const started = await axiosInstance.post(`${syncBase}/start`, { platform });
        const runId = started.data.run.id;
        let token: string | undefined;
        let cursor: string | undefined;
        let offset = 0;
        let sourceTotalCount: number | undefined;
        let averageRating: number | undefined;

        for (let current = 0; current < (full ? 250 : 2); current++) {
          const response =
            platform === 'google'
              ? await axiosInstance.get('/reviews/googleReviews', {
                  params: token ? { pageToken: token } : undefined,
                })
              : platform === 'tripadvisor'
                ? await axiosInstance.get('/reviews/tripadvisorReviews', {
                    params: offset ? { offset } : undefined,
                  })
                : platform === 'getyourguide'
                  ? await axiosInstance.get('/reviews/getyourguideReviews', {
                      params: offset ? { offset } : undefined,
                    })
                  : await axiosInstance.get('/reviews/airbnbReviews', {
                      params: cursor ? { cursor } : undefined,
                    });
          const payload = response.data[0];
          const rows = payload.data ?? [];
          const meta = payload.columns?.[0];
          await axiosInstance.post(`${syncBase}/${runId}/page`, { reviews: rows });

          if (platform === 'google') {
            const googleMeta = (typeof meta === 'object' ? meta : { nextPageToken: meta }) as GoogleMeta;
            sourceTotalCount = googleMeta.totalCount;
            averageRating = googleMeta.averageRating;
            token = googleMeta.nextPageToken || undefined;
            if (!token) break;
          } else if (platform === 'tripadvisor' || platform === 'getyourguide') {
            sourceTotalCount = meta?.totalCount ?? sourceTotalCount;
            if (!meta?.hasMore) break;
            offset = meta.nextOffset;
          } else {
            sourceTotalCount = meta?.totalCount ?? sourceTotalCount;
            if (!meta?.hasMore || !meta?.endCursor) break;
            cursor = meta.endCursor;
          }
        }

        await axiosInstance.post(`${syncBase}/${runId}/complete`, { sourceTotalCount, averageRating });
        setSourceStats({ totalCount: sourceTotalCount, averageRating });
        setPage(1);
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
      } finally {
        setLoading(false);
      }
    },
    [platform],
  );

  useEffect(() => {
    if (fastSyncedPlatform.current !== platform) {
      fastSyncedPlatform.current = platform;
      void sync(false);
    }
  }, [platform, sync]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load, loading]);

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
    setReviews((current) =>
      current.map((review) => (review.id === id ? { ...review, ...flags } : review)),
    );
    try {
      await axiosInstance.put(`/reviews/archive/${id}/flags`, flags);
    } catch {
      await load();
    }
  };

  const setCreditMonth = async (review: Review, value: string) => {
    const sourceMonth = reviewMonthInWarsaw(review.reviewCreatedAt);
    const creditMonth = !value || value === sourceMonth ? null : `${value}-01`;
    setReviews((current) =>
      current.map((item) => (item.id === review.id ? { ...item, creditMonth } : item)),
    );
    try {
      await axiosInstance.put(`/reviews/archive/${review.id}/credit-month`, { creditMonth });
    } catch (caught: any) {
      setError(caught.response?.data?.[0]?.message ?? caught.message ?? 'Unable to change the review month.');
      await load();
    }
  };

  const options = users.map((user) => ({
    value: String(user.id),
    label: `${user.firstName} ${user.lastName}`.trim() || user.username,
  }));
  const userNames = new Map(options.map((option) => [Number(option.value), option.label]));

  return (
    <Stack gap="lg" miw={0}>
      <Paper p={{ base: 'md', sm: 'lg' }} radius="lg" withBorder>
        <Stack align="center" gap="sm">
          <Stack align="center" gap={2}>
            <Title order={3} ta="center">
              {labels[platform]} review archive
            </Title>
            <Text c="dimmed" size="sm" ta="center">
              Persistent history, deletion monitoring, edits, and shared staff credit.
            </Text>
          </Stack>
          {canManage && (
            <Button
              leftSection={<IconRefresh size={17} />}
              loading={loading}
              onClick={() => void sync(true)}
              fullWidth={isMobile}
              maw={220}
            >
              Full sync
            </Button>
          )}
        </Stack>

        <Group mt="lg" gap={isMobile ? 'md' : 'xl'} justify="center" w="100%">
          <Stack gap={0} align="center" miw={100}>
            <Text size="xs" c="dimmed" ta="center">
              Reviews in this view
            </Text>
            <Text fw={800} fz="xl" ta="center">
              {total.toLocaleString()}
            </Text>
          </Stack>
          {sourceStats.totalCount != null && (
            <Stack gap={0} align="center" miw={100}>
              <Text size="xs" c="dimmed" ta="center">
                Source total
              </Text>
              <Text fw={800} fz="xl" ta="center">
                {sourceStats.totalCount.toLocaleString()}
              </Text>
            </Stack>
          )}
          {sourceStats.averageRating != null && (
            <Stack gap={0} align="center" miw={100}>
              <Text size="xs" c="dimmed" ta="center">
                Average rating
              </Text>
              <Text fw={800} fz="xl" ta="center">
                {sourceStats.averageRating.toFixed(2)}
              </Text>
            </Stack>
          )}
        </Group>

        <Group mt="lg" justify="center" align="stretch" w="100%">
          <TextInput
            leftSection={<IconSearch size={16} />}
            placeholder="Search archived reviews"
            aria-label="Search archived reviews"
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(1);
            }}
            w={isMobile ? '100%' : 420}
            maw="100%"
          />
          <SegmentedControl
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
            data={[
              { value: 'active', label: 'Active' },
              { value: 'deleted', label: 'Deleted' },
              { value: 'all', label: 'All' },
            ]}
            fullWidth
            w={isMobile ? '100%' : 300}
            maw="100%"
          />
        </Group>

        {error && manualReviewUrl ? (
          <Alert
            color="red"
            mt="sm"
            title="GetYourGuide reviews could not be loaded"
            ta="center"
            styles={{ title: { justifyContent: 'center' } }}
          >
            <Text size="sm" ta="center">
              {error}
            </Text>
            <Text size="sm" mt="xs" ta="center">
              Check the reviews directly on GetYourGuide:
            </Text>
            <Anchor
              href={manualReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'block', overflowWrap: 'anywhere', textAlign: 'center' }}
            >
              {manualReviewUrl}
            </Anchor>
          </Alert>
        ) : (
          error && (
            <Text c="red" mt="sm" ta="center" style={{ overflowWrap: 'anywhere' }}>
              {error}
            </Text>
          )
        )}
      </Paper>

      <SimpleGrid cols={{ base: 1, xl: 2 }} style={{ minWidth: 0 }}>
        {reviews.map((review) => {
          const created = new Date(review.reviewCreatedAt);
          const updated = review.reviewUpdatedAt ? new Date(review.reviewUpdatedAt) : null;
          const sourceCreatedAtLabel =
            platform === 'airbnb' ? review.rawPayload?.sourceCreatedAtLabel?.trim() : null;
          const monthOnly =
            platform === 'airbnb' &&
            (review.rawPayload?.sourceDatePrecision === 'month' ||
              (!sourceCreatedAtLabel && created.getUTCDate() === 1 && created.getUTCHours() === 0));
          const createdLabel =
            sourceCreatedAtLabel ||
            (monthOnly
              ? created.toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })
              : formatWarsawDateTime(created));
          const sourceMonth = reviewMonthInWarsaw(review.reviewCreatedAt);
          const countedMonth = effectiveReviewMonth(review.reviewCreatedAt, review.creditMonth);
          const wasUpdated = !!updated && updated.getTime() - created.getTime() > 60_000;
          const suspicious = wasUpdated && reviewMonthInWarsaw(created) !== reviewMonthInWarsaw(updated!);
          const cardColor = review.isBadReview
            ? 'red'
            : review.isNoName
              ? 'yellow'
              : review.assignedUserIds.length
                ? 'green'
                : null;

          return (
            <Paper
              key={review.id}
              p={{ base: 'md', sm: 'lg' }}
              radius="lg"
              withBorder
              style={{
                minWidth: 0,
                opacity: review.isDeleted ? 0.72 : 1,
                background: cardColor ? `var(--mantine-color-${cardColor}-light)` : undefined,
                borderColor: cardColor
                  ? `var(--mantine-color-${cardColor}-light-color)`
                  : undefined,
                transition: 'background-color 160ms ease, border-color 160ms ease',
              }}
            >
              <Stack align="center" gap="sm">
                <Avatar src={review.reviewerPhotoUrl} radius="xl" />
                <Stack align="center" gap={2} w="100%" miw={0}>
                  <Text fw={700} ta="center" style={{ maxWidth: '100%', overflowWrap: 'anywhere' }}>
                    {review.reviewerName}
                  </Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    ta="center"
                    style={{ maxWidth: '100%', overflowWrap: 'anywhere' }}
                  >
                    Created {createdLabel}
                    {wasUpdated && ` · Updated ${formatWarsawDateTime(updated!)}`}
                  </Text>
                </Stack>
                <Group gap="xs" justify="center">
                  <Badge color="yellow" leftSection={<IconStarFilled size={12} />}>
                    {Number(review.rating).toFixed(1)}
                  </Badge>
                  {wasUpdated && (
                    <Badge color="blue" leftSection={<IconEdit size={12} />}>
                      Updated
                    </Badge>
                  )}
                  {suspicious && (
                    <Badge color="orange" leftSection={<IconAlertTriangle size={12} />}>
                      Suspicious
                    </Badge>
                  )}
                  {review.isDeleted && (
                    <Badge color="red" leftSection={<IconTrash size={12} />}>
                      Deleted at source
                    </Badge>
                  )}
                </Group>
              </Stack>

              <Text
                my="md"
                size="sm"
                lineClamp={5}
                ta="center"
                style={{ overflowWrap: 'anywhere' }}
              >
                {review.comment || 'No written comment'}
              </Text>

              {canManage ? (
                <Stack align="center" gap="md">
                  <Group justify="center">
                    <Checkbox
                      color="gray"
                      label="No name"
                      checked={review.isNoName}
                      onChange={(event) =>
                        void setFlags(review.id, { isNoName: event.currentTarget.checked })
                      }
                    />
                    <Checkbox
                      color="red"
                      label="Bad review"
                      checked={review.isBadReview}
                      onChange={(event) =>
                        void setFlags(review.id, { isBadReview: event.currentTarget.checked })
                      }
                    />
                  </Group>
                  <Group align="flex-end" justify="center" w="100%">
                    <TextInput
                      type="month"
                      label="Count in month"
                      description={
                        review.creditMonth
                          ? 'Manual month override'
                          : `${labels[platform]} creation month · Warsaw time`
                      }
                      value={countedMonth}
                      onChange={(event) => void setCreditMonth(review, event.currentTarget.value)}
                      styles={centeredFieldStyles}
                      style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 360 }}
                    />
                    {review.creditMonth && (
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => void setCreditMonth(review, sourceMonth)}
                        fullWidth={isMobile}
                        maw={isMobile ? 360 : undefined}
                      >
                        Use {labels[platform]} month
                      </Button>
                    )}
                  </Group>
                  <MultiSelect
                    searchable
                    clearable
                    label="Credit this review to"
                    description={
                      review.assignedUserIds.length
                        ? `${(1 / review.assignedUserIds.length).toFixed(3)} credit per person · counted in ${dayjs(
                            `${countedMonth}-01`,
                          ).format('MMMM YYYY')}`
                        : `Unassigned — not counted for staff · target ${dayjs(`${countedMonth}-01`).format(
                            'MMMM YYYY',
                          )}`
                    }
                    data={options}
                    value={review.assignedUserIds.map(String)}
                    onChange={(values) => void assign(review.id, values)}
                    styles={centeredFieldStyles}
                    w="100%"
                    maw={520}
                  />
                </Stack>
              ) : (
                <Stack gap="xs" align="center">
                  <Group gap="xs" justify="center">
                    {review.isNoName && <Badge color="gray">No name</Badge>}
                    {review.isBadReview && <Badge color="red">Bad review</Badge>}
                    {!review.isNoName && !review.isBadReview && (
                      <Badge color="green" variant="light">
                        No review flags
                      </Badge>
                    )}
                  </Group>
                  <Stack gap={4} align="center" w="100%">
                    <Text size="xs" c="dimmed" ta="center">
                      Credited to · counted in {dayjs(`${countedMonth}-01`).format('MMMM YYYY')}
                    </Text>
                    {review.assignedUserIds.length ? (
                      <Group gap="xs" justify="center">
                        {review.assignedUserIds.map((userId) => (
                          <Badge key={userId} variant="light" maw="100%">
                            {userNames.get(userId) ?? `User #${userId}`} ·{' '}
                            {(1 / review.assignedUserIds.length).toFixed(3)}
                          </Badge>
                        ))}
                      </Group>
                    ) : (
                      <Text size="sm" c="dimmed" ta="center">
                        Unassigned — not counted for staff
                      </Text>
                    )}
                  </Stack>
                </Stack>
              )}
            </Paper>
          );
        })}
      </SimpleGrid>

      {!reviews.length && !loading && (
        <Paper p={{ base: 'lg', sm: 'xl' }} withBorder>
          <Text ta="center" c="dimmed">
            No reviews match this view.
          </Text>
        </Paper>
      )}
      {totalPages > 1 && (
        <Group justify="center" w="100%">
          <Pagination
            value={page}
            onChange={setPage}
            total={totalPages}
            siblings={isMobile ? 0 : 1}
            boundaries={isMobile ? 0 : 1}
            size={isMobile ? 'sm' : 'md'}
          />
        </Group>
      )}
    </Stack>
  );
}
