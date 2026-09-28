import type {
  WhatsAppTemplateComponent,
  WhatsAppTemplateDefinition,
} from '../types/whatsappTemplates.js';

export type WhatsAppCoexistenceSyncType = 'smb_app_state_sync' | 'history';

export interface WhatsAppTemplateMessageRequest {
  recipient: string;
  templateName: string;
  languageCode: string;
  // Send-time parameter components have a shape distinct from creation-time
  // definition components. Runtime validation below accepts either without
  // weakening the provider boundary.
  components?: object[];
}

export interface WhatsAppMessageTemplateRecord {
  id: string;
  name: string;
  status: string;
  language: string;
  category: string;
  components: WhatsAppTemplateComponent[];
  qualityScore: string | null;
  rejectedReason: string | null;
  previousCategory: string | null;
  correctCategory: string | null;
  lastUpdatedTime: string | null;
  messageSendTtlSeconds: number | null;
  parameterFormat: string;
}

export interface WhatsAppTemplateMutationResult {
  id: string;
  status: string;
  category: string;
}

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const META_ID = /^\d{1,64}$/;
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_CODE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
const TEMPLATE_FIELDS = [
  'id',
  'name',
  'status',
  'language',
  'category',
  'components',
  'quality_score',
  'rejected_reason',
  'previous_category',
  'correct_category',
  'last_updated_time',
  'message_send_ttl_seconds',
  'parameter_format',
].join(',');
const TEMPLATE_PAGE_SIZE = 100;
// Current WABA capacity is below this bound. Keeping a hard ceiling also
// prevents a malformed provider cursor from causing an unbounded request loop.
const MAX_TEMPLATE_LIST_PAGES = 100;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const safeProviderString = (value: unknown, maxLength = 128): string | null =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= maxLength
  && value === value.trim()
  && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;

const optionalProviderString = (
  value: unknown,
  maxLength = 128,
): string | null | undefined => {
  if (value === undefined || value === null || value === '') return null;
  return safeProviderString(value, maxLength) ?? undefined;
};

const optionalTemplateTtl = (value: unknown): number | null | undefined => {
  if (value === undefined || value === null) return null;
  return Number.isSafeInteger(value) && Number(value) >= -1 ? Number(value) : undefined;
};

const isJsonValue = (value: unknown, depth = 0): boolean => {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  const record = asRecord(value);
  return record !== null
    && (Object.getPrototypeOf(record) === Object.prototype || Object.getPrototypeOf(record) === null)
    && Object.entries(record).every(([key, entry]) => (
      key.length > 0
      && key.length <= 256
      && !['__proto__', 'prototype', 'constructor'].includes(key)
      && !/[\u0000-\u001f\u007f]/.test(key)
      && isJsonValue(entry, depth + 1)
    ));
};

const asTemplateComponents = (value: unknown): WhatsAppTemplateComponent[] | null => {
  if (!Array.isArray(value)) return null;
  const components = value.filter((entry) => {
    const component = asRecord(entry);
    return component !== null
      && safeProviderString(component.type, 64) !== null
      && isJsonValue(entry);
  });
  return components.length === value.length
    ? components as WhatsAppTemplateComponent[]
    : null;
};

const parseQualityScore = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return safeProviderString(value, 64) ?? undefined;
  const record = asRecord(value);
  return record && Object.prototype.hasOwnProperty.call(record, 'score')
    ? optionalProviderString(record.score, 64)
    : undefined;
};

const safeSegment = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').slice(0, 24);
  return normalized || null;
};

const providerFailureCode = (status: number, payload: unknown): string => {
  const error = asRecord(asRecord(payload)?.error);
  const segments = [
    'META',
    String(status),
    safeSegment(error?.type),
    safeSegment(error?.code),
    safeSegment(error?.error_subcode),
  ].filter((segment): segment is string => Boolean(segment));
  return segments.join('_').slice(0, 64);
};

const parseTemplateRecord = (
  value: unknown,
  safeCode: string,
): WhatsAppMessageTemplateRecord => {
  const record = asRecord(value);
  const id = record?.id;
  const name = record?.name;
  const status = safeProviderString(record?.status, 64);
  const language = record?.language;
  const category = safeProviderString(record?.category, 64);
  const components = asTemplateComponents(record?.components);
  const qualityScore = parseQualityScore(record?.quality_score);
  const rejectedReason = optionalProviderString(record?.rejected_reason, 512);
  const previousCategory = optionalProviderString(record?.previous_category, 64);
  const correctCategory = optionalProviderString(record?.correct_category, 64);
  const messageSendTtlSeconds = optionalTemplateTtl(record?.message_send_ttl_seconds);
  const parameterFormatValue = optionalProviderString(record?.parameter_format, 64);
  const parameterFormat = parameterFormatValue ?? 'POSITIONAL';

  const rawLastUpdatedTime = record?.last_updated_time;
  let lastUpdatedTime: string | null | undefined = null;
  if (rawLastUpdatedTime !== undefined && rawLastUpdatedTime !== null) {
    if (
      typeof rawLastUpdatedTime === 'number'
      && Number.isSafeInteger(rawLastUpdatedTime)
      && rawLastUpdatedTime >= 0
    ) {
      const timestamp = new Date(rawLastUpdatedTime * 1_000);
      lastUpdatedTime = Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : undefined;
    } else {
      lastUpdatedTime = safeProviderString(rawLastUpdatedTime, 128) ?? undefined;
    }
  }

  if (
    !record
    || typeof id !== 'string'
    || !META_ID.test(id)
    || typeof name !== 'string'
    || !TEMPLATE_NAME.test(name)
    || status === null
    || typeof language !== 'string'
    || !LANGUAGE_CODE.test(language)
    || category === null
    || components === null
    || qualityScore === undefined
    || rejectedReason === undefined
    || previousCategory === undefined
    || correctCategory === undefined
    || lastUpdatedTime === undefined
    || messageSendTtlSeconds === undefined
    || parameterFormatValue === undefined
  ) {
    throw new WhatsAppMetaGraphError(safeCode, 200, false);
  }

  return {
    id,
    name,
    status,
    language,
    category,
    components,
    qualityScore,
    rejectedReason,
    previousCategory,
    correctCategory,
    lastUpdatedTime,
    messageSendTtlSeconds,
    parameterFormat,
  };
};

const assertTemplateDefinition = (definition: WhatsAppTemplateDefinition): void => {
  const category = definition?.category;
  const parameterFormat = definition?.parameterFormat;
  const components = asTemplateComponents(definition?.components);
  const ttl = definition?.messageSendTtlSeconds;
  const ttlIsValid = ttl === null
    || (typeof ttl === 'number' && Number.isSafeInteger(ttl) && (
      (ttl === -1 && category !== 'MARKETING')
      || (category === 'AUTHENTICATION' && ttl >= 30 && ttl <= 900)
      || (category === 'UTILITY' && ttl >= 30 && ttl <= 43_200)
      || (category === 'MARKETING' && ttl >= 43_200 && ttl <= 2_592_000)
    ));
  if (
    !definition
    || !TEMPLATE_NAME.test(definition.name)
    || !LANGUAGE_CODE.test(definition.language)
    || !['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(category)
    || !['NAMED', 'POSITIONAL'].includes(parameterFormat)
    || components === null
    || components.length === 0
    || !ttlIsValid
  ) {
    throw new WhatsAppMetaGraphError('META_TEMPLATE_REQUEST_INVALID', null, false);
  }
};

const assertTemplateId = (value: string): void => {
  if (!META_ID.test(value)) {
    throw new WhatsAppMetaGraphError('META_TEMPLATE_REQUEST_INVALID', null, false);
  }
};

const assertMutationSuccess = (payload: JsonRecord, safeCode: string): void => {
  if (payload.success !== true && payload.success !== 'true') {
    throw new WhatsAppMetaGraphError(safeCode, 200, true);
  }
};

const assertBulkArchiveResponse = (
  payload: JsonRecord,
  requestedIds: string[],
  operation: 'archive' | 'unarchive',
): void => {
  const resultKey = operation === 'archive' ? 'archived_templates' : 'unarchived_templates';
  const rawSucceeded = payload[resultKey];
  const rawFailed = asRecord(payload.failed_templates);
  const succeededIds = Array.isArray(rawSucceeded)
    ? rawSucceeded.filter((value): value is string => typeof value === 'string' && META_ID.test(value))
    : null;
  const failedEntries = rawFailed ? Object.entries(rawFailed) : null;
  const failedIds = failedEntries?.map(([id]) => id) ?? null;
  const responseIds = succeededIds && failedIds ? [...succeededIds, ...failedIds] : [];
  const responseIsComplete = responseIds.length === requestedIds.length
    && new Set(responseIds).size === responseIds.length
    && responseIds.every((id) => requestedIds.includes(id));
  const failuresAreValid = failedEntries?.every(([id, reason]) => (
    META_ID.test(id) && safeProviderString(reason, 1_024) !== null
  )) ?? false;
  if (
    !Array.isArray(rawSucceeded)
    || succeededIds === null
    || succeededIds.length !== rawSucceeded.length
    || failedEntries === null
    || !failuresAreValid
    || !responseIsComplete
  ) {
    throw new WhatsAppMetaGraphError(
      operation === 'archive'
        ? 'META_TEMPLATE_ARCHIVE_RESPONSE_INVALID'
        : 'META_TEMPLATE_UNARCHIVE_RESPONSE_INVALID',
      200,
      true,
    );
  }
  if (failedEntries.length > 0) {
    throw new WhatsAppMetaGraphError(
      operation === 'archive'
        ? 'META_TEMPLATE_ARCHIVE_PARTIAL_FAILURE'
        : 'META_TEMPLATE_UNARCHIVE_PARTIAL_FAILURE',
      200,
      true,
    );
  }
};

export class WhatsAppMetaGraphError extends Error {
  readonly safeCode: string;
  readonly status: number | null;
  readonly ambiguous: boolean;

  constructor(safeCode: string, status: number | null, ambiguous: boolean) {
    super('Meta Graph request failed');
    this.name = 'WhatsAppMetaGraphError';
    this.safeCode = safeCode.slice(0, 64);
    this.status = status;
    this.ambiguous = ambiguous;
  }
}

export interface WhatsAppMetaGraphClientOptions {
  appId: string;
  appSecret: string;
  graphApiVersion: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class WhatsAppMetaGraphClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly graphApiVersion: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: WhatsAppMetaGraphClientOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.graphApiVersion = options.graphApiVersion;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async requestJson(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE';
      accessToken?: string;
      query?: Record<string, string>;
      body?: JsonRecord;
      atMostOnceWrite?: boolean;
      unversionedApi?: boolean;
    } = {},
  ): Promise<JsonRecord> {
    const url = new URL(options.unversionedApi
      ? `https://api.facebook.com/${path}`
      : `https://graph.facebook.com/${this.graphApiVersion}/${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const abortController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: options.method ?? 'GET',
          signal: abortController.signal,
          headers: {
            ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        });
      } catch {
        throw new WhatsAppMetaGraphError(
          timedOut ? 'META_TIMEOUT' : 'META_NETWORK_ERROR',
          null,
          Boolean(options.atMostOnceWrite),
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new WhatsAppMetaGraphError(
          timedOut ? 'META_TIMEOUT' : 'META_INVALID_JSON_RESPONSE',
          response.status,
          Boolean(options.atMostOnceWrite),
        );
      }
      if (!response.ok) {
        throw new WhatsAppMetaGraphError(
          providerFailureCode(response.status, payload),
          response.status,
          Boolean(options.atMostOnceWrite) && response.status >= 500,
        );
      }
      const record = asRecord(payload);
      if (!record) {
        throw new WhatsAppMetaGraphError(
          'META_INVALID_RESPONSE',
          response.status,
          Boolean(options.atMostOnceWrite),
        );
      }
      return record;
    } finally {
      clearTimeout(timeout);
    }
  }

  async exchangeEmbeddedSignupCode(code: string): Promise<string> {
    const payload = await this.requestJson('oauth/access_token', {
      query: {
        client_id: this.appId,
        client_secret: this.appSecret,
        code,
      },
    });
    const accessToken = payload.access_token;
    if (typeof accessToken !== 'string' || accessToken.length < 32 || accessToken.length > 4096) {
      throw new WhatsAppMetaGraphError('META_TOKEN_RESPONSE_INVALID', 200, false);
    }
    return accessToken;
  }

  async validateAccessToken(accessToken: string, expectedWabaId: string): Promise<void> {
    const payload = await this.requestJson('debug_token', {
      query: {
        input_token: accessToken,
        access_token: `${this.appId}|${this.appSecret}`,
      },
    });
    const data = asRecord(payload.data);
    if (!data || data.is_valid !== true || String(data.app_id ?? '') !== this.appId) {
      throw new WhatsAppMetaGraphError('META_TOKEN_INVALID', 200, false);
    }

    const scopes = Array.isArray(data.scopes)
      ? data.scopes.filter((scope): scope is string => typeof scope === 'string')
      : [];
    const requiredScopes = ['whatsapp_business_management', 'whatsapp_business_messaging'];
    if (requiredScopes.some((scope) => !scopes.includes(scope))) {
      throw new WhatsAppMetaGraphError('META_TOKEN_SCOPES_MISSING', 200, false);
    }

    const granularScopes = Array.isArray(data.granular_scopes) ? data.granular_scopes : [];
    const targetsExpectedWaba = granularScopes.some((scopeValue) => {
      const scope = asRecord(scopeValue);
      const targetIds = Array.isArray(scope?.target_ids) ? scope.target_ids : [];
      return requiredScopes.includes(String(scope?.scope ?? ''))
        && targetIds.some((targetId) => String(targetId) === expectedWabaId);
    });
    if (!targetsExpectedWaba) {
      throw new WhatsAppMetaGraphError('META_TOKEN_WABA_SCOPE_MISMATCH', 200, false);
    }
  }

  async listWabaPhoneNumberIds(accessToken: string, wabaId: string): Promise<string[]> {
    const payload = await this.requestJson(`${encodeURIComponent(wabaId)}/phone_numbers`, {
      accessToken,
      query: { fields: 'id', limit: '100' },
    });
    if (!Array.isArray(payload.data)) {
      throw new WhatsAppMetaGraphError('META_PHONE_LIST_INVALID', 200, false);
    }
    return payload.data.map((value) => {
      const id = asRecord(value)?.id;
      if (typeof id !== 'string' || !/^\d{1,64}$/.test(id)) {
        throw new WhatsAppMetaGraphError('META_PHONE_LIST_INVALID', 200, false);
      }
      return id;
    });
  }

  async assertCoexistencePhone(accessToken: string, phoneNumberId: string): Promise<void> {
    const payload = await this.requestJson(encodeURIComponent(phoneNumberId), {
      accessToken,
      query: { fields: 'is_on_biz_app,platform_type' },
    });
    if (payload.is_on_biz_app !== true || payload.platform_type !== 'CLOUD_API') {
      throw new WhatsAppMetaGraphError('META_PHONE_NOT_COEXISTENCE', 200, false);
    }
  }

  async isAppSubscribedToWaba(accessToken: string, wabaId: string): Promise<boolean> {
    const payload = await this.requestJson(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
      accessToken,
      query: { limit: '100' },
    });
    if (!Array.isArray(payload.data)) {
      throw new WhatsAppMetaGraphError('META_SUBSCRIPTION_LIST_INVALID', 200, false);
    }

    let malformedEntry = false;
    for (const value of payload.data) {
      const subscription = asRecord(value);
      const app = subscription && asRecord(subscription.whatsapp_business_api_data);
      // Graph versions have returned both a top-level app object and a nested
      // whatsapp_business_api_data object for this edge. Accept only an exact,
      // syntactically valid app id from either documented envelope.
      const subscribedAppId = app?.id ?? subscription?.id;
      if (typeof subscribedAppId !== 'string' || !/^\d{1,64}$/.test(subscribedAppId)) {
        malformedEntry = true;
        continue;
      }
      if (subscribedAppId === this.appId) return true;
    }
    if (malformedEntry) {
      // A partial or future response shape must not be interpreted as a
      // definitive missing subscription. A valid match above is sufficient;
      // otherwise surface an unknown provider response for safe retry.
      throw new WhatsAppMetaGraphError('META_SUBSCRIPTION_LIST_INVALID', 200, false);
    }
    return false;
  }

  async subscribeWaba(accessToken: string, wabaId: string): Promise<void> {
    const payload = await this.requestJson(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: 'POST',
      accessToken,
      atMostOnceWrite: true,
    });
    if (payload.success !== true && payload.success !== 'true') {
      throw new WhatsAppMetaGraphError('META_SUBSCRIPTION_RESPONSE_INVALID', 200, false);
    }
  }

  async dispatchCoexistenceSync(
    accessToken: string,
    phoneNumberId: string,
    syncType: WhatsAppCoexistenceSyncType,
  ): Promise<string> {
    const payload = await this.requestJson(`${encodeURIComponent(phoneNumberId)}/smb_app_data`, {
      method: 'POST',
      accessToken,
      body: {
        messaging_product: 'whatsapp',
        sync_type: syncType,
      },
      atMostOnceWrite: true,
    });
    const requestId = payload.request_id;
    if (
      typeof requestId !== 'string'
      || requestId.length === 0
      || requestId.length > 256
      || /[\u0000-\u001f\u007f]/.test(requestId)
    ) {
      throw new WhatsAppMetaGraphError('META_SYNC_RESPONSE_INVALID', 200, true);
    }
    return requestId;
  }

  async sendTemplateMessage(
    accessToken: string,
    phoneNumberId: string,
    request: WhatsAppTemplateMessageRequest,
  ): Promise<string> {
    const preparedComponents = request.components === undefined
      ? undefined
      : asTemplateComponents(request.components);
    if (
      !/^\+?[1-9]\d{7,14}$/.test(request.recipient)
      || !TEMPLATE_NAME.test(request.templateName)
      || !LANGUAGE_CODE.test(request.languageCode)
      || preparedComponents === null
    ) {
      throw new WhatsAppMetaGraphError('META_MESSAGE_REQUEST_INVALID', null, false);
    }
    const payload = await this.requestJson(`${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      accessToken,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: request.recipient.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: request.templateName,
          language: { code: request.languageCode },
          ...(preparedComponents === undefined ? {} : { components: preparedComponents }),
        },
      },
      // Meta does not provide an idempotency key for this write. Never replay a
      // request whose outcome could already have been accepted by the provider.
      atMostOnceWrite: true,
    });
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const messageId = asRecord(messages[0])?.id;
    if (
      typeof messageId !== 'string'
      || messageId.length === 0
      || messageId.length > 256
      || /[\u0000-\u001f\u007f]/.test(messageId)
    ) {
      throw new WhatsAppMetaGraphError('META_MESSAGE_RESPONSE_INVALID', 200, true);
    }
    return messageId;
  }

  async listMessageTemplates(
    accessToken: string,
    wabaId: string,
  ): Promise<WhatsAppMessageTemplateRecord[]> {
    assertTemplateId(wabaId);
    const templates: WhatsAppMessageTemplateRecord[] = [];
    const seenCursors = new Set<string>();
    let after: string | undefined;

    for (let page = 0; page < MAX_TEMPLATE_LIST_PAGES; page += 1) {
      const payload = await this.requestJson(`${encodeURIComponent(wabaId)}/message_templates`, {
        accessToken,
        query: {
          fields: TEMPLATE_FIELDS,
          limit: String(TEMPLATE_PAGE_SIZE),
          ...(after ? { after } : {}),
        },
      });
      if (!Array.isArray(payload.data)) {
        throw new WhatsAppMetaGraphError('META_TEMPLATE_LIST_INVALID', 200, false);
      }
      templates.push(...payload.data.map((value) => (
        parseTemplateRecord(value, 'META_TEMPLATE_LIST_INVALID')
      )));

      if (payload.paging === undefined || payload.paging === null) return templates;
      const paging = asRecord(payload.paging);
      const cursors = paging && asRecord(paging.cursors);
      const next = paging?.next;
      if (!paging || (next !== undefined && next !== null && typeof next !== 'string')) {
        throw new WhatsAppMetaGraphError('META_TEMPLATE_LIST_INVALID', 200, false);
      }

      // `next` is Graph's definitive signal, but only its presence is trusted;
      // requests are rebuilt locally from the opaque `after` cursor.
      const hasNextPage = typeof next === 'string' && next.length > 0;
      if (!hasNextPage) return templates;
      const nextAfter = safeProviderString(cursors?.after, 2048);
      if (!nextAfter || seenCursors.has(nextAfter)) {
        throw new WhatsAppMetaGraphError('META_TEMPLATE_LIST_INVALID', 200, false);
      }
      seenCursors.add(nextAfter);
      after = nextAfter;
    }

    throw new WhatsAppMetaGraphError('META_TEMPLATE_LIST_PAGE_LIMIT', 200, false);
  }

  async getMessageTemplate(
    accessToken: string,
    templateId: string,
  ): Promise<WhatsAppMessageTemplateRecord> {
    assertTemplateId(templateId);
    const payload = await this.requestJson(encodeURIComponent(templateId), {
      accessToken,
      query: { fields: TEMPLATE_FIELDS },
    });
    return parseTemplateRecord(payload, 'META_TEMPLATE_GET_INVALID');
  }

  async createMessageTemplate(
    accessToken: string,
    wabaId: string,
    definition: WhatsAppTemplateDefinition,
  ): Promise<WhatsAppTemplateMutationResult> {
    assertTemplateId(wabaId);
    assertTemplateDefinition(definition);
    const payload = await this.requestJson(`${encodeURIComponent(wabaId)}/message_templates`, {
      method: 'POST',
      accessToken,
      body: {
        name: definition.name,
        language: definition.language,
        category: definition.category,
        parameter_format: definition.parameterFormat,
        components: definition.components,
        ...(definition.messageSendTtlSeconds === null
          ? {}
          : { message_send_ttl_seconds: definition.messageSendTtlSeconds }),
      },
      atMostOnceWrite: true,
    });
    const id = payload.id;
    const status = safeProviderString(payload.status, 64);
    const category = safeProviderString(payload.category, 64);
    if (typeof id !== 'string' || !META_ID.test(id) || !status || !category) {
      throw new WhatsAppMetaGraphError('META_TEMPLATE_CREATE_RESPONSE_INVALID', 200, true);
    }
    return { id, status, category };
  }

  async updateMessageTemplate(
    accessToken: string,
    templateId: string,
    definition: WhatsAppTemplateDefinition,
    options: { includeCategory?: boolean } = {},
  ): Promise<void> {
    assertTemplateId(templateId);
    assertTemplateDefinition(definition);
    const payload = await this.requestJson(encodeURIComponent(templateId), {
      method: 'POST',
      accessToken,
      body: {
        ...(options.includeCategory === false ? {} : { category: definition.category }),
        components: definition.components,
        ...(definition.messageSendTtlSeconds === null
          ? {}
          : { message_send_ttl_seconds: definition.messageSendTtlSeconds }),
      },
      atMostOnceWrite: true,
    });
    assertMutationSuccess(payload, 'META_TEMPLATE_UPDATE_RESPONSE_INVALID');
  }

  async deleteMessageTemplate(
    accessToken: string,
    wabaId: string,
    templateId: string,
    templateName: string,
  ): Promise<void> {
    assertTemplateId(wabaId);
    assertTemplateId(templateId);
    if (!TEMPLATE_NAME.test(templateName)) {
      throw new WhatsAppMetaGraphError('META_TEMPLATE_REQUEST_INVALID', null, false);
    }
    const payload = await this.requestJson(`${encodeURIComponent(wabaId)}/message_templates`, {
      method: 'DELETE',
      accessToken,
      query: { hsm_id: templateId, name: templateName },
      atMostOnceWrite: true,
    });
    assertMutationSuccess(payload, 'META_TEMPLATE_DELETE_RESPONSE_INVALID');
  }

  private async setTemplateArchiveState(
    accessToken: string,
    wabaId: string,
    templateIds: string[],
    operation: 'archive' | 'unarchive',
  ): Promise<void> {
    assertTemplateId(wabaId);
    if (
      templateIds.length === 0
      || templateIds.length > 100
      || templateIds.some((id) => !META_ID.test(id))
      || new Set(templateIds).size !== templateIds.length
    ) {
      throw new WhatsAppMetaGraphError('META_TEMPLATE_REQUEST_INVALID', null, false);
    }
    const payload = await this.requestJson(
      `${encodeURIComponent(wabaId)}/message_templates/${operation}`,
      {
        method: 'POST',
        accessToken,
        // Unlike most Graph list inputs, this legacy endpoint expects a single
        // comma-separated string rather than a JSON array.
        body: { hsm_ids: templateIds.join(',') },
        atMostOnceWrite: true,
        // Meta's archival API is intentionally hosted outside the versioned
        // Graph origin documented for the rest of template management.
        unversionedApi: true,
      },
    );
    assertBulkArchiveResponse(payload, templateIds, operation);
  }

  async archiveMessageTemplates(
    accessToken: string,
    wabaId: string,
    templateIds: string[],
  ): Promise<void> {
    return this.setTemplateArchiveState(accessToken, wabaId, templateIds, 'archive');
  }

  async unarchiveMessageTemplates(
    accessToken: string,
    wabaId: string,
    templateIds: string[],
  ): Promise<void> {
    return this.setTemplateArchiveState(accessToken, wabaId, templateIds, 'unarchive');
  }

  async unpauseMessageTemplate(accessToken: string, templateId: string): Promise<void> {
    assertTemplateId(templateId);
    const payload = await this.requestJson(`${encodeURIComponent(templateId)}/unpause`, {
      method: 'POST',
      accessToken,
      atMostOnceWrite: true,
    });
    assertMutationSuccess(payload, 'META_TEMPLATE_UNPAUSE_RESPONSE_INVALID');
  }
}
