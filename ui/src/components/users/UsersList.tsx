import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchUsers, deleteUser, createUser, updateUser } from '../../actions/userActions';
import Table from '../../utils/TableNew';
import { useMemo } from 'react';
import { User } from '../../types/users/User';
import { modifyColumn } from '../../utils/modifyColumn';
import { usersColumnDef } from './usersColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';

const UserList = () => {

  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.users)[0];
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
    dispatch(fetchUsers())
  }, [dispatch]);

  const handleCreate = async (dataCreate: User) => {
    await dispatch(createUser(dataCreate));
    dispatch(fetchUsers());
  };

  const handleUpdate = async (dataUpdate: User) => {
    const userId = dataUpdate.id;
    const userData = dataUpdate;
    await dispatch(updateUser({ userId, userData }));
    dispatch(fetchUsers());
  };

  const handleDelete = async (dataDelete: User, count: number, iterator: number) => {
    await dispatch(deleteUser(dataDelete.id));
    if (count === iterator) { dispatch(fetchUsers()); }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<User>[]>(() => modifyColumn(data[0].columns, usersColumnDef), [data]);

  return (
    <Table
      pageTitle={currentPage}
      data={data[0].data}
      loading={loading}
      error={error}
      columns={modifiedColumns}
      actions={{ handleDelete, handleCreate, handleUpdate }}
      initialState={initialState}
    />
  );
};

export default UserList;