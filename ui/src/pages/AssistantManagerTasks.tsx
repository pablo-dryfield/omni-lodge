import { PageAccessGuard } from "../components/access/PageAccessGuard";
import AssistantManagerTaskPlanner from "../components/assistantManagerTasks/AssistantManagerTaskPlanner";
import { PAGE_SLUGS } from "../constants/pageSlugs";

const AssistantManagerTasks = () => (
  <PageAccessGuard pageSlug={PAGE_SLUGS.assistantManagerTasks}>
    <AssistantManagerTaskPlanner />
  </PageAccessGuard>
);

export default AssistantManagerTasks;
