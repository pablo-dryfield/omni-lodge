import { useEffect, useMemo } from "react";
import { MRT_ColumnDef } from "mantine-react-table";
import dayjs from "dayjs";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import {
  fetchChannelCommissions,
  createChannelCommission,
  updateChannelCommission,
  deleteChannelCommission,
} from "../../actions/channelCommissionActions";
import { ChannelCommission } from "../../types/channels/ChannelCommission";
import { channelCommissionColumnDef } from "./channelCommissionColumnDef";
import { fetchChannels } from "../../actions/channelActions";
import { EditSelectOption } from "../../utils/CustomEditSelect";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";

const MODULE_SLUG = "channel-commission-management";

type ChannelCommissionListProps = {
  pageTitle?: string;
};

const normalizeCommissionPayload = (payload: Partial<ChannelCommission>) => {
  const next: Partial<ChannelCommission> = {};

  if (payload.channelId !== undefined && payload.channelId !== null && payload.channelId !== "") {
    next.channelId = Number(payload.channelId);
  }

  if (payload.rate !== undefined && payload.rate !== null && payload.rate !== "") {
    next.rate = Number(payload.rate);
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

const ChannelCommissionList = ({ pageTitle }: ChannelCommissionListProps) => {
  const dispatch = useAppDispatch();
  const commissionState = useAppSelector((state) => state.channelCommissions)[0];
  const channelsState = useAppSelector((state) => state.channels)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchChannelCommissions(undefined));
  }, [dispatch]);

  useEffect(() => {
    if (!channelsState.data[0]?.data?.length) {
      dispatch(fetchChannels());
    }
  }, [dispatch, channelsState.data]);

  const channelOptions = useMemo<EditSelectOption[]>(() => {
    const records = channelsState.data[0]?.data || [];
    return records.map((channel) => ({
      value: String(channel.id),
      label: `${channel.name ?? channel.description ?? `Channel #${channel.id}`} (#${channel.id})`,
    }));
  }, [channelsState.data]);

  const channelNameById = useMemo(() => {
    const map = new Map<number, string>();
    channelOptions.forEach((opt) => {
      map.set(Number(opt.value), opt.label);
    });
    return map;
  }, [channelOptions]);

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

  const handleCreate = async (payload: Partial<ChannelCommission>) => {
    const sanitized = removeEmptyKeys(normalizeCommissionPayload(payload), Number(loggedUserId ?? 0));
    if (sanitized.channelId && sanitized.rate != null && sanitized.validFrom) {
      await dispatch(createChannelCommission(sanitized));
      await dispatch(fetchChannelCommissions(undefined));
    }
  };

  const handleUpdate = async (original: Partial<ChannelCommission>, updates: Partial<ChannelCommission>) => {
    if (typeof original.id !== "number") {
      console.error("Channel commission ID is undefined.");
      return;
    }

    const delta = getChangedValues(
      original,
      normalizeCommissionPayload(updates),
      Number(loggedUserId ?? 0),
    );

    if (Object.keys(delta).length > 0) {
      await dispatch(updateChannelCommission({ commissionId: original.id, payload: delta }));
      await dispatch(fetchChannelCommissions(undefined));
    }
  };

  const handleDelete = async (record: Partial<ChannelCommission>, count: number, iterator: number) => {
    if (typeof record.id !== "number") {
      console.error("Channel commission ID is undefined.");
      return;
    }

    await dispatch(deleteChannelCommission(record.id));
    if (count === iterator) {
      await dispatch(fetchChannelCommissions(undefined));
    }
  };

  const columns = useMemo<MRT_ColumnDef<Partial<ChannelCommission>>[]>(
    () =>
      modifyColumn(
        commissionState.data[0]?.columns || [],
        channelCommissionColumnDef({
          channelOptions,
        }),
      ),
    [commissionState.data, channelOptions],
  );

  const headingTitle = pageTitle ?? currentPage;

  const dataAugmented = useMemo(() => {
    return (commissionState.data[0]?.data || []).map((record) => ({
      ...record,
      channelName:
        record.channelName ??
        (record.channelId != null ? channelNameById.get(Number(record.channelId)) ?? null : null),
    }));
  }, [commissionState.data, channelNameById]);

  return (
    <Table
      pageTitle={headingTitle}
      data={dataAugmented}
      loading={commissionState.loading}
      error={commissionState.error}
      columns={columns}
      actions={{ handleCreate, handleUpdate, handleDelete }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default ChannelCommissionList;
