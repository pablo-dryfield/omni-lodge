import { Center, Title } from '@mantine/core';
import VenueNumbersList from '../components/venueNumbers/VenueNumbersList';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';
import { useEffect } from 'react';

const VenueNumbers = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(navigateToPage("Venue Numbers"));
  }, [dispatch, props.title]);
  return (
    <div>
      <Center>
        <Title order={2}>{props.title}</Title>
      </Center>
      <VenueNumbersList />
    </div>
  );
};

export default VenueNumbers;
