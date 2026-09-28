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

  it('checks whether this app is present in the WABA subscription list', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(200, {
        data: [{ id: '111222333', name: 'Another app' }],
      }))
      .mockResolvedValueOnce(response(200, {
        data: [
          { future_provider_shape: true },
          { whatsapp_business_api_data: { id: appId } },
        ],
      }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(client.isAppSubscribedToWaba(accessToken, '987654321')).resolves.toBe(false);
    await expect(client.isAppSubscribedToWaba(accessToken, '987654321')).resolves.toBe(true);

    const [url, request] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://graph.facebook.com/v25.0/987654321/subscribed_apps?limit=100');
    expect(request.method).toBe('GET');
    expect(request.headers).toEqual({ Authorization: `Bearer ${accessToken}` });
  });

  it('rejects malformed WABA subscription lists without exposing provider data', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      data: [{ whatsapp_business_api_data: { provider_secret: 'do-not-expose' } }],
    }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    const failure = await client.isAppSubscribedToWaba(accessToken, '987654321')
      .catch((error) => error);

    expect(failure).toMatchObject({
      safeCode: 'META_SUBSCRIPTION_LIST_INVALID',
      ambiguous: false,
    });
    expect(JSON.stringify(failure)).not.toContain('do-not-expose');
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

  it('lists message templates with rich metadata and the bounded documented field selection', async () => {
    const providerTemplate = {
      id: '123456789',
      name: 'simple_notice',
      status: 'FUTURE_REVIEW_STATE',
      language: 'en_US',
      category: 'FUTURE_CATEGORY',
      components: [{
        type: 'FUTURE_COMPONENT',
        nested_future_property: { enabled: true },
      }],
      quality_score: { score: 'FUTURE_QUALITY', date: 123 },
      rejected_reason: 'FUTURE_REASON',
      previous_category: 'UTILITY',
      correct_category: 'MARKETING',
      last_updated_time: '2026-09-28T10:30:00+0000',
      message_send_ttl_seconds: 3600,
      parameter_format: 'FUTURE_FORMAT',
    };
    const fetchImpl = jest.fn().mockResolvedValue(response(200, { data: [providerTemplate] }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(client.listMessageTemplates(accessToken, '123456789')).resolves.toEqual([{
      id: '123456789',
      name: 'simple_notice',
      status: 'FUTURE_REVIEW_STATE',
      language: 'en_US',
      category: 'FUTURE_CATEGORY',
      components: providerTemplate.components,
      qualityScore: 'FUTURE_QUALITY',
      rejectedReason: 'FUTURE_REASON',
      previousCategory: 'UTILITY',
      correctCategory: 'MARKETING',
      lastUpdatedTime: '2026-09-28T10:30:00+0000',
      messageSendTtlSeconds: 3600,
      parameterFormat: 'FUTURE_FORMAT',
    }]);

    const [url, request] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe(
      'https://graph.facebook.com/v25.0/123456789/message_templates',
    );
    expect(url.searchParams.get('fields')).toBe(
      'id,name,status,language,category,components,quality_score,rejected_reason,'
      + 'previous_category,correct_category,last_updated_time,message_send_ttl_seconds,'
      + 'parameter_format',
    );
    expect(url.searchParams.get('limit')).toBe('100');
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

  it('follows opaque paging cursors without trusting the provider next URL', async () => {
    const first = {
      id: '1001',
      name: 'first_template',
      status: 'APPROVED',
      language: 'en_US',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'First' }],
    };
    const second = {
      id: '1002',
      name: 'second_template',
      status: 'PENDING',
      language: 'en_US',
      category: 'MARKETING',
      components: [{ type: 'BODY', text: 'Second' }],
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(200, {
        data: [first],
        paging: {
          cursors: { after: 'opaque+/cursor==' },
          next: 'https://attacker.invalid/do-not-follow',
        },
      }))
      .mockResolvedValueOnce(response(200, { data: [second] }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    const templates = await client.listMessageTemplates(accessToken, '123456789');

    expect(templates.map(({ id }) => id)).toEqual(['1001', '1002']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [secondUrl] = fetchImpl.mock.calls[1] as [URL, RequestInit];
    expect(secondUrl.origin).toBe('https://graph.facebook.com');
    expect(secondUrl.searchParams.get('after')).toBe('opaque+/cursor==');
  });

  it('stops template pagination at the defensive page ceiling', async () => {
    let page = 0;
    const fetchImpl = jest.fn().mockImplementation(async () => {
      page += 1;
      return response(200, {
        data: [],
        paging: {
          cursors: { after: `cursor-${page}` },
          next: `https://graph.facebook.com/ignored?page=${page + 1}`,
        },
      });
    });
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(client.listMessageTemplates(accessToken, '123456789')).rejects.toMatchObject({
      safeCode: 'META_TEMPLATE_LIST_PAGE_LIMIT',
      ambiguous: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(100);
  });

  it('gets a single template and normalizes a numeric provider timestamp', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      id: '1001',
      name: 'booking_update',
      status: 'APPROVED',
      language: 'en_US',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Updated.' }],
      quality_score: 'GREEN',
      last_updated_time: 1_795_000_000,
    }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    const template = await client.getMessageTemplate(accessToken, '1001');

    expect(template).toMatchObject({
      id: '1001',
      qualityScore: 'GREEN',
      parameterFormat: 'POSITIONAL',
      lastUpdatedTime: new Date(1_795_000_000_000).toISOString(),
    });
    const [url] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/v25.0/1001');
    expect(url.searchParams.get('fields')).toContain('quality_score');
  });

  it('creates a full template definition and preserves future response enum strings', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      id: '9001',
      status: 'FUTURE_PENDING_STATE',
      category: 'FUTURE_CATEGORY',
    }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });
    const definition = {
      name: 'booking_confirmation',
      language: 'en_US',
      category: 'UTILITY' as const,
      parameterFormat: 'NAMED' as const,
      messageSendTtlSeconds: 3600,
      components: [{ type: 'BODY', text: 'Hello {{guest_first_name}}' }],
    };

    await expect(client.createMessageTemplate(
      accessToken,
      '123456789',
      definition,
    )).resolves.toEqual({
      id: '9001',
      status: 'FUTURE_PENDING_STATE',
      category: 'FUTURE_CATEGORY',
    });

    const [url, request] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/v25.0/123456789/message_templates');
    expect(request.method).toBe('POST');
    expect(JSON.parse(String(request.body))).toEqual({
      name: 'booking_confirmation',
      language: 'en_US',
      category: 'UTILITY',
      parameter_format: 'NAMED',
      components: definition.components,
      message_send_ttl_seconds: 3600,
    });
  });

  it('uses safe one-shot requests for update, delete, archive, unarchive, and unpause', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(200, { success: true }))
      .mockResolvedValueOnce(response(200, { success: true }))
      .mockResolvedValueOnce(response(200, {
        archived_templates: ['9001', '9002'],
        failed_templates: {},
      }))
      .mockResolvedValueOnce(response(200, {
        unarchived_templates: ['9001'],
        failed_templates: {},
      }))
      .mockResolvedValueOnce(response(200, { success: true }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });
    const definition = {
      name: 'booking_confirmation',
      language: 'en_US',
      category: 'UTILITY' as const,
      parameterFormat: 'POSITIONAL' as const,
      messageSendTtlSeconds: null,
      components: [{ type: 'BODY', text: 'Booking confirmed.' }],
    };

    await client.updateMessageTemplate(accessToken, '9001', definition);
    await client.deleteMessageTemplate(
      accessToken,
      '123456789',
      '9001',
      'booking_confirmation',
    );
    await client.archiveMessageTemplates(accessToken, '123456789', ['9001', '9002']);
    await client.unarchiveMessageTemplates(accessToken, '123456789', ['9001']);
    await client.unpauseMessageTemplate(accessToken, '9001');

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    const [updateUrl, updateRequest] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(updateUrl.pathname).toBe('/v25.0/9001');
    expect(JSON.parse(String(updateRequest.body))).toEqual({
      category: 'UTILITY',
      components: definition.components,
    });
    const [deleteUrl, deleteRequest] = fetchImpl.mock.calls[1] as [URL, RequestInit];
    expect(deleteRequest.method).toBe('DELETE');
    expect(deleteUrl.searchParams.get('hsm_id')).toBe('9001');
    expect(deleteUrl.searchParams.get('name')).toBe('booking_confirmation');
    const [archiveUrl, archiveRequest] = fetchImpl.mock.calls[2] as [URL, RequestInit];
    expect(archiveUrl.toString()).toBe(
      'https://api.facebook.com/123456789/message_templates/archive',
    );
    expect(JSON.parse(String(archiveRequest.body))).toEqual({ hsm_ids: '9001,9002' });
    const [unarchiveUrl, unarchiveRequest] = fetchImpl.mock.calls[3] as [URL, RequestInit];
    expect(unarchiveUrl.toString()).toBe(
      'https://api.facebook.com/123456789/message_templates/unarchive',
    );
    expect(JSON.parse(String(unarchiveRequest.body))).toEqual({ hsm_ids: '9001' });
    const [unpauseUrl] = fetchImpl.mock.calls[4] as [URL, RequestInit];
    expect(unpauseUrl.pathname).toBe('/v25.0/9001/unpause');
  });

  it('includes prepared send components without changing their provider shape', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      messages: [{ id: 'wamid.parameterized' }],
    }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });
    const components = [{
      type: 'body',
      parameters: [{ type: 'text', parameter_name: 'guest_first_name', text: 'Alex' }],
    }];

    await client.sendTemplateMessage(accessToken, '987654321', {
      recipient: '+48502484066',
      templateName: 'booking_confirmation',
      languageCode: 'en_US',
      components,
    });

    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body)).template.components).toEqual(components);
  });

  it('marks an unconfirmed template mutation as ambiguous and never retries it', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, { success: false }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(client.unpauseMessageTemplate(accessToken, '9001')).rejects.toMatchObject({
      safeCode: 'META_TEMPLATE_UNPAUSE_RESPONSE_INVALID',
      ambiguous: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('marks a partial bulk archive result as ambiguous so callers reconcile it', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      archived_templates: ['9001'],
      failed_templates: { '9002': 'Template could not be archived.' },
    }));
    const client = new WhatsAppMetaGraphClient({
      appId,
      appSecret,
      graphApiVersion: 'v25.0',
      fetchImpl,
    });

    await expect(
      client.archiveMessageTemplates(accessToken, '123456789', ['9001', '9002']),
    ).rejects.toMatchObject({
      safeCode: 'META_TEMPLATE_ARCHIVE_PARTIAL_FAILURE',
      ambiguous: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
