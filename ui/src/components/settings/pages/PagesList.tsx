import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import {
  fetchPages,
  deletePage,
  createPage,
  updatePage,
} from "../../../actions/pageActions";
import Table from "../../../utils/Table";
import { modifyColumn } from "../../../utils/modifyColumn";
import { type MRT_ColumnDef } from "mantine-react-table";
import { removeEmptyKeys } from "../../../utils/removeEmptyKeys";
import { getChangedValues } from "../../../utils/getChangedValues";
import { pageColumnDef } from "./pageColumnDef";
import { Page } from "../../../types/pages/Page";
import { fetchAccessSnapshot } from "../../../actions/accessControlActions";

const MODULE_SLUG = "settings-pages-admin";

type PagesListProps = {
  pageTitle?: string;
};

const coercePagePayload = (payload: Partial<Page>) => {
  const nextPayload: Partial<Page> = { ...payload };

  if (nextPayload.sortOrder !== undefined && nextPayload.sortOrder !== null) {
    nextPayload.sortOrder = Number(nextPayload.sortOrder);
  }

  if (nextPayload.status !== undefined && nextPayload.status !== null) {
    nextPayload.status = Boolean(nextPayload.status);
  }

  return nextPayload;
};

const PagesList = ({ pageTitle }: PagesListProps) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.pages)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
      createdBy: false,
      updatedBy: false,
    },
  };

  useEffect(() => {
    dispatch(fetchPages());
  }, [dispatch]);

  const handleCreate = async (draft: Partial<Page>) => {
    const sanitized = removeEmptyKeys(coercePagePayload(draft), loggedUserId);

    if (
      Object.keys(sanitized).some((key) => key !== "createdBy") &&
      Object.keys(sanitized).length !== 0
    ) {
      await dispatch(createPage(sanitized));
      dispatch(fetchPages());
      dispatch(fetchAccessSnapshot());
    }
  };

  const handleUpdate = async (
    originalData: Partial<Page>,
    updatedDraft: Partial<Page>
  ) => {
    const dataId = originalData.id;
    const changes = getChangedValues(
      originalData,
      coercePagePayload(updatedDraft),
      loggedUserId
    );

    if (typeof dataId === "number") {
      if (
        Object.keys(changes).some((key) => key !== "updatedBy") &&
        Object.keys(changes).length !== 0
      ) {
        await dispatch(updatePage({ pageId: dataId, pageData: changes }));
        dispatch(fetchPages());
        dispatch(fetchAccessSnapshot());
      }
    } else {
      console.error("Page ID is undefined.");
    }
  };

  const handleDelete = async (
    payload: Partial<Page>,
    count: number,
    iterator: number
  ) => {
    if (typeof payload.id === "number") {
      await dispatch(deletePage(payload.id));
      if (count === iterator) {
        dispatch(fetchPages());
        dispatch(fetchAccessSnapshot());
      }
    } else {
      console.error("Page ID is undefined.");
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<Page>>[]>(
    () => modifyColumn(data[0]?.columns || [], pageColumnDef),
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
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default PagesList;
