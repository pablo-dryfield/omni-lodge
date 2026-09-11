import axiosInstance from "../utils/axiosInstance";
import type { WhatsAppEmbeddedSignupSession } from "../utils/metaWhatsAppSignup";

const ADMIN_BASE_PATH = "/integrations/whatsapp/admin";
export const WHATSAPP_ADMIN_STATUS_QUERY_KEY = ["whatsapp-admin-status"] as const;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {});

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const firstBoolean = (...values: unknown[]): boolean | null => {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
};

export type WhatsAppAdminStatus = {
  available: boolean;
  connectionStatus: string;
  webhookSubscriptionStatus: "verified" | "missing" | "unknown";
  coexistenceVerified: boolean;
  launchConfigured: boolean;
  webhookVerifyTokenConfigured: boolean;
  metaAppSecretConfigured: boolean;
  tokenConfigured: boolean;
  wabaConfigured: boolean;
  phoneNumberConfigured: boolean;
  wabaId: string | null;
  phoneNumberId: string | null;
  latestAttemptId: string | null;
  onboardingStatus: string | null;
  appStateSyncStatus: string | null;
  historyDispatchStatus: string | null;
  historySyncStatus: string | null;
  recoveryRequired: boolean;
  lastErrorCode: string | null;
  updatedAt: string | null;
};

export type WhatsAppEmbeddedSignupAttempt = {
  id: string;
  nonce: string;
  expiresAt: string;
  launch: {
    appId: string;
    configId: string;
    graphApiVersion: string;
  };
};

export type CompleteWhatsAppEmbeddedSignupPayload = {
  nonce: string;
  code: string;
  session: WhatsAppEmbeddedSignupSession;
};

export type SendWhatsAppTemplateMessagePayload = {
  password: string;
  recipient: string;
  templateName: string;
  languageCode: string;
};

export type WhatsAppTemplateMessageAcceptance = {
  messageId: string;
};

export type WhatsAppWebhookSubscriptionRepairResult = {
  repaired: boolean;
  status: WhatsAppAdminStatus;
};

export type WhatsAppOutboundTemplate = {
  name: string;
  language: string;
  category: string;
};

export const WHATSAPP_OUTBOUND_TEMPLATES_QUERY_KEY = ["whatsapp-outbound-templates"] as const;

export const normalizeWhatsAppAdminStatus = (payload: unknown): WhatsAppAdminStatus => {
  const response = asRecord(payload);
  const root = isRecord(response.status) ? response.status : response;
  const connection = asRecord(root.connection);
  const source = asRecord(root.source);
  const onboarding = asRecord(root.onboarding);
  const sync = asRecord(root.sync);
  const configuration = asRecord(root.configuration);
  const latestAttempt = asRecord(root.latestAttempt);
  const connected = firstBoolean(root.connected, connection.connected);

  const connectionStatus = firstString(
    root.connectionStatus,
    connection.status,
    source.status,
    typeof root.status === "string" ? root.status : null,
  ) ?? (connected ? "connected" : "unavailable");
  const wabaId = firstString(root.wabaId, connection.wabaId, configuration.wabaId);
  const phoneNumberId = firstString(
    root.phoneNumberId,
    connection.phoneNumberId,
    configuration.phoneNumberId,
  );
  const rawWebhookSubscriptionStatus = firstString(
    root.webhookSubscriptionStatus,
    connection.webhookSubscriptionStatus,
    configuration.webhookSubscriptionStatus,
  )?.toLowerCase();
  const webhookSubscriptionStatus = (
    rawWebhookSubscriptionStatus === "verified"
    || rawWebhookSubscriptionStatus === "missing"
  )
    ? rawWebhookSubscriptionStatus
    : "unknown";

  return {
    available: firstBoolean(source.available, root.available, root.connected) ?? connectionStatus === "connected",
    connectionStatus: connected ? "connected" : connectionStatus,
    webhookSubscriptionStatus,
    coexistenceVerified: firstBoolean(root.coexistenceVerified) ?? false,
    launchConfigured: firstBoolean(configuration.launchConfigured) ?? false,
    webhookVerifyTokenConfigured:
      firstBoolean(configuration.webhookVerifyTokenConfigured) ?? false,
    metaAppSecretConfigured: firstBoolean(configuration.metaAppSecretConfigured) ?? false,
    tokenConfigured: firstBoolean(
      root.tokenConfigured,
      connection.tokenConfigured,
      configuration.tokenConfigured,
      configuration.businessAccessTokenConfigured,
    ) ?? false,
    wabaConfigured: firstBoolean(root.wabaConfigured, configuration.wabaConfigured) ?? Boolean(wabaId),
    phoneNumberConfigured:
      firstBoolean(root.phoneNumberConfigured, configuration.phoneNumberConfigured) ?? Boolean(phoneNumberId),
    wabaId,
    phoneNumberId,
    latestAttemptId: firstString(root.latestAttemptId, latestAttempt.id),
    onboardingStatus: firstString(root.onboardingStatus, onboarding.status, latestAttempt.status),
    appStateSyncStatus: firstString(
      root.appStateSyncStatus,
      sync.appStateStatus,
      sync.appStateSyncStatus,
      onboarding.appStateSyncStatus,
      latestAttempt.appStateSyncStatus,
    ),
    historyDispatchStatus: firstString(
      root.historyDispatchStatus,
      latestAttempt.historySyncStatus,
    ),
    historySyncStatus: firstString(
      source.historySyncStatus,
      root.historySyncStatus,
      sync.historyStatus,
      sync.historySyncStatus,
      latestAttempt.historySyncStatus,
    ),
    recoveryRequired: firstBoolean(root.recoveryRequired, latestAttempt.recoveryRequired) ?? false,
    lastErrorCode: firstString(
      root.lastErrorCode,
      connection.lastErrorCode,
      onboarding.lastErrorCode,
      latestAttempt.errorCode,
    ),
    updatedAt: firstString(
      root.updatedAt,
      connection.updatedAt,
      onboarding.updatedAt,
      latestAttempt.completedAt,
      latestAttempt.createdAt,
    ),
  };
};

const normalizeEmbeddedSignupAttempt = (payload: unknown): WhatsAppEmbeddedSignupAttempt => {
  const response = asRecord(payload);
  const attempt = isRecord(response.attempt) ? response.attempt : response;
  const launch = isRecord(response.launch)
    ? response.launch
    : isRecord(attempt.launch)
      ? attempt.launch
      : isRecord(response.meta)
        ? response.meta
        : response;

  const id = firstString(attempt.id, attempt.attemptId, response.attemptId);
  const nonce = firstString(attempt.nonce, response.nonce);
  const expiresAt = firstString(attempt.expiresAt, response.expiresAt);
  const appId = firstString(launch.appId, launch.app_id);
  const configId = firstString(launch.configId, launch.config_id);
  const graphApiVersion = firstString(
    launch.graphApiVersion,
    launch.graphVersion,
    launch.version,
  );

  if (!id || !nonce || !expiresAt || !appId || !configId || !graphApiVersion) {
    throw new Error("The WhatsApp setup response is incomplete. Check the Meta configuration and try again.");
  }

  return {
    id,
    nonce,
    expiresAt,
    launch: { appId, configId, graphApiVersion },
  };
};

export const fetchWhatsAppAdminStatus = async (): Promise<WhatsAppAdminStatus> => {
  const response = await axiosInstance.get(`${ADMIN_BASE_PATH}/status`);
  return normalizeWhatsAppAdminStatus(response.data);
};

export const repairWhatsAppWebhookSubscription = async (
  password: string,
): Promise<WhatsAppWebhookSubscriptionRepairResult> => {
  const response = await axiosInstance.post(`${ADMIN_BASE_PATH}/webhook-subscription/repair`, {
    password,
  });
  const root = asRecord(response.data);
  return {
    repaired: firstBoolean(root.repaired) ?? false,
    status: normalizeWhatsAppAdminStatus(root.status),
  };
};

export const prepareWhatsAppEmbeddedSignup = async (
  password: string,
  reconnectAfterOffboarding = false,
): Promise<WhatsAppEmbeddedSignupAttempt> => {
  const response = await axiosInstance.post(`${ADMIN_BASE_PATH}/embedded-signup/attempts`, {
    password,
    reconnectAfterOffboarding,
  });
  return normalizeEmbeddedSignupAttempt(response.data);
};

export const completeWhatsAppEmbeddedSignup = async (
  attemptId: string,
  payload: CompleteWhatsAppEmbeddedSignupPayload,
): Promise<WhatsAppAdminStatus> => {
  const response = await axiosInstance.post(
    `${ADMIN_BASE_PATH}/embedded-signup/attempts/${encodeURIComponent(attemptId)}/complete`,
    payload,
  );
  return normalizeWhatsAppAdminStatus(response.data);
};

export const sendWhatsAppTemplateMessage = async (
  payload: SendWhatsAppTemplateMessagePayload,
): Promise<WhatsAppTemplateMessageAcceptance> => {
  const response = await axiosInstance.post(`${ADMIN_BASE_PATH}/messages/template`, payload);
  const root = asRecord(response.data);
  const messageId = firstString(root.messageId);
  const hasControlCharacter = messageId
    ?.split("")
    .some((character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f);
  if (!messageId || messageId.length > 512 || hasControlCharacter) {
    throw new Error("Meta accepted the request but returned an invalid message reference. Check WhatsApp before retrying.");
  }
  return { messageId };
};

export const fetchWhatsAppOutboundTemplates = async (): Promise<WhatsAppOutboundTemplate[]> => {
  const response = await axiosInstance.get(`${ADMIN_BASE_PATH}/messages/templates`);
  const root = asRecord(response.data);
  if (!Array.isArray(root.templates)) {
    throw new Error("The approved WhatsApp template list is unavailable.");
  }
  return root.templates.map((value) => {
    const template = asRecord(value);
    const name = firstString(template.name);
    const language = firstString(template.language);
    const category = firstString(template.category);
    if (!name || !language || !category) {
      throw new Error("The approved WhatsApp template list is invalid.");
    }
    return { name, language, category };
  });
};
