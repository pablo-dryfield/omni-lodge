import { Center, Tabs, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import VenueNumbersList from '../components/venueNumbers/VenueNumbersList';
import VenueNumbersSummary from '../components/venueNumbers/VenueNumbersSummary';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';
import { PageAccessGuard } from '../components/access/PageAccessGuard';
import { PAGE_SLUGS } from '../constants/pageSlugs';

const PAGE_SLUG = PAGE_SLUGS.venueNumbers;

const VenueNumbers = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState<string>('entries');
  useEffect(() => {
    dispatch(navigateToPage("Venue Numbers"));
  }, [dispatch, props.title]);
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <div>
        <Center>
          <Title order={2}>{props.title}</Title>
        </Center>
        <Tabs value={tab} onChange={(value) => setTab(value ?? 'entries')} mt="md">
          <Tabs.List grow>
            <Tabs.Tab value="entries">Night Reports</Tabs.Tab>
            <Tabs.Tab value="summary">Summary</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="entries" pt="md">
            <VenueNumbersList />
          </Tabs.Panel>
          <Tabs.Panel value="summary" pt="md">
            <VenueNumbersSummary />
          </Tabs.Panel>
        </Tabs>
      </div>
    </PageAccessGuard>
  );
};

export default VenueNumbers;
