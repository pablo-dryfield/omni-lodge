import axiosInstance from "../utils/axiosInstance";
import axios from "axios";

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

export type NotificationPushTestResponse = {
  userId: number;
  sent: boolean;
  targetedDeviceCount: number;
};

const extractApiErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data;
    if (typeof payload === "string" && payload.trim()) {
      return payload.trim();
    }
    if (Array.isArray(payload)) {
      const first = payload.find(
        (item) =>
          item &&
          typeof item === "object" &&
          "message" in item &&
          typeof (item as { message?: unknown }).message === "string",
      ) as { message: string } | undefined;
      if (first?.message?.trim()) {
        return first.message.trim();
      }
    }
    if (
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof (payload as { message?: unknown }).message === "string"
    ) {
      const message = (payload as { message: string }).message.trim();
      if (message) {
        return message;
      }
    }
    if (error.message?.trim()) {
      return error.message.trim();
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
};

const extractEnvelopeData = <T>(payload: unknown): T | null => {
  if (Array.isArray(payload)) {
    const first = payload[0] as { data?: unknown } | undefined;
    if (first && typeof first === "object" && "data" in first) {
      return (first.data as T) ?? null;
    }
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    return ((payload as { data?: unknown }).data as T) ?? null;
  }
  return null;
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

export const sendNotificationPushTest = async (params: {
  userId: number;
  title?: string;
  body?: string;
  url?: string;
}): Promise<NotificationPushTestResponse> => {
  try {
    const response = await axiosInstance.post(
      "/notifications/push/test",
      {
        userId: params.userId,
        title: params.title,
        body: params.body,
        url: params.url,
      },
      { withCredentials: true },
    );
    const data = extractEnvelopeData<Partial<NotificationPushTestResponse>>(response.data);
    return {
      userId: typeof data?.userId === "number" ? data.userId : params.userId,
      sent: data?.sent === true,
      targetedDeviceCount:
        typeof data?.targetedDeviceCount === "number" && Number.isFinite(data.targetedDeviceCount)
          ? data.targetedDeviceCount
          : 0,
    };
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Failed to send test notification"));
  }
};
