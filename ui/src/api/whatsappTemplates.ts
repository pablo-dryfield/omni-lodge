import axiosInstance from "../utils/axiosInstance";

const BASE_PATH = "/integrations/whatsapp/admin/templates";

export const WHATSAPP_TEMPLATES_QUERY_KEY = ["whatsapp-templates"] as const;
export const WHATSAPP_TEMPLATE_VARIABLES_QUERY_KEY = ["whatsapp-template-variables"] as const;

export type WhatsAppTemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";
export type WhatsAppTemplateParameterFormat = "NAMED" | "POSITIONAL";
export type WhatsAppTemplateComponent = Record<string, unknown>;
export type WhatsAppTemplateBookingBindings = {
  buttons?: Record<string, string[]>;
};

export type WhatsAppTemplateDefinition = {
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  parameterFormat: WhatsAppTemplateParameterFormat;
  messageSendTtlSeconds: number | null;
  components: WhatsAppTemplateComponent[];
  bookingBindings?: WhatsAppTemplateBookingBindings;
};

export type WhatsAppManagedTemplate = WhatsAppTemplateDefinition & {
  id?: number;
  metaTemplateId: string;
  status: string;
  qualityScore: string | null;
  previousCategory?: string | null;
  correctCategory?: string | null;
  rejectedReason: string | null;
  reasonInfo: string | null;
  recommendationInfo: string | null;
  providerUpdatedAt?: string | null;
  lastSyncedAt: string | null;
  localState?: string | null;
  bookingPreviewSupported: boolean;
  bookingSendSupported: boolean;
  bookingSupportReason: string | null;
};

export type WhatsAppTemplateVariable = {
  key: string;
  label: string;
  description: string;
  source: string;
  dataType: "text" | "date" | "time" | "integer" | "money" | string;
  sampleValue: string;
  sensitivity: "customer" | "booking" | "financial" | string;
  nullable: boolean;
  value?: string | null;
  missing?: boolean;
};

export type WhatsAppTemplateBooking = {
  id: number;
  reference: string;
  guestName: string;
  productName: string;
  experienceAt: string | null;
  phoneSuffix: string | null;
};

export type WhatsAppTemplatePreviewButton = {
  type: string;
  text: string;
  url?: string;
  phoneNumber?: string;
};

export type WhatsAppTemplatePreview = {
  header: { format: string; text: string | null } | null;
  body: string;
  footer: string | null;
  buttons: WhatsAppTemplatePreviewButton[];
  variables: WhatsAppTemplateVariable[];
  missingVariables: string[];
};

export type WhatsAppTemplateEvent = {
  id: number | string;
  eventType: string;
  eventValue: string | null;
  previousValue: string | null;
  source: string;
  payload?: Record<string, unknown> | null;
  occurredAt: string;
};

export type WhatsAppTemplateWritePayload = WhatsAppTemplateDefinition & {
  password: string;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fromEnvelope = <T>(value: unknown, key: string): T => {
  if (isRecord(value) && key in value) return value[key] as T;
  return value as T;
};

const requireArray = <T>(value: unknown, key: string): T[] => {
  const result = fromEnvelope<unknown>(value, key);
  if (!Array.isArray(result)) throw new Error(`The WhatsApp ${key} response is invalid.`);
  return result as T[];
};

export const fetchWhatsAppTemplates = async (): Promise<WhatsAppManagedTemplate[]> => {
  const response = await axiosInstance.get(BASE_PATH);
  return requireArray<WhatsAppManagedTemplate>(response.data, "templates");
};

export const syncWhatsAppTemplates = async (password: string): Promise<WhatsAppManagedTemplate[]> => {
  const response = await axiosInstance.post(`${BASE_PATH}/sync`, { password });
  return requireArray<WhatsAppManagedTemplate>(response.data, "templates");
};

export const createWhatsAppTemplate = async (
  payload: WhatsAppTemplateWritePayload,
): Promise<WhatsAppManagedTemplate> => {
  const response = await axiosInstance.post(BASE_PATH, payload);
  return fromEnvelope<WhatsAppManagedTemplate>(response.data, "template");
};

export const updateWhatsAppTemplate = async (
  metaTemplateId: string,
  payload: WhatsAppTemplateWritePayload,
): Promise<WhatsAppManagedTemplate> => {
  const response = await axiosInstance.put(
    `${BASE_PATH}/${encodeURIComponent(metaTemplateId)}`,
    payload,
  );
  return fromEnvelope<WhatsAppManagedTemplate>(response.data, "template");
};

export const deleteWhatsAppTemplate = async (
  metaTemplateId: string,
  name: string,
  password: string,
): Promise<void> => {
  await axiosInstance.delete(`${BASE_PATH}/${encodeURIComponent(metaTemplateId)}`, {
    data: { name, password },
  });
};

const changeArchiveState = async (
  action: "archive" | "unarchive",
  templateIds: string[],
  password: string,
): Promise<WhatsAppManagedTemplate[]> => {
  const response = await axiosInstance.post(`${BASE_PATH}/${action}`, {
    templateIds,
    password,
  });
  return requireArray<WhatsAppManagedTemplate>(response.data, "templates");
};

export const archiveWhatsAppTemplates = (templateIds: string[], password: string) =>
  changeArchiveState("archive", templateIds, password);

export const unarchiveWhatsAppTemplates = (templateIds: string[], password: string) =>
  changeArchiveState("unarchive", templateIds, password);

export const unpauseWhatsAppTemplate = async (
  metaTemplateId: string,
  password: string,
): Promise<WhatsAppManagedTemplate> => {
  const response = await axiosInstance.post(
    `${BASE_PATH}/${encodeURIComponent(metaTemplateId)}/unpause`,
    { password },
  );
  return fromEnvelope<WhatsAppManagedTemplate>(response.data, "template");
};

export const fetchWhatsAppTemplateVariables = async (): Promise<WhatsAppTemplateVariable[]> => {
  const response = await axiosInstance.get(`${BASE_PATH}/variables`);
  return requireArray<WhatsAppTemplateVariable>(response.data, "variables");
};

export const searchWhatsAppTemplateBookings = async (
  query: string,
): Promise<WhatsAppTemplateBooking[]> => {
  const response = await axiosInstance.post(`${BASE_PATH}/bookings/search`, { q: query });
  return requireArray<WhatsAppTemplateBooking>(response.data, "bookings");
};

export const previewWhatsAppTemplate = async (payload: {
  metaTemplateId?: string;
  definition?: WhatsAppTemplateDefinition;
  bookingId?: number | null;
}): Promise<WhatsAppTemplatePreview> => {
  const response = await axiosInstance.post(`${BASE_PATH}/preview`, payload);
  return fromEnvelope<WhatsAppTemplatePreview>(response.data, "preview");
};

export const sendManagedWhatsAppTemplate = async (
  metaTemplateId: string,
  payload: { password: string; bookingId: number; recipient?: string },
): Promise<{ messageId: string }> => {
  const response = await axiosInstance.post(
    `${BASE_PATH}/${encodeURIComponent(metaTemplateId)}/send`,
    payload,
  );
  return fromEnvelope<{ messageId: string }>(response.data, "send");
};

export const fetchWhatsAppTemplateEvents = async (
  metaTemplateId: string,
): Promise<WhatsAppTemplateEvent[]> => {
  const response = await axiosInstance.get(
    `${BASE_PATH}/${encodeURIComponent(metaTemplateId)}/events`,
  );
  return requireArray<WhatsAppTemplateEvent>(response.data, "events");
};
