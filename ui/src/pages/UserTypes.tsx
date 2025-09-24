import { Center, Title } from '@mantine/core';
import UserTypesList from '../components/userTypes/UserTypeList';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';
import { useEffect } from 'react';
import { PageAccessGuard } from '../components/access/PageAccessGuard';
import { PAGE_SLUGS } from '../constants/pageSlugs';

const PAGE_SLUG = PAGE_SLUGS.userTypes;

const UserTypes = (props: GenericPageProps) => {
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
        <UserTypesList />
      </div>
    </PageAccessGuard>
  );
};

export default UserTypes;