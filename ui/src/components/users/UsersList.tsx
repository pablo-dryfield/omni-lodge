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
import dayjs from 'dayjs';
import { Space, Title } from '@mantine/core';

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
        accessorKey: 'id',
        modifications: {
          id: 'id',
          header: 'ID',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
          Edit: () => null,
          visibleInShowHideMenu: false,
        }
      },
      {
        accessorKey: 'email',
        modifications: {
          enableClickToCopy: true,
          id: 'email',
          header: 'Email',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
          mantineEditTextInputProps: {
            type: 'email',
            required: true,
          },
        }
      },
      {
        accessorKey: 'username',
        modifications: {
          id: 'username',
          header: 'Username',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
          mantineEditTextInputProps: {
            required: true,
          },
        }
      },
      {
        accessorKey: 'firstName',
        modifications: {
          id: 'firstName',
          header: 'First Name',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
          mantineEditTextInputProps: {
            required: true,
          },
        }
      },
      {
        accessorKey: 'lastName',
        modifications: {
          id: 'lastName',
          header: 'Last Name',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
          mantineEditTextInputProps: {
            required: true,
          },
        }
      },
      {
        accessorKey: 'createdBy',
        modifications: {
          id: 'createdBy',
          header: 'Created By',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
          Edit: () => null,
        }
      },
      {
        accessorKey: 'updatedBy',
        modifications: {
          id: 'updatedBy',
          header: 'Updated By',
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
          Edit: () => null,
        }
      },
      {
        accessorKey: 'createdAt',
        modifications: {
          id: 'createdAt',
          header: 'Created Date',
          filterVariant: 'date-range',
          sortingFn: 'datetime',
          enableColumnFilterModes: false,
          Cell: ({ cell }) => dayjs(cell.getValue<Date>()).format('YYYY-MM-DD HH:mm:ss'),
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
          Edit: () => null,
        }
      },
      {
        accessorKey: 'updatedAt',
        modifications: {
          id: 'updatedAt',
          header: 'Updated Date',
          filterVariant: 'date-range',
          sortingFn: 'datetime',
          enableColumnFilterModes: false,
          Cell: ({ cell }) => dayjs(cell.getValue<Date>()).format('YYYY-MM-DD HH:mm:ss'),
          Header: ({ column }) => <div>{column.columnDef.header}</div>,
          Edit: () => null,
        }
      },
      {
        accessorKey: 'password',
        modifications: {
          Cell: () => <span>••••••••</span>,
          mantineEditTextInputProps: {
            required: true,
          },
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
      <Title order={2}>Users</Title>
      <Space h="sm" />
        <TableContainer>
          <StyledTable>
            <Table
              pageTitle="Users"
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