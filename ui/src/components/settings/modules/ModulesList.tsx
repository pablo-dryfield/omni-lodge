import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import {
  fetchModules,
  deleteModule,
  createModule,
  updateModule,
} from "../../../actions/moduleActions";
import { fetchPages } from "../../../actions/pageActions";
import Table from "../../../utils/Table";
import { modifyColumn } from "../../../utils/modifyColumn";
import { getChangedValues } from "../../../utils/getChangedValues";
import { removeEmptyKeys } from "../../../utils/removeEmptyKeys";
import { type MRT_ColumnDef } from "mantine-react-table";
import { Module } from "../../../types/modules/Module";
import { moduleColumnDef } from "./moduleColumnDef";
import { fetchAccessSnapshot } from "../../../actions/accessControlActions";

const MODULE_SLUG = "settings-modules-admin";

const coerceModulePayload = (payload: Partial<Module>) => {
  const nextPayload: Partial<Module> = { ...payload };

  if (nextPayload.pageId !== undefined && nextPayload.pageId !== null) {
    nextPayload.pageId = Number(nextPayload.pageId);
  }

  if (nextPayload.sortOrder !== undefined && nextPayload.sortOrder !== null) {
    nextPayload.sortOrder = Number(nextPayload.sortOrder);
  }

  if (nextPayload.status !== undefined && nextPayload.status !== null) {
    nextPayload.status = Boolean(nextPayload.status);
  }

  return nextPayload;
};

const ModulesList = ({ pageTitle }: { pageTitle?: string }) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.modules)[0];
  const pagesState = useAppSelector((state) => state.pages)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchModules());
  }, [dispatch]);

  useEffect(() => {
    if (!pagesState.data[0]?.data?.length) {
      dispatch(fetchPages());
    }
  }, [dispatch, pagesState.data]);

  const pageRecords = useMemo(() => pagesState.data[0]?.data || [], [pagesState.data]);
  const pageLabelById = useMemo(() => {
    const map = new Map<number, string>();
    pageRecords.forEach((page) => {
      if (typeof page.id === "number") {
        const label = page.name ?? page.slug ?? `Page ${page.id}`;
        map.set(page.id, label);
      }
    });
    return map;
  }, [pageRecords]);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
      createdBy: false,
      updatedBy: false,
    },
  };

  const handleCreate = async (draft: Partial<Module>) => {
    const payload = removeEmptyKeys(coerceModulePayload(draft), loggedUserId);

    if (
      Object.keys(payload).some((key) => key !== "createdBy") &&
      Object.keys(payload).length !== 0
    ) {
      await dispatch(createModule(payload));
      dispatch(fetchModules());
      dispatch(fetchAccessSnapshot());
    }
  };

  const handleUpdate = async (
    originalData: Partial<Module>,
    updatedDraft: Partial<Module>
  ) => {
    const recordId = originalData.id;
    const delta = getChangedValues(
      originalData,
      coerceModulePayload(updatedDraft),
      loggedUserId
    );

    if (typeof recordId === "number") {
      if (
        Object.keys(delta).some((key) => key !== "updatedBy") &&
        Object.keys(delta).length !== 0
      ) {
        await dispatch(updateModule({ moduleId: recordId, moduleData: delta }));
        dispatch(fetchModules());
        dispatch(fetchAccessSnapshot());
      }
    } else {
      console.error("Module ID is undefined.");
    }
  };

  const handleDelete = async (
    draft: Partial<Module>,
    count: number,
    iterator: number
  ) => {
    if (typeof draft.id === "number") {
      await dispatch(deleteModule(draft.id));
      if (count === iterator) {
        dispatch(fetchModules());
        dispatch(fetchAccessSnapshot());
      }
    } else {
      console.error("Module ID is undefined.");
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<Module>>[]>(
    () => modifyColumn(data[0]?.columns || [], moduleColumnDef({ pageLabelById })),
    [data, pageLabelById]
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
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default ModulesList;
