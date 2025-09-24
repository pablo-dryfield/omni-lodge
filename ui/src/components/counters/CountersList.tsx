import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchCounters, deleteCounter, createCounter, updateCounter } from "../../actions/counterActions";
import { fetchCounterProducts } from "../../actions/counterProductActions";
import { fetchCounterUsers } from "../../actions/counterUserActions";
import { fetchProducts } from "../../actions/productActions";
import Table from "../../utils/Table";
import { Counter } from "../../types/counters/Counter";
import { modifyColumn } from "../../utils/modifyColumn";
import { countersColumnDef } from "./countersColumnDef";
import { type MRT_ColumnDef, MRT_Row } from "mantine-react-table";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { CounterProduct } from "../../types/counterProducts/CounterProduct";
import { Box, Grid, Paper, Typography } from "@mui/material";
import { Product } from "../../types/products/Product";
import { CounterUser } from "../../types/counterUsers/CounterUser";

const MODULE_SLUG = "counter-operations";

const CounterList = () => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.counters)[0];
  const { data: dataCounterProducts } = useAppSelector((state) => state.counterProducts)[0];
  const { data: dataCounterUsers } = useAppSelector((state) => state.counterUsers)[0];
  const { data: dataProducts } = useAppSelector((state) => state.products)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  const productLookup = useMemo(() => {
    const products = Array.isArray(dataProducts[0]?.data)
      ? (dataProducts[0]?.data as Partial<Product>[])
      : [];
    return new Map(products.map((product) => [product.id, product]));
  }, [dataProducts]);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
      userId: false,
      createdBy: false,
      updatedBy: false,
    },
    sorting: [
      {
        id: "date",
        desc: true,
      },
    ],
  };

  useEffect(() => {
    dispatch(fetchCounters());
    dispatch(fetchCounterProducts());
    dispatch(fetchProducts());
    dispatch(fetchCounterUsers());
  }, [dispatch]);

  const renderDetailPanel = (row: MRT_Row<Partial<Counter>>) => {
    const counterId = row.getValue("id");

    const counterProducts: Partial<CounterProduct>[] = Array.isArray(dataCounterProducts[0]?.data)
      ? (dataCounterProducts[0]?.data as Partial<CounterProduct>[]).filter(
          (product) => product.counterId === counterId,
        )
      : [];

    const counterUsers: Partial<CounterUser>[] = Array.isArray(dataCounterUsers[0]?.data)
      ? (dataCounterUsers[0]?.data as Partial<CounterUser>[]).filter(
          (user) => user.counterId === counterId,
        )
      : [];

    const staffNames = counterUsers
      .map(
        (user) =>
          (user as { counterUser?: { firstName?: string; lastName?: string } }).counterUser?.firstName,
      )
      .filter((name): name is string => Boolean(name));

    const totalCustomers = counterProducts.reduce(
      (total, product) => total + (product.quantity || 0),
      0,
    );

    const staffCount = counterUsers.length;

    const renderFields = (
      fields: Array<{ label: string; value: string | number | null | undefined }>,
    ) => (
      <Grid container spacing={1}>
        {fields.map(({ label, value }) => (
          <Grid item xs={12} sm={6} key={label}>
            <Typography variant="subtitle1">
              <Box component="span" sx={{ fontWeight: 600 }}>
                {label}
              </Box>{" "}
              {value ?? "N/A"}
            </Typography>
          </Grid>
        ))}
      </Grid>
    );

    return (
      <Box sx={{ width: "100%", py: 1 }}>
        <Box
          sx={{
            display: "grid",
            gap: { xs: 2, sm: 3 },
            gridTemplateColumns: { xs: "1fr", sm: "repeat(auto-fit, minmax(260px, 1fr))" },
          }}
        >
          {counterProducts.length === 0 ? (
            <Paper elevation={3} sx={{ p: { xs: 2.5, sm: 3 } }}>
              <Typography variant="h6" gutterBottom>
                No products linked to this counter yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Assign a product to see its sales breakdown here.
              </Typography>
            </Paper>
          ) : (
            counterProducts.map((product) => {
              const matchedProduct =
                typeof product.productId === "number"
                  ? productLookup.get(product.productId)
                  : undefined;

              const productFields = [
                { label: "Quantity:", value: product.quantity },
                {
                  label: "Price:",
                  value: matchedProduct?.price?.toLocaleString("pl-PL", {
                    style: "currency",
                    currency: "PLN",
                  }),
                },
                {
                  label: "Total:",
                  value: product.total?.toLocaleString("pl-PL", {
                    style: "currency",
                    currency: "PLN",
                  }),
                },
              ];

              const productKey = product.id ?? product.productId ?? counterId;

              return (
                <Paper
                  key={"product-" + productKey}
                  elevation={3}
                  sx={{
                    p: { xs: 2.5, sm: 3 },
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    minHeight: 180,
                  }}
                >
                  <Typography variant="h6" gutterBottom sx={{ wordBreak: "break-word" }}>
                    {matchedProduct?.name ?? "Unnamed product"}
                  </Typography>
                  {renderFields(productFields)}
                </Paper>
              );
            })
          )}
          <Paper
            elevation={3}
            sx={{
              p: { xs: 2.5, sm: 3 },
              display: "flex",
              flexDirection: "column",
              gap: 1,
              backgroundColor: "#ddf1c1",
            }}
          >
            <Typography variant="h6">Staff: {staffCount}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ minHeight: 24 }}>
              {staffNames.length > 0 ? staffNames.join(', ') : 'No staff assigned'}
            </Typography>
            <Typography variant="h6" sx={{ mt: 1 }}>
              Customers: {totalCustomers}
            </Typography>
          </Paper>
        </Box>
      </Box>
    );
  };

  const handleCreate = async (dataCreate: Partial<Counter>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if (Object.keys(dataCreated).some((key) => key !== "createdBy") && Object.keys(dataCreated).length !== 0) {
      await dispatch(createCounter(dataCreated));
      dispatch(fetchCounters());
    }
  };

  const handleUpdate = async (
    originalData: Partial<Counter>,
    dataUpdated: Partial<Counter>
  ) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === "number") {
      if (Object.keys(dataUpdate).some((key) => key !== "updatedBy") && Object.keys(dataUpdate).length !== 0) {
        await dispatch(updateCounter({ counterId: dataId, counterData: dataUpdate }));
        dispatch(fetchCounters());
      }
    } else {
      console.error("Counter ID is undefined.");
    }
  };

  const handleDelete = async (
    dataDelete: Partial<Counter>,
    count: number,
    iterator: number
  ) => {
    if (typeof dataDelete.id === "number") {
      await dispatch(deleteCounter(dataDelete.id));
      if (count === iterator) {
        dispatch(fetchCounters());
      }
    } else {
      console.error("Counter ID is undefined.");
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<Counter>>[]>(
    () => modifyColumn(data[0]?.columns || [], countersColumnDef),
    [data]
  );

  return (
    <Table
      pageTitle={currentPage}
      data={data[0]?.data || []}
      loading={loading}
      error={error}
      columns={modifiedColumns}
      actions={{ handleDelete, handleCreate, handleUpdate }}
      initialState={initialState}
      renderDetailPanel={renderDetailPanel}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default CounterList;
