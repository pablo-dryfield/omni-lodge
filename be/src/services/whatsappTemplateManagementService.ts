import { createHash } from 'node:crypto';
import { Op, UniqueConstraintError } from 'sequelize';
import {
  getWhatsAppEmbeddedSignupConfig,
  WhatsAppConfigError,
} from '../config/whatsappConfig.js';
import HttpError from '../errors/HttpError.js';
import AuditLog from '../models/AuditLog.js';
import Booking from '../models/Booking.js';
import WhatsAppTemplate from '../models/WhatsAppTemplate.js';
import WhatsAppTemplateEvent from '../models/WhatsAppTemplateEvent.js';
import WhatsAppTemplateSend from '../models/WhatsAppTemplateSend.js';
import type { NormalizedWhatsAppTemplateEvent } from '../types/whatsapp.js';
import type {
  WhatsAppTemplateBookingBindings,
  WhatsAppTemplateCategory,
  WhatsAppTemplateComponent,
  WhatsAppTemplateDefinition,
  WhatsAppTemplateJsonValue,
  WhatsAppTemplateParameterFormat,
} from '../types/whatsappTemplates.js';
import logger from '../utils/logger.js';
import { getConfigValueRaw, refreshConfigCacheKeys } from './configService.js';
import {
  WhatsAppMetaGraphClient,
  WhatsAppMetaGraphError,
  type WhatsAppMessageTemplateRecord,
} from './whatsappMetaGraphClient.js';
import {
  buildWhatsAppTemplateSendComponents,
  listWhatsAppTemplateVariables,
  renderWhatsAppTemplatePreview,
} from './whatsappTemplateVariableService.js';

const CONFIG_KEYS = [
  'WHATSAPP_META_APP_ID',
  'WHATSAPP_META_APP_SECRET',
  'WHATSAPP_META_GRAPH_API_VERSION',
  'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID',
  'WHATSAPP_BUSINESS_ACCESS_TOKEN',
  'WHATSAPP_WABA_ID',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const;

const META_ID = /^\d{1,64}$/;
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const LANGUAGE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const NAMED_PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;
const POSITIONAL_PLACEHOLDER = /\{\{([1-9]\d*)\}\}/g;
const ANY_PLACEHOLDER = /\{\{([^{}]+)\}\}/g;
const MAX_COMPONENT_BYTES = 100_000;

type TemplateGraphClient = Pick<
  WhatsAppMetaGraphClient,
  | 'listMessageTemplates'
  | 'getMessageTemplate'
  | 'createMessageTemplate'
  | 'updateMessageTemplate'
  | 'deleteMessageTemplate'
  | 'archiveMessageTemplates'
  | 'unarchiveMessageTemplates'
  | 'unpauseMessageTemplate'
  | 'sendTemplateMessage'
>;

interface TemplateConnection {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  graphClient: TemplateGraphClient;
}

export interface WhatsAppManagedTemplate {
  id: number;
  metaTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  qualityScore: string | null;
  parameterFormat: string;
  components: Record<string, unknown>[];
  bookingBindings: WhatsAppTemplateBookingBindings;
  messageSendTtlSeconds: number | null;
  previousCategory: string | null;
  correctCategory: string | null;
  rejectedReason: string | null;
  reasonInfo: string | null;
  recommendationInfo: string | null;
  providerUpdatedAt: string | null;
  lastSyncedAt: string;
  localState: string;
  bookingPreviewSupported: boolean;
  bookingSendSupported: boolean;
  bookingSupportReason: string | null;
}

const recordValue = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const exactString = (value: unknown): string | null =>
  typeof value === 'string' && value === value.trim() && value.length > 0 ? value : null;

const providerString = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
};

const assertJsonValue = (value: unknown, depth = 0): WhatsAppTemplateJsonValue => {
  if (depth > 12) throw new HttpError(400, 'WhatsApp template components are too deeply nested.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => assertJsonValue(entry, depth + 1));
  const record = recordValue(value);
  if (!record) throw new HttpError(400, 'WhatsApp template components contain an invalid value.');
  const normalized: Record<string, WhatsAppTemplateJsonValue> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new HttpError(400, 'WhatsApp template components contain an invalid property.');
    }
    normalized[key] = assertJsonValue(entry, depth + 1);
  }
  return normalized;
};

const normalizedComponents = (
  value: unknown,
  category: WhatsAppTemplateCategory,
): WhatsAppTemplateComponent[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new HttpError(400, 'A WhatsApp template requires between 1 and 50 components.');
  }
  const components = value.map((entry) => {
    const normalized = assertJsonValue(entry);
    const component = recordValue(normalized);
    if (!component || typeof component.type !== 'string') {
      throw new HttpError(400, 'Every WhatsApp template component requires a type.');
    }
    return normalized as WhatsAppTemplateComponent;
  });
  if (Buffer.byteLength(JSON.stringify(components), 'utf8') > MAX_COMPONENT_BYTES) {
    throw new HttpError(400, 'WhatsApp template components are too large.');
  }
  const types = components.map((component) => String(component.type).toUpperCase());
  if (types.filter((type) => type === 'BODY').length !== 1) {
    throw new HttpError(400, 'A WhatsApp template requires exactly one body component.');
  }
  if (types.filter((type) => type === 'HEADER').length > 1
      || types.filter((type) => type === 'FOOTER').length > 1
      || types.filter((type) => type === 'BUTTONS').length > 1) {
    throw new HttpError(400, 'A WhatsApp template can contain only one header, footer, and buttons component.');
  }
  for (const component of components) {
    const type = String(component.type).toUpperCase();
    const text = component.text;
    if (type === 'BODY') {
      if (category === 'AUTHENTICATION') {
        const validAuthenticationBody = text === undefined
          && (component.add_security_recommendation === undefined
            || typeof component.add_security_recommendation === 'boolean');
        if (!validAuthenticationBody) {
          throw new HttpError(
            400,
            'Authentication template bodies use Meta preset text and cannot define custom text.',
          );
        }
      } else if (typeof text !== 'string' || text.length === 0 || text.length > 1024) {
        throw new HttpError(400, 'WhatsApp template body text must be between 1 and 1024 characters.');
      }
    }
    if (type === 'HEADER' && String(component.format ?? '').toUpperCase() === 'TEXT'
        && (typeof text !== 'string' || text.length === 0 || text.length > 60)) {
      throw new HttpError(400, 'WhatsApp text headers must be between 1 and 60 characters.');
    }
    if (type === 'FOOTER') {
      const validText = typeof text === 'string' && text.length > 0 && text.length <= 60;
      const expiration = component.code_expiration_minutes;
      const validAuthenticationFooter = category === 'AUTHENTICATION'
        && text === undefined
        && Number.isInteger(expiration)
        && Number(expiration) >= 1
        && Number(expiration) <= 90;
      const validFooter = category === 'AUTHENTICATION'
        ? validAuthenticationFooter
        : validText;
      if (!validFooter) {
        throw new HttpError(
          400,
          category === 'AUTHENTICATION'
            ? 'Authentication template footers require a code expiration between 1 and 90 minutes.'
            : 'WhatsApp template footers must be between 1 and 60 characters.',
        );
      }
      if (typeof text === 'string' && /\{\{[^{}]+\}\}/.test(text)) {
        throw new HttpError(400, 'WhatsApp template footers cannot contain variables.');
      }
    }
    if (type === 'BUTTONS') {
      if (!Array.isArray(component.buttons) || component.buttons.length > 10) {
        throw new HttpError(400, 'WhatsApp templates support up to 10 buttons.');
      }
    }
  }
  return components;
};

const normalizedBookingBindings = (
  value: unknown,
  components: WhatsAppTemplateComponent[],
): WhatsAppTemplateBookingBindings => {
  if (value === undefined || value === null) return {};
  const record = recordValue(value);
  if (!record || Object.keys(record).some((key) => key !== 'buttons')) {
    throw new HttpError(400, 'WhatsApp booking bindings are invalid.');
  }
  if (record.buttons === undefined) return {};
  const buttons = recordValue(record.buttons);
  if (!buttons) throw new HttpError(400, 'WhatsApp button booking bindings are invalid.');
  const knownVariables = new Set(listWhatsAppTemplateVariables().map((variable) => variable.key));
  const normalizedButtons: Record<string, string[]> = {};
  for (const [index, rawKeys] of Object.entries(buttons)) {
    if (!/^[0-9]$/.test(index) || !Array.isArray(rawKeys) || rawKeys.length !== 1) {
      throw new HttpError(400, 'Each dynamic URL button requires exactly one booking-variable binding.');
    }
    const key = exactString(rawKeys[0]);
    if (!key || !knownVariables.has(key)) {
      throw new HttpError(400, 'A WhatsApp button uses an unknown booking-variable binding.');
    }
    normalizedButtons[index] = [key];
  }
  const buttonComponent = components.find(
    (component) => String(component.type).toUpperCase() === 'BUTTONS',
  );
  const componentButtons = Array.isArray(buttonComponent?.buttons) ? buttonComponent.buttons : [];
  for (const index of Object.keys(normalizedButtons)) {
    const button = recordValue(componentButtons[Number(index)]);
    if (
      !button
      || String(button.type ?? '').toUpperCase() !== 'URL'
      || typeof button.url !== 'string'
      || !button.url.includes('{{1}}')
    ) {
      throw new HttpError(400, 'Booking-variable bindings are allowed only for dynamic URL buttons.');
    }
  }
  return Object.keys(normalizedButtons).length > 0 ? { buttons: normalizedButtons } : {};
};

const validatePlaceholderFormat = (
  components: WhatsAppTemplateComponent[],
  parameterFormat: WhatsAppTemplateParameterFormat,
): void => {
  const templatedStrings: string[] = [];
  const collectStrings = (value: unknown, key = ''): void => {
    if (key === 'example' || key === 'url') return;
    if (typeof value === 'string') {
      if (/\{\{[^{}]+\}\}/.test(value)) templatedStrings.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => collectStrings(entry));
      return;
    }
    const record = recordValue(value);
    if (record) Object.entries(record).forEach(([entryKey, entry]) => collectStrings(entry, entryKey));
  };
  components.forEach((component) => collectStrings(component));
  const tokenGroups = templatedStrings.map((text) =>
    [...text.matchAll(new RegExp(ANY_PLACEHOLDER.source, 'g'))].map((match) => match[1]));
  const tokens = tokenGroups.flat();
  if (parameterFormat === 'NAMED') {
    if (tokens.some((token) => !/^[a-z_]+$/.test(token))) {
      throw new HttpError(400, 'Named WhatsApp parameters use lowercase letters and underscores only.');
    }
  } else {
    for (const group of tokenGroups) {
      const indexes = group.map((token) => Number(token));
      if (indexes.some((index) => !Number.isInteger(index) || index < 1)) {
        throw new HttpError(400, 'Positional WhatsApp parameters must be sequential numbers starting at 1.');
      }
      const unique = [...new Set(indexes)].sort((left, right) => left - right);
      if (unique.some((index, offset) => index !== offset + 1)) {
        throw new HttpError(400, 'Positional WhatsApp parameters must not skip a number within a component.');
      }
    }
  }
  for (const component of components) {
    if (String(component.type).toUpperCase() !== 'BUTTONS' || !Array.isArray(component.buttons)) continue;
    for (const rawButton of component.buttons) {
      const button = recordValue(rawButton);
      if (!button || String(button.type ?? '').toUpperCase() !== 'URL' || typeof button.url !== 'string') continue;
      const tokens = [...button.url.matchAll(new RegExp(ANY_PLACEHOLDER.source, 'g'))]
        .map((match) => match[1]);
      if (tokens.some((token) => token !== '1') || tokens.length > 1) {
        throw new HttpError(400, 'Dynamic WhatsApp URL buttons use a single {{1}} suffix parameter.');
      }
      if (tokens.length === 1 && !button.url.endsWith('{{1}}')) {
        throw new HttpError(400, 'The dynamic WhatsApp URL parameter {{1}} must be at the end of the URL.');
      }
    }
  }
};

const normalizeTtl = (value: unknown, category: WhatsAppTemplateCategory): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const ttl = Number(value);
  if (!Number.isInteger(ttl)) throw new HttpError(400, 'WhatsApp template TTL must be a whole number.');
  if (ttl === -1 && category !== 'MARKETING') return ttl;
  const valid = category === 'AUTHENTICATION'
    ? ttl >= 30 && ttl <= 900
    : category === 'UTILITY'
      ? ttl >= 30 && ttl <= 43_200
      : ttl >= 43_200 && ttl <= 2_592_000;
  if (!valid) throw new HttpError(400, 'WhatsApp template TTL is outside Meta limits for this category.');
  return ttl;
};

export const normalizeWhatsAppTemplateDefinition = (value: unknown): WhatsAppTemplateDefinition => {
  const record = recordValue(value);
  if (!record) throw new HttpError(400, 'WhatsApp template definition is required.');
  const name = exactString(record.name);
  const language = exactString(record.language);
  const category = exactString(record.category)?.toUpperCase();
  const parameterFormat = (exactString(record.parameterFormat)
    ?? exactString(record.parameter_format)
    ?? 'NAMED').toUpperCase();
  if (!name || !TEMPLATE_NAME.test(name)) throw new HttpError(400, 'WhatsApp template name is invalid.');
  if (!language || !LANGUAGE.test(language)) throw new HttpError(400, 'WhatsApp template language is invalid.');
  if (category !== 'UTILITY' && category !== 'MARKETING' && category !== 'AUTHENTICATION') {
    throw new HttpError(400, 'WhatsApp template category is invalid.');
  }
  if (parameterFormat !== 'NAMED' && parameterFormat !== 'POSITIONAL') {
    throw new HttpError(400, 'WhatsApp template parameter format is invalid.');
  }
  const components = normalizedComponents(record.components, category);
  validatePlaceholderFormat(components, parameterFormat);
  return {
    name,
    language,
    category,
    parameterFormat,
    messageSendTtlSeconds: normalizeTtl(
      record.messageSendTtlSeconds ?? record.message_send_ttl_seconds,
      category,
    ),
    components,
    bookingBindings: normalizedBookingBindings(
      record.bookingBindings ?? record.booking_bindings,
      components,
    ),
  };
};

const placeholderNames = (text: string, format: WhatsAppTemplateParameterFormat): string[] => {
  const expression = format === 'NAMED'
    ? new RegExp(NAMED_PLACEHOLDER.source, 'g')
    : new RegExp(POSITIONAL_PLACEHOLDER.source, 'g');
  return [...text.matchAll(expression)].map((match) => match[1]);
};

const withReviewExamples = (definition: WhatsAppTemplateDefinition): WhatsAppTemplateDefinition => {
  const samples = new Map(listWhatsAppTemplateVariables().map((variable) => [variable.key, variable.sampleValue]));
  const components = definition.components.map((component) => {
    const type = String(component.type).toUpperCase();
    if (type === 'BUTTONS' && Array.isArray(component.buttons)) {
      const buttons = component.buttons.map((rawButton, buttonIndex) => {
        const button = recordValue(rawButton);
        if (!button || String(button.type ?? '').toUpperCase() !== 'URL'
            || typeof button.url !== 'string' || button.example) {
          return rawButton;
        }
        const names = [...new Set(placeholderNames(button.url, 'POSITIONAL'))]
          .sort((left, right) => Number(left) - Number(right));
        if (names.length === 0) return rawButton;
        const bindingKey = definition.bookingBindings?.buttons?.[String(buttonIndex)]?.[0];
        const exampleSuffix = (bindingKey ? samples.get(bindingKey) : null)
          ?? `sample-${names[0].replace(/_/g, '-')}`;
        return { ...button, example: [exampleSuffix] } as WhatsAppTemplateComponent;
      });
      return { ...component, buttons } as WhatsAppTemplateComponent;
    }
    const text = typeof component.text === 'string' ? component.text : '';
    if (!text || (type !== 'BODY' && !(type === 'HEADER' && String(component.format).toUpperCase() === 'TEXT'))) {
      return component;
    }
    const names = [...new Set(placeholderNames(text, definition.parameterFormat))]
      .sort((left, right) => definition.parameterFormat === 'POSITIONAL'
        ? Number(left) - Number(right)
        : 0);
    if (names.length === 0 || component.example) return component;
    if (definition.parameterFormat === 'NAMED') {
      const entries = names.map((name) => ({
        param_name: name,
        example: samples.get(name) ?? `Sample ${name.replace(/_/g, ' ')}`,
      }));
      return {
        ...component,
        example: type === 'HEADER'
          ? { header_text_named_params: entries }
          : { body_text_named_params: entries },
      } as WhatsAppTemplateComponent;
    }
    const values = names.map((name) => samples.get(name) ?? `Sample ${name}`);
    return {
      ...component,
      example: type === 'HEADER' ? { header_text: values } : { body_text: [values] },
    } as WhatsAppTemplateComponent;
  });
  return { ...definition, components };
};

const resolveConnection = async (override?: TemplateGraphClient): Promise<TemplateConnection> => {
  await refreshConfigCacheKeys(CONFIG_KEYS);
  const accessToken = getConfigValueRaw('WHATSAPP_BUSINESS_ACCESS_TOKEN')?.trim() ?? '';
  const wabaId = getConfigValueRaw('WHATSAPP_WABA_ID')?.trim() ?? '';
  const phoneNumberId = getConfigValueRaw('WHATSAPP_PHONE_NUMBER_ID')?.trim() ?? '';
  if (accessToken.length < 32 || accessToken.length > 4096 || !META_ID.test(wabaId) || !META_ID.test(phoneNumberId)) {
    throw new HttpError(409, 'WhatsApp Business is not connected for template management.');
  }
  if (override) return { accessToken, wabaId, phoneNumberId, graphClient: override };
  try {
    return {
      accessToken,
      wabaId,
      phoneNumberId,
      graphClient: new WhatsAppMetaGraphClient(getWhatsAppEmbeddedSignupConfig()),
    };
  } catch (error) {
    if (error instanceof WhatsAppConfigError) {
      throw new HttpError(409, 'WhatsApp Business is not connected for template management.');
    }
    throw error;
  }
};

const graphFailure = (error: unknown, action: string): never => {
  if (error instanceof WhatsAppMetaGraphError) {
    throw new HttpError(502, `Meta could not ${action} the WhatsApp template.`, {
      code: error.safeCode,
      ambiguous: error.ambiguous,
    });
  }
  throw error;
};

const localReconciliationFailure = (action: string): never => {
  logger.error(`[whatsapp-template] Meta accepted a ${action} operation but local reconciliation failed.`);
  throw new HttpError(
    502,
    `Meta accepted the WhatsApp template ${action}, but OmniLodge could not confirm its local state. Synchronize templates before doing anything else.`,
    { code: 'META_TEMPLATE_LOCAL_RECONCILIATION_REQUIRED', ambiguous: true },
  );
};

const settleOperationTracking = async (tasks: Promise<unknown>[]): Promise<void> => {
  const results = await Promise.allSettled(tasks);
  if (results.some((result) => result.status === 'rejected')) {
    logger.error('[whatsapp-template] Provider operation succeeded but local audit/event tracking was incomplete.');
  }
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = recordValue(value);
  if (record) {
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const definitionHash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

const templateButtons = (components: WhatsAppTemplateComponent[]): unknown[] => {
  const component = components.find((entry) => String(entry.type ?? '').toUpperCase() === 'BUTTONS');
  return Array.isArray(component?.buttons) ? component.buttons : [];
};

const dynamicUrlButtonIdentity = (value: unknown): string | null => {
  const button = recordValue(value);
  if (!button || String(button.type ?? '').toUpperCase() !== 'URL' || typeof button.url !== 'string') return null;
  if (!button.url.includes('{{1}}')) return null;
  return canonicalJson({
    type: 'URL',
    text: typeof button.text === 'string' ? button.text : '',
    url: button.url,
  });
};

const reconcileProviderBookingBindings = (
  priorComponents: WhatsAppTemplateComponent[],
  nextComponents: WhatsAppTemplateComponent[],
  priorBindings: WhatsAppTemplateBookingBindings,
): WhatsAppTemplateBookingBindings => {
  const priorButtons = templateButtons(priorComponents);
  const nextButtons = templateButtons(nextComponents);
  const buttons: Record<string, string[]> = {};
  for (const [rawIndex, rawKeys] of Object.entries(priorBindings.buttons ?? {})) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || !Array.isArray(rawKeys) || rawKeys.length !== 1) continue;
    const priorIdentity = dynamicUrlButtonIdentity(priorButtons[index]);
    const nextIdentity = dynamicUrlButtonIdentity(nextButtons[index]);
    if (!priorIdentity || priorIdentity !== nextIdentity) continue;
    // If two buttons look identical, an external reorder cannot be detected.
    // Clearing the mapping is safer than injecting one booking field into the
    // wrong URL at send time.
    if (priorButtons.filter((button) => dynamicUrlButtonIdentity(button) === priorIdentity).length !== 1
        || nextButtons.filter((button) => dynamicUrlButtonIdentity(button) === nextIdentity).length !== 1) continue;
    const key = rawKeys[0];
    if (typeof key === 'string' && key.length > 0) buttons[rawIndex] = [key];
  }
  return Object.keys(buttons).length > 0 ? { buttons } : {};
};

const dateFromProvider = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const bookingTemplateCapability = (
  definition: WhatsAppTemplateDefinition,
  mode: 'preview' | 'send',
): { supported: boolean; reason: string | null } => {
  if (definition.parameterFormat !== 'NAMED') {
    return {
      supported: false,
      reason: 'Booking data needs named parameters; this template uses positional parameters.',
    };
  }
  if (definition.category === 'AUTHENTICATION') {
    return {
      supported: false,
      reason: 'Authentication codes need a dedicated secure code source and cannot use booking data.',
    };
  }
  const knownVariables = new Set(listWhatsAppTemplateVariables().map((variable) => variable.key));
  for (const component of definition.components) {
    const type = String(component.type ?? '').toUpperCase();
    if (!['HEADER', 'BODY', 'FOOTER', 'BUTTONS'].includes(type)) {
      return {
        supported: false,
        reason: `${type || 'Unknown'} components are viewable but do not yet support booking-data delivery.`,
      };
    }
    if (type === 'BODY' && typeof component.text !== 'string') {
      return { supported: false, reason: 'The template body cannot be resolved with booking data.' };
    }
    if (type === 'FOOTER' && typeof component.text === 'string' && ANY_PLACEHOLDER.test(component.text)) {
      ANY_PLACEHOLDER.lastIndex = 0;
      return { supported: false, reason: 'WhatsApp footer variables are not supported.' };
    }
    ANY_PLACEHOLDER.lastIndex = 0;
    if (mode === 'send' && type === 'HEADER') {
      const format = String(component.format ?? 'TEXT').toUpperCase();
      if (format !== 'TEXT') {
        return {
          supported: false,
          reason: `${format} headers need media or location values and cannot be sent from a booking yet.`,
        };
      }
    }
    if (type === 'BUTTONS' && Array.isArray(component.buttons)) {
      for (const [buttonIndex, rawButton] of component.buttons.entries()) {
        const button = recordValue(rawButton);
        const buttonType = String(button?.type ?? '').toUpperCase();
        if (mode === 'send' && !['URL', 'PHONE_NUMBER'].includes(buttonType)) {
          return {
            supported: false,
            reason: `${buttonType || 'Unknown'} buttons need specialized send-time data and cannot be sent from a booking yet.`,
          };
        }
        if (buttonType === 'URL' && typeof button?.url === 'string' && button.url.includes('{{')) {
          const tokens = [...button.url.matchAll(new RegExp(ANY_PLACEHOLDER.source, 'g'))]
            .map((match) => match[1]);
          if (tokens.length !== 1 || tokens[0] !== '1') {
            return {
              supported: false,
              reason: 'Dynamic URL buttons must use Meta\'s single positional {{1}} suffix parameter.',
            };
          }
          const binding = definition.bookingBindings?.buttons?.[String(buttonIndex)];
          if (!binding || binding.length !== 1 || !knownVariables.has(binding[0])) {
            return {
              supported: false,
              reason: `Dynamic URL button ${buttonIndex + 1} needs a booking-variable mapping.`,
            };
          }
        }
      }
    }
    if ((type === 'HEADER' || type === 'BODY') && typeof component.text === 'string') {
      for (const match of component.text.matchAll(new RegExp(ANY_PLACEHOLDER.source, 'g'))) {
        if (!knownVariables.has(match[1])) {
          return {
            supported: false,
            reason: `The parameter {{${match[1]}}} is not mapped to an approved booking field.`,
          };
        }
      }
    }
  }
  return { supported: true, reason: null };
};

const synchronizationReason = (template: WhatsAppTemplate): string | null => {
  if (template.localState === 'synced') return null;
  if (template.localState === 'stale') {
    return 'Meta reported a component change. Synchronize templates before using booking data.';
  }
  if (template.localState === 'missing') {
    return 'This template was not returned by Meta during the latest synchronization.';
  }
  if (template.localState === 'pending_sync') {
    return 'This template change is waiting to be reconciled with Meta.';
  }
  return 'Synchronize this template with Meta before using booking data.';
};

const assertSynchronizedTemplate = (template: WhatsAppTemplate): void => {
  const reason = synchronizationReason(template);
  if (reason) throw new HttpError(409, reason, { code: 'TEMPLATE_SYNC_REQUIRED' });
};

const dto = (template: WhatsAppTemplate): WhatsAppManagedTemplate => {
  const definition: WhatsAppTemplateDefinition = {
    name: template.name,
    language: template.language,
    category: template.category as WhatsAppTemplateCategory,
    parameterFormat: template.parameterFormat as WhatsAppTemplateParameterFormat,
    messageSendTtlSeconds: template.messageSendTtlSeconds,
    components: template.components as WhatsAppTemplateComponent[],
    bookingBindings: template.bookingBindings as WhatsAppTemplateBookingBindings,
  };
  const previewCapability = bookingTemplateCapability(definition, 'preview');
  const sendCapability = bookingTemplateCapability(definition, 'send');
  const syncReason = synchronizationReason(template);
  return {
    id: Number(template.id),
    metaTemplateId: template.metaTemplateId,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    qualityScore: template.qualityScore,
    parameterFormat: template.parameterFormat,
    components: template.components,
    bookingBindings: definition.bookingBindings ?? {},
    messageSendTtlSeconds: template.messageSendTtlSeconds,
    previousCategory: template.previousCategory,
    correctCategory: template.correctCategory,
    rejectedReason: template.rejectedReason,
    reasonInfo: template.reasonInfo,
    recommendationInfo: template.recommendationInfo,
    providerUpdatedAt: template.providerUpdatedAt?.toISOString() ?? null,
    lastSyncedAt: template.lastSyncedAt.toISOString(),
    localState: template.localState,
    bookingPreviewSupported: previewCapability.supported && syncReason === null,
    bookingSendSupported: sendCapability.supported && syncReason === null,
    bookingSupportReason: syncReason ?? sendCapability.reason ?? previewCapability.reason,
  };
};

const event = async (params: {
  template: WhatsAppTemplate | null;
  metaTemplateId: string;
  eventType: string;
  eventValue?: string | null;
  previousValue?: string | null;
  source: 'webhook' | 'sync' | 'operation';
  payload?: Record<string, unknown> | null;
  actorId?: number | null;
  occurredAt?: Date;
  fingerprint?: string | null;
}): Promise<void> => {
  try {
    await WhatsAppTemplateEvent.create({
      templateId: params.template?.id ?? null,
      metaTemplateId: params.metaTemplateId,
      eventType: params.eventType.slice(0, 64),
      eventValue: params.eventValue?.slice(0, 128) ?? null,
      previousValue: params.previousValue?.slice(0, 128) ?? null,
      source: params.source,
      payload: params.payload ?? null,
      actorId: params.actorId ?? null,
      occurredAt: params.occurredAt ?? new Date(),
      fingerprint: params.fingerprint ?? null,
    });
  } catch (error) {
    if (params.fingerprint && error instanceof UniqueConstraintError) return;
    throw error;
  }
};

const upsertProviderTemplate = async (
  wabaId: string,
  record: WhatsAppMessageTemplateRecord,
  syncedAt: Date,
  actorId: number | null = null,
  bookingBindings?: WhatsAppTemplateBookingBindings,
  snapshotStartedAt?: Date,
): Promise<WhatsAppTemplate> => {
  const existing = await WhatsAppTemplate.findOne({
    where: { wabaId, metaTemplateId: record.id },
  });
  const nextBookingBindings = bookingBindings ?? (existing
    ? reconcileProviderBookingBindings(
        existing.components as WhatsAppTemplateComponent[],
        record.components,
        existing.bookingBindings as WhatsAppTemplateBookingBindings,
      )
    : {});
  const hash = definitionHash({
    category: record.category.toUpperCase().slice(0, 32),
    components: record.components,
    bookingBindings: nextBookingBindings,
    parameterFormat: record.parameterFormat.toUpperCase().slice(0, 16),
    messageSendTtlSeconds: record.messageSendTtlSeconds,
  });
  const values = {
    wabaId,
    metaTemplateId: record.id,
    name: record.name,
    language: record.language,
    category: record.category.toUpperCase().slice(0, 32),
    status: record.status.toUpperCase().slice(0, 32),
    qualityScore: record.qualityScore?.toUpperCase().slice(0, 16) ?? null,
    parameterFormat: record.parameterFormat.toUpperCase().slice(0, 16) || 'POSITIONAL',
    components: record.components,
    bookingBindings: nextBookingBindings,
    messageSendTtlSeconds: record.messageSendTtlSeconds,
    previousCategory: record.previousCategory?.slice(0, 32) ?? null,
    correctCategory: record.correctCategory?.slice(0, 32) ?? null,
    rejectedReason: record.rejectedReason?.slice(0, 128) ?? null,
    providerUpdatedAt: dateFromProvider(record.lastUpdatedTime),
    lastSyncedAt: syncedAt,
    definitionHash: hash,
    localState: 'synced',
    statusUpdatedAt: syncedAt,
    qualityUpdatedAt: syncedAt,
    categoryUpdatedAt: syncedAt,
    componentsUpdatedAt: syncedAt,
    updatedBy: actorId,
    ...(record.status.toUpperCase() === 'REJECTED'
      ? {}
      : { reasonInfo: null, recommendationInfo: null }),
  };
  if (!existing) {
    let created: WhatsAppTemplate;
    try {
      created = await WhatsAppTemplate.create({
        ...values,
        reasonInfo: null,
        recommendationInfo: null,
        createdBy: actorId,
      });
    } catch (error) {
      if (snapshotStartedAt && error instanceof UniqueConstraintError) {
        const concurrent = await WhatsAppTemplate.findOne({
          where: { wabaId, metaTemplateId: record.id },
        });
        if (concurrent) return concurrent;
      }
      throw error;
    }
    await event({
      template: created,
      metaTemplateId: record.id,
      eventType: 'discovered',
      eventValue: created.status,
      source: 'sync',
      actorId,
    });
    return created;
  }
  const changes = [
    ['status', existing.status, values.status],
    ['quality', existing.qualityScore, values.qualityScore],
    ['category', existing.category, values.category],
    ['definition', existing.definitionHash, hash],
  ] as const;
  if (snapshotStartedAt) {
    const [updatedRows] = await WhatsAppTemplate.update(values, {
      where: {
        id: existing.id,
        lastSyncedAt: { [Op.lt]: snapshotStartedAt },
      },
    });
    if (updatedRows === 0) {
      return await WhatsAppTemplate.findOne({
        where: { wabaId, metaTemplateId: record.id },
      }) ?? existing;
    }
    Object.assign(existing, values);
  } else {
    await existing.update(values);
  }
  for (const [eventType, previousValue, eventValue] of changes) {
    if ((previousValue ?? null) !== (eventValue ?? null)) {
      await event({
        template: existing,
        metaTemplateId: record.id,
        eventType,
        eventValue: eventValue ?? null,
        previousValue: previousValue ?? null,
        source: 'sync',
        actorId,
      });
    }
  }
  return existing;
};

export const listManagedWhatsAppTemplates = async (): Promise<WhatsAppManagedTemplate[]> => {
  const connection = await resolveConnection();
  const rows = await WhatsAppTemplate.findAll({
    where: { wabaId: connection.wabaId },
    order: [['name', 'ASC'], ['language', 'ASC']],
  });
  return rows.map(dto);
};

export const syncManagedWhatsAppTemplates = async (
  actorId: number | null = null,
  graphClient?: TemplateGraphClient,
): Promise<WhatsAppManagedTemplate[]> => {
  const connection = await resolveConnection(graphClient);
  // Every provider row in this run is an observation from a request that began
  // no later than this watermark. Never let it overwrite a webhook or admin
  // operation committed while the remote list was in flight.
  const syncStartedAt = new Date();
  let records: WhatsAppMessageTemplateRecord[];
  try {
    records = await connection.graphClient.listMessageTemplates(connection.accessToken, connection.wabaId);
  } catch (error) {
    return graphFailure(error, 'synchronize');
  }
  const rows: WhatsAppTemplate[] = [];
  for (const record of records) {
    rows.push(await upsertProviderTemplate(
      connection.wabaId,
      record,
      syncStartedAt,
      actorId,
      undefined,
      syncStartedAt,
    ));
  }
  const remoteIds = records.map((record) => record.id);
  const missingRows = await WhatsAppTemplate.findAll({
    where: {
      wabaId: connection.wabaId,
      ...(remoteIds.length > 0 ? { metaTemplateId: { [Op.notIn]: remoteIds } } : {}),
      localState: { [Op.notIn]: ['deleted', 'missing'] },
      lastSyncedAt: { [Op.lt]: syncStartedAt },
    },
  });
  let missingCount = 0;
  for (const missing of missingRows) {
    const previousState = missing.localState;
    const [updatedRows] = await WhatsAppTemplate.update({
      localState: 'missing',
      lastSyncedAt: syncStartedAt,
      updatedBy: actorId,
    }, {
      where: {
        id: missing.id,
        localState: { [Op.notIn]: ['deleted', 'missing'] },
        lastSyncedAt: { [Op.lt]: syncStartedAt },
      },
    });
    if (updatedRows === 0) continue;
    missingCount += 1;
    await event({
      template: missing,
      metaTemplateId: missing.metaTemplateId,
      eventType: 'local_state',
      eventValue: 'missing',
      previousValue: previousState,
      source: 'sync',
      actorId,
      occurredAt: syncStartedAt,
    });
  }
  if (actorId !== null) {
    await AuditLog.create({
      actorId,
      action: 'whatsapp.template.synced',
      entity: 'whatsapp_template',
      entityId: connection.wabaId,
      metaJson: { remoteCount: rows.length, missingCount },
    });
  }
  return rows.map(dto).sort((left, right) =>
    left.name.localeCompare(right.name) || left.language.localeCompare(right.language));
};

export const createManagedWhatsAppTemplate = async (
  input: unknown,
  actorId: number,
  graphClient?: TemplateGraphClient,
): Promise<WhatsAppManagedTemplate> => {
  const definition = withReviewExamples(normalizeWhatsAppTemplateDefinition(input));
  const connection = await resolveConnection(graphClient);
  let result;
  try {
    result = await connection.graphClient.createMessageTemplate(
      connection.accessToken,
      connection.wabaId,
      definition,
    );
  } catch (error) {
    return graphFailure(error, 'create');
  }
  let provider: WhatsAppMessageTemplateRecord;
  try {
    provider = await connection.graphClient.getMessageTemplate(connection.accessToken, result.id);
  } catch {
    provider = {
      id: result.id,
      name: definition.name,
      language: definition.language,
      category: result.category,
      status: result.status,
      components: definition.components,
      qualityScore: 'UNKNOWN',
      rejectedReason: null,
      previousCategory: null,
      correctCategory: null,
      lastUpdatedTime: null,
      messageSendTtlSeconds: definition.messageSendTtlSeconds,
      parameterFormat: definition.parameterFormat,
    };
  }
  let template: WhatsAppTemplate;
  try {
    template = await upsertProviderTemplate(
      connection.wabaId,
      provider,
      new Date(),
      actorId,
      definition.bookingBindings,
    );
  } catch {
    return localReconciliationFailure('creation');
  }
  await settleOperationTracking([
    event({ template, metaTemplateId: provider.id, eventType: 'created', eventValue: provider.status, source: 'operation', actorId }),
    AuditLog.create({
      actorId,
      action: 'whatsapp.template.created',
      entity: 'whatsapp_template',
      entityId: provider.id,
      metaJson: { name: provider.name, language: provider.language, category: provider.category, definitionHash: template.definitionHash },
    }),
  ]);
  return dto(template);
};

const loadManagedTemplate = async (metaTemplateId: unknown): Promise<WhatsAppTemplate> => {
  const id = exactString(metaTemplateId);
  if (!id || !META_ID.test(id)) throw new HttpError(400, 'WhatsApp template ID is invalid.');
  const connection = await resolveConnection();
  const template = await WhatsAppTemplate.findOne({ where: { wabaId: connection.wabaId, metaTemplateId: id } });
  if (!template) throw new HttpError(404, 'WhatsApp template was not found.');
  return template;
};

export const updateManagedWhatsAppTemplate = async (
  metaTemplateId: unknown,
  input: unknown,
  actorId: number,
  graphClient?: TemplateGraphClient,
): Promise<WhatsAppManagedTemplate> => {
  const existing = await loadManagedTemplate(metaTemplateId);
  assertSynchronizedTemplate(existing);
  if (!['APPROVED', 'REJECTED', 'PAUSED'].includes(existing.status.toUpperCase())) {
    throw new HttpError(
      409,
      'Meta only allows template edits while the template is approved, rejected, or paused.',
    );
  }
  const inputRecord = recordValue(input);
  if (!inputRecord) throw new HttpError(400, 'WhatsApp template definition is required.');
  const requestedName = inputRecord.name === undefined ? existing.name : exactString(inputRecord.name);
  const requestedLanguage = inputRecord.language === undefined
    ? existing.language
    : exactString(inputRecord.language);
  const requestedParameterFormat = inputRecord.parameterFormat
    ?? inputRecord.parameter_format
    ?? existing.parameterFormat;
  if (requestedName !== existing.name || requestedLanguage !== existing.language
      || String(requestedParameterFormat).toUpperCase() !== existing.parameterFormat.toUpperCase()) {
    throw new HttpError(
      409,
      'WhatsApp template name, language, and parameter format cannot be changed after creation.',
    );
  }
  const requestedCategory = exactString(inputRecord.category)?.toUpperCase() ?? existing.category.toUpperCase();
  if (existing.status.toUpperCase() === 'APPROVED' && requestedCategory !== existing.category.toUpperCase()) {
    throw new HttpError(409, 'Meta does not allow changing the category of an approved template.');
  }
  const rawRequestedTtl = inputRecord.messageSendTtlSeconds
    ?? inputRecord.message_send_ttl_seconds;
  const requested = normalizeWhatsAppTemplateDefinition({
    ...inputRecord,
    name: existing.name,
    language: existing.language,
    parameterFormat: existing.parameterFormat,
    // Meta has no documented null/clear operation for updates. A blank edit
    // therefore means "keep the provider value"; -1 remains the explicit
    // provider-default value for categories where Meta supports it.
    messageSendTtlSeconds: rawRequestedTtl === null
      || rawRequestedTtl === undefined
      || rawRequestedTtl === ''
      ? existing.messageSendTtlSeconds
      : rawRequestedTtl,
    bookingBindings: inputRecord.bookingBindings
      ?? inputRecord.booking_bindings
      ?? existing.bookingBindings,
  });
  const definition = withReviewExamples(requested);
  const connection = await resolveConnection(graphClient);
  try {
    await connection.graphClient.updateMessageTemplate(
      connection.accessToken,
      existing.metaTemplateId,
      definition,
      { includeCategory: existing.status.toUpperCase() !== 'APPROVED' },
    );
  } catch (error) {
    return graphFailure(error, 'update');
  }
  const priorHash = existing.definitionHash;
  let provider: WhatsAppMessageTemplateRecord | null = null;
  try {
    provider = await connection.graphClient.getMessageTemplate(connection.accessToken, existing.metaTemplateId);
  } catch {
    // The write was confirmed. Preserve a locally complete representation until reconciliation.
  }
  let template: WhatsAppTemplate;
  try {
    template = provider
      ? await upsertProviderTemplate(
          connection.wabaId,
          provider,
          new Date(),
          actorId,
          definition.bookingBindings,
        )
      : await existing.update({
          category: definition.category,
          components: definition.components,
          bookingBindings: definition.bookingBindings ?? {},
          parameterFormat: definition.parameterFormat,
          messageSendTtlSeconds: definition.messageSendTtlSeconds,
          definitionHash: definitionHash({
            category: definition.category,
            components: definition.components,
            bookingBindings: definition.bookingBindings ?? {},
            parameterFormat: definition.parameterFormat,
            messageSendTtlSeconds: definition.messageSendTtlSeconds,
          }),
          status: 'PENDING',
          localState: 'pending_sync',
          lastSyncedAt: new Date(),
          statusUpdatedAt: new Date(),
          categoryUpdatedAt: new Date(),
          componentsUpdatedAt: new Date(),
          updatedBy: actorId,
        });
  } catch {
    return localReconciliationFailure('update');
  }
  await settleOperationTracking([
    event({
      template,
      metaTemplateId: template.metaTemplateId,
      eventType: 'updated',
      eventValue: template.definitionHash,
      previousValue: priorHash,
      source: 'operation',
      actorId,
    }),
    AuditLog.create({
      actorId,
      action: 'whatsapp.template.updated',
      entity: 'whatsapp_template',
      entityId: template.metaTemplateId,
      metaJson: { beforeHash: priorHash, afterHash: template.definitionHash },
    }),
  ]);
  return dto(template);
};

export const deleteManagedWhatsAppTemplate = async (
  metaTemplateId: unknown,
  expectedName: unknown,
  actorId: number,
  graphClient?: TemplateGraphClient,
): Promise<void> => {
  const template = await loadManagedTemplate(metaTemplateId);
  assertSynchronizedTemplate(template);
  if (expectedName !== template.name) throw new HttpError(400, 'Type the exact template name to confirm deletion.');
  const connection = await resolveConnection(graphClient);
  try {
    await connection.graphClient.deleteMessageTemplate(
      connection.accessToken,
      connection.wabaId,
      template.metaTemplateId,
      template.name,
    );
  } catch (error) {
    return graphFailure(error, 'delete');
  }
  const previous = template.status;
  const changedAt = new Date();
  try {
    await template.update({
      status: 'DELETED',
      localState: 'deleted',
      updatedBy: actorId,
      lastSyncedAt: changedAt,
      statusUpdatedAt: changedAt,
    });
  } catch {
    return localReconciliationFailure('deletion');
  }
  await settleOperationTracking([
    event({ template, metaTemplateId: template.metaTemplateId, eventType: 'status', eventValue: 'DELETED', previousValue: previous, source: 'operation', actorId }),
    AuditLog.create({ actorId, action: 'whatsapp.template.deleted', entity: 'whatsapp_template', entityId: template.metaTemplateId, metaJson: { name: template.name, language: template.language } }),
  ]);
};

const bulkLifecycle = async (
  action: 'archive' | 'unarchive',
  rawIds: unknown,
  actorId: number,
  graphClient?: TemplateGraphClient,
): Promise<WhatsAppManagedTemplate[]> => {
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 100) {
    throw new HttpError(400, 'Select between 1 and 100 WhatsApp templates.');
  }
  const ids = [...new Set(rawIds.map(exactString))];
  if (ids.some((id) => !id || !META_ID.test(id))) throw new HttpError(400, 'A WhatsApp template ID is invalid.');
  const normalizedIds = ids as string[];
  const connection = await resolveConnection(graphClient);
  const rows = await WhatsAppTemplate.findAll({ where: { wabaId: connection.wabaId, metaTemplateId: { [Op.in]: normalizedIds } } });
  if (rows.length !== normalizedIds.length) throw new HttpError(404, 'One or more WhatsApp templates were not found.');
  rows.forEach(assertSynchronizedTemplate);
  try {
    if (action === 'archive') {
      await connection.graphClient.archiveMessageTemplates(connection.accessToken, connection.wabaId, normalizedIds);
    } else {
      await connection.graphClient.unarchiveMessageTemplates(connection.accessToken, connection.wabaId, normalizedIds);
    }
  } catch (error) {
    return graphFailure(error, action);
  }
  const trackingEvents: Array<Parameters<typeof event>[0]> = [];
  try {
    for (const row of rows) {
      const previous = row.status;
      const next = action === 'archive' ? 'ARCHIVED' : 'APPROVED';
      const changedAt = new Date();
      await row.update({
        status: next,
        localState: 'synced',
        updatedBy: actorId,
        lastSyncedAt: changedAt,
        statusUpdatedAt: changedAt,
      });
      trackingEvents.push({
        template: row,
        metaTemplateId: row.metaTemplateId,
        eventType: 'status',
        eventValue: next,
        previousValue: previous,
        source: 'operation',
        actorId,
      });
    }
  } catch {
    return localReconciliationFailure(action);
  }
  await settleOperationTracking([
    ...trackingEvents.map((params) => event(params)),
    AuditLog.create({ actorId, action: `whatsapp.template.${action}d`, entity: 'whatsapp_template', entityId: normalizedIds[0], metaJson: { templateIds: normalizedIds } }),
  ]);
  return rows.map(dto);
};

export const archiveManagedWhatsAppTemplates = (ids: unknown, actorId: number, graphClient?: TemplateGraphClient) =>
  bulkLifecycle('archive', ids, actorId, graphClient);

export const unarchiveManagedWhatsAppTemplates = (ids: unknown, actorId: number, graphClient?: TemplateGraphClient) =>
  bulkLifecycle('unarchive', ids, actorId, graphClient);

export const unpauseManagedWhatsAppTemplate = async (
  metaTemplateId: unknown,
  actorId: number,
  graphClient?: TemplateGraphClient,
): Promise<WhatsAppManagedTemplate> => {
  const template = await loadManagedTemplate(metaTemplateId);
  assertSynchronizedTemplate(template);
  const connection = await resolveConnection(graphClient);
  try {
    await connection.graphClient.unpauseMessageTemplate(connection.accessToken, template.metaTemplateId);
  } catch (error) {
    return graphFailure(error, 'unpause');
  }
  const previous = template.status;
  const changedAt = new Date();
  try {
    await template.update({
      status: 'APPROVED',
      updatedBy: actorId,
      lastSyncedAt: changedAt,
      statusUpdatedAt: changedAt,
    });
  } catch {
    return localReconciliationFailure('unpause');
  }
  await settleOperationTracking([
    event({ template, metaTemplateId: template.metaTemplateId, eventType: 'status', eventValue: 'APPROVED', previousValue: previous, source: 'operation', actorId }),
    AuditLog.create({
      actorId,
      action: 'whatsapp.template.unpaused',
      entity: 'whatsapp_template',
      entityId: template.metaTemplateId,
      metaJson: { previousStatus: previous },
    }),
  ]);
  return dto(template);
};

export const getManagedWhatsAppTemplateEvents = async (metaTemplateId: unknown): Promise<Record<string, unknown>[]> => {
  const template = await loadManagedTemplate(metaTemplateId);
  const events = await WhatsAppTemplateEvent.findAll({
    where: { metaTemplateId: template.metaTemplateId },
    order: [['occurredAt', 'DESC'], ['id', 'DESC']],
    limit: 200,
  });
  return events.map((entry) => ({
    id: Number(entry.id),
    eventType: entry.eventType,
    eventValue: entry.eventValue,
    previousValue: entry.previousValue,
    source: entry.source,
    payload: entry.payload,
    occurredAt: entry.occurredAt.toISOString(),
  }));
};

export const previewManagedWhatsAppTemplate = async (params: {
  metaTemplateId?: unknown;
  definition?: unknown;
  bookingId?: unknown;
}) => {
  let definition: WhatsAppTemplateDefinition;
  if (params.definition !== undefined) {
    definition = normalizeWhatsAppTemplateDefinition(params.definition);
  } else {
    const template = await loadManagedTemplate(params.metaTemplateId);
    definition = {
      name: template.name,
      language: template.language,
      category: template.category as WhatsAppTemplateCategory,
      parameterFormat: template.parameterFormat as WhatsAppTemplateParameterFormat,
      messageSendTtlSeconds: template.messageSendTtlSeconds,
      components: template.components as WhatsAppTemplateComponent[],
      bookingBindings: template.bookingBindings as WhatsAppTemplateBookingBindings,
    };
  }
  const bookingId = params.bookingId === undefined || params.bookingId === null || params.bookingId === ''
    ? undefined
    : Number(params.bookingId);
  if (bookingId !== undefined && (!Number.isInteger(bookingId) || bookingId <= 0)) {
    throw new HttpError(400, 'Booking ID is invalid.');
  }
  return renderWhatsAppTemplatePreview(definition, {
    bookingId,
    positionalBindings: definition.bookingBindings,
  });
};

const templateDefinitionFromRow = (template: WhatsAppTemplate): WhatsAppTemplateDefinition => ({
  name: template.name,
  language: template.language,
  category: template.category as WhatsAppTemplateCategory,
  parameterFormat: template.parameterFormat as WhatsAppTemplateParameterFormat,
  messageSendTtlSeconds: template.messageSendTtlSeconds,
  components: template.components as WhatsAppTemplateComponent[],
  bookingBindings: template.bookingBindings as WhatsAppTemplateBookingBindings,
});

const keysFromComponents = (
  components: Record<string, unknown>[],
  bookingBindings: WhatsAppTemplateBookingBindings = {},
): string[] => {
  const values = new Set<string>();
  const pending: unknown[] = [...components];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') {
      for (const match of current.matchAll(ANY_PLACEHOLDER)) {
        if (!/^\d+$/.test(match[1])) values.add(match[1]);
      }
    } else if (Array.isArray(current)) pending.push(...current);
    else if (recordValue(current)) pending.push(...Object.values(current as Record<string, unknown>));
  }
  Object.values(bookingBindings.buttons ?? {}).flat().forEach((key) => values.add(key));
  return [...values].sort();
};

export const sendManagedWhatsAppTemplate = async (params: {
  metaTemplateId: unknown;
  bookingId: unknown;
  recipient?: unknown;
  actorId: number;
  graphClient?: TemplateGraphClient;
}): Promise<{ messageId: string }> => {
  const template = await loadManagedTemplate(params.metaTemplateId);
  assertSynchronizedTemplate(template);
  if (template.status !== 'APPROVED') throw new HttpError(409, 'Only approved WhatsApp templates can be sent.');
  const bookingId = Number(params.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) throw new HttpError(400, 'Booking ID is invalid.');
  const booking = await Booking.findByPk(bookingId, { attributes: ['id', 'guestPhone'] });
  if (!booking) throw new HttpError(404, 'Booking was not found.');
  const recipient = exactString(params.recipient) ?? booking.guestPhone?.trim() ?? null;
  if (!recipient || !E164.test(recipient)) {
    throw new HttpError(400, 'The booking needs a valid E.164 WhatsApp recipient.');
  }
  const definition = templateDefinitionFromRow(template);
  const capability = bookingTemplateCapability(definition, 'send');
  if (!capability.supported) {
    throw new HttpError(409, capability.reason ?? 'This template cannot be sent with booking data.', {
      code: 'UNSUPPORTED_BOOKING_TEMPLATE',
    });
  }
  const components = await buildWhatsAppTemplateSendComponents(definition, {
    bookingId,
    positionalBindings: definition.bookingBindings,
  });
  const connection = await resolveConnection(params.graphClient);
  let messageId: string;
  try {
    messageId = await connection.graphClient.sendTemplateMessage(
      connection.accessToken,
      connection.phoneNumberId,
      {
        recipient,
        templateName: template.name,
        languageCode: template.language,
        components,
      },
    );
  } catch (error) {
    if (error instanceof WhatsAppMetaGraphError) {
      throw new HttpError(
        502,
        error.ambiguous
          ? 'Meta did not confirm whether the WhatsApp template message was accepted. Check WhatsApp before retrying.'
          : 'Meta rejected the WhatsApp template message.',
        { code: error.safeCode, ambiguous: error.ambiguous },
      );
    }
    throw error;
  }
  // Meta has already accepted the message at this point. A local tracking or
  // audit outage must not turn that success into a retryable HTTP 500 and cause
  // an administrator to send the same guest message twice.
  const parameterKeys = keysFromComponents(template.components, definition.bookingBindings);
  const persistenceResults = await Promise.allSettled([
    WhatsAppTemplateSend.create({
      templateId: template.id,
      bookingId,
      providerMessageId: messageId,
      templateName: template.name,
      language: template.language,
      recipientPhoneSuffix: recipient.replace(/\D/g, '').slice(-4) || null,
      parameterKeys,
      deliveryStatus: 'accepted',
      createdBy: params.actorId,
    }),
    AuditLog.create({
      actorId: params.actorId,
      action: 'whatsapp.template.sent',
      entity: 'whatsapp_template',
      entityId: template.metaTemplateId,
      metaJson: { bookingId, providerMessageId: messageId, parameterKeys },
    }),
  ]);
  if (persistenceResults.some((result) => result.status === 'rejected')) {
    logger.error('[whatsapp-template] Meta accepted a message but local send tracking was incomplete.');
  }
  return { messageId };
};

export const ingestWhatsAppTemplateEvents = async (
  events: NormalizedWhatsAppTemplateEvent[],
): Promise<number> => {
  let applied = 0;
  for (const incoming of events) {
    const fingerprint = definitionHash({
      wabaId: incoming.wabaId,
      templateId: incoming.templateId,
      source: incoming.source,
      value: incoming.value,
      previousValue: incoming.previousValue,
      occurredAt: incoming.occurredAt.toISOString(),
      details: incoming.details,
    });
    const duplicate = await WhatsAppTemplateEvent.findOne({ where: { fingerprint } });
    if (duplicate) continue;
    const template = await WhatsAppTemplate.findOne({
      where: { wabaId: incoming.wabaId, metaTemplateId: incoming.templateId },
    });
    const payload = incoming.details;
    let stale = false;
    if (template) {
      const patch: Record<string, unknown> = {};
      let timestampField: 'statusUpdatedAt' | 'qualityUpdatedAt' | 'categoryUpdatedAt' | 'componentsUpdatedAt' | null = null;
      if (incoming.source === 'message_template_status_update' && incoming.value) {
        timestampField = 'statusUpdatedAt';
        patch.status = incoming.value.toUpperCase().slice(0, 32);
        patch.rejectedReason = providerString(payload.reason, 128);
        patch.reasonInfo = providerString(payload.reason_info, 8_000);
        patch.recommendationInfo = providerString(payload.recommendation_info, 8_000);
        patch.statusUpdatedAt = incoming.occurredAt;
      } else if (incoming.source === 'message_template_quality_update' && incoming.value) {
        timestampField = 'qualityUpdatedAt';
        patch.qualityScore = incoming.value.toUpperCase().slice(0, 16);
        patch.qualityUpdatedAt = incoming.occurredAt;
      } else if (incoming.source === 'template_category_update' && incoming.value) {
        timestampField = 'categoryUpdatedAt';
        if (payload.new_category) patch.category = incoming.value.toUpperCase().slice(0, 32);
        patch.correctCategory = providerString(payload.correct_category, 32);
        patch.previousCategory = providerString(payload.previous_category, 32)
          ?? providerString(payload.current_category, 32);
        patch.categoryUpdatedAt = incoming.occurredAt;
      } else if (incoming.source === 'message_template_components_update') {
        timestampField = 'componentsUpdatedAt';
        patch.localState = 'stale';
        patch.componentsUpdatedAt = incoming.occurredAt;
      }
      if (timestampField && Object.keys(patch).length > 0) {
        patch.lastSyncedAt = new Date();
        const [updatedRows] = await WhatsAppTemplate.update(patch, {
          where: {
            id: template.id,
            [Op.or]: [
              { [timestampField]: null },
              { [timestampField]: { [Op.lte]: incoming.occurredAt } },
            ],
          },
        });
        stale = updatedRows === 0;
      }
    }
    await event({
      template,
      metaTemplateId: incoming.templateId,
      eventType: incoming.source,
      eventValue: incoming.value,
      previousValue: incoming.previousValue,
      source: 'webhook',
      payload: stale ? { ...payload, ignored_as_stale: true } : payload,
      occurredAt: incoming.occurredAt,
      fingerprint,
    });
    applied += 1;
  }
  return applied;
};

export const updateWhatsAppTemplateSendStatuses = async (events: Array<{
  messageId: string;
  status: string;
  deliveryErrorCode: string | null;
  timestamp: Date;
}>): Promise<number> => {
  const rank: Readonly<Record<string, number>> = {
    accepted: 0,
    sent: 1,
    failed: 2,
    delivered: 3,
    read: 4,
    played: 4,
  };
  let updated = 0;
  for (const status of events) {
    if (!Number.isFinite(status.timestamp.getTime())) continue;
    const incomingStatus = status.status.trim().toLowerCase();
    if (rank[incomingStatus] === undefined) continue;
    const eligibleStatuses = Object.entries(rank)
      .filter(([, value]) => value <= rank[incomingStatus])
      .flatMap(([value]) => [value, value.toUpperCase()]);
    const [updatedRows] = await WhatsAppTemplateSend.update({
      deliveryStatus: incomingStatus,
      ...(incomingStatus === 'failed' && status.deliveryErrorCode
        ? { deliveryErrorCode: status.deliveryErrorCode.slice(0, 64) }
        : {}),
      statusUpdatedAt: status.timestamp,
    }, {
      where: {
        providerMessageId: status.messageId,
        deliveryStatus: { [Op.in]: eligibleStatuses },
        [Op.or]: [
          { statusUpdatedAt: null },
          { statusUpdatedAt: { [Op.lte]: status.timestamp } },
        ],
      },
    });
    updated += updatedRows;
  }
  return updated;
};
