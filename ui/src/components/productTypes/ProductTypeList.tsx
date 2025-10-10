import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  fetchProductTypes,
  deleteProductType,
  createProductType,
  updateProductType,
} from "../../actions/productTypeActions";
import Table from "../../utils/Table";
import { ProductType } from "../../types/productTypes/ProductType";
import { modifyColumn } from "../../utils/modifyColumn";
import { productTypesColumnDef } from "./productTypesColumnDef";
import { type MRT_ColumnDef } from "mantine-react-table";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";

const DEFAULT_MODULE_SLUG = "product-taxonomy";

type ProductTypeListProps = {
  moduleSlug?: string;
  pageTitle?: string;
};

const ProductTypeList = ({ moduleSlug = DEFAULT_MODULE_SLUG, pageTitle }: ProductTypeListProps) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.productTypes)[0];
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
    dispatch(fetchProductTypes());
  }, [dispatch]);

  const handleCreate = async (dataCreate: Partial<ProductType>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if (
      Object.keys(dataCreated).some((key) => key !== "createdBy") &&
      Object.keys(dataCreated).length !== 0
    ) {
      await dispatch(createProductType(dataCreated));
      dispatch(fetchProductTypes());
    }
  };

  const handleUpdate = async (
    originalData: Partial<ProductType>,
    dataUpdated: Partial<ProductType>
  ) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === "number") {
      if (
        Object.keys(dataUpdate).some((key) => key !== "updatedBy") &&
        Object.keys(dataUpdate).length !== 0
      ) {
        await dispatch(
          updateProductType({ productTypeId: dataId, productTypeData: dataUpdate })
        );
        dispatch(fetchProductTypes());
      }
    } else {
      console.error("Product Type ID is undefined.");
    }
  };

  const handleDelete = async (
    dataDelete: Partial<ProductType>,
    count: number,
    iterator: number
  ) => {
    if (typeof dataDelete.id === "number") {
      await dispatch(deleteProductType(dataDelete.id));
      if (count === iterator) {
        dispatch(fetchProductTypes());
      }
    } else {
      console.error("Product Type ID is undefined.");
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<ProductType>>[]>(
    () => modifyColumn(data[0]?.columns || [], productTypesColumnDef),
    [data]
  );

  const headingTitle = pageTitle ?? currentPage;

  return (
    <Table
      pageTitle={headingTitle}
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

export default ProductTypeList;
