import { Center, Title } from '@mantine/core';
import UserTypesList from '../components/userTypes/UserTypeList';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';
import { useEffect } from 'react';

const UserTypes = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(navigateToPage(props.title));
  }, [dispatch, props.title]);
  return (
    <div>
      <Center>
        <Title order={2}>{props.title}</Title>
      </Center>
      <UserTypesList />
    </div>
  );
};

export default UserTypes;
