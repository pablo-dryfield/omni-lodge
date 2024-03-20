import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchBookings, deleteBooking, createBooking, updateBooking } from '../../actions/bookingActions';
import Table from '../../utils/Table';
import { useMemo } from 'react';
import { Booking } from '../../types/bookings/Booking';
import { modifyColumn } from '../../utils/modifyColumn';
import { bookingsColumnDef } from './bookingsColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';
import { removeEmptyKeys } from '../../utils/removeEmptyKeys';
import { getChangedValues } from '../../utils/getChangedValues';

const BookingList = () => {

  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.bookings)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
    },
  }

  useEffect(() => {
    dispatch(fetchBookings())
  }, [dispatch]);

  const handleCreate = async (dataCreate: Partial<Booking>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if(Object.keys(dataCreated).some(key => key !== 'createdBy') && Object.keys(dataCreated).length !== 0){
      await dispatch(createBooking(dataCreated));
      dispatch(fetchBookings());
    }
  };

  const handleUpdate = async (originalData: Partial<Booking>, dataUpdated: Partial<Booking>) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === 'number') {
      if(Object.keys(dataUpdate).some(key => key !== 'updatedBy') && Object.keys(dataUpdate).length !== 0){
        await dispatch(updateBooking({ bookingId:dataId, bookingData:dataUpdate }));
        dispatch(fetchBookings());
      }
    }else{
      console.error('Booking ID is undefined.');
    }
  };

  const handleDelete = async (dataDelete: Partial<Booking>, count: number, iterator: number) => {
    if (typeof dataDelete.id === 'number') {
      await dispatch(deleteBooking(dataDelete.id));
      if (count === iterator) { dispatch(fetchBookings()); }
    }else{
      console.error('Booking ID is undefined.');
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<Booking>>[]>(() => modifyColumn(data[0]?.columns || [], bookingsColumnDef), [data]);

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

export default BookingList;