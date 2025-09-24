import { Center, Title } from '@mantine/core';
import GuestsList from '../components/guests/GuestsList';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';
import { useEffect } from 'react';
import { PageAccessGuard } from '../components/access/PageAccessGuard';
import { PAGE_SLUGS } from '../constants/pageSlugs';

const PAGE_SLUG = PAGE_SLUGS.guests;

const Guests = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(navigateToPage(props.title));
  }, [dispatch, props.title]);
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <div>
        <Center>
          <Title order={2}>{props.title}</Title>
        </Center>
        <GuestsList />
      </div>
    </PageAccessGuard>
  );
};

export default Guests;