import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchUsers, deleteUser, createUser, updateUser } from '../../actions/userActions';
import Table from '../../utils/Table';
import { useMemo } from 'react';
import { User } from '../../types/users/User';
import { modifyColumn } from '../../utils/modifyColumn';
import { usersColumnDef } from './usersColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';
import { removeEmptyKeys } from '../../utils/removeEmptyKeys';
import { getChangedValues } from '../../utils/getChangedValues';

/**
 * UserList component for displaying and interacting with a list of users.
 * 
 * This component fetches and displays user data in a table format, with capabilities
 * to create, update, and delete users. It uses custom hooks from Redux for state management
 * and dispatching actions. It also utilizes memoization to ensure that column modifications
 * are only recalculated when necessary.
 *
 * The table is configured to hide the 'id' column and display a global filter.
 * Error handling is also incorporated to log to the console when the user ID is undefined.
 *
 * @returns {JSX.Element} The table component populated with user data and configured actions.
 */

const UserList = () => {

  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.users)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
    },
  }

  useEffect(() => {
    dispatch(fetchUsers())
  }, [dispatch]);

  const handleCreate = async (dataCreate: Partial<User>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if(Object.keys(dataCreated).some(key => key !== 'createdBy') && Object.keys(dataCreated).length !== 0){
      await dispatch(createUser(dataCreated));
      dispatch(fetchUsers());
    }
  };

  const handleUpdate = async (originalData: Partial<User>, dataUpdated: Partial<User>) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === 'number') {
      if(Object.keys(dataUpdate).some(key => key !== 'updatedBy') && Object.keys(dataUpdate).length !== 0){
        await dispatch(updateUser({ userId:dataId, userData:dataUpdate }));
        dispatch(fetchUsers());
      }
    }else{
      console.error('User ID is undefined.');
    }
  };

  const handleDelete = async (dataDelete: Partial<User>, count: number, iterator: number) => {
    if (typeof dataDelete.id === 'number') {
      await dispatch(deleteUser(dataDelete.id));
      if (count === iterator) { dispatch(fetchUsers()); }
    }else{
      console.error('User ID is undefined.');
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<User>>[]>(() => modifyColumn(data[0]?.columns || [], usersColumnDef), [data]);

  return (
    <Table
      pageTitle={currentPage}
      data={data[0]?.data || []}
      loading={loading}
      error={error}
      columns={modifiedColumns}
      actions={{ handleDelete, handleCreate, handleUpdate }}
      initialState={initialState}
    />
  );
};

export default UserList;