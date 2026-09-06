jest.mock('../configService.js', () => ({
  getConfigValueRaw: jest.fn(),
  refreshConfigCacheKeys: jest.fn(),
}));
jest.mock('../../config/whatsappConfig.js', () => {
  const actual = jest.requireActual('../../config/whatsappConfig.js');
  return {
    ...actual,
    getWhatsAppEmbeddedSignupConfig: jest.fn(() => ({
      appId: '828737393371751',
      appSecret: 'a'.repeat(32),
      configId: '2148233786074769',
      graphApiVersion: 'v25.0',
    })),
  };
});

import { getConfigValueRaw, refreshConfigCacheKeys } from '../configService';
import { WhatsAppMetaGraphError } from '../whatsappMetaGraphClient';
import {
  listWhatsAppMessageTemplates,
  sendWhatsAppTemplateMessage,
} from '../whatsappOutboundMessageService';

const token = 'token'.repeat(20);
const mockGetConfigValueRaw = getConfigValueRaw as jest.Mock;
const mockRefreshConfigCacheKeys = refreshConfigCacheKeys as jest.Mock;

describe('WhatsApp outbound message service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshConfigCacheKeys.mockResolvedValue(undefined);
    mockGetConfigValueRaw.mockImplementation((key: string) => {
      if (key === 'WHATSAPP_BUSINESS_ACCESS_TOKEN') return token;
      if (key === 'WHATSAPP_WABA_ID') return '123456789';
      if (key === 'WHATSAPP_PHONE_NUMBER_ID') return '987654321';
      return null;
    });
  });

  it('uses the system-managed Embedded Signup token and phone number', async () => {
    const graphClient = {
      listMessageTemplates: jest.fn().mockResolvedValue([{
        id: '1',
        name: 'hello_world',
        status: 'APPROVED',
        language: 'en_US',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: 'Hello world' }],
      }]),
      sendTemplateMessage: jest.fn().mockResolvedValue('wamid.accepted-message-id'),
    };

    await expect(sendWhatsAppTemplateMessage({
      recipient: '+48502484066',
      templateName: 'hello_world',
      languageCode: 'en_US',
      graphClient,
    })).resolves.toEqual({ messageId: 'wamid.accepted-message-id' });

    expect(mockRefreshConfigCacheKeys).toHaveBeenCalledWith(expect.arrayContaining([
      'WHATSAPP_BUSINESS_ACCESS_TOKEN',
      'WHATSAPP_WABA_ID',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_META_GRAPH_API_VERSION',
    ]));
    expect(graphClient.listMessageTemplates).toHaveBeenCalledWith(token, '123456789');
    expect(graphClient.sendTemplateMessage).toHaveBeenCalledWith(
      token,
      '987654321',
      {
        recipient: '+48502484066',
        templateName: 'hello_world',
        languageCode: 'en_US',
      },
    );
  });

  it.each([
    [{ recipient: '48502484066', templateName: 'hello_world', languageCode: 'en_US' }, 'recipient'],
    [{ recipient: '+48502484066 ', templateName: 'hello_world', languageCode: 'en_US' }, 'recipient'],
    [{ recipient: '+48502484066', templateName: 'Hello World', languageCode: 'en_US' }, 'template'],
    [{ recipient: '+48502484066', templateName: 'hello_world', languageCode: 'EN-us' }, 'language'],
  ])('rejects invalid outbound input before reading credentials: %s', async (input, field) => {
    const graphClient = {
      listMessageTemplates: jest.fn(),
      sendTemplateMessage: jest.fn(),
    };

    await expect(sendWhatsAppTemplateMessage({ ...input, graphClient })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(field),
    });

    expect(mockRefreshConfigCacheKeys).not.toHaveBeenCalled();
    expect(graphClient.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('fails closed when the system-managed connection tuple is unavailable', async () => {
    mockGetConfigValueRaw.mockReturnValue(null);
    const graphClient = {
      listMessageTemplates: jest.fn(),
      sendTemplateMessage: jest.fn(),
    };

    await expect(sendWhatsAppTemplateMessage({
      recipient: '+48502484066',
      templateName: 'hello_world',
      languageCode: 'en_US',
      graphClient,
    })).rejects.toMatchObject({
      status: 409,
      message: 'WhatsApp Business is not connected for outbound messaging.',
    });

    expect(graphClient.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('surfaces an ambiguous provider outcome without exposing credentials', async () => {
    const graphClient = {
      listMessageTemplates: jest.fn().mockResolvedValue([{
        id: '1',
        name: 'hello_world',
        status: 'APPROVED',
        language: 'en_US',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: 'Hello world' }],
      }]),
      sendTemplateMessage: jest.fn().mockRejectedValue(
        new WhatsAppMetaGraphError('META_TIMEOUT', null, true),
      ),
    };

    const failure = await sendWhatsAppTemplateMessage({
      recipient: '+48502484066',
      templateName: 'hello_world',
      languageCode: 'en_US',
      graphClient,
    }).catch((error) => error);

    expect(failure).toMatchObject({
      status: 502,
      message: 'Meta did not confirm whether the WhatsApp message was accepted. Check the destination chat before retrying.',
      details: { code: 'META_TIMEOUT', ambiguous: true },
    });
    expect(JSON.stringify(failure)).not.toContain(token);
    expect(JSON.stringify(failure)).not.toContain('+48502484066');
  });

  it('returns a safe rejection code for a definite provider failure', async () => {
    const graphClient = {
      listMessageTemplates: jest.fn().mockResolvedValue([{
        id: '1',
        name: 'hello_world',
        status: 'APPROVED',
        language: 'en_US',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: 'Hello world' }],
      }]),
      sendTemplateMessage: jest.fn().mockRejectedValue(
        new WhatsAppMetaGraphError('META_400_OAUTHEXCEPTION_131009', 400, false),
      ),
    };

    await expect(sendWhatsAppTemplateMessage({
      recipient: '+48502484066',
      templateName: 'hello_world',
      languageCode: 'en_US',
      graphClient,
    })).rejects.toMatchObject({
      status: 502,
      message: 'Meta rejected the WhatsApp message.',
      details: { code: 'META_400_OAUTHEXCEPTION_131009', ambiguous: false },
    });
  });

  it('lists only approved templates that need no parameters or media', async () => {
    const graphClient = {
      listMessageTemplates: jest.fn().mockResolvedValue([
        {
          id: '1',
          name: 'simple_notice',
          status: 'APPROVED',
          language: 'en_US',
          category: 'UTILITY',
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'OmniLodge' },
            { type: 'BODY', text: 'This is a fixed notice.' },
          ],
        },
        {
          id: '2',
          name: 'pending_notice',
          status: 'PENDING',
          language: 'en_US',
          category: 'UTILITY',
          components: [{ type: 'BODY', text: 'Pending' }],
        },
        {
          id: '3',
          name: 'parameter_notice',
          status: 'APPROVED',
          language: 'en_US',
          category: 'UTILITY',
          components: [{ type: 'BODY', text: 'Hello {{1}}' }],
        },
        {
          id: '4',
          name: 'media_notice',
          status: 'APPROVED',
          language: 'pl',
          category: 'MARKETING',
          components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Photo' }],
        },
      ]),
      sendTemplateMessage: jest.fn(),
    };

    await expect(listWhatsAppMessageTemplates(graphClient)).resolves.toEqual([{
      name: 'simple_notice',
      language: 'en_US',
      category: 'UTILITY',
    }]);
    expect(graphClient.listMessageTemplates).toHaveBeenCalledWith(token, '123456789');
  });

  it('re-verifies the exact template name and language before sending', async () => {
    const graphClient = {
      listMessageTemplates: jest.fn().mockResolvedValue([{
        id: '1',
        name: 'hello_world',
        status: 'PAUSED',
        language: 'en_US',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: 'Hello world' }],
      }]),
      sendTemplateMessage: jest.fn(),
    };

    await expect(sendWhatsAppTemplateMessage({
      recipient: '+48502484066',
      templateName: 'hello_world',
      languageCode: 'en_US',
      graphClient,
    })).rejects.toMatchObject({
      status: 409,
      message: 'The selected WhatsApp template is not currently approved and parameter-free.',
    });
    expect(graphClient.sendTemplateMessage).not.toHaveBeenCalled();
  });
});
