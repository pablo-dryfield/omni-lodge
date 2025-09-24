import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchProducts, deleteProduct, createProduct, updateProduct } from "../../actions/productActions";
import Table from "../../utils/Table";
import { Product } from "../../types/products/Product";
import { modifyColumn } from "../../utils/modifyColumn";
import { productsColumnDef } from "./productsColumnDef";
import { type MRT_ColumnDef } from "mantine-react-table";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { fetchProductTypes } from "../../actions/productTypeActions";

const DEFAULT_MODULE_SLUG = "product-catalog";

type ProductsListProps = {
  moduleSlug?: string;
};

const coerceProductPayload = (payload: Partial<Product>) => {
  const next: Partial<Product> = { ...payload };

  if (next.productTypeId !== undefined && next.productTypeId !== null) {
    next.productTypeId = Number(next.productTypeId);
  }

  if (next.price !== undefined && next.price !== null) {
    next.price = Number(next.price);
  }

  if (next.status !== undefined && next.status !== null) {
    next.status = Boolean(next.status);
  }

  return next;
};

const ProductList = ({ moduleSlug = DEFAULT_MODULE_SLUG }: ProductsListProps) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.products)[0];
  const productTypesState = useAppSelector((state) => state.productTypes)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
    },
  };

  useEffect(() => {
    dispatch(fetchProducts());
  }, [dispatch]);

  useEffect(() => {
    if (!productTypesState.data[0]?.data?.length) {
      dispatch(fetchProductTypes());
    }
  }, [dispatch, productTypesState.data]);

  const handleCreate = async (dataCreate: Partial<Product>) => {
    const sanitized = removeEmptyKeys(coerceProductPayload(dataCreate), loggedUserId);
    if (
      Object.keys(sanitized).some((key) => key !== "createdBy") &&
      Object.keys(sanitized).length !== 0
    ) {
      await dispatch(createProduct(sanitized));
      dispatch(fetchProducts());
    }
  };

  const handleUpdate = async (
    originalData: Partial<Product>,
    dataUpdated: Partial<Product>,
  ) => {
    const dataId = originalData.id;
    const delta = getChangedValues(originalData, coerceProductPayload(dataUpdated), loggedUserId);
    if (typeof dataId === "number") {
      if (
        Object.keys(delta).some((key) => key !== "updatedBy") &&
        Object.keys(delta).length !== 0
      ) {
        await dispatch(updateProduct({ productId: dataId, productData: delta }));
        dispatch(fetchProducts());
      }
    } else {
      console.error("Product ID is undefined.");
    }
  };

  const handleDelete = async (
    dataDelete: Partial<Product>,
    count: number,
    iterator: number,
  ) => {
    if (typeof dataDelete.id === "number") {
      await dispatch(deleteProduct(dataDelete.id));
      if (count === iterator) {
        dispatch(fetchProducts());
      }
    } else {
      console.error("Product ID is undefined.");
    }
  };

  const productTypeRecords = useMemo(
    () => productTypesState.data[0]?.data || [],
    [productTypesState.data],
  );

  const productTypeLabelById = useMemo(() => {
    const map = new Map<number, string>();
    productTypeRecords.forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? record.slug ?? `Type ${record.id}`);
      }
    });
    return map;
  }, [productTypeRecords]);

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<Product>>[]>(
    () => modifyColumn(data[0]?.columns || [], productsColumnDef({ productTypeLabelById })),
    [data, productTypeLabelById],
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
      moduleSlug={moduleSlug}
    />
  );
};

export default ProductList;