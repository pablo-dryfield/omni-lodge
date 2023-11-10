import React /*, { useEffect }*/ from 'react';
//import { useDispatch, useSelector } from 'react-redux';
//import { fetchChannels } from '../../actions/channelActions';
import { styled } from '@mui/system';
import Table from '../../utils/TableNew';

const ChannelListContainer = styled('div')({
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

const ChannelList = () => {
  //const dispatch = useDispatch();
  //const { channels, loading, error } = useSelector((state) => state.channels);
const loading = undefined;
const error = undefined;
  //useEffect(() => {
    //dispatch(fetchChannels());
  //}, [dispatch]);

  return (
    <ChannelListContainer>
      <h2>Channels</h2>
      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <p>Error retrieving data: <i>{error}</i></p>
      ) : (
        <TableContainer>
          <StyledTable>
            <Table/>
          </StyledTable>
        </TableContainer>
      )}
    </ChannelListContainer>
  );
};

export default ChannelList;
