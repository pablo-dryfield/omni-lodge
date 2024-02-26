import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchBookings, deleteBooking, createBooking, updateBooking } from '../../actions/bookingActions';
import Table from '../../utils/Table';
import { useMemo } from 'react';
import { Booking } from '../../types/bookings/Booking';
import { modifyColumn } from '../../utils/modifyColumn';
import { bookingsColumnDef } from './bookingsColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';

const BookingList = () => {

  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.bookings)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
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
    await dispatch(createBooking(dataCreate));
    dispatch(fetchBookings());
  };

  const handleUpdate = async (dataUpdate: Partial<Booking>) => {
    const bookingId = dataUpdate.id;
    const bookingData = dataUpdate;
    if (typeof bookingId === 'number') {
    await dispatch(updateBooking({ bookingId, bookingData }));
    dispatch(fetchBookings());
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