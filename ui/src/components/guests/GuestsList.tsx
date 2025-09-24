import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchGuests, deleteGuest, createGuest, updateGuest } from '../../actions/guestActions';
import Table from '../../utils/Table';
import { useMemo } from 'react';
import { Guest } from '../../types/guests/Guest';
import { modifyColumn } from '../../utils/modifyColumn';
import { guestsColumnDef } from './guestsColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';
import { removeEmptyKeys } from '../../utils/removeEmptyKeys';
import { getChangedValues } from '../../utils/getChangedValues';

const MODULE_SLUG = 'guest-directory';

const GuestList = () => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.guests)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
    },
  };

  useEffect(() => {
    dispatch(fetchGuests());
  }, [dispatch]);

  const handleCreate = async (dataCreate: Partial<Guest>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if (
      Object.keys(dataCreated).some((key) => key !== 'createdBy') &&
      Object.keys(dataCreated).length !== 0
    ) {
      await dispatch(createGuest(dataCreated));
      dispatch(fetchGuests());
    }
  };

  const handleUpdate = async (
    originalData: Partial<Guest>,
    dataUpdated: Partial<Guest>
  ) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === 'number') {
      if (
        Object.keys(dataUpdate).some((key) => key !== 'updatedBy') &&
        Object.keys(dataUpdate).length !== 0
      ) {
        await dispatch(updateGuest({ guestId: dataId, guestData: dataUpdate }));
        dispatch(fetchGuests());
      }
    } else {
      console.error('Guest ID is undefined.');
    }
  };

  const handleDelete = async (
    dataDelete: Partial<Guest>,
    count: number,
    iterator: number
  ) => {
    if (typeof dataDelete.id === 'number') {
      await dispatch(deleteGuest(dataDelete.id));
      if (count === iterator) {
        dispatch(fetchGuests());
      }
    } else {
      console.error('Guest ID is undefined.');
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<Guest>>[]>(
    () => modifyColumn(data[0]?.columns || [], guestsColumnDef),
    [data]
  );

  return (
    <Table
      pageTitle={currentPage}
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

export default GuestList;
