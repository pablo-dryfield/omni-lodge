import { useEffect, useMemo } from "react";
import { MRT_ColumnDef } from "mantine-react-table";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { EditSelectOption } from "../../utils/CustomEditSelect";
import { venueCompensationTermRateColumnDef } from "./venueCompensationTermRateColumnDef";
import { VenueCompensationTermRate } from "../../types/venues/VenueCompensationTermRate";
import { fetchProducts } from "../../actions/productActions";
import {
  createVenueCompensationTermRate,
  deleteVenueCompensationTermRate,
  fetchVenueCompensationTermRates,
  updateVenueCompensationTermRate,
} from "../../actions/venueCompensationTermRateActions";

const MODULE_SLUG = "venue-directory";

export const VenueCompensationTermRateList = () => {
  const dispatch = useAppDispatch();
  const rateState = useAppSelector((state) => state.venueCompensationTermRates)[0];
  const termState = useAppSelector((state) => state.venueCompensationTerms)[0];
  const productState = useAppSelector((state) => state.products)[0];
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchVenueCompensationTermRates(undefined));
  }, [dispatch]);

  useEffect(() => {
    if (!productState.data[0]?.data?.length) {
      dispatch(fetchProducts());
    }
  }, [dispatch, productState.data]);

  const termOptions = useMemo<EditSelectOption[]>(() => {
    const records = termState.data[0]?.data || [];
    return records.map((term) => ({
      value: String(term.id),
      label: `${term.venueName ?? "Venue"} (Term #${term.id})`,
    }));
  }, [termState.data]);

  const productOptions = useMemo<EditSelectOption[]>(() => {
    const records = productState.data[0]?.data || [];
    return records.map((product) => ({
      value: String(product.id),
      label: product.name ?? `Product #${product.id}`,
    }));
  }, [productState.data]);

  const columns = useMemo<MRT_ColumnDef<Partial<VenueCompensationTermRate>>[]>(
    () =>
      modifyColumn(
        rateState.data[0]?.columns || [],
        venueCompensationTermRateColumnDef({
          termOptions,
          productOptions,
        }),
      ),
    [rateState.data, termOptions, productOptions],
  );

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

  const handleCreate = async (payload: Partial<VenueCompensationTermRate>) => {
    const sanitized = removeEmptyKeys(payload, Number(loggedUserId ?? 0));
    if (!sanitized.termId || !sanitized.ticketType || sanitized.rateAmount == null || !sanitized.validFrom) {
      return;
    }
    await dispatch(createVenueCompensationTermRate(sanitized));
    await dispatch(fetchVenueCompensationTermRates(undefined));
  };

  const handleUpdate = async (
    original: Partial<VenueCompensationTermRate>,
    updates: Partial<VenueCompensationTermRate>,
  ) => {
    if (typeof original.id !== "number") {
      console.error("Rate band ID is undefined.");
      return;
    }

    const delta = getChangedValues(original, updates, Number(loggedUserId ?? 0));
    if (Object.keys(delta).length === 0) {
      return;
    }

    await dispatch(updateVenueCompensationTermRate({ rateId: original.id, payload: delta }));
    await dispatch(fetchVenueCompensationTermRates(undefined));
  };

  const handleDelete = async (record: Partial<VenueCompensationTermRate>, count: number, iterator: number) => {
    if (typeof record.id !== "number") {
      console.error("Rate band ID is undefined.");
      return;
    }
    await dispatch(deleteVenueCompensationTermRate(record.id));
    if (count === iterator) {
      await dispatch(fetchVenueCompensationTermRates(undefined));
    }
  };

  return (
    <Table
      pageTitle="Compensation Rate Bands"
      data={rateState.data[0]?.data || []}
      loading={rateState.loading}
      error={rateState.error}
      columns={columns}
      actions={{ handleCreate, handleUpdate, handleDelete }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default VenueCompensationTermRateList;
