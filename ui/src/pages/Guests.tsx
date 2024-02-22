import { Center, Title } from '@mantine/core';
import GuestsList from '../components/guests/GuestsList';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';

const Guests = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  dispatch(navigateToPage(props.title));
  return (
    <div>
      <Center>
        <Title order={2}>{props.title}</Title>
      </Center>
      <GuestsList/>
    </div>
  );
};

export default Guests;
