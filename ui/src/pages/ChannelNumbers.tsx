import { Center, Title } from '@mantine/core';
import { useEffect } from 'react';

import { PageAccessGuard } from '../components/access/PageAccessGuard';
import ChannelNumbersSummary from '../components/channelNumbers/ChannelNumbersSummary';
import { navigateToPage } from '../actions/navigationActions';
import { useAppDispatch } from '../store/hooks';
import { PAGE_SLUGS } from '../constants/pageSlugs';
import { GenericPageProps } from '../types/general/GenericPageProps';

const PAGE_SLUG = PAGE_SLUGS.channelNumbers;

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
        <ChannelNumbersSummary />
      </div>
    </PageAccessGuard>
  );
};

export default ChannelNumbers;
