import { useEffect, useMemo } from "react";
import { MRT_ColumnDef } from "mantine-react-table";
import dayjs from "dayjs";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import {
  fetchProductPrices,
  createProductPrice,
  updateProductPrice,
  deleteProductPrice,
} from "../../actions/productPriceActions";
import { ProductPrice } from "../../types/products/ProductPrice";
import { productPriceColumnDef } from "./productPriceColumnDef";
import { fetchProducts } from "../../actions/productActions";
import { EditSelectOption } from "../../utils/CustomEditSelect";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";

const MODULE_SLUG = "product-price-management";

type ProductPriceListProps = {
  pageTitle?: string;
};

const normalizeProductPricePayload = (payload: Partial<ProductPrice>) => {
  const next: Partial<ProductPrice> = {};

  if (payload.productId !== undefined && payload.productId !== null && payload.productId !== "") {
    next.productId = Number(payload.productId);
  }

  if (payload.price !== undefined && payload.price !== null && payload.price !== "") {
    next.price = Number(payload.price);
  }

  if (payload.validFrom !== undefined && payload.validFrom !== null && payload.validFrom !== "") {
    next.validFrom = dayjs(payload.validFrom).format("YYYY-MM-DD");
  }

  if (payload.validTo !== undefined) {
    next.validTo =
      payload.validTo === null || payload.validTo === ""
        ? null
        : dayjs(payload.validTo).format("YYYY-MM-DD");
  }

  return next;
};

const ProductPriceList = ({ pageTitle }: ProductPriceListProps) => {
  const dispatch = useAppDispatch();
  const productPricesState = useAppSelector((state) => state.productPrices)[0];
  const productsState = useAppSelector((state) => state.products)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchProductPrices(undefined));
  }, [dispatch]);

  useEffect(() => {
    if (!productsState.data[0]?.data?.length) {
      dispatch(fetchProducts());
    }
  }, [dispatch, productsState.data]);

  const productOptions = useMemo<EditSelectOption[]>(() => {
    const records = productsState.data[0]?.data || [];
    return records.map((product) => ({
      value: String(product.id),
      label: `${product.name ?? `Product #${product.id}`} (#${product.id})`,
    }));
  }, [productsState.data]);

  const productNameById = useMemo(() => {
    const map = new Map<number, string>();
    productOptions.forEach((option) => {
      map.set(Number(option.value), option.label);
    });
    return map;
  }, [productOptions]);

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

  const handleCreate = async (payload: Partial<ProductPrice>) => {
    const sanitized = removeEmptyKeys(normalizeProductPricePayload(payload), Number(loggedUserId ?? 0));
    if (sanitized.productId && sanitized.price != null && sanitized.validFrom) {
      await dispatch(createProductPrice(sanitized));
      await dispatch(fetchProductPrices(undefined));
    }
  };

  const handleUpdate = async (original: Partial<ProductPrice>, updates: Partial<ProductPrice>) => {
    if (typeof original.id !== "number") {
      console.error("Product price ID is undefined.");
      return;
    }

    const delta = getChangedValues(
      original,
      normalizeProductPricePayload(updates),
      Number(loggedUserId ?? 0),
    );

    if (Object.keys(delta).length > 0) {
      await dispatch(updateProductPrice({ productPriceId: original.id, payload: delta }));
      await dispatch(fetchProductPrices(undefined));
    }
  };

  const handleDelete = async (record: Partial<ProductPrice>, count: number, iterator: number) => {
    if (typeof record.id !== "number") {
      console.error("Product price ID is undefined.");
      return;
    }

    await dispatch(deleteProductPrice(record.id));
    if (count === iterator) {
      await dispatch(fetchProductPrices(undefined));
    }
  };

  const columns = useMemo<MRT_ColumnDef<Partial<ProductPrice>>[]>(
    () =>
      modifyColumn(
        productPricesState.data[0]?.columns || [],
        productPriceColumnDef({
          productOptions,
        }),
      ),
    [productPricesState.data, productOptions],
  );

  const headingTitle = pageTitle ?? currentPage;

  const dataAugmented = useMemo(() => {
    return (productPricesState.data[0]?.data || []).map((record) => ({
      ...record,
      productName:
        record.productName ??
        (record.productId != null ? productNameById.get(Number(record.productId)) ?? null : null),
    }));
  }, [productPricesState.data, productNameById]);

  return (
    <Table
      pageTitle={headingTitle}
      data={dataAugmented}
      loading={productPricesState.loading}
      error={productPricesState.error}
      columns={columns}
      actions={{ handleCreate, handleUpdate, handleDelete }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default ProductPriceList;
