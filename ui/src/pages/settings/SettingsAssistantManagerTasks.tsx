import { PageAccessGuard } from '../../components/access/PageAccessGuard';
import AssistantManagerTaskPlanner from '../../components/assistantManagerTasks/AssistantManagerTaskPlanner';
import { PAGE_SLUGS } from '../../constants/pageSlugs';

const SettingsAssistantManagerTasks = () => (
  <PageAccessGuard pageSlug={PAGE_SLUGS.settingsAssistantManagerTasks}>
    <AssistantManagerTaskPlanner />
  </PageAccessGuard>
);

export default SettingsAssistantManagerTasks;
