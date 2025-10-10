import { useEffect, useMemo } from "react";
import { MRT_ColumnDef } from "mantine-react-table";
import dayjs from "dayjs";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import {
  fetchChannelProductPrices,
  createChannelProductPrice,
  updateChannelProductPrice,
  deleteChannelProductPrice,
} from "../../actions/channelProductPriceActions";
import { ChannelProductPrice } from "../../types/channels/ChannelProductPrice";
import { channelProductPriceColumnDef } from "./channelProductPriceColumnDef";
import { fetchChannels } from "../../actions/channelActions";
import { fetchProducts } from "../../actions/productActions";
import { EditSelectOption } from "../../utils/CustomEditSelect";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";

const MODULE_SLUG = "channel-product-price-management";

type ChannelProductPriceListProps = {
  pageTitle?: string;
};

const normalizeChannelProductPricePayload = (payload: Partial<ChannelProductPrice>) => {
  const next: Partial<ChannelProductPrice> = {};

  if (payload.channelId !== undefined && payload.channelId !== null && payload.channelId !== "") {
    next.channelId = Number(payload.channelId);
  }

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

const ChannelProductPriceList = ({ pageTitle }: ChannelProductPriceListProps) => {
  const dispatch = useAppDispatch();
  const channelProductPricesState = useAppSelector((state) => state.channelProductPrices)[0];
  const channelsState = useAppSelector((state) => state.channels)[0];
  const productsState = useAppSelector((state) => state.products)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchChannelProductPrices(undefined));
  }, [dispatch]);

  useEffect(() => {
    if (!channelsState.data[0]?.data?.length) {
      dispatch(fetchChannels());
    }
  }, [dispatch, channelsState.data]);

  useEffect(() => {
    if (!productsState.data[0]?.data?.length) {
      dispatch(fetchProducts());
    }
  }, [dispatch, productsState.data]);

  const channelOptions = useMemo<EditSelectOption[]>(() => {
    const records = channelsState.data[0]?.data || [];
    return records.map((channel) => ({
      value: String(channel.id),
      label: `${channel.name ?? channel.description ?? `Channel #${channel.id}`} (#${channel.id})`,
    }));
  }, [channelsState.data]);

  const productOptions = useMemo<EditSelectOption[]>(() => {
    const records = productsState.data[0]?.data || [];
    return records.map((product) => ({
      value: String(product.id),
      label: `${product.name ?? `Product #${product.id}`} (#${product.id})`,
    }));
  }, [productsState.data]);

  const channelNameById = useMemo(() => {
    const map = new Map<number, string>();
    channelOptions.forEach((opt) => {
      map.set(Number(opt.value), opt.label);
    });
    return map;
  }, [channelOptions]);

  const productNameById = useMemo(() => {
    const map = new Map<number, string>();
    productOptions.forEach((opt) => {
      map.set(Number(opt.value), opt.label);
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

  const handleCreate = async (payload: Partial<ChannelProductPrice>) => {
    const sanitized = removeEmptyKeys(
      normalizeChannelProductPricePayload(payload),
      Number(loggedUserId ?? 0),
    );
    if (
      sanitized.channelId &&
      sanitized.productId &&
      sanitized.price != null &&
      sanitized.validFrom
    ) {
      await dispatch(createChannelProductPrice(sanitized));
      await dispatch(fetchChannelProductPrices(undefined));
    }
  };

  const handleUpdate = async (
    original: Partial<ChannelProductPrice>,
    updates: Partial<ChannelProductPrice>,
  ) => {
    if (typeof original.id !== "number") {
      console.error("Channel product price ID is undefined.");
      return;
    }

    const delta = getChangedValues(
      original,
      normalizeChannelProductPricePayload(updates),
      Number(loggedUserId ?? 0),
    );

    if (Object.keys(delta).length > 0) {
      await dispatch(updateChannelProductPrice({ recordId: original.id, payload: delta }));
      await dispatch(fetchChannelProductPrices(undefined));
    }
  };

  const handleDelete = async (
    record: Partial<ChannelProductPrice>,
    count: number,
    iterator: number,
  ) => {
    if (typeof record.id !== "number") {
      console.error("Channel product price ID is undefined.");
      return;
    }

    await dispatch(deleteChannelProductPrice(record.id));
    if (count === iterator) {
      await dispatch(fetchChannelProductPrices(undefined));
    }
  };

  const columns = useMemo<MRT_ColumnDef<Partial<ChannelProductPrice>>[]>(
    () =>
      modifyColumn(
        channelProductPricesState.data[0]?.columns || [],
        channelProductPriceColumnDef({
          channelOptions,
          productOptions,
        }),
      ),
    [channelProductPricesState.data, channelOptions, productOptions],
  );

  const headingTitle = pageTitle ?? currentPage;

  const dataAugmented = useMemo(() => {
    return (channelProductPricesState.data[0]?.data || []).map((record) => ({
      ...record,
      channelName:
        record.channelName ??
        (record.channelId != null ? channelNameById.get(Number(record.channelId)) ?? null : null),
      productName:
        record.productName ??
        (record.productId != null ? productNameById.get(Number(record.productId)) ?? null : null),
    }));
  }, [channelProductPricesState.data, channelNameById, productNameById]);

  return (
    <Table
      pageTitle={headingTitle}
      data={dataAugmented}
      loading={channelProductPricesState.loading}
      error={channelProductPricesState.error}
      columns={columns}
      actions={{ handleCreate, handleUpdate, handleDelete }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default ChannelProductPriceList;
