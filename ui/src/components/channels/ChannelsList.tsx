import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchChannels, deleteChannel, createChannel, updateChannel } from '../../actions/channelActions';
import Table from '../../utils/Table';
import { useMemo } from 'react';
import { Channel } from '../../types/channels/Channel';
import { modifyColumn } from '../../utils/modifyColumn';
import { channelsColumnDef } from './channelsColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';
import { removeEmptyKeys } from '../../utils/removeEmptyKeys';
import { getChangedValues } from '../../utils/getChangedValues';

const MODULE_SLUG = 'channel-console';

type ChannelsListProps = {
  pageTitle?: string;
};

const ChannelList = ({ pageTitle }: ChannelsListProps) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.channels)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
      paymentMethodId: false,
    },
  };

  useEffect(() => {
    dispatch(fetchChannels());
  }, [dispatch]);

  const handleCreate = async (dataCreate: Partial<Channel>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if (
      Object.keys(dataCreated).some((key) => key !== 'createdBy') &&
      Object.keys(dataCreated).length !== 0
    ) {
      await dispatch(createChannel(dataCreated));
      dispatch(fetchChannels());
    }
  };

  const handleUpdate = async (
    originalData: Partial<Channel>,
    dataUpdated: Partial<Channel>
  ) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === 'number') {
      if (
        Object.keys(dataUpdate).some((key) => key !== 'updatedBy') &&
        Object.keys(dataUpdate).length !== 0
      ) {
        await dispatch(updateChannel({ channelId: dataId, channelData: dataUpdate }));
        dispatch(fetchChannels());
      }
    } else {
      console.error('Channel ID is undefined.');
    }
  };

  const handleDelete = async (
    dataDelete: Partial<Channel>,
    count: number,
    iterator: number
  ) => {
    if (typeof dataDelete.id === 'number') {
      await dispatch(deleteChannel(dataDelete.id));
      if (count === iterator) {
        dispatch(fetchChannels());
      }
    } else {
      console.error('Channel ID is undefined.');
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<Channel>>[]>(
    () => modifyColumn(data[0]?.columns || [], channelsColumnDef),
    [data]
  );

  const headingTitle = pageTitle ?? currentPage;

  return (
    <Table
      pageTitle={headingTitle}
      data={data[0]?.data || []}
      loading={loading}
      error={error}
      columns={modifiedColumns}
      actions={{ handleDelete, handleCreate, handleUpdate }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default ChannelList;
