import { useEffect, useMemo, useState } from "react";
import { SegmentedControl, Stack, Text } from "@mantine/core";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchProducts } from "../../actions/productActions";
import {
  fetchProductAliases,
  createProductAlias,
  updateProductAlias,
  deleteProductAlias,
} from "../../actions/productAliasActions";
import Table from "../../utils/Table";
import { type Product } from "../../types/products/Product";
import type { ProductAlias } from "../../types/products/ProductAlias";
import { modifyColumn } from "../../utils/modifyColumn";
import { type MRT_ColumnDef } from "mantine-react-table";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { productAliasesColumnDef } from "./productAliasesColumnDef";

const DEFAULT_MODULE_SLUG = "product-alias-management";

type ProductAliasListProps = {
  moduleSlug?: string;
  pageTitle?: string;
};

type FilterKey = "all" | "pending" | "assigned";

const coerceAliasPayload = (payload: Partial<ProductAlias>) => {
  const next: Partial<ProductAlias> = { ...payload };

  if (next.productId !== undefined && next.productId !== null) {
    next.productId = Number(next.productId);
  }
  if (next.priority !== undefined && next.priority !== null) {
    next.priority = Number(next.priority);
  }
  if (next.active !== undefined && next.active !== null) {
    next.active = Boolean(next.active);
  }
  if (next.matchType !== undefined && next.matchType !== null) {
    next.matchType = String(next.matchType) as ProductAlias["matchType"];
  }
  return next;
};

const ProductAliasList = ({ moduleSlug = DEFAULT_MODULE_SLUG, pageTitle }: ProductAliasListProps) => {
  const dispatch = useAppDispatch();
  const aliasState = useAppSelector((state) => state.productAliases)[0];
  const productsState = useAppSelector((state) => state.products)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);
  const [filterKey, setFilterKey] = useState<FilterKey>("all");

  useEffect(() => {
    dispatch(fetchProductAliases());
  }, [dispatch]);

  useEffect(() => {
    if (!productsState.data[0]?.data?.length) {
      dispatch(fetchProducts());
    }
  }, [dispatch, productsState.data]);

  const allAliases = useMemo<Partial<ProductAlias>[]>(
    () => aliasState.data?.[0]?.data ?? [],
    [aliasState.data],
  );

  const filteredAliases = useMemo(() => {
    if (filterKey === "pending") {
      return allAliases.filter((alias) => !alias.productId);
    }
    if (filterKey === "assigned") {
      return allAliases.filter((alias) => Boolean(alias.productId));
    }
    return allAliases;
  }, [allAliases, filterKey]);

  const productRecords = useMemo(
    () => (productsState.data[0]?.data ?? []) as Partial<Product>[],
    [productsState.data],
  );

  const productLabelById = useMemo(() => {
    const map = new Map<number, string>();
    productRecords.forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? `Product #${record.id}`);
      }
    });
    return map;
  }, [productRecords]);

  const productOptions = useMemo(
    () =>
      productRecords
        .filter((record) => typeof record.id === "number")
        .map((record) => ({
          value: String(record.id),
          label: record.name ?? `Product #${record.id}`,
        })),
    [productRecords],
  );

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<ProductAlias>>[]>(
    () =>
      modifyColumn(
        aliasState.data?.[0]?.columns || [],
        productAliasesColumnDef({ productOptions, productLabelById }),
      ),
    [aliasState.data, productLabelById, productOptions],
  );

  const handleCreate = async (dataCreate: Partial<ProductAlias>) => {
    const payload = removeEmptyKeys(
      coerceAliasPayload({ ...dataCreate, createdBy: loggedUserId, source: "manual" }),
      loggedUserId,
    );
    if (Object.keys(payload).some((key) => key !== "createdBy") && Object.keys(payload).length !== 0) {
      await dispatch(createProductAlias(payload));
      dispatch(fetchProductAliases());
    }
  };

  const handleUpdate = async (originalData: Partial<ProductAlias>, dataUpdated: Partial<ProductAlias>) => {
    const aliasId = originalData.id;
    const delta = getChangedValues(
      originalData,
      coerceAliasPayload({ ...dataUpdated, updatedBy: loggedUserId }),
      loggedUserId,
    );
    if (typeof aliasId === "number") {
      if (Object.keys(delta).some((key) => key !== "updatedBy") && Object.keys(delta).length !== 0) {
        await dispatch(updateProductAlias({ aliasId, payload: delta }));
        dispatch(fetchProductAliases());
      }
    } else {
      console.error("Product alias ID is undefined.");
    }
  };

  const handleDelete = async (dataDelete: Partial<ProductAlias>, count: number, iterator: number) => {
    if (typeof dataDelete.id === "number") {
      await dispatch(deleteProductAlias(dataDelete.id));
      if (count === iterator) {
        dispatch(fetchProductAliases());
      }
    } else {
      console.error("Product alias ID is undefined.");
    }
  };

  const headingTitle = pageTitle ?? currentPage;

  return (
    <Stack gap="md">
      <Stack gap={2}>
        <Text size="sm" c="dimmed">
          Map incoming booking labels to products. Pending rows are collected automatically from ingestion.
        </Text>
        <SegmentedControl
          value={filterKey}
          onChange={(value) => setFilterKey(value as FilterKey)}
          data={[
            { value: "all", label: "All" },
            { value: "pending", label: "Pending" },
            { value: "assigned", label: "Assigned" },
          ]}
          size="sm"
        />
      </Stack>
      <Table
        pageTitle={headingTitle}
        data={filteredAliases}
        loading={aliasState.loading || productsState.loading}
        error={aliasState.error}
        columns={modifiedColumns}
        actions={{ handleDelete, handleCreate, handleUpdate }}
        initialState={{ showGlobalFilter: true, columnVisibility: { id: false, normalizedLabel: false } }}
        moduleSlug={moduleSlug}
      />
    </Stack>
  );
};

export default ProductAliasList;
