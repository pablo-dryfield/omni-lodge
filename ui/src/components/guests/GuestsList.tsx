import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchGuests, deleteGuest, createGuest, updateGuest } from '../../actions/guestActions';
import Table from '../../utils/Table';
import { useMemo } from 'react';
import { Guest } from '../../types/guests/Guest';
import { modifyColumn } from '../../utils/modifyColumn';
import { guestsColumnDef } from './guestsColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';

const GuestList = () => {

  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.guests)[0];
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
    dispatch(fetchGuests())
  }, [dispatch]);

  const handleCreate = async (dataCreate: Guest) => {
    await dispatch(createGuest(dataCreate));
    dispatch(fetchGuests());
  };

  const handleUpdate = async (dataUpdate: Guest) => {
    const guestId = dataUpdate.id;
    const guestData = dataUpdate;
    await dispatch(updateGuest({ guestId, guestData }));
    dispatch(fetchGuests());
  };

  const handleDelete = async (dataDelete: Guest, count: number, iterator: number) => {
    await dispatch(deleteGuest(dataDelete.id));
    if (count === iterator) { dispatch(fetchGuests()); }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Guest>[]>(() => modifyColumn(data[0]?.columns || [], guestsColumnDef), [data]);

  return (
    <Table
      pageTitle={currentPage}
      data={data[0]?.data || []}
      loading={loading}
      error={error}
      columns={modifiedColumns}
      actions={{ handleDelete, handleCreate, handleUpdate }}
      initialState={initialState}
    />
  );
};

export default GuestList;