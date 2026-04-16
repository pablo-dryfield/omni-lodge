import axiosInstance from "../utils/axiosInstance";

export type InboxNotification = {
  id: number;
  channel: "in_app" | "email";
  templateKey: string;
  title: string;
  body: string | null;
  url: string | null;
  sentAt: string;
};

export type InboxNotificationListResponse = {
  items: InboxNotification[];
  total: number;
  limit: number;
  offset: number;
};

const normalizeResponse = (
  payload: unknown,
): InboxNotificationListResponse => {
  if (!payload || typeof payload !== "object") {
    return { items: [], total: 0, limit: 0, offset: 0 };
  }

  const source = payload as Partial<InboxNotificationListResponse>;
  const items = Array.isArray(source.items)
    ? source.items.filter(
        (item): item is InboxNotification =>
          Boolean(item && typeof item === "object" && "id" in item),
      )
    : [];

  return {
    items,
    total: Number.isFinite(source.total) ? Number(source.total) : items.length,
    limit: Number.isFinite(source.limit) ? Number(source.limit) : items.length,
    offset: Number.isFinite(source.offset) ? Number(source.offset) : 0,
  };
};

export const fetchInboxNotifications = async (params?: {
  limit?: number;
  offset?: number;
  includeAllChannels?: boolean;
}): Promise<InboxNotificationListResponse> => {
  const response = await axiosInstance.get("/notifications", {
    withCredentials: true,
    params: {
      limit: params?.limit,
      offset: params?.offset,
      includeAllChannels: params?.includeAllChannels ?? false,
    },
  });

  return normalizeResponse(response.data);
};

