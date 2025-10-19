import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import { venuesColumnDef } from "./venuesColumnDef";
import { Venue } from "../../types/venues/Venue";
import { createVenue, deleteVenue, fetchVenues, updateVenue } from "../../actions/venueActions";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { MRT_ColumnDef } from "mantine-react-table";

const MODULE_SLUG = "venue-directory";

const VenuesList = () => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.venues)[0];
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchVenues());
  }, [dispatch]);

  const initialState = useMemo(
    () => ({
      showColumnFilters: false,
      showGlobalFilter: true,
      columnVisibility: {
        id: false,
        createdAt: false,
        updatedAt: false,
      },
    }),
    [],
  );

  const columns = useMemo<MRT_ColumnDef<Partial<Venue>>[]>(
    () => modifyColumn(data[0]?.columns || [], venuesColumnDef()),
    [data],
  );

  const handleCreate = async (payload: Partial<Venue>) => {
    const sanitized = removeEmptyKeys(payload, Number(loggedUserId ?? 0));
    if (!sanitized.name) {
      return;
    }
    await dispatch(createVenue(sanitized));
    await dispatch(fetchVenues());
  };

  const handleUpdate = async (original: Partial<Venue>, updates: Partial<Venue>) => {
    if (typeof original.id !== "number") {
      console.error("Venue ID is undefined.");
      return;
    }

    const delta = getChangedValues(original, updates, Number(loggedUserId ?? 0));
    if (Object.keys(delta).length === 0) {
      return;
    }

    await dispatch(updateVenue({ venueId: original.id, venueData: delta }));
    await dispatch(fetchVenues());
  };

  const handleDelete = async (record: Partial<Venue>, count: number, iterator: number) => {
    if (typeof record.id !== "number") {
      console.error("Venue ID is undefined.");
      return;
    }

    await dispatch(deleteVenue(record.id));
    if (count === iterator) {
      await dispatch(fetchVenues());
    }
  };

  return (
    <Table
      pageTitle="Venues"
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

export default VenuesList;

