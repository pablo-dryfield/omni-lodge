import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchGuests } from '../../actions/guestActions';
import { styled } from '@mui/system';
import Table from '../../utils/Table';

const GuestListContainer = styled('div')({
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

const GuestList = () => {
  const dispatch = useDispatch();
  const { guests, loading, error } = useSelector((state) => state.guests);

  useEffect(() => {
    dispatch(fetchGuests());
  }, [dispatch]);

  return (
    <GuestListContainer>
      <h2>Guests</h2>
      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <p>Error retrieving data: <i>{error}</i></p>
      ) : (
        <TableContainer>
          <StyledTable>
            <Table guests={guests}/>
          </StyledTable>
        </TableContainer>
      )}
    </GuestListContainer>
  );
};

export default GuestList;
