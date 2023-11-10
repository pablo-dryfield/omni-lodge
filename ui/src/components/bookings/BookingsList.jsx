import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchBookings } from '../../actions/bookingActions';
import { styled } from '@mui/system';

const BookingListContainer = styled('div')({
  width: '93%',
  margin: '0 auto', // Center the container
  padding: '20px',
  borderRadius: '4px',
});

const TableContainer = styled('div')({
  overflowY: 'auto', // Add vertical scrolling
  maxHeight: '650px', // Adjust the maximum height as needed
  border: '1px solid black',
  position: 'relative', // Add relative positioning
});

const Table = styled('table')({
  borderCollapse: 'collapse',
  width: '100%',
});

const HeaderRow = styled('tr')({
  backgroundColor: 'lightgray',
  color: 'white',
  border: '1px solid black',
});

const Row = styled('tr')({
  '&:hover': {
    backgroundColor: 'lightgray',
  },
});

const HeaderCell = styled('th')({
  border: '1px solid black',
  padding: '8px',
  textAlign: 'center',
  position: 'sticky', // Add sticky positioning
  top: '0', // Stick to the top
  zIndex: '1', // Ensure it appears above the table body
  backgroundColor: '#a59f9f',
  color: 'white',
});

const Cell = styled('td')({
  border: '1px solid black',
  padding: '8px',
  textAlign: 'center',
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
          <Table>
            {!bookings || bookings.length === 0 ? (
              <p>No bookings found.</p>
            ) : (
              <>
                <thead>
                  <HeaderRow>
                    {bookings[0].map((header, index) => (
                      <HeaderCell key={index}>{header}</HeaderCell>
                    ))}
                  </HeaderRow>
                </thead>
                <tbody>
                  {bookings.slice(1).map((booking, rowIndex) => (
                    <Row key={rowIndex}>
                      {booking.map((cell, cellIndex) => (
                        <Cell key={cellIndex}>{cell}</Cell>
                      ))}
                    </Row>
                  ))}
                </tbody>
              </>
            )}
          </Table>
        </TableContainer>
      )}
    </BookingListContainer>
  );
};

export default BookingList;
