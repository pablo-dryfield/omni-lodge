import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchProducts, deleteProduct, createProduct, updateProduct } from '../../actions/productActions';
import Table from '../../utils/Table';
import { useMemo } from 'react';
import { Product } from '../../types/products/Product';
import { modifyColumn } from '../../utils/modifyColumn';
import { productsColumnDef } from './productsColumnDef';
import { type MRT_ColumnDef } from 'mantine-react-table';
import { removeEmptyKeys } from '../../utils/removeEmptyKeys';
import { getChangedValues } from '../../utils/getChangedValues';

const ProductList = () => {

  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.products)[0];
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
    dispatch(fetchProducts())
  }, [dispatch]);

  const handleCreate = async (dataCreate: Partial<Product>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if(Object.keys(dataCreated).some(key => key !== 'createdBy') && Object.keys(dataCreated).length !== 0){
      await dispatch(createProduct(dataCreated));
      dispatch(fetchProducts());
    }
  };

  const handleUpdate = async (originalData: Partial<Product>, dataUpdated: Partial<Product>) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === 'number') {
      if(Object.keys(dataUpdate).some(key => key !== 'updatedBy') && Object.keys(dataUpdate).length !== 0){
        await dispatch(updateProduct({ productId:dataId, productData:dataUpdate }));
        dispatch(fetchProducts());
      }
    }else{
      console.error('Product ID is undefined.');
    }
  };

  const handleDelete = async (dataDelete: Partial<Product>, count: number, iterator: number) => {
    if (typeof dataDelete.id === 'number') {
      await dispatch(deleteProduct(dataDelete.id));
      if (count === iterator) { dispatch(fetchProducts()); }
    }else{
      console.error('Product ID is undefined.');
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<Product>>[]>(() => modifyColumn(data[0]?.columns || [], productsColumnDef), [data]);

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

export default ProductList;