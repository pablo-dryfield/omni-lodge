import { Center, Title } from '@mantine/core';
import ChannelsList from '../components/channels/ChannelsList';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';

const Channels = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  dispatch(navigateToPage(props.title));
  return (
    <div>
      <Center>
        <Title order={2}>{props.title}</Title>
      </Center>
      <ChannelsList/>
    </div>
  );
};

export default Channels;
