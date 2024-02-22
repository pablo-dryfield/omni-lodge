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
      password: false,
    },
  }

  useEffect(() => {
    dispatch(fetchBookings())
  }, [dispatch]);

  const handleCreate = async (dataCreate: Booking) => {
    await dispatch(createBooking(dataCreate));
    dispatch(fetchBookings());
  };

  const handleUpdate = async (dataUpdate: Booking) => {
    const bookingId = dataUpdate.id;
    const bookingData = dataUpdate;
    await dispatch(updateBooking({ bookingId, bookingData }));
    dispatch(fetchBookings());
  };

  const handleDelete = async (dataDelete: Booking, count: number, iterator: number) => {
    await dispatch(deleteBooking(dataDelete.id));
    if (count === iterator) { dispatch(fetchBookings()); }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Booking>[]>(() => modifyColumn(data[0]?.columns || [], bookingsColumnDef), [data]);

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