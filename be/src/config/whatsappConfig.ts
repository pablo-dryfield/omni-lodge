export const DEFAULT_WHATSAPP_RETENTION_DAYS = 7;
export const DEFAULT_WHATSAPP_ONBOARDING_GENERATION = '1';
export const MAX_WHATSAPP_QUEUE_PREVIOUS_KEYS = 3;

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

type WhatsAppEnvironment = Readonly<Record<string, string | undefined>>;

const requireEnvironmentValue = (
  environment: WhatsAppEnvironment,
  key: keyof NodeJS.ProcessEnv,
): string => {
  const value = environment[key]?.trim();
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

export const resolveWhatsAppOnboardingGeneration = (
  environment: WhatsAppEnvironment = process.env,
): string => parseIdentifier(
  environment.WHATSAPP_ONBOARDING_GENERATION ?? DEFAULT_WHATSAPP_ONBOARDING_GENERATION,
  'WHATSAPP_ONBOARDING_GENERATION',
);

export const getWhatsAppWebhookQueueConfig = (
  environment: WhatsAppEnvironment = process.env,
): WhatsAppWebhookQueueConfig => {
  const activeKeyId = parseIdentifier(
    requireEnvironmentValue(environment, 'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID'),
    'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID',
  );
  const activeKey = parseQueueEncryptionKey(
    requireEnvironmentValue(environment, 'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY'),
    'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY',
  );
  const decryptionKeys = new Map<string, Buffer>([[activeKeyId, activeKey]]);
  const previousEntries = (environment.WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS ?? '')
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
  environment: WhatsAppEnvironment = process.env,
): WhatsAppConfig => ({
  webhookVerifyToken: requireEnvironmentValue(environment, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
  metaAppSecret: requireEnvironmentValue(environment, 'WHATSAPP_META_APP_SECRET'),
  wabaId: requireEnvironmentValue(environment, 'WHATSAPP_WABA_ID'),
  phoneNumberId: requireEnvironmentValue(environment, 'WHATSAPP_PHONE_NUMBER_ID'),
  briefApiToken: requireEnvironmentValue(environment, 'WHATSAPP_BRIEF_API_TOKEN'),
  retentionDays: parseRetentionDays(environment.WHATSAPP_RETENTION_DAYS),
});

export const getWhatsAppWebhookConfig = (
  environment: WhatsAppEnvironment = process.env,
): WhatsAppWebhookConfig => ({
  verifyToken: requireEnvironmentValue(environment, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
  appSecret: requireEnvironmentValue(environment, 'WHATSAPP_META_APP_SECRET'),
  wabaId: requireEnvironmentValue(environment, 'WHATSAPP_WABA_ID'),
  phoneNumberId: requireEnvironmentValue(environment, 'WHATSAPP_PHONE_NUMBER_ID'),
  retentionDays: parseRetentionDays(environment.WHATSAPP_RETENTION_DAYS),
});

export const getWhatsAppBriefConfig = (
  environment: WhatsAppEnvironment = process.env,
): WhatsAppBriefConfig => ({
  apiToken: requireEnvironmentValue(environment, 'WHATSAPP_BRIEF_API_TOKEN'),
  retentionDays: parseRetentionDays(environment.WHATSAPP_RETENTION_DAYS),
});
