import { Center, Title } from '@mantine/core';
import VenueNumbersList from '../components/venueNumbers/VenueNumbersList';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';
import { useEffect } from 'react';
import { PageAccessGuard } from '../components/access/PageAccessGuard';
import { PAGE_SLUGS } from '../constants/pageSlugs';

const PAGE_SLUG = PAGE_SLUGS.venueNumbers;

const VenueNumbers = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(navigateToPage("Venue Numbers"));
  }, [dispatch, props.title]);
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <div>
        <Center>
          <Title order={2}>{props.title}</Title>
        </Center>
        <VenueNumbersList />
      </div>
    </PageAccessGuard>
  );
};

export default VenueNumbers;