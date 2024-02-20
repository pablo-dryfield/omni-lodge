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

  const handleCreate = async (dataCreate:User) => {
    await dispatch(createUser(dataCreate));
    dispatch(fetchUsers());
  };

  const handleDelete = async (dataDelete:User, count:number, iterator:number) => {
    await dispatch(deleteUser(dataDelete.id));
    if(count === iterator){dispatch(fetchUsers());}
  };

  const handleUpdate = async (dataUpdate:User) => {
    const userId = dataUpdate.id;
    const userData = dataUpdate;
    await dispatch(updateUser({userId, userData}));
    dispatch(fetchUsers());
  };

  useEffect(() => {
    dispatch(fetchUsers())
  }, [dispatch]);

  const modifiedColumns = useMemo<MRT_ColumnDef<User>[]>(
    () => modifyColumn(data[0].columns, [
      {
        accessorKey: 'firstName',
        modifications: {
          id: 'firstName',
          header: 'First Name',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
        }
      },
      {
        accessorKey: 'lastName',
        modifications: {
          id: 'lastName',
          header: 'Last Name',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
        }
      },
      {
        accessorKey: 'createdBy',
        modifications: {
          id: 'createdBy',
          header: 'Created By',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
        }
      },
      {
        accessorKey: 'updatedBy',
        modifications: {
          id: 'updatedBy',
          header: 'Updated By',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
        }
      },
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
          Cell: ({ cell }) => cell.getValue<Date>()?.toLocaleDateString('en-CA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }),
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
        }
      },
      {
        accessorKey: 'updatedAt',
        modifications: {
          accessorFn: (row) => {
            const sDay = new Date(row.updatedAt);
            sDay.setHours(0, 0, 0, 0); // remove time from date
            return sDay;
          },
          id: 'updatedAt',
          header: 'Updated Date',
          filterVariant: 'date-range',
          sortingFn: 'datetime',
          enableColumnFilterModes: false,
          Cell: ({ cell }) => cell.getValue<Date>().toLocaleDateString('en-CA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }),
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
        }
      },
      {
        accessorKey: 'password',
        modifications: {
          Cell: () => <span>••••••••</span>,
          enableHiding: false,
        }
      }
    ])
    , [data]);

    const initialState = {
      showColumnFilters: false, 
      showGlobalFilter: true,
      columnVisibility: {
        id: false, 
        password: false,
      },
    }
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
              actions={{handleDelete, handleCreate, handleUpdate}} 
              initialState={initialState}
            /> 
          </StyledTable>
        </TableContainer>
    </UserListContainer>
  );
};

export default UserList;