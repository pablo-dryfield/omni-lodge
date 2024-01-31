import React, { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchUsers, deleteUser, createUser, updateUser } from '../../actions/userActions'; 
import { styled } from '@mui/system';
import Table from '../../utils/TableNew';
import {
  type MRT_ColumnDef,
} from 'mantine-react-table';
import { useMemo } from 'react';

import { User } from '../../types/users/User';

const modifyColumn = (
  columns: MRT_ColumnDef<User>[],
  accessorKey: string,
  modifications: Partial<MRT_ColumnDef<User>>
): MRT_ColumnDef<User>[] => {
  return columns.map((column) => {
    if (column.accessorKey === accessorKey) {
      // Directly merge modifications with the column
      return { ...column, ...modifications };
    }
    return column;
  });
}

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
  const { data, loading, error } = useAppSelector((state) => state.users)[0]; 

  useEffect(() => {
    dispatch(fetchUsers())
  }, [dispatch]);

  const modifiedColumns = useMemo<MRT_ColumnDef<User>[]>(
    () => modifyColumn(data[0].columns, 'createdAt', {
    accessorFn: (row) => {
      const sDay = new Date(row.createdAt);
      sDay.setHours(0, 0, 0, 0); // remove time from date
      return sDay;
    },
    id: 'createdAt',
    header: 'Created Date',
    filterVariant: 'date-range',
    sortingFn: 'datetime',
    enableColumnFilterModes: false,
    Cell: ({ cell }) => cell.getValue<Date>()?.toLocaleDateString(),
    Header: ({ column }) => <em>{column.columnDef.header}</em>,
  })
  ,[data]);

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
              data={data[0].data} 
              columns={modifiedColumns} 
              actions={{ deleteUser, createUser, updateUser}} 
            /> 
          </StyledTable>
        </TableContainer>
      )}
    </UserListContainer>
  );
};

export default UserList;