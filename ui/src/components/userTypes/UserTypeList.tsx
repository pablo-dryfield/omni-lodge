import { useMemo, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  fetchUserTypes,
  deleteUserType,
  createUserType,
  updateUserType,
} from "../../actions/userTypeActions";
import Table from "../../utils/Table";
import { UserType } from "../../types/userTypes/UserType";
import { modifyColumn } from "../../utils/modifyColumn";
import { userTypesColumnDef } from "./userTypesColumnDef";
import { type MRT_ColumnDef } from "mantine-react-table";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";

const DEFAULT_MODULE_SLUG = "settings-user-types-admin";

type UserTypeListProps = {
  pageTitle?: string;
  moduleSlug?: string;
};

const UserTypeList = ({ pageTitle, moduleSlug = DEFAULT_MODULE_SLUG }: UserTypeListProps) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.userTypes)[0];
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
    dispatch(fetchUserTypes());
  }, [dispatch]);

  const handleCreate = async (dataCreate: Partial<UserType>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if (
      Object.keys(dataCreated).some((key) => key !== "createdBy") &&
      Object.keys(dataCreated).length !== 0
    ) {
      await dispatch(createUserType(dataCreated));
      dispatch(fetchUserTypes());
    }
  };

  const handleUpdate = async (
    originalData: Partial<UserType>,
    dataUpdated: Partial<UserType>
  ) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === "number") {
      if (
        Object.keys(dataUpdate).some((key) => key !== "updatedBy") &&
        Object.keys(dataUpdate).length !== 0
      ) {
        await dispatch(
          updateUserType({ userTypeId: dataId, userTypeData: dataUpdate })
        );
        dispatch(fetchUserTypes());
      }
    } else {
      console.error("UserType ID is undefined.");
    }
  };

  const handleDelete = async (
    dataDelete: Partial<UserType>,
    count: number,
    iterator: number
  ) => {
    if (typeof dataDelete.id === "number") {
      await dispatch(deleteUserType(dataDelete.id));
      if (count === iterator) {
        dispatch(fetchUserTypes());
      }
    } else {
      console.error("UserType ID is undefined.");
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<UserType>>[]>(
    () => modifyColumn(data[0]?.columns || [], userTypesColumnDef),
    [data]
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

export default UserTypeList;
