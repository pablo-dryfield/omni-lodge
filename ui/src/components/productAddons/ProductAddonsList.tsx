import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import {
  createProductAddon,
  deleteProductAddon,
  fetchProductAddons,
  updateProductAddon,
} from "../../actions/productAddonActions";
import { ProductAddon } from "../../types/productAddons/ProductAddon";
import { productAddonsColumnDef } from "./productAddonsColumnDef";
import { fetchProducts } from "../../actions/productActions";
import { fetchAddons } from "../../actions/addonActions";
import { Addon } from "../../types/addons/Addon";
import { Product } from "../../types/products/Product";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { MRT_ColumnDef } from "mantine-react-table";

const MODULE_SLUG = "product-addon-management";

type ProductAddonsListProps = {
  pageTitle?: string;
};

const coerceProductAddonPayload = (
  payload: Partial<ProductAddon>,
  { forCreate = false }: { forCreate?: boolean } = {},
): Partial<ProductAddon> => {
  const next: Partial<ProductAddon> = {};

  if (payload.productId !== undefined && payload.productId !== null && payload.productId !== "") {
    next.productId = Number(payload.productId);
  }
  if (payload.addonId !== undefined && payload.addonId !== null && payload.addonId !== "") {
    next.addonId = Number(payload.addonId);
  }

  if (payload.maxPerAttendee !== undefined) {
    if (payload.maxPerAttendee === null || payload.maxPerAttendee === "") {
      next.maxPerAttendee = null;
    } else {
      next.maxPerAttendee = Number(payload.maxPerAttendee);
    }
  }

  if (payload.priceOverride !== undefined) {
    if (payload.priceOverride === null || payload.priceOverride === "") {
      next.priceOverride = null;
    } else {
      next.priceOverride = Number(payload.priceOverride);
    }
  }

  if (payload.sortOrder !== undefined) {
    if (payload.sortOrder === "" || payload.sortOrder === null) {
      if (forCreate) {
        next.sortOrder = 0;
      }
    } else {
      next.sortOrder = Number(payload.sortOrder);
    }
  } else if (forCreate) {
    next.sortOrder = 0;
  }

  delete (next as Record<string, unknown>).id;
  delete (next as Record<string, unknown>).productName;
  delete (next as Record<string, unknown>).addonName;
  delete (next as Record<string, unknown>).createdAt;
  delete (next as Record<string, unknown>).updatedAt;

  return next;
};

const ensureNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isNaN(numeric) ? undefined : numeric;
};

const ProductAddonsList = ({ pageTitle }: ProductAddonsListProps) => {
  const dispatch = useAppDispatch();
  const productAddonsState = useAppSelector((state) => state.productAddons)[0];
  const productsState = useAppSelector((state) => state.products)[0];
  const addonsState = useAppSelector((state) => state.addons)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchProductAddons());
  }, [dispatch]);

  useEffect(() => {
    if (!productsState.data[0]?.data?.length) {
      dispatch(fetchProducts());
    }
  }, [dispatch, productsState.data]);

  useEffect(() => {
    if (!addonsState.data[0]?.data?.length) {
      dispatch(fetchAddons());
    }
  }, [dispatch, addonsState.data]);

  const productRecords = useMemo(() => {
    const raw = productsState.data[0]?.data ?? [];
    return raw as Partial<Product>[];
  }, [productsState.data]);

  const addonRecords = useMemo(() => {
    const raw = addonsState.data[0]?.data ?? [];
    return raw as Partial<Addon>[];
  }, [addonsState.data]);

  const productLabelById = useMemo(() => {
    const map = new Map<number, string>();
    productRecords.forEach((product) => {
      if (typeof product.id === "number") {
        map.set(product.id, product.name ?? `Product ${product.id}`);
      }
    });
    return map;
  }, [productRecords]);

  const addonLabelById = useMemo(() => {
    const map = new Map<number, string>();
    addonRecords.forEach((addon) => {
      if (typeof addon.id === "number") {
        map.set(addon.id, addon.name ?? `Add-On ${addon.id}`);
      }
    });
    return map;
  }, [addonRecords]);

  const productOptions = useMemo(
    () =>
      Array.from(productLabelById.entries()).map(([id, label]) => ({
        value: String(id),
        label: `${label} (#${id})`,
      })),
    [productLabelById],
  );

  const addonOptions = useMemo(
    () =>
      Array.from(addonLabelById.entries()).map(([id, label]) => ({
        value: String(id),
        label: `${label} (#${id})`,
      })),
    [addonLabelById],
  );

  const handleCreate = async (payload: Partial<ProductAddon>) => {
    const sanitized = removeEmptyKeys(
      coerceProductAddonPayload(payload, { forCreate: true }),
      Number(loggedUserId ?? 0),
    );

    const productId = ensureNumber(sanitized.productId);
    const addonId = ensureNumber(sanitized.addonId);

    if (productId === undefined || addonId === undefined) {
      console.error("Product ID and Add-On ID are required.");
      return;
    }

    await dispatch(createProductAddon({ ...sanitized, productId, addonId }));
    await dispatch(fetchProductAddons());
  };

  const handleUpdate = async (original: Partial<ProductAddon>, updates: Partial<ProductAddon>) => {
    if (typeof original.id !== "number") {
      console.error("Product add-on ID is undefined.");
      return;
    }

    const delta = getChangedValues(
      original,
      coerceProductAddonPayload(updates),
      Number(loggedUserId ?? 0),
    );

    if (Object.keys(delta).length > 0) {
      await dispatch(
        updateProductAddon({
          productAddonId: original.id,
          payload: delta,
        }),
      );
      await dispatch(fetchProductAddons());
    }
  };

  const handleDelete = async (record: Partial<ProductAddon>, count: number, iterator: number) => {
    if (typeof record.id !== "number") {
      console.error("Product add-on ID is undefined.");
      return;
    }

    await dispatch(deleteProductAddon(record.id));
    if (count === iterator) {
      await dispatch(fetchProductAddons());
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

  const columns = useMemo<MRT_ColumnDef<Partial<ProductAddon>>[]>(
    () =>
      modifyColumn(
        productAddonsState.data[0]?.columns || [],
        productAddonsColumnDef({
          productLabelById,
          addonLabelById,
          productOptions,
          addonOptions,
        }),
      ),
    [productAddonsState.data, productLabelById, addonLabelById, productOptions, addonOptions],
  );

  const headingTitle = pageTitle ?? currentPage;

  return (
    <Table
      pageTitle={headingTitle}
      data={productAddonsState.data[0]?.data || []}
      loading={productAddonsState.loading}
      error={productAddonsState.error}
      columns={columns}
      actions={{ handleCreate, handleUpdate, handleDelete }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default ProductAddonsList;
