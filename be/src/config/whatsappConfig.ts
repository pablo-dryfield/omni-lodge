import { getConfigValueRaw, hasConfigValueOverride } from '../services/configService.js';

export const DEFAULT_WHATSAPP_RETENTION_DAYS = 7;
export const DEFAULT_WHATSAPP_ONBOARDING_GENERATION = '1';
export const MAX_WHATSAPP_QUEUE_PREVIOUS_KEYS = 3;
export const MAX_WHATSAPP_QUEUE_KEYRING_KEYS = 4;

export interface WhatsAppConfig {
  webhookVerifyToken: string;
  metaAppSecret: string;
  wabaId: string;
  phoneNumberId: string;
  briefApiToken: string;
  retentionDays: number;
}

export interface WhatsAppWebhookConfig {
  verifyToken: string;
  appSecret: string;
  wabaId: string;
  phoneNumberId: string;
  retentionDays: number;
}

export interface WhatsAppWebhookVerificationConfig {
  verifyToken: string;
}

export interface WhatsAppEmbeddedSignupConfig {
  appId: string;
  appSecret: string;
  configId: string;
  graphApiVersion: string;
}

export interface WhatsAppBriefConfig {
  apiToken: string;
  retentionDays: number;
}

export interface WhatsAppQueueEncryptionKey {
  id: string;
  material: Buffer;
}

export interface WhatsAppWebhookQueueConfig {
  activeKey: WhatsAppQueueEncryptionKey;
  decryptionKeys: ReadonlyMap<string, Buffer>;
}

export class WhatsAppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppConfigError';
  }
}

export type WhatsAppEnvironment = Readonly<Record<string, string | undefined>>;

export type WhatsAppConfigKey =
  | 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'
  | 'WHATSAPP_META_APP_ID'
  | 'WHATSAPP_META_APP_SECRET'
  | 'WHATSAPP_META_GRAPH_API_VERSION'
  | 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID'
  | 'WHATSAPP_BUSINESS_ACCESS_TOKEN'
  | 'WHATSAPP_WABA_ID'
  | 'WHATSAPP_PHONE_NUMBER_ID'
  | 'WHATSAPP_BRIEF_API_TOKEN'
  | 'WHATSAPP_ONBOARDING_GENERATION'
  | 'WHATSAPP_WEBHOOK_QUEUE_KEYRING'
  | 'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID'
  | 'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY'
  | 'WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS'
  | 'WHATSAPP_CONTACT_HASH_KEY'
  | 'WHATSAPP_RETENTION_DAYS'
  | 'WHATSAPP_SOURCE_STALE_HOURS';

export const getWhatsAppConfigValue = (
  key: WhatsAppConfigKey,
  environment?: WhatsAppEnvironment,
): string | undefined => {
  if (environment !== undefined) {
    return environment[key];
  }
  return getConfigValueRaw(key) ?? undefined;
};

const requireConfigValue = (
  key: WhatsAppConfigKey,
  environment?: WhatsAppEnvironment,
): string => {
  const value = getWhatsAppConfigValue(key, environment)?.trim();
  if (!value) {
    throw new WhatsAppConfigError(`Missing required WhatsApp configuration: ${key}`);
  }
  return value;
};

const parseRetentionDays = (value: string | undefined): number => {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_WHATSAPP_RETENTION_DAYS;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new WhatsAppConfigError('WHATSAPP_RETENTION_DAYS must be a positive integer');
  }

  const retentionDays = Number(normalized);
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    throw new WhatsAppConfigError('WHATSAPP_RETENTION_DAYS must be a positive integer');
  }

  return retentionDays;
};

const parseIdentifier = (value: string, environmentName: string): string => {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(normalized)) {
    throw new WhatsAppConfigError(
      `${environmentName} must contain 1-64 letters, numbers, dots, underscores, or hyphens`,
    );
  }
  return normalized;
};

const parseQueueEncryptionKey = (value: string, environmentName: string): Buffer => {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(normalized)) {
    throw new WhatsAppConfigError(`${environmentName} must be a base64-encoded 32-byte key`);
  }
  const material = Buffer.from(normalized, 'base64');
  if (material.length !== 32 || material.toString('base64') !== normalized) {
    throw new WhatsAppConfigError(`${environmentName} must be a base64-encoded 32-byte key`);
  }
  return material;
};

const parseWhatsAppQueueKeyring = (
  value: string,
  configName = 'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
): WhatsAppWebhookQueueConfig => {
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.some((entry) => entry.length === 0)) {
    throw new WhatsAppConfigError(`${configName} must use key-id=base64-key entries`);
  }
  if (entries.length > MAX_WHATSAPP_QUEUE_KEYRING_KEYS) {
    throw new WhatsAppConfigError(
      `${configName} supports at most ${MAX_WHATSAPP_QUEUE_KEYRING_KEYS} keys`,
    );
  }

  const keys: WhatsAppQueueEncryptionKey[] = [];
  const keyIds = new Set<string>();
  entries.forEach((entry, index) => {
    const separator = entry.indexOf('=');
    if (separator <= 0) {
      throw new WhatsAppConfigError(`${configName} must use key-id=base64-key entries`);
    }
    const id = parseIdentifier(entry.slice(0, separator), `${configName} entry ${index + 1} key ID`);
    if (keyIds.has(id)) {
      throw new WhatsAppConfigError(`Duplicate WhatsApp queue encryption key ID: ${id}`);
    }
    keyIds.add(id);
    keys.push({
      id,
      material: parseQueueEncryptionKey(
        entry.slice(separator + 1),
        `${configName} entry ${index + 1}`,
      ),
    });
  });

  const activeKey = keys[0];
  if (!activeKey) {
    throw new WhatsAppConfigError(`Missing required WhatsApp configuration: ${configName}`);
  }
  return {
    activeKey,
    decryptionKeys: new Map(keys.map((key) => [key.id, key.material])),
  };
};

export const resolveWhatsAppOnboardingGeneration = (
  environment?: WhatsAppEnvironment,
): string => parseIdentifier(
  getWhatsAppConfigValue('WHATSAPP_ONBOARDING_GENERATION', environment)
    ?? DEFAULT_WHATSAPP_ONBOARDING_GENERATION,
  'WHATSAPP_ONBOARDING_GENERATION',
);

export const getWhatsAppWebhookQueueConfig = (
  environment?: WhatsAppEnvironment,
): WhatsAppWebhookQueueConfig => {
  const compositeKeyring = getWhatsAppConfigValue(
    'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
    environment,
  )?.trim();
  if (compositeKeyring) {
    return parseWhatsAppQueueKeyring(compositeKeyring);
  }
  if (
    environment === undefined
    && hasConfigValueOverride('WHATSAPP_WEBHOOK_QUEUE_KEYRING')
  ) {
    throw new WhatsAppConfigError(
      'Missing required WhatsApp configuration: WHATSAPP_WEBHOOK_QUEUE_KEYRING',
    );
  }

  const activeKeyId = parseIdentifier(
    requireConfigValue('WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID', environment),
    'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID',
  );
  const activeKey = parseQueueEncryptionKey(
    requireConfigValue('WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY', environment),
    'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY',
  );
  const decryptionKeys = new Map<string, Buffer>([[activeKeyId, activeKey]]);
  const previousEntries = (getWhatsAppConfigValue(
    'WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS',
    environment,
  ) ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (previousEntries.length > MAX_WHATSAPP_QUEUE_PREVIOUS_KEYS) {
    throw new WhatsAppConfigError(
      `WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS supports at most ${MAX_WHATSAPP_QUEUE_PREVIOUS_KEYS} keys`,
    );
  }

  previousEntries.forEach((entry, index) => {
    const separator = entry.indexOf('=');
    if (separator <= 0) {
      throw new WhatsAppConfigError(
        'WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS must use key-id=base64-key entries',
      );
    }
    const id = parseIdentifier(
      entry.slice(0, separator),
      `WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS entry ${index + 1} key ID`,
    );
    if (decryptionKeys.has(id)) {
      throw new WhatsAppConfigError(`Duplicate WhatsApp queue encryption key ID: ${id}`);
    }
    decryptionKeys.set(
      id,
      parseQueueEncryptionKey(
        entry.slice(separator + 1),
        `WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS entry ${index + 1}`,
      ),
    );
  });

  return {
    activeKey: { id: activeKeyId, material: activeKey },
    decryptionKeys,
  };
};

export const loadWhatsAppConfig = (
  environment?: WhatsAppEnvironment,
): WhatsAppConfig => ({
  webhookVerifyToken: requireConfigValue('WHATSAPP_WEBHOOK_VERIFY_TOKEN', environment),
  metaAppSecret: requireConfigValue('WHATSAPP_META_APP_SECRET', environment),
  wabaId: requireConfigValue('WHATSAPP_WABA_ID', environment),
  phoneNumberId: requireConfigValue('WHATSAPP_PHONE_NUMBER_ID', environment),
  briefApiToken: requireConfigValue('WHATSAPP_BRIEF_API_TOKEN', environment),
  retentionDays: parseRetentionDays(getWhatsAppConfigValue('WHATSAPP_RETENTION_DAYS', environment)),
});

export const getWhatsAppWebhookConfig = (
  environment?: WhatsAppEnvironment,
): WhatsAppWebhookConfig => ({
  verifyToken: requireConfigValue('WHATSAPP_WEBHOOK_VERIFY_TOKEN', environment),
  appSecret: requireConfigValue('WHATSAPP_META_APP_SECRET', environment),
  wabaId: requireConfigValue('WHATSAPP_WABA_ID', environment),
  phoneNumberId: requireConfigValue('WHATSAPP_PHONE_NUMBER_ID', environment),
  retentionDays: parseRetentionDays(getWhatsAppConfigValue('WHATSAPP_RETENTION_DAYS', environment)),
});

export const getWhatsAppWebhookVerificationConfig = (
  environment?: WhatsAppEnvironment,
): WhatsAppWebhookVerificationConfig => ({
  verifyToken: requireConfigValue('WHATSAPP_WEBHOOK_VERIFY_TOKEN', environment),
});

export const getWhatsAppEmbeddedSignupConfig = (
  environment?: WhatsAppEnvironment,
): WhatsAppEmbeddedSignupConfig => ({
  appId: requireConfigValue('WHATSAPP_META_APP_ID', environment),
  appSecret: requireConfigValue('WHATSAPP_META_APP_SECRET', environment),
  configId: requireConfigValue('WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID', environment),
  graphApiVersion: requireConfigValue('WHATSAPP_META_GRAPH_API_VERSION', environment),
});

export const getWhatsAppBriefConfig = (
  environment?: WhatsAppEnvironment,
): WhatsAppBriefConfig => ({
  apiToken: requireConfigValue('WHATSAPP_BRIEF_API_TOKEN', environment),
  retentionDays: parseRetentionDays(getWhatsAppConfigValue('WHATSAPP_RETENTION_DAYS', environment)),
});
