import { Center, Tabs, Title } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = useMemo(() => searchParams.get('tab'), [searchParams]);
  const resolvedTab = tabParam === 'summary' ? 'summary' : 'entries';
  const [tab, setTab] = useState<string>(resolvedTab);
  useEffect(() => {
    dispatch(navigateToPage("Venue Numbers"));
  }, [dispatch, props.title]);
  useEffect(() => {
    if (tab !== resolvedTab) {
      setTab(resolvedTab);
    }
  }, [resolvedTab, tab]);
  const handleTabChange = (value: string | null) => {
    const nextTab = value ?? 'entries';
    setTab(nextTab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', nextTab);
      return next;
    }, { replace: true });
  };
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <div>
        <Center>
          <Title order={2}>{props.title}</Title>
        </Center>
        <Tabs value={tab} onChange={handleTabChange} mt="md">
          <Tabs.List grow>
            <Tabs.Tab value="entries">Night Reports</Tabs.Tab>
            <Tabs.Tab value="summary">Summary</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="entries" pt="md">
            <VenueNumbersList active={tab === 'entries'} />
          </Tabs.Panel>
          <Tabs.Panel value="summary" pt="md">
            <VenueNumbersSummary active={tab === 'summary'} />
          </Tabs.Panel>
        </Tabs>
      </div>
    </PageAccessGuard>
  );
};

export default VenueNumbers;
