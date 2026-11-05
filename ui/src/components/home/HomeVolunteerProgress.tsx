import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useAppSelector } from '../../store/hooks';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import { selectAllowedPageSlugs } from '../../selectors/accessControlSelectors';
import { PAGE_SLUGS } from '../../constants/pageSlugs';
import { useVolunteerStayProgress, getVolunteerMilestoneErrorMessage } from '../../api/volunteerMilestones';
import { VolunteerOverviewCard } from '../volunteer/VolunteerStayProgress';

export default function HomeVolunteerProgress({ configuredVisible, audienceReady }: {
  configuredVisible: boolean; audienceReady: boolean;
}) {
  const navigate = useNavigate();
  const { staffType, loggedUserId } = useAppSelector((state) => state.session);
  const pages = useAppSelector(selectAllowedPageSlugs);
  const access = useModuleAccess('volunteer-progress');
  const visible = audienceReady && configuredVisible && staffType === 'volunteer'
    && access.ready && access.canView && pages.has(PAGE_SLUGS.volunteerProgress) && Boolean(loggedUserId);
  // Always fetch the current user's report, even if their role also has management access.
  const report = useVolunteerStayProgress(loggedUserId ?? null, null, visible);
  if (!visible) return null;
  return <Box component="section" aria-label="Your volunteer progress">
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={2} size="h3">Your volunteer progress</Title>
        <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} loading={report.isFetching}
          onClick={() => report.refetch()}>Refresh progress</Button>
      </Group>
      {report.isLoading ? <Group><Loader size="sm" /><Text size="sm">Loading your stay progress…</Text></Group>
        : report.error ? <Alert color="red" title="Unable to load your progress">{getVolunteerMilestoneErrorMessage(report.error)}</Alert>
        : report.data ? <VolunteerOverviewCard report={report.data} selfView onOpen={() => navigate('/volunteer-progress')} />
        : <Alert color="blue">Your volunteer stay has not been set up yet. Please contact a manager.</Alert>}
    </Stack>
  </Box>;
}
