import { useMemo, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchUsers, deleteUser, createUser, updateUser } from "../../actions/userActions";
import Table from "../../utils/Table";
import { User } from "../../types/users/User";
import { modifyColumn } from "../../utils/modifyColumn";
import { usersColumnDef } from "./usersColumnDef";
import { type MRT_ColumnDef } from "mantine-react-table";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { fetchUserTypes } from "../../actions/userTypeActions";

const DEFAULT_MODULE_SLUG = "user-directory";

type UsersListProps = {
  pageTitle?: string;
  moduleSlug?: string;
};

const coerceUserPayload = (payload: Partial<User>) => {
  const next: Partial<User> = { ...payload };

  if (next.userTypeId !== undefined && next.userTypeId !== null) {
    next.userTypeId = Number(next.userTypeId);
  }

  if (next.status !== undefined && next.status !== null) {
    next.status = Boolean(next.status);
  }

  return next;
};

const UsersList = ({ pageTitle, moduleSlug = DEFAULT_MODULE_SLUG }: UsersListProps) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.users)[0];
  const userTypesState = useAppSelector((state) => state.userTypes)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
    },
  };

  useEffect(() => {
    dispatch(fetchUsers());
  }, [dispatch]);

  useEffect(() => {
    if (!userTypesState.data[0]?.data?.length) {
      dispatch(fetchUserTypes());
    }
  }, [dispatch, userTypesState.data]);

  const handleCreate = async (dataCreate: Partial<User>) => {
    const sanitized = removeEmptyKeys(coerceUserPayload(dataCreate), loggedUserId);
    if (
      Object.keys(sanitized).some((key) => key !== "createdBy") &&
      Object.keys(sanitized).length !== 0
    ) {
      await dispatch(createUser(sanitized));
      dispatch(fetchUsers());
    }
  };

  const handleUpdate = async (
    originalData: Partial<User>,
    dataUpdated: Partial<User>,
  ) => {
    const dataId = originalData.id;
    const delta = getChangedValues(originalData, coerceUserPayload(dataUpdated), loggedUserId);
    if (typeof dataId === "number") {
      if (
        Object.keys(delta).some((key) => key !== "updatedBy") &&
        Object.keys(delta).length !== 0
      ) {
        await dispatch(updateUser({ userId: dataId, userData: delta }));
        dispatch(fetchUsers());
      }
    } else {
      console.error("User ID is undefined.");
    }
  };

  const handleDelete = async (
    dataDelete: Partial<User>,
    count: number,
    iterator: number,
  ) => {
    if (typeof dataDelete.id === "number") {
      await dispatch(deleteUser(dataDelete.id));
      if (count === iterator) {
        dispatch(fetchUsers());
      }
    } else {
      console.error("User ID is undefined.");
    }
  };

  const userTypeRecords = useMemo(
    () => userTypesState.data[0]?.data || [],
    [userTypesState.data],
  );

  const userTypeLabelById = useMemo(() => {
    const map = new Map<number, string>();
    userTypeRecords.forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? record.slug ?? `Role ${record.id}`);
      }
    });
    return map;
  }, [userTypeRecords]);

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<User>>[]>(
    () => modifyColumn(data[0]?.columns || [], usersColumnDef({ userTypeLabelById })),
    [data, userTypeLabelById],
  );

  const headerTitle = pageTitle ?? currentPage;

  return (
    <Table
      pageTitle={headerTitle}
      data={data[0]?.data || []}
      loading={loading}
      error={error}
      columns={modifiedColumns}
      actions={{ handleDelete, handleCreate, handleUpdate }}
      initialState={initialState}
      moduleSlug={moduleSlug}
    />
  );
};

export default UsersList;