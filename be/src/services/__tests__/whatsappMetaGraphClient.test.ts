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

  it('sends a template message without the E.164 plus sign and returns only the provider ID', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      messaging_product: 'whatsapp',
      contacts: [{ input: '48502484066', wa_id: '48502484066' }],
      messages: [{ id: 'wamid.accepted-message-id' }],
    }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(client.sendTemplateMessage(accessToken, '987654321', {
      recipient: '+48502484066',
      templateName: 'hello_world',
      languageCode: 'en_US',
    })).resolves.toBe('wamid.accepted-message-id');

    const [url, request] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://graph.facebook.com/v25.0/987654321/messages');
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual({
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(request.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '48502484066',
      type: 'template',
      template: {
        name: 'hello_world',
        language: { code: 'en_US' },
      },
    });
  });

  it('treats a successful template response without a message ID as ambiguous', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, { messages: [] }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(client.sendTemplateMessage(accessToken, '987654321', {
      recipient: '+48502484066',
      templateName: 'hello_world',
      languageCode: 'en_US',
    })).rejects.toMatchObject({
      safeCode: 'META_MESSAGE_RESPONSE_INVALID',
      ambiguous: true,
    });
  });

  it('lists message templates with the bounded documented field selection', async () => {
    const template = {
      id: '123456789',
      name: 'simple_notice',
      status: 'APPROVED',
      language: 'en_US',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'This is a fixed notice.' }],
    };
    const fetchImpl = jest.fn().mockResolvedValue(response(200, { data: [template] }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(client.listMessageTemplates(accessToken, '123456789')).resolves.toEqual([template]);

    const [url, request] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      'https://graph.facebook.com/v25.0/123456789/message_templates'
      + '?fields=id%2Cname%2Cstatus%2Clanguage%2Ccategory%2Ccomponents&limit=100',
    );
    expect(request.method).toBe('GET');
    expect(request.headers).toEqual({ Authorization: `Bearer ${accessToken}` });
  });

  it('rejects malformed template-list responses without returning provider data', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      data: [{ id: '123', name: 'unsafe name', provider_secret: 'do-not-expose' }],
    }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    const failure = await client.listMessageTemplates(accessToken, '123456789')
      .catch((error) => error);
    expect(failure).toMatchObject({
      safeCode: 'META_TEMPLATE_LIST_INVALID',
      ambiguous: false,
    });
    expect(JSON.stringify(failure)).not.toContain('do-not-expose');
  });
});
