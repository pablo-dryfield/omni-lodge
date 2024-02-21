import { Center, Title } from '@mantine/core';
import UsersList from '../components/users/UsersList';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';

const Users = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  dispatch(navigateToPage(props.title));
  return (
    <div>
      <Center>
        <Title order={2}>{props.title}</Title>
      </Center>
      <UsersList/>
    </div>
  );
};

export default Users;
