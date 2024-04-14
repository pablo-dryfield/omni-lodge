import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchCounters, deleteCounter, createCounter, updateCounter } from '../../actions/counterActions';
import Table from '../../utils/Table';
import { useMemo } from 'react';
import { Counter } from '../../types/counters/Counter';
import { modifyColumn } from '../../utils/modifyColumn';
import { countersColumnDef } from './countersColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';
import { removeEmptyKeys } from '../../utils/removeEmptyKeys';
import { getChangedValues } from '../../utils/getChangedValues';
import { ResponseModifications } from '../../types/general/ResponseModifications';
import ProductCounterModal from '../products/ProductCounterModal';

const CounterList = () => {

  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.counters)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
    },
  }

  useEffect(() => {
    dispatch(fetchCounters())
  }, [dispatch]);

  const handleCreate = async (dataCreate: Partial<Counter>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if(Object.keys(dataCreated).some(key => key !== 'createdBy') && Object.keys(dataCreated).length !== 0){
      await dispatch(createCounter(dataCreated));
      dispatch(fetchCounters());
    }
  };

  const handleUpdate = async (originalData: Partial<Counter>, dataUpdated: Partial<Counter>) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === 'number') {
      if(Object.keys(dataUpdate).some(key => key !== 'updatedBy') && Object.keys(dataUpdate).length !== 0){
        await dispatch(updateCounter({ counterId:dataId, counterData:dataUpdate }));
        dispatch(fetchCounters());
      }
    }else{
      console.error('Counter ID is undefined.');
    }
  };

  const handleDelete = async (dataDelete: Partial<Counter>, count: number, iterator: number) => {
    if (typeof dataDelete.id === 'number') {
      await dispatch(deleteCounter(dataDelete.id));
      if (count === iterator) { dispatch(fetchCounters()); }
    }else{
      console.error('Counter ID is undefined.');
    }
  };

  const countersExtraColumnDef: ResponseModifications<Partial<Counter>>[] = [
    {
      accessorKey: 'test',
      modifications: {
        id: 'test',
        header: 'Test',
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        visibleInShowHideMenu: false,
        Edit:  () => <ProductCounterModal />,
      }
    },
  ];

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<Counter>>[]>(() => modifyColumn(data[0]?.columns || [], countersColumnDef, countersExtraColumnDef), [data]);

  return (
    <Table
      pageTitle={currentPage}
      data={data[0]?.data || []}
      loading={loading}
      error={error}
      columns={modifiedColumns}
      actions={{ handleDelete, handleCreate, handleUpdate }}
      initialState={initialState}
    />
  );
};

export default CounterList;