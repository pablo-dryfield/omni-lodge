import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import { paymentMethodColumnDef } from "./paymentMethodColumnDef";
import {
  createPaymentMethod,
  deletePaymentMethod,
  fetchPaymentMethods,
  updatePaymentMethod,
} from "../../actions/paymentMethodActions";
import { PaymentMethod } from "../../types/paymentMethods/PaymentMethod";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { MRT_ColumnDef } from "mantine-react-table";

const MODULE_SLUG = "payment-method-management";

const coercePaymentMethodPayload = (payload: Partial<PaymentMethod>): Partial<PaymentMethod> => {
  const next: Partial<PaymentMethod> = { ...payload };

  if (typeof next.name === "string") {
    next.name = next.name.trim();
  }

  if (next.description !== undefined) {
    if (typeof next.description === "string") {
      const trimmed = next.description.trim();
      next.description = trimmed.length === 0 ? null : trimmed;
    } else if (next.description === "") {
      next.description = null;
    }
  }

  delete next.id;
  delete next.createdAt;
  delete next.updatedAt;

  return next;
};

const PaymentMethodsList = () => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.paymentMethods)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchPaymentMethods());
  }, [dispatch]);

  const handleCreate = async (payload: Partial<PaymentMethod>) => {
    const sanitized = removeEmptyKeys(coercePaymentMethodPayload(payload), Number(loggedUserId ?? 0));
    if (Object.keys(sanitized).length > 0) {
      await dispatch(createPaymentMethod(sanitized));
      await dispatch(fetchPaymentMethods());
    }
  };

  const handleUpdate = async (original: Partial<PaymentMethod>, updates: Partial<PaymentMethod>) => {
    if (typeof original.id !== "number") {
      console.error("Payment method ID is undefined.");
      return;
    }

    const delta = getChangedValues(
      original,
      coercePaymentMethodPayload(updates),
      Number(loggedUserId ?? 0),
    );

    if (Object.keys(delta).length > 0) {
      await dispatch(
        updatePaymentMethod({
          paymentMethodId: original.id,
          payload: delta,
        }),
      );
      await dispatch(fetchPaymentMethods());
    }
  };

  const handleDelete = async (record: Partial<PaymentMethod>, count: number, iterator: number) => {
    if (typeof record.id !== "number") {
      console.error("Payment method ID is undefined.");
      return;
    }

    await dispatch(deletePaymentMethod(record.id));
    if (count === iterator) {
      await dispatch(fetchPaymentMethods());
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

  const columns = useMemo<MRT_ColumnDef<Partial<PaymentMethod>>[]>(
    () => modifyColumn(data[0]?.columns || [], paymentMethodColumnDef()),
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

export default PaymentMethodsList;
