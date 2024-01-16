import React, { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchUsers, deleteUser, createUser, updateUser } from '../../actions/userActions'; 
import { styled } from '@mui/system';
import Table from '../../utils/TableNew';

const UserListContainer = styled('div')({
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

const UserList = () => {
  const dispatch = useAppDispatch();
  const { users, loading, error } = useAppSelector((state) => state.users); 

  useEffect(() => {
    dispatch(fetchUsers())
  }, [dispatch]);

  return (
    <UserListContainer>
      <h2>Users</h2>
      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <p>Error retrieving data: <i>{error}</i></p>
      ) : (
        <TableContainer>
          <StyledTable>
            <Table
              data={users} 
              actions={{ deleteUser, createUser, updateUser}} 
            />
          </StyledTable>
        </TableContainer>
      )}
    </UserListContainer>
  );
};

export default UserList;