import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import { addonsColumnDef } from "./addonsColumnDef";
import { Addon } from "../../types/addons/Addon";
import {
  createAddon,
  deleteAddon,
  fetchAddons,
  updateAddon,
} from "../../actions/addonActions";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { MRT_ColumnDef } from "mantine-react-table";

const MODULE_SLUG = "addon-management";

const coerceAddonPayload = (payload: Partial<Addon>): Partial<Addon> => {
  const next: Partial<Addon> = { ...payload };

  if (next.basePrice === "" || next.basePrice === undefined) {
    next.basePrice = null;
  } else if (next.basePrice !== null) {
    next.basePrice = Number(next.basePrice);
  }

  if (next.taxRate === "" || next.taxRate === undefined) {
    next.taxRate = null;
  } else if (next.taxRate !== null) {
    next.taxRate = Number(next.taxRate);
  }

  if (next.isActive !== undefined && next.isActive !== null) {
    next.isActive = Boolean(next.isActive);
  }

  delete next.id;
  delete next.createdAt;
  delete next.updatedAt;

  return next;
};

const AddonsList = () => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.addons)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchAddons());
  }, [dispatch]);

  const handleCreate = async (payload: Partial<Addon>) => {
    const sanitized = removeEmptyKeys(coerceAddonPayload(payload), Number(loggedUserId ?? 0));
    if (Object.keys(sanitized).length > 0) {
      await dispatch(createAddon(sanitized));
      await dispatch(fetchAddons());
    }
  };

  const handleUpdate = async (original: Partial<Addon>, updates: Partial<Addon>) => {
    if (typeof original.id !== "number") {
      console.error("Addon ID is undefined.");
      return;
    }

    const delta = getChangedValues(
      original,
      coerceAddonPayload(updates),
      Number(loggedUserId ?? 0),
    );

    if (Object.keys(delta).length > 0) {
      await dispatch(
        updateAddon({
          addonId: original.id,
          addonData: delta,
        }),
      );
      await dispatch(fetchAddons());
    }
  };

  const handleDelete = async (record: Partial<Addon>, count: number, iterator: number) => {
    if (typeof record.id !== "number") {
      console.error("Addon ID is undefined.");
      return;
    }

    await dispatch(deleteAddon(record.id));
    if (count === iterator) {
      await dispatch(fetchAddons());
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

  const columns = useMemo<MRT_ColumnDef<Partial<Addon>>[]>(
    () => modifyColumn(data[0]?.columns || [], addonsColumnDef()),
    [data],
  );

  return (
    <Table
      pageTitle={currentPage}
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

export default AddonsList;
