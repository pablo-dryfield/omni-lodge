import { Stack, Title, Text } from '@mantine/core';
import { PageAccessGuard } from '../components/access/PageAccessGuard';
import { PAGE_SLUGS } from '../constants/pageSlugs';
import ReviewCounterList from '../components/reviewCounters/ReviewCounterList';

const ReviewCounters = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.reviews}>
      <Stack gap="md">
        <div>
          <Title order={2}>Reviews</Title>
          <Text size="sm" c="dimmed">
            Track monthly review totals, reviewer order, and staff credit allocations across platforms.
          </Text>
        </div>
        <ReviewCounterList />
      </Stack>
    </PageAccessGuard>
  );
};

export default ReviewCounters;
