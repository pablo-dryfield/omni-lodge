import { PageAccessGuard } from '../../components/access/PageAccessGuard';
import CompensationComponentList from '../../components/compensationComponents/CompensationComponentList';
import { PAGE_SLUGS } from '../../constants/pageSlugs';

const SettingsCompensationComponents = () => (
  <PageAccessGuard pageSlug={PAGE_SLUGS.settingsCompensationComponents}>
    <CompensationComponentList />
  </PageAccessGuard>
);

export default SettingsCompensationComponents;
