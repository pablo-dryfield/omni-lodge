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
    return definition.defaultValue ?? null;
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

  if (typeof rules.maxLength === 'number' && raw.length > rules.maxLength) {
    throw new HttpError(400, `${definition.key} exceeds max length of ${rules.maxLength}`);
  }

  if (definition.valueType === 'number') {
    const numeric = coerceNumber(raw);
    if (numeric == null) {
      throw new HttpError(400, `${definition.key} must be a number`);
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
    configCache.clear();

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

      configCache.set(entry.key, {
        value,
        updatedAt: entry.updatedAt ?? null,
        updatedBy: entry.updatedBy ?? null,
      });
    });

    cacheLoaded = true;
  } catch (error) {
    logger.warn('[config] Failed to refresh config cache. Falling back to environment values.', error);
    configCache.clear();
    cacheLoaded = false;
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
  const cached = configCache.get(key);
  if (cached && cached.value !== null) {
    return cached.value;
  }
  return resolveFallbackRaw(definition);
};

export const getConfigValue = (key: string): unknown => {
  const definition = resolveDefinition(key);
  const raw = getConfigValueRaw(key);
  return parseValue(definition, raw);
};

export const listConfigEntries = async (): Promise<Array<Record<string, unknown>>> => {
  const keys = await ConfigKey.findAll({ order: [['category', 'ASC'], ['label', 'ASC']] });
  const values = await ConfigValue.findAll();
  const valueMap = new Map(values.map((entry) => [entry.key, entry]));

  return keys.map((entry) => {
    const valueRecord = valueMap.get(entry.key);
    const isSecret = entry.isSecret;
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
      maskedValue: isSecret ? (valueRecord ? '********' : null) : null,
      isSet: valueRecord != null,
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
    maskedValue: record.isSecret ? (valueRecord ? '********' : null) : null,
    isSet: valueRecord != null,
    updatedAt: valueRecord?.updatedAt ?? null,
    updatedBy: valueRecord?.updatedBy ?? null,
    fallbackValue: cacheLoaded ? null : resolveFallbackRaw(definition),
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

  if (definition.isSecret) {
    if (!rawValue) {
      await ConfigValue.destroy({ where: { key: params.key } });
    } else {
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
    }
  } else {
    if (!rawValue) {
      await ConfigValue.destroy({ where: { key: params.key } });
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
        updatedBy: params.actorId ?? null,
      });
    }
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
    value: definition.isSecret ? rawValue : rawValue,
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
