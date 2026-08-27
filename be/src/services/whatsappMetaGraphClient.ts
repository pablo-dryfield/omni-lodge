export type WhatsAppCoexistenceSyncType = 'smb_app_state_sync' | 'history';

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;

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
      method?: 'GET' | 'POST';
      accessToken?: string;
      query?: Record<string, string>;
      body?: JsonRecord;
      atMostOnceWrite?: boolean;
    } = {},
  ): Promise<JsonRecord> {
    const url = new URL(`https://graph.facebook.com/${this.graphApiVersion}/${path}`);
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
          true,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new WhatsAppMetaGraphError(
          timedOut ? 'META_TIMEOUT' : 'META_INVALID_JSON_RESPONSE',
          response.status,
          Boolean(options.atMostOnceWrite) || response.status >= 500,
        );
      }
      if (!response.ok) {
        throw new WhatsAppMetaGraphError(
          providerFailureCode(response.status, payload),
          response.status,
          response.status >= 500,
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

  async subscribeWaba(accessToken: string, wabaId: string): Promise<void> {
    const payload = await this.requestJson(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: 'POST',
      accessToken,
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
}
