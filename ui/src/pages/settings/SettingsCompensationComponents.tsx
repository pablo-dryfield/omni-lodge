import { Tabs } from '@mantine/core';
import { IconCoin, IconRoute } from '@tabler/icons-react';
import { PageAccessGuard } from '../../components/access/PageAccessGuard';
import CompensationComponentList from '../../components/compensationComponents/CompensationComponentList';
import PayoutRoutingPanel from '../../components/compensationComponents/PayoutRoutingPanel';
import { PAGE_SLUGS } from '../../constants/pageSlugs';

const SettingsCompensationComponents = () => (
  <PageAccessGuard pageSlug={PAGE_SLUGS.settingsCompensationComponents}>
    <Tabs defaultValue="components" keepMounted={false}>
      <Tabs.List mb="lg">
        <Tabs.Tab value="components" leftSection={<IconCoin size={16} />}>
          Components
        </Tabs.Tab>
        <Tabs.Tab value="payout-routing" leftSection={<IconRoute size={16} />}>
          Payout Routing
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="components">
        <CompensationComponentList />
      </Tabs.Panel>
      <Tabs.Panel value="payout-routing">
        <PayoutRoutingPanel />
      </Tabs.Panel>
    </Tabs>
  </PageAccessGuard>
);

export default SettingsCompensationComponents;
