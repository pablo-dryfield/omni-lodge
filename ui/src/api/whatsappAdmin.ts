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

  return {
    available: firstBoolean(source.available, root.available, root.connected) ?? connectionStatus === "connected",
    connectionStatus: connected ? "connected" : connectionStatus,
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

export const prepareWhatsAppEmbeddedSignup = async (
  password: string,
): Promise<WhatsAppEmbeddedSignupAttempt> => {
  const response = await axiosInstance.post(`${ADMIN_BASE_PATH}/embedded-signup/attempts`, { password });
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
