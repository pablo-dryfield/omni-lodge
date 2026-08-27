import {
  WhatsAppMetaGraphClient,
  WhatsAppMetaGraphError,
} from '../whatsappMetaGraphClient';

const response = (
  status: number,
  payload: unknown,
  jsonImpl?: () => Promise<unknown>,
): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: jsonImpl ?? jest.fn().mockResolvedValue(payload),
} as unknown as Response);

const appId = '828737393371751';
const appSecret = 'a'.repeat(32);
const accessToken = 'token'.repeat(20);

describe('WhatsApp Meta Graph client', () => {
  it('exchanges the one-use code without exposing provider failure text', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(400, {
      error: {
        type: 'OAuthException',
        code: 190,
        error_subcode: 123,
        message: 'provider echoed a sensitive authorization code',
      },
    }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    const failure = await client.exchangeEmbeddedSignupCode('one-use-code').catch((error) => error);

    expect(failure).toBeInstanceOf(WhatsAppMetaGraphError);
    expect(failure.safeCode).toBe('META_400_OAUTHEXCEPTION_190_123');
    expect(failure.message).toBe('Meta Graph request failed');
    expect(JSON.stringify(failure)).not.toContain('one-use-code');
    expect(JSON.stringify(failure)).not.toContain('authorization code');
  });

  it('validates app identity, required scopes, and WABA granular targeting', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      data: {
        app_id: appId,
        is_valid: true,
        scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
        granular_scopes: [{
          scope: 'whatsapp_business_management',
          target_ids: ['123456789'],
        }],
      },
    }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(client.validateAccessToken(accessToken, '123456789')).resolves.toBeUndefined();
  });

  it('sends the documented coexistence sync body and returns its request ID', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, { request_id: 'sync-request-1' }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(
      client.dispatchCoexistenceSync(accessToken, '987654321', 'smb_app_state_sync'),
    ).resolves.toBe('sync-request-1');
    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(JSON.parse(String(request.body))).toEqual({
      messaging_product: 'whatsapp',
      sync_type: 'smb_app_state_sync',
    });
  });

  it('classifies a malformed successful one-shot response as ambiguous', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(
      200,
      null,
      jest.fn().mockRejectedValue(new Error('truncated body')),
    ));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    const failure = await client
      .dispatchCoexistenceSync(accessToken, '987654321', 'history')
      .catch((error) => error);

    expect(failure).toBeInstanceOf(WhatsAppMetaGraphError);
    expect(failure.safeCode).toBe('META_INVALID_JSON_RESPONSE');
    expect(failure.ambiguous).toBe(true);
  });

  it('keeps the default timeout active while the response body is being parsed', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(async (_input, init?: RequestInit) => response(
        200,
        null,
        () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted body')));
        }),
      ));
      const client = new WhatsAppMetaGraphClient({
        appId,
        appSecret,
        graphApiVersion: 'v25.0',
        fetchImpl,
      });

      const pending = client.dispatchCoexistenceSync(accessToken, '987654321', 'history');
      const rejection = expect(pending).rejects.toMatchObject({
        safeCode: 'META_TIMEOUT',
        ambiguous: true,
      });
      await jest.advanceTimersByTimeAsync(10_000);
      await rejection;
    } finally {
      jest.useRealTimers();
    }
  });

  it('requires a verified Cloud API coexistence phone', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      id: '987654321',
      is_on_biz_app: false,
      platform_type: 'CLOUD_API',
    }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(client.assertCoexistencePhone(accessToken, '987654321')).rejects.toMatchObject({
      safeCode: 'META_PHONE_NOT_COEXISTENCE',
      ambiguous: false,
    });
  });
});
