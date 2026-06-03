import { Center, Loader, Title } from '@mantine/core';
import { Suspense, lazy, useEffect } from 'react';

import { PageAccessGuard } from '../components/access/PageAccessGuard';
import { navigateToPage } from '../actions/navigationActions';
import { useAppDispatch } from '../store/hooks';
import { PAGE_SLUGS } from '../constants/pageSlugs';
import { GenericPageProps } from '../types/general/GenericPageProps';

const PAGE_SLUG = PAGE_SLUGS.channelNumbers;
const ChannelNumbersSummary = lazy(() => import('../components/channelNumbers/ChannelNumbersSummary'));

const ChannelNumbers = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(navigateToPage('Channel Numbers'));
  }, [dispatch, title]);

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <div>
        <Center>
          <Title order={2}>{title}</Title>
        </Center>
        <Suspense fallback={<Center py="xl"><Loader /></Center>}>
          <ChannelNumbersSummary />
        </Suspense>
      </div>
    </PageAccessGuard>
  );
};

export default ChannelNumbers;
