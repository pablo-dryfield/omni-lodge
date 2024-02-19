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
import { ResponseModifications } from '../../types/general/ResponseModifications';

const modifyColumn = (
  columns: MRT_ColumnDef<User>[],
  modifications: ResponseModifications<User>[]
): MRT_ColumnDef<User>[] => {
  return columns.map((column) => {
    const modification = modifications.find(m => m.accessorKey === column.accessorKey);
    if (modification) {
      return { ...column, ...modification.modifications };
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

  const handleCreate = async (data:User) => {
    await dispatch(createUser(data));
    dispatch(fetchUsers());
  };

  const handleDelete = async (data:User) => {
    await dispatch(deleteUser(data.id));
    dispatch(fetchUsers());
  };

  const handleUpdate = async (data:User) => {
    const userId = data.id;
    const userData = data;
    await dispatch(updateUser({userId, userData}));
    dispatch(fetchUsers());
  };

  useEffect(() => {
    dispatch(fetchUsers())
  }, [dispatch]);

  const modifiedColumns = useMemo<MRT_ColumnDef<User>[]>(
    () => modifyColumn(data[0].columns, [
      {
        accessorKey: 'createdAt',
        modifications: {
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
        }
      },
      {
        accessorKey: 'password',
        modifications: {
          Cell: () => <span>••••••••</span>,
        }
      }
    ])
    , [data]);

  return (
    <UserListContainer>
      <h2>Users</h2>
        <TableContainer>
          <StyledTable>
            <Table
              data={data[0].data} 
              loading={loading}
              error={error}
              columns={modifiedColumns} 
              actions={{ handleDelete, handleCreate, handleUpdate}} 
            /> 
          </StyledTable>
        </TableContainer>
    </UserListContainer>
  );
};

export default UserList;