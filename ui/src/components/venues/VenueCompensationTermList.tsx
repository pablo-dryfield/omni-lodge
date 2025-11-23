import { useEffect, useMemo } from "react";
import dayjs from "dayjs";
import { MRT_ColumnDef } from "mantine-react-table";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { fetchVenues } from "../../actions/venueActions";
import { Venue } from "../../types/venues/Venue";
import { EditSelectOption } from "../../utils/CustomEditSelect";
import {
  createVenueCompensationTerm,
  deleteVenueCompensationTerm,
  fetchVenueCompensationTerms,
  updateVenueCompensationTerm,
} from "../../actions/venueCompensationTermActions";
import { VenueCompensationTerm } from "../../types/venues/VenueCompensationTerm";
import { venueCompensationColumnDef } from "./venueCompensationColumnDef";

const MODULE_SLUG = "venue-directory";

const normalizeTermPayload = (payload: Partial<VenueCompensationTerm>) => {
  const next: Partial<VenueCompensationTerm> = {};

  const venueIdValue = payload.venueId as number | string | null | undefined;
  if (venueIdValue !== undefined && venueIdValue !== null) {
    const venueIdText = String(venueIdValue).trim();
    if (venueIdText !== "") {
      next.venueId = Number(venueIdValue);
    }
  }

  if (payload.compensationType) {
    next.compensationType = payload.compensationType;
  }

  if (payload.rateAmount !== undefined && payload.rateAmount !== null && payload.rateAmount !== "") {
    next.rateAmount = Number(payload.rateAmount);
  }

  if (payload.rateUnit) {
    next.rateUnit = payload.rateUnit;
  }

  if (payload.currencyCode !== undefined && payload.currencyCode !== null) {
    const currencyText = String(payload.currencyCode).trim().toUpperCase();
    next.currencyCode = currencyText || "USD";
  }

  if (payload.validFrom) {
    next.validFrom = dayjs(payload.validFrom).format("YYYY-MM-DD");
  }

  if (payload.validTo !== undefined) {
    if (payload.validTo === null) {
      next.validTo = null;
    } else {
      const validToText = String(payload.validTo).trim();
      next.validTo = validToText === "" ? null : dayjs(validToText).format("YYYY-MM-DD");
    }
  }

  if (payload.isActive !== undefined && payload.isActive !== null) {
    if (typeof payload.isActive === "string") {
      next.isActive = payload.isActive.trim().toLowerCase() === "true";
    } else {
      next.isActive = Boolean(payload.isActive);
    }
  }

  if (payload.notes !== undefined) {
    next.notes = payload.notes == null ? null : payload.notes;
  }

  return next;
};

export const VenueCompensationTermList = () => {
  const dispatch = useAppDispatch();
  const termState = useAppSelector((state) => state.venueCompensationTerms)[0];
  const venuesState = useAppSelector((state) => state.venues)[0];
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchVenueCompensationTerms(undefined));
  }, [dispatch]);

  useEffect(() => {
    if (!venuesState.data[0]?.data?.length) {
      dispatch(fetchVenues());
    }
  }, [dispatch, venuesState.data]);

  const venueOptions = useMemo<EditSelectOption[]>(() => {
    const records = (venuesState.data[0]?.data as Venue[] | undefined) ?? [];
    return records.map((venue) => ({
      value: String(venue.id),
      label: `${venue.name ?? `Venue #${venue.id}`} (#${venue.id})`,
    }));
  }, [venuesState.data]);

  const venueNameById = useMemo(() => {
    const map = new Map<number, string>();
    venueOptions.forEach((option) => {
      map.set(Number(option.value), option.label);
    });
    return map;
  }, [venueOptions]);

  const initialState = useMemo(
    () => ({
      showColumnFilters: false,
      showGlobalFilter: true,
      columnVisibility: {
        id: false,
        createdBy: false,
        updatedBy: false,
      },
    }),
    [],
  );

  const columns = useMemo<MRT_ColumnDef<Partial<VenueCompensationTerm>>[]>(
    () =>
      modifyColumn(
        termState.data[0]?.columns || [],
        venueCompensationColumnDef({
          venueOptions,
        }),
      ),
    [termState.data, venueOptions],
  );

  const handleCreate = async (payload: Partial<VenueCompensationTerm>) => {
    const sanitized = removeEmptyKeys(normalizeTermPayload(payload), Number(loggedUserId ?? 0));
    if (
      sanitized.venueId &&
      sanitized.compensationType &&
      sanitized.rateAmount != null &&
      sanitized.validFrom
    ) {
      await dispatch(createVenueCompensationTerm(sanitized));
      await dispatch(fetchVenueCompensationTerms(undefined));
    }
  };

  const handleUpdate = async (
    original: Partial<VenueCompensationTerm>,
    updates: Partial<VenueCompensationTerm>,
  ) => {
    if (typeof original.id !== "number") {
      console.error("Venue compensation term ID is undefined.");
      return;
    }

    const delta = getChangedValues(
      original,
      normalizeTermPayload(updates),
      Number(loggedUserId ?? 0),
    );

    if (Object.keys(delta).length > 0) {
      await dispatch(updateVenueCompensationTerm({ termId: original.id, payload: delta }));
      await dispatch(fetchVenueCompensationTerms(undefined));
    }
  };

  const handleDelete = async (record: Partial<VenueCompensationTerm>, count: number, iterator: number) => {
    if (typeof record.id !== "number") {
      console.error("Venue compensation term ID is undefined.");
      return;
    }

    await dispatch(deleteVenueCompensationTerm(record.id));
    if (count === iterator) {
      await dispatch(fetchVenueCompensationTerms(undefined));
    }
  };

  const dataAugmented = useMemo(() => {
    return (termState.data[0]?.data || []).map((record) => ({
      ...record,
      venueName:
        record.venueName ??
        (record.venueId != null ? venueNameById.get(Number(record.venueId)) ?? null : null),
    }));
  }, [termState.data, venueNameById]);

  return (
    <Table
      pageTitle="Compensation Terms"
      data={dataAugmented}
      loading={termState.loading}
      error={termState.error}
      columns={columns}
      actions={{ handleCreate, handleUpdate, handleDelete }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default VenueCompensationTermList;
