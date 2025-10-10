import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import { actionsColumnDef } from "./actionsColumnDef";
import {
  createAction,
  deleteAction,
  fetchActions,
  updateAction,
} from "../../actions/actionActions";
import { Action } from "../../types/actions/Action";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { MRT_ColumnDef } from "mantine-react-table";

const MODULE_SLUG = "action-registry";

const coerceActionPayload = (payload: Partial<Action>): Partial<Action> => {
  const next: Partial<Action> = { ...payload };

  if (typeof next.key === "string") {
    next.key = next.key.trim();
  }
  if (typeof next.name === "string") {
    next.name = next.name.trim();
  }
  if (typeof next.description === "string") {
    const trimmed = next.description.trim();
    next.description = trimmed.length === 0 ? null : trimmed;
  } else if (next.description === "") {
    next.description = null;
  }

  if (next.isAssignable !== undefined && next.isAssignable !== null) {
    next.isAssignable = Boolean(next.isAssignable);
  }
  if (next.status !== undefined && next.status !== null) {
    next.status = Boolean(next.status);
  }

  delete next.id;
  delete next.createdAt;
  delete next.updatedAt;

  return next;
};

type ActionsListProps = {
  pageTitle?: string;
};

const ActionsList = ({ pageTitle }: ActionsListProps) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.actions)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchActions());
  }, [dispatch]);

  const handleCreate = async (payload: Partial<Action>) => {
    const sanitized = removeEmptyKeys(coerceActionPayload(payload), Number(loggedUserId ?? 0));
    if (Object.keys(sanitized).length > 0) {
      await dispatch(createAction(sanitized));
      await dispatch(fetchActions());
    }
  };

  const handleUpdate = async (original: Partial<Action>, updates: Partial<Action>) => {
    if (typeof original.id !== "number") {
      console.error("Action ID is undefined.");
      return;
    }

    const delta = getChangedValues(
      original,
      coerceActionPayload(updates),
      Number(loggedUserId ?? 0),
    );

    if (Object.keys(delta).length > 0) {
      await dispatch(
        updateAction({
          actionId: original.id,
          payload: delta,
        }),
      );
      await dispatch(fetchActions());
    }
  };

  const handleDelete = async (record: Partial<Action>, count: number, iterator: number) => {
    if (typeof record.id !== "number") {
      console.error("Action ID is undefined.");
      return;
    }

    await dispatch(deleteAction(record.id));
    if (count === iterator) {
      await dispatch(fetchActions());
    }
  };

  const initialState = useMemo(
    () => ({
      showColumnFilters: false,
      showGlobalFilter: true,
      columnVisibility: {
        id: false,
      },
    }),
    [],
  );

  const columns = useMemo<MRT_ColumnDef<Partial<Action>>[]>(
    () => modifyColumn(data[0]?.columns || [], actionsColumnDef()),
    [data],
  );

  const headingTitle = pageTitle ?? currentPage;

  return (
    <Table
      pageTitle={headingTitle}
      data={data[0]?.data || []}
      loading={loading}
      error={error}
      columns={columns}
      actions={{ handleCreate, handleUpdate, handleDelete }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default ActionsList;
