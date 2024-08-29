import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchCounters, deleteCounter, createCounter, updateCounter } from '../../actions/counterActions';
import { fetchCounterProducts } from '../../actions/counterProductActions';
import { fetchCounterUsers } from '../../actions/counterUserActions';
import { fetchProducts } from '../../actions/productActions';
import Table from '../../utils/Table';
import { useMemo } from 'react';
import { Counter } from '../../types/counters/Counter';
import { modifyColumn } from '../../utils/modifyColumn';
import { countersColumnDef } from './countersColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';
import { MRT_Row } from 'mantine-react-table';
import { removeEmptyKeys } from '../../utils/removeEmptyKeys';
import { getChangedValues } from '../../utils/getChangedValues';
import { CounterProduct } from '../../types/counterProducts/CounterProduct';
import { Grid, Paper, Typography } from '@mui/material'; // Import Material-UI components
import { Product } from '../../types/products/Product';
import { CounterUser } from '../../types/counterUsers/CounterUser';

const CounterList = () => {

  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.counters)[0];
  const { data: dataCounterProducts } = useAppSelector((state) => state.counterProducts)[0];
  const { data: dataCounterUsers } = useAppSelector((state) => state.counterUsers)[0];
  const { data: dataProducts } = useAppSelector((state) => state.products)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
      userId: false,
      createdBy: false,
      updatedBy: false
    },
  }

  useEffect(() => {
    dispatch(fetchCounters());
    dispatch(fetchCounterProducts());
    dispatch(fetchProducts());
    dispatch(fetchCounterUsers());
  }, [dispatch]);

  const renderDetailPanel = (row: MRT_Row<Partial<Counter>>) => {
    // Extract the counter ID from the row
    const counterId = row.getValue('id');

    // Filter the counter products data based on the counterId
    const counterProducts: Partial<CounterProduct>[] = dataCounterProducts[0]?.data.filter(
      (product: Partial<CounterProduct>) => product.counterId === counterId
    );

    const counterUsers: Partial<CounterUser>[] = dataCounterUsers[0]?.data.filter(
      (user: Partial<CounterUser>) => user.counterId === counterId
    );


    // Display counter products data
return (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap' }}>
      {counterProducts.map((product: Partial<CounterProduct>) => {
        // Find the matching product information
        const matchedProduct: Partial<Product> | undefined = dataProducts[0]?.data.find(
          (productArray: Partial<Product>) => productArray.id === product.productId
        ) as Partial<Product> | undefined;

        // Define an array to hold pairs of product information fields
        const productFields = [
          { label: 'Quantity:', value: product.quantity },
          { label: 'Price:', value: matchedProduct?.price?.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })},
          { label: 'Total:', value: product.total?.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }) }
        ];

        // Function to render a pair of product information fields
        const renderFields = (fields: Array<{ label: string, value: any }>) => (
          <Grid container spacing={2}>
            {fields.map((field, index) => (
              <Grid item xs={6} key={index}>
                <Typography variant="subtitle1">
                  <span style={{ fontWeight: 'bold' }}>{field.label}</span> {field.value}
                </Typography>
              </Grid>
            ))}
          </Grid>
        );

        // Display the product details
        return (
          <Paper key={product.id} elevation={3} style={{ margin: '20px', padding: '20px', maxWidth: '300px', flexGrow: 1 }}>
            <Typography variant="h5" gutterBottom>{matchedProduct?.name}</Typography>
            {renderFields(productFields)}
          </Paper>
        );
      })}
    </div>
    {/* Paper component for staffCounterUser information */}
    <Paper elevation={3} style={{ margin: '20px', padding: '20px', maxWidth: '300px', flexGrow: 1, backgroundColor: '#ddf1c1' }}>
      <Typography variant="h5">Staff:</Typography>
      <Typography variant="subtitle1" gutterBottom>
        {counterUsers.map((user, index) => (
          (user as { counterUser: { firstName: string } })?.counterUser?.firstName && (
            <span key={index}>
              {index !== 0 && ', '} {/* Add comma before names except for the first one */}
              {(user as { counterUser: { firstName: string } }).counterUser.firstName}
            </span>
          )
        ))}
      </Typography>
      <Typography variant="h5">Customers:</Typography>
      <Typography variant="subtitle1">
        {counterProducts.reduce((total, product) => total + (product.quantity || 0), 0)}
      </Typography>
    </Paper>
  </div>
);
  };

  const handleCreate = async (dataCreate: Partial<Counter>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if (Object.keys(dataCreated).some(key => key !== 'createdBy') && Object.keys(dataCreated).length !== 0) {
      await dispatch(createCounter(dataCreated));
      dispatch(fetchCounters());
    }
  };

  const handleUpdate = async (originalData: Partial<Counter>, dataUpdated: Partial<Counter>) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === 'number') {
      if (Object.keys(dataUpdate).some(key => key !== 'updatedBy') && Object.keys(dataUpdate).length !== 0) {
        await dispatch(updateCounter({ counterId: dataId, counterData: dataUpdate }));
        dispatch(fetchCounters());
      }
    } else {
      console.error('Counter ID is undefined.');
    }
  };

  const handleDelete = async (dataDelete: Partial<Counter>, count: number, iterator: number) => {
    if (typeof dataDelete.id === 'number') {
      await dispatch(deleteCounter(dataDelete.id));
      if (count === iterator) { dispatch(fetchCounters()); }
    } else {
      console.error('Counter ID is undefined.');
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<Counter>>[]>(() => modifyColumn(data[0]?.columns || [], countersColumnDef), [data]);

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
    />
  );
};

export default CounterList;