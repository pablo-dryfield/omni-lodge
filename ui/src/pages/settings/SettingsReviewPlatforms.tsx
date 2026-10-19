import { Stack, Title, Text } from '@mantine/core';
import { PageAccessGuard } from '../../components/access/PageAccessGuard';
import { PAGE_SLUGS } from '../../constants/pageSlugs';
import ReviewPlatformList from '../../components/reviewPlatforms/ReviewPlatformList';

const SettingsReviewPlatforms = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.settingsReviewPlatforms}>
      <Stack gap="md">
        <div>
          <Title order={3}>Review Platforms</Title>
          <Text size="sm" c="dimmed">
            Configure review platforms used by counters and manual review credits. Active platforms appear in the review overview dropdowns.
          </Text>
        </div>
        <ReviewPlatformList />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsReviewPlatforms;
