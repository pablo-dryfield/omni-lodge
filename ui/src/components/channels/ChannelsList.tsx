import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchChannels, deleteChannel, createChannel, updateChannel } from '../../actions/channelActions';
import Table from '../../utils/TableNew';
import { useMemo } from 'react';
import { Channel } from '../../types/channels/Channel';
import { modifyColumn } from '../../utils/modifyColumn';
import { channelsColumnDef } from './channelsColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';

const ChannelList = () => {

  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.channels)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
      password: false,
    },
  }

  useEffect(() => {
    dispatch(fetchChannels())
  }, [dispatch]);

  const handleCreate = async (dataCreate: Channel) => {
    await dispatch(createChannel(dataCreate));
    dispatch(fetchChannels());
  };

  const handleUpdate = async (dataUpdate: Channel) => {
    const channelId = dataUpdate.id;
    const channelData = dataUpdate;
    await dispatch(updateChannel({ channelId, channelData }));
    dispatch(fetchChannels());
  };

  const handleDelete = async (dataDelete: Channel, count: number, iterator: number) => {
    await dispatch(deleteChannel(dataDelete.id));
    if (count === iterator) { dispatch(fetchChannels()); }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Channel>[]>(() => modifyColumn(data[0].columns, channelsColumnDef), [data]);

  return (
    <Table
      pageTitle={currentPage}
      data={data[0].data}
      loading={loading}
      error={error}
      columns={modifiedColumns}
      actions={{ handleDelete, handleCreate, handleUpdate }}
      initialState={initialState}
    />
  );
};

export default ChannelList;