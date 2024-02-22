import { Center, Title } from '@mantine/core';
import BookingsList from '../components/bookings/BookingsList';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';
import { useEffect } from 'react';

const Bookings = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(navigateToPage(props.title));
  }, [dispatch, props.title]);
  return (
    <div>
      <Center>
        <Title order={2}>{props.title}</Title>
      </Center>
      <BookingsList />
    </div>
  );
};

export default Bookings;
