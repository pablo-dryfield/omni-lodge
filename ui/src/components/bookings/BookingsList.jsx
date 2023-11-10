import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchBookings } from '../../actions/bookingActions';
import { styled } from '@mui/system';
import Table from '../../utils/Table';

const BookingListContainer = styled('div')({
  width: '93%',
  margin: '0 auto', // Center the container
  padding: '20px',
  borderRadius: '4px',
});

const TableContainer = styled('div')({
  overflowY: 'auto', // Add vertical scrolling
  maxHeight: '650px', // Adjust the maximum height as needed
  position: 'relative', // Add relative positioning
});

const StyledTable = styled('div')({
  borderCollapse: 'collapse',
  width: '100%',
});

const BookingList = () => {
  const dispatch = useDispatch();
  const { bookings, loading, error } = useSelector((state) => state.bookings);

  useEffect(() => {
    dispatch(fetchBookings());
  }, [dispatch]);

  return (
    <BookingListContainer>
      <h2>Bookings</h2>
      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <p>Error retrieving data: <i>{error}</i></p>
      ) : (
        <TableContainer>
          <StyledTable>
            <Table bookings={bookings}/>
          </StyledTable>
        </TableContainer>
      )}
    </BookingListContainer>
  );
};

export default BookingList;
