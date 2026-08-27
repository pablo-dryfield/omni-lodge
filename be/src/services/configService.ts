import ConfigKey from '../models/ConfigKey.js';
import ConfigValue from '../models/ConfigValue.js';
import ConfigHistory from '../models/ConfigHistory.js';
import logger from '../utils/logger.js';
import type ConfigSeedRun from '../models/ConfigSeedRun.js';
import { CONFIG_DEFINITION_MAP, CONFIG_DEFINITIONS, type ConfigDefinition } from '../config/appConfigRegistry.js';
import { decryptSecret, encryptSecret } from './configEncryptionService.js';
import HttpError from '../errors/HttpError.js';
import { hasSeedRun, recordSeedRun, listSeedRuns } from './seedRunService.js';

const DEFAULT_SEED_KEY = 'defaults';
const AUTO_SEED_RUN_TYPE = 'auto';
const MANUAL_SEED_RUN_TYPE = 'manual';

type ConfigCacheEntry = {
  value: string | null;
  updatedAt: Date | null;
  updatedBy: number | null;
};

const configCache = new Map<string, ConfigCacheEntry>();
let cacheLoaded = false;

const normalizeEnvValue = (value: string | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const coerceBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return null;
};

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const serializeValue = (definition: ConfigDefinition, value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  switch (definition.valueType) {
    case 'boolean': {
      const normalized = coerceBoolean(value);
      return normalized === null ? null : normalized ? 'true' : 'false';
    }
    case 'number': {
      const normalized = coerceNumber(value);
      return normalized === null ? null : `${normalized}`;
    }
    case 'json': {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      try {
        return JSON.stringify(value);
      } catch {
        return null;
      }
    }
    case 'enum':
    case 'string':
    default: {
      const asString = typeof value === 'string' ? value : String(value);
      const trimmed = asString.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
};

const parseValue = (definition: ConfigDefinition, raw: string | null): unknown => {
  if (raw === null || raw === undefined) {
    return null;
  }

  switch (definition.valueType) {
    case 'boolean': {
      const normalized = coerceBoolean(raw);
      return normalized ?? definition.defaultValue ?? null;
    }
    case 'number': {
      const normalized = coerceNumber(raw);
      return normalized ?? definition.defaultValue ?? null;
    }
    case 'json': {
      try {
        return JSON.parse(raw);
      } catch {
        return definition.defaultValue ?? null;
      }
    }
    case 'enum':
    case 'string':
    default:
      return raw;
  }
};

const isTimezone = (value: string): boolean => {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const isBase64Encoded32ByteKey = (value: string): boolean => {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    return false;
  }
  const material = Buffer.from(value, 'base64');
  return material.length === 32 && material.toString('base64') === value;
};

const validateWhatsAppQueueKeyEntries = (
  definition: ConfigDefinition,
  raw: string,
  maxEntries: number,
): void => {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim());
  if (entries.some((entry) => entry.length === 0)) {
    throw new HttpError(
      400,
      `${definition.key} must use key-id=base64-encoded-32-byte-key entries`,
    );
  }
  if (entries.length > maxEntries) {
    throw new HttpError(400, `${definition.key} supports at most ${maxEntries} keys`);
  }

  const keyIds = new Set<string>();
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    const keyId = separator > 0 ? entry.slice(0, separator).trim() : '';
    const keyMaterial = separator > 0 ? entry.slice(separator + 1).trim() : '';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || !isBase64Encoded32ByteKey(keyMaterial)) {
      throw new HttpError(
        400,
        `${definition.key} must use key-id=base64-encoded-32-byte-key entries`,
      );
    }
    if (keyIds.has(keyId)) {
      throw new HttpError(400, `${definition.key} contains a duplicate key ID`);
    }
    keyIds.add(keyId);
  }
};

const validateValue = (definition: ConfigDefinition, raw: string | null): void => {
  const rules = definition.validation ?? {};
  if (rules.required && (!raw || raw.length === 0)) {
    throw new HttpError(400, `${definition.key} is required`);
  }

  if (raw == null) {
    return;
  }

  if (definition.valueType === 'enum' && definition.options) {
    if (!definition.options.includes(raw)) {
      throw new HttpError(400, `${definition.key} must be one of: ${definition.options.join(', ')}`);
    }
  }

  if (typeof rules.minLength === 'number' && raw.length < rules.minLength) {
    throw new HttpError(400, `${definition.key} must be at least ${rules.minLength} characters`);
  }

  if (typeof rules.maxLength === 'number' && raw.length > rules.maxLength) {
    throw new HttpError(400, `${definition.key} exceeds max length of ${rules.maxLength}`);
  }

  if (typeof rules.pattern === 'string') {
    const pattern = new RegExp(rules.pattern);
    if (!pattern.test(raw)) {
      const expected = typeof rules.patternDescription === 'string'
        ? rules.patternDescription
        : 'the required format';
      throw new HttpError(400, `${definition.key} must be ${expected}`);
    }
  }

  if (definition.valueType === 'number') {
    const numeric = coerceNumber(raw);
    if (numeric == null) {
      throw new HttpError(400, `${definition.key} must be a number`);
    }
    if (rules.integer === true && !Number.isSafeInteger(numeric)) {
      throw new HttpError(400, `${definition.key} must be an integer`);
    }
    if (typeof rules.min === 'number' && numeric < rules.min) {
      throw new HttpError(400, `${definition.key} must be >= ${rules.min}`);
    }
    if (typeof rules.max === 'number' && numeric > rules.max) {
      throw new HttpError(400, `${definition.key} must be <= ${rules.max}`);
    }
  }

  if (typeof rules.format === 'string') {
    if (rules.format === 'timezone' && !isTimezone(raw)) {
      throw new HttpError(400, `${definition.key} must be a valid IANA timezone`);
    }
    if (rules.format === 'cron') {
      const parts = raw.trim().split(/\s+/);
      if (parts.length < 5) {
        throw new HttpError(400, `${definition.key} must be a valid cron expression`);
      }
    }
    if (rules.format === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw new HttpError(400, `${definition.key} must use YYYY-MM-DD`);
      }
      const parsed = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) {
        throw new HttpError(400, `${definition.key} must be a valid date`);
      }
      const normalized = parsed.toISOString().slice(0, 10);
      if (normalized !== raw) {
        throw new HttpError(400, `${definition.key} must be a valid calendar date`);
      }
    }
    if (rules.format === 'iso-datetime') {
      const parsed = new Date(raw);
      const hasExplicitTimezone =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw);
      if (!hasExplicitTimezone || Number.isNaN(parsed.getTime())) {
        throw new HttpError(400, `${definition.key} must be a valid ISO date and time`);
      }
    }
    if (rules.format === 'base64-32-byte-key' && !isBase64Encoded32ByteKey(raw)) {
      throw new HttpError(400, `${definition.key} must be a base64-encoded 32-byte key`);
    }
    if (rules.format === 'whatsapp-queue-previous-keys') {
      validateWhatsAppQueueKeyEntries(definition, raw, 3);
    }
    if (rules.format === 'whatsapp-queue-keyring') {
      validateWhatsAppQueueKeyEntries(definition, raw, 4);
    }
  }
};

const resolveDefinition = (key: string): ConfigDefinition => {
  const definition = CONFIG_DEFINITION_MAP.get(key);
  if (!definition) {
    throw new HttpError(404, `Config key ${key} is not registered`);
  }
  return definition;
};

const resolveFallbackRaw = (definition: ConfigDefinition): string | null => {
  const envValue = normalizeEnvValue(process.env[definition.key]);
  if (envValue !== null) {
    return envValue;
  }
  if (definition.defaultValue === null || definition.defaultValue === undefined) {
    return null;
  }
  return serializeValue(definition, definition.defaultValue);
};

const buildValidationRules = (definition: ConfigDefinition): Record<string, unknown> | null => {
  const rules = definition.validation ? { ...definition.validation } : {};
  if (definition.options && definition.options.length > 0) {
    rules.options = definition.options;
  }
  return Object.keys(rules).length > 0 ? rules : null;
};

export const syncConfigDefinitions = async (): Promise<void> => {
  const existing = await ConfigKey.findAll();
  const existingMap = new Map(existing.map((entry) => [entry.key, entry]));
  const createdKeys: string[] = [];

  await Promise.all(
    CONFIG_DEFINITIONS.map(async (definition) => {
      const record = existingMap.get(definition.key);
      const defaultValue = serializeValue(definition, definition.defaultValue);
      const validationRules = buildValidationRules(definition);
      if (!record) {
        await ConfigKey.create({
          key: definition.key,
          label: definition.label,
          description: definition.description ?? null,
          category: definition.category,
          valueType: definition.valueType,
          defaultValue,
          validationRules,
          isSecret: Boolean(definition.isSecret),
          isEditable: definition.isEditable ?? true,
          impact: definition.impact ?? 'low',
        });
        createdKeys.push(definition.key);
        return;
      }

      const next = {
        label: definition.label,
        description: definition.description ?? null,
        category: definition.category,
        valueType: definition.valueType,
        defaultValue,
        validationRules,
        isSecret: Boolean(definition.isSecret),
        isEditable: definition.isEditable ?? true,
        impact: definition.impact ?? 'low',
      };
      await record.update(next);
    }),
  );

  if (createdKeys.length > 0) {
    logger.info(`[config] Registered ${createdKeys.length} new config keys`, { keys: createdKeys });
  }
};

export const seedConfigValues = async (): Promise<string[]> => {
  const existing = await ConfigValue.findAll();
  const existingMap = new Map(existing.map((entry) => [entry.key, entry]));
  const seededKeys: string[] = [];

  await Promise.all(
    CONFIG_DEFINITIONS.map(async (definition) => {
      const current = existingMap.get(definition.key);
      if (current) {
        return;
      }

      const seedValue = resolveFallbackRaw(definition);
      if (seedValue === null) {
        return;
      }

      if (definition.isSecret) {
        const encrypted = encryptSecret(seedValue);
        await ConfigValue.create({
          key: definition.key,
          value: null,
          encryptedValue: encrypted.encryptedValue,
          encryptionIv: encrypted.iv,
          encryptionTag: encrypted.tag,
        });
        seededKeys.push(definition.key);
      } else {
        await ConfigValue.create({
          key: definition.key,
          value: seedValue,
        });
        seededKeys.push(definition.key);
      }
    }),
  );

  if (seededKeys.length > 0) {
    logger.info(`[config] Seeded ${seededKeys.length} config values`, { keys: seededKeys });
  }

  return seededKeys;
};

export const refreshConfigCache = async (): Promise<void> => {
  try {
    const values = await ConfigValue.findAll();
    const nextCache = new Map<string, ConfigCacheEntry>();

    values.forEach((entry) => {
      const definition = CONFIG_DEFINITION_MAP.get(entry.key);
      let value: string | null = entry.value ?? null;
      if (definition?.isSecret) {
        if (entry.encryptedValue && entry.encryptionIv && entry.encryptionTag) {
          try {
            value = decryptSecret({
              encryptedValue: entry.encryptedValue,
              iv: entry.encryptionIv,
              tag: entry.encryptionTag,
            });
          } catch (error) {
            logger.error(`[config] Failed to decrypt ${entry.key}`, error);
            value = null;
          }
        } else {
          value = null;
        }
      }

      nextCache.set(entry.key, {
        value,
        updatedAt: entry.updatedAt ?? null,
        updatedBy: entry.updatedBy ?? null,
      });
    });

    configCache.clear();
    nextCache.forEach((entry, key) => configCache.set(key, entry));
    cacheLoaded = true;
  } catch (error) {
    if (cacheLoaded) {
      logger.warn('[config] Failed to refresh config cache. Retaining last known values.', error);
    } else {
      logger.warn('[config] Failed to refresh config cache. Falling back to environment values.', error);
      configCache.clear();
    }
  }
};

export const initializeConfigRegistry = async (): Promise<void> => {
  await syncConfigDefinitions();

  const shouldAutoSeed = !(await hasSeedRun(DEFAULT_SEED_KEY, AUTO_SEED_RUN_TYPE));
  if (shouldAutoSeed) {
    const seededKeys = await seedConfigValues();
    await recordSeedRun({
      seedKey: DEFAULT_SEED_KEY,
      runType: AUTO_SEED_RUN_TYPE,
      seededCount: seededKeys.length,
      seedDetails: { keys: seededKeys },
    });
  }

  await refreshConfigCache();
};

export const restoreMissingConfigValues = async (actorId?: number | null): Promise<string[]> => {
  const seededKeys = await seedConfigValues();
  await recordSeedRun({
    seedKey: DEFAULT_SEED_KEY,
    runType: MANUAL_SEED_RUN_TYPE,
    seededBy: actorId ?? null,
    seededCount: seededKeys.length,
    seedDetails: { keys: seededKeys },
  });
  await refreshConfigCache();
  return seededKeys;
};

export const listConfigSeedRuns = async (limit = 5): Promise<ConfigSeedRun[]> => {
  return listSeedRuns(limit);
};

export const getConfigValueRaw = (key: string): string | null => {
  const definition = resolveDefinition(key);
  if (configCache.has(key)) {
    return configCache.get(key)?.value ?? null;
  }
  return resolveFallbackRaw(definition);
};

export const hasConfigValueOverride = (key: string): boolean => {
  resolveDefinition(key);
  return configCache.has(key);
};

export const getConfigValue = (key: string): unknown => {
  const definition = resolveDefinition(key);
  const raw = getConfigValueRaw(key);
  return parseValue(definition, raw);
};

const hasStoredConfigValue = (
  valueRecord: ConfigValue | null | undefined,
  isSecret: boolean,
): boolean => {
  if (!valueRecord) {
    return false;
  }
  if (isSecret) {
    return Boolean(
      valueRecord.encryptedValue
      && valueRecord.encryptionIv
      && valueRecord.encryptionTag,
    );
  }
  return valueRecord.value !== null && valueRecord.value !== undefined;
};

export const listConfigEntries = async (): Promise<Array<Record<string, unknown>>> => {
  const keys = await ConfigKey.findAll({ order: [['category', 'ASC'], ['label', 'ASC']] });
  const values = await ConfigValue.findAll();
  const valueMap = new Map(values.map((entry) => [entry.key, entry]));

  return keys.map((entry) => {
    const valueRecord = valueMap.get(entry.key);
    const isSecret = entry.isSecret;
    const isSet = hasStoredConfigValue(valueRecord, isSecret);
    const isCleared = Boolean(valueRecord) && !isSet;
    const cacheEntry = configCache.get(entry.key);
    const rawValue = cacheEntry?.value ?? null;
    return {
      key: entry.key,
      label: entry.label,
      description: entry.description,
      category: entry.category,
      valueType: entry.valueType,
      defaultValue: entry.defaultValue,
      validationRules: entry.validationRules,
      isSecret,
      isEditable: entry.isEditable,
      impact: entry.impact,
      value: isSecret ? null : rawValue,
      maskedValue: isSecret && isSet ? '********' : null,
      isSet,
      isCleared,
      updatedAt: valueRecord?.updatedAt ?? null,
      updatedBy: valueRecord?.updatedBy ?? null,
    };
  });
};

export const getConfigDetail = async (key: string): Promise<Record<string, unknown>> => {
  const definition = resolveDefinition(key);
  const record = await ConfigKey.findByPk(key);
  if (!record) {
    throw new HttpError(404, `Config key ${key} not found`);
  }
  const valueRecord = await ConfigValue.findByPk(key);
  const isSet = hasStoredConfigValue(valueRecord, record.isSecret);
  const isCleared = Boolean(valueRecord) && !isSet;
  const cacheEntry = configCache.get(key);
  const rawValue = cacheEntry?.value ?? null;
  return {
    key: record.key,
    label: record.label,
    description: record.description,
    category: record.category,
    valueType: record.valueType,
    defaultValue: record.defaultValue,
    validationRules: record.validationRules,
    isSecret: record.isSecret,
    isEditable: record.isEditable,
    impact: record.impact,
    value: record.isSecret ? null : rawValue,
    maskedValue: record.isSecret && isSet ? '********' : null,
    isSet,
    isCleared,
    updatedAt: valueRecord?.updatedAt ?? null,
    updatedBy: valueRecord?.updatedBy ?? null,
    fallbackValue: cacheLoaded || valueRecord ? null : resolveFallbackRaw(definition),
  };
};

export const updateConfigValue = async (params: {
  key: string;
  value: unknown;
  actorId: number | null;
  reason?: string | null;
}): Promise<Record<string, unknown>> => {
  const definition = resolveDefinition(params.key);
  const record = await ConfigKey.findByPk(params.key);
  if (!record) {
    throw new HttpError(404, `Config key ${params.key} not found`);
  }
  if (!record.isEditable) {
    throw new HttpError(403, `${params.key} cannot be modified`);
  }

  const rawValue = serializeValue(definition, params.value);
  validateValue(definition, rawValue);

  const existing = await ConfigValue.findByPk(params.key);
  const previousRaw = existing ? configCache.get(params.key)?.value ?? null : null;

  if (rawValue === null) {
    const tombstone = {
      value: null,
      encryptedValue: null,
      encryptionIv: null,
      encryptionTag: null,
      updatedBy: params.actorId ?? null,
    };
    if (existing) {
      await existing.update(tombstone);
    } else {
      await ConfigValue.create({ key: params.key, ...tombstone });
    }
  } else if (definition.isSecret) {
    const encrypted = encryptSecret(rawValue);
    if (existing) {
      await existing.update({
        value: null,
        encryptedValue: encrypted.encryptedValue,
        encryptionIv: encrypted.iv,
        encryptionTag: encrypted.tag,
        updatedBy: params.actorId ?? null,
      });
    } else {
      await ConfigValue.create({
        key: params.key,
        value: null,
        encryptedValue: encrypted.encryptedValue,
        encryptionIv: encrypted.iv,
        encryptionTag: encrypted.tag,
        updatedBy: params.actorId ?? null,
      });
    }
  } else if (existing) {
    await existing.update({
      value: rawValue,
      encryptedValue: null,
      encryptionIv: null,
      encryptionTag: null,
      updatedBy: params.actorId ?? null,
    });
  } else {
    await ConfigValue.create({
      key: params.key,
      value: rawValue,
      encryptedValue: null,
      encryptionIv: null,
      encryptionTag: null,
      updatedBy: params.actorId ?? null,
    });
  }

  await ConfigHistory.create({
    key: params.key,
    actorId: params.actorId ?? null,
    oldValue: definition.isSecret ? null : previousRaw,
    newValue: definition.isSecret ? null : rawValue,
    isSecret: Boolean(definition.isSecret),
    reason: params.reason ?? null,
  });

  configCache.set(params.key, {
    value: rawValue,
    updatedAt: new Date(),
    updatedBy: params.actorId ?? null,
  });

  return getConfigDetail(params.key);
};

export const revealConfigSecret = async (key: string): Promise<{ value: string | null }> => {
  const definition = resolveDefinition(key);
  if (!definition.isSecret) {
    throw new HttpError(400, `${key} is not a secret config`);
  }
  const record = await ConfigValue.findByPk(key);
  if (!record || !record.encryptedValue || !record.encryptionIv || !record.encryptionTag) {
    return { value: null };
  }
  const value = decryptSecret({
    encryptedValue: record.encryptedValue,
    iv: record.encryptionIv,
    tag: record.encryptionTag,
  });
  return { value };
};

export const getConfigHistory = async (key: string): Promise<ConfigHistory[]> => {
  await resolveDefinition(key);
  return ConfigHistory.findAll({
    where: { key },
    order: [['created_at', 'DESC']],
    limit: 50,
  });
};
