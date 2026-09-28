import AuditLog from '../../models/AuditLog.js';
import Booking from '../../models/Booking.js';
import WhatsAppTemplate from '../../models/WhatsAppTemplate.js';
import WhatsAppTemplateEvent from '../../models/WhatsAppTemplateEvent.js';
import WhatsAppTemplateSend from '../../models/WhatsAppTemplateSend.js';
import type { NormalizedWhatsAppTemplateEvent } from '../../types/whatsapp.js';
import {
  buildWhatsAppTemplateSendComponents,
} from '../whatsappTemplateVariableService.js';

jest.mock('../../config/whatsappConfig.js', () => ({
  getWhatsAppEmbeddedSignupConfig: jest.fn(() => ({})),
  WhatsAppConfigError: class WhatsAppConfigError extends Error {},
}));

jest.mock('../configService.js', () => ({
  refreshConfigCacheKeys: jest.fn().mockResolvedValue(undefined),
  getConfigValueRaw: jest.fn((key: string) => ({
    WHATSAPP_BUSINESS_ACCESS_TOKEN: 't'.repeat(64),
    WHATSAPP_WABA_ID: '123456789',
    WHATSAPP_PHONE_NUMBER_ID: '987654321',
  }[key] ?? null)),
}));

jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

jest.mock('../../models/AuditLog.js', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));

jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));

jest.mock('../../models/WhatsAppTemplate.js', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../../models/WhatsAppTemplateEvent.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), findAll: jest.fn(), findOne: jest.fn() },
}));

jest.mock('../../models/WhatsAppTemplateSend.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), findOne: jest.fn(), update: jest.fn() },
}));

jest.mock('../whatsappMetaGraphClient.js', () => ({
  WhatsAppMetaGraphClient: jest.fn().mockImplementation(() => ({})),
  WhatsAppMetaGraphError: class WhatsAppMetaGraphError extends Error {
    safeCode = 'META_ERROR';
    ambiguous = false;
  },
}));

jest.mock('../whatsappTemplateVariableService.js', () => ({
  listWhatsAppTemplateVariables: jest.fn(() => [
    {
      key: 'booking_reference',
      label: 'Booking reference',
      description: 'Booking reference',
      source: 'bookings.platform_booking_id',
      dataType: 'text',
      sampleValue: 'GYG 42/ABC',
      sensitivity: 'booking',
      nullable: false,
    },
    {
      key: 'guest_first_name',
      label: 'Guest first name',
      description: 'Guest first name',
      source: 'bookings.guest_first_name',
      dataType: 'text',
      sampleValue: 'Alex',
      sensitivity: 'customer',
      nullable: false,
    },
  ]),
  buildWhatsAppTemplateSendComponents: jest.fn(),
  renderWhatsAppTemplatePreview: jest.fn(),
}));

import {
  createManagedWhatsAppTemplate,
  ingestWhatsAppTemplateEvents,
  normalizeWhatsAppTemplateDefinition,
  sendManagedWhatsAppTemplate,
  syncManagedWhatsAppTemplates,
  updateManagedWhatsAppTemplate,
  updateWhatsAppTemplateSendStatuses,
} from '../whatsappTemplateManagementService.js';

const templateModel = WhatsAppTemplate as unknown as {
  create: jest.Mock;
  findAll: jest.Mock;
  findOne: jest.Mock;
  findOne: jest.Mock;
  update: jest.Mock;
};
const templateEventModel = WhatsAppTemplateEvent as unknown as {
  create: jest.Mock;
  findAll: jest.Mock;
};
const templateSendModel = WhatsAppTemplateSend as unknown as {
  create: jest.Mock;
  findOne: jest.Mock;
  update: jest.Mock;
};
const bookingModel = Booking as unknown as { findByPk: jest.Mock };
const auditLogModel = AuditLog as unknown as { create: jest.Mock };
const buildSendComponents = buildWhatsAppTemplateSendComponents as jest.Mock;

const makeTemplate = (overrides: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> & { update: jest.Mock } = {
    id: 7,
    wabaId: '123456789',
    metaTemplateId: '444555666',
    name: 'booking_confirmation',
    language: 'en_US',
    category: 'UTILITY',
    status: 'APPROVED',
    qualityScore: 'GREEN',
    parameterFormat: 'NAMED',
    components: [{ type: 'BODY', text: 'Hi {{guest_first_name}}' }],
    bookingBindings: {},
    messageSendTtlSeconds: 3_600,
    previousCategory: null,
    correctCategory: null,
    rejectedReason: null,
    reasonInfo: null,
    recommendationInfo: null,
    providerUpdatedAt: null,
    lastSyncedAt: new Date('2026-09-28T08:00:00.000Z'),
    definitionHash: 'before-hash',
    localState: 'synced',
    statusUpdatedAt: new Date('2026-09-28T08:00:00.000Z'),
    qualityUpdatedAt: new Date('2026-09-28T08:00:00.000Z'),
    categoryUpdatedAt: new Date('2026-09-28T08:00:00.000Z'),
    componentsUpdatedAt: new Date('2026-09-28T08:00:00.000Z'),
    createdBy: 1,
    updatedBy: 1,
    update: jest.fn(),
    ...overrides,
  };
  row.update.mockImplementation(async (patch: Record<string, unknown>) => {
    Object.assign(row, patch);
    return row;
  });
  return row;
};

const makeGraphClient = () => ({
  listMessageTemplates: jest.fn(),
  getMessageTemplate: jest.fn(),
  createMessageTemplate: jest.fn(),
  updateMessageTemplate: jest.fn(),
  deleteMessageTemplate: jest.fn(),
  archiveMessageTemplates: jest.fn(),
  unarchiveMessageTemplates: jest.fn(),
  unpauseMessageTemplate: jest.fn(),
  sendTemplateMessage: jest.fn(),
});

const templateEvent = (
  source: NormalizedWhatsAppTemplateEvent['source'],
  overrides: Partial<NormalizedWhatsAppTemplateEvent> = {},
): NormalizedWhatsAppTemplateEvent => ({
  kind: 'template',
  source,
  wabaId: '123456789',
  templateId: '444555666',
  templateName: 'booking_confirmation',
  language: 'en_US',
  event: null,
  value: null,
  previousValue: null,
  category: null,
  occurredAt: new Date('2026-09-28T09:00:00.000Z'),
  details: {},
  ...overrides,
});

describe('whatsappTemplateManagementService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    templateModel.findOne.mockResolvedValue(null);
    templateModel.findAll.mockResolvedValue([]);
    templateModel.update.mockResolvedValue([1]);
    templateEventModel.create.mockResolvedValue({});
    templateEventModel.findOne.mockResolvedValue(null);
    templateSendModel.create.mockResolvedValue({});
    templateSendModel.update.mockResolvedValue([1]);
    auditLogModel.create.mockResolvedValue({});
    bookingModel.findByPk.mockResolvedValue({ id: 42, guestPhone: '+48600123987' });
    buildSendComponents.mockResolvedValue([]);
  });

  describe('definition normalization', () => {
    it('normalizes named templates while retaining supported dynamic URL components', () => {
      expect(normalizeWhatsAppTemplateDefinition({
        name: 'booking_confirmation',
        language: 'en_US',
        category: 'utility',
        parameter_format: 'named',
        message_send_ttl_seconds: '3600',
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Booking {{booking_reference}}' },
          { type: 'BODY', text: 'Hello {{guest_first_name}}' },
          {
            type: 'BUTTONS',
            buttons: [{
              type: 'URL',
              text: 'View booking',
              url: 'https://example.test/bookings/{{1}}',
            }],
          },
        ],
      })).toEqual({
        name: 'booking_confirmation',
        language: 'en_US',
        category: 'UTILITY',
        parameterFormat: 'NAMED',
        messageSendTtlSeconds: 3_600,
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Booking {{booking_reference}}' },
          { type: 'BODY', text: 'Hello {{guest_first_name}}' },
          {
            type: 'BUTTONS',
            buttons: [{
              type: 'URL',
              text: 'View booking',
              url: 'https://example.test/bookings/{{1}}',
            }],
          },
        ],
        bookingBindings: {},
      });
    });

    it('accepts Meta authentication body, expiration, and OTP button schemas', () => {
      expect(normalizeWhatsAppTemplateDefinition({
        name: 'login_code',
        language: 'en_US',
        category: 'AUTHENTICATION',
        parameterFormat: 'NAMED',
        messageSendTtlSeconds: 300,
        components: [
          { type: 'BODY', add_security_recommendation: true },
          { type: 'FOOTER', code_expiration_minutes: 10 },
          {
            type: 'BUTTONS',
            buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }],
          },
        ],
      })).toMatchObject({
        category: 'AUTHENTICATION',
        messageSendTtlSeconds: 300,
        components: [
          { type: 'BODY', add_security_recommendation: true },
          { type: 'FOOTER', code_expiration_minutes: 10 },
          {
            type: 'BUTTONS',
            buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }],
          },
        ],
      });
    });

    it('rejects custom authentication body text because Meta supplies the fixed copy', () => {
      expect(() => normalizeWhatsAppTemplateDefinition({
        name: 'login_code',
        language: 'en_US',
        category: 'AUTHENTICATION',
        parameterFormat: 'POSITIONAL',
        components: [
          { type: 'BODY', text: '{{1}} is the code you requested.' },
          {
            type: 'BUTTONS',
            buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }],
          },
        ],
      })).toThrow('Authentication template bodies use Meta preset text and cannot define custom text.');
    });

    it('rejects malformed named placeholders and invalid authentication expiration', () => {
      expect(() => normalizeWhatsAppTemplateDefinition({
        name: 'bad_parameter',
        language: 'en_US',
        category: 'UTILITY',
        parameterFormat: 'NAMED',
        components: [{ type: 'BODY', text: 'Hello {{Guest-Name}}' }],
      })).toThrow('Named WhatsApp parameters use lowercase letters and underscores only.');

      expect(() => normalizeWhatsAppTemplateDefinition({
        name: 'bad_expiration',
        language: 'en_US',
        category: 'AUTHENTICATION',
        parameterFormat: 'NAMED',
        components: [
          { type: 'BODY', add_security_recommendation: false },
          { type: 'FOOTER', code_expiration_minutes: 91 },
        ],
      })).toThrow('Authentication template footers require a code expiration between 1 and 90 minutes.');

      expect(() => normalizeWhatsAppTemplateDefinition({
        name: 'custom_authentication_footer',
        language: 'en_US',
        category: 'AUTHENTICATION',
        parameterFormat: 'POSITIONAL',
        components: [
          { type: 'BODY' },
          { type: 'FOOTER', text: 'Custom footer' },
        ],
      })).toThrow('Authentication template footers require a code expiration between 1 and 90 minutes.');
    });
  });

  it('adds named review examples for text and dynamic URL parameters before creation', async () => {
    const graph = makeGraphClient();
    graph.createMessageTemplate.mockResolvedValue({
      id: '444555666',
      status: 'PENDING',
      category: 'UTILITY',
    });
    graph.getMessageTemplate.mockRejectedValue(new Error('not visible yet'));
    templateModel.create.mockImplementation(async (values: Record<string, unknown>) =>
      makeTemplate({ ...values, id: 7 }));

    await createManagedWhatsAppTemplate({
      name: 'booking_confirmation',
      language: 'en_US',
      category: 'UTILITY',
      parameterFormat: 'NAMED',
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Booking {{booking_reference}}' },
        { type: 'BODY', text: 'Hi {{guest_first_name}}, booking {{booking_reference}} is confirmed.' },
        {
          type: 'BUTTONS',
          buttons: [{
            type: 'URL',
            text: 'View booking',
            url: 'https://example.test/bookings/{{1}}',
          }],
        },
      ],
      bookingBindings: { buttons: { 0: ['booking_reference'] } },
    }, 91, graph as never);

    const submitted = graph.createMessageTemplate.mock.calls[0][2];
    expect(submitted.components).toEqual([
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'Booking {{booking_reference}}',
        example: {
          header_text_named_params: [{
            param_name: 'booking_reference',
            example: 'GYG 42/ABC',
          }],
        },
      },
      {
        type: 'BODY',
        text: 'Hi {{guest_first_name}}, booking {{booking_reference}} is confirmed.',
        example: {
          body_text_named_params: [
            { param_name: 'guest_first_name', example: 'Alex' },
            { param_name: 'booking_reference', example: 'GYG 42/ABC' },
          ],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [{
          type: 'URL',
          text: 'View booking',
          url: 'https://example.test/bookings/{{1}}',
          example: ['GYG 42/ABC'],
        }],
      },
    ]);
    expect(templateEventModel.create).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'created',
      eventValue: 'PENDING',
      source: 'operation',
      actorId: 91,
    }));
  });

  it.each([
    ['name', { name: 'renamed_template' }],
    ['language', { language: 'pl_PL' }],
    ['parameter format', { parameterFormat: 'POSITIONAL' }],
  ])('prevents changing the immutable template %s', async (_field, change) => {
    const row = makeTemplate();
    const graph = makeGraphClient();
    templateModel.findOne.mockResolvedValue(row);

    await expect(updateManagedWhatsAppTemplate(
      row.metaTemplateId,
      {
        ...change,
        category: 'UTILITY',
        components: [{ type: 'BODY', text: 'Updated text' }],
      },
      91,
      graph as never,
    )).rejects.toMatchObject({
      status: 409,
      message: 'WhatsApp template name, language, and parameter format cannot be changed after creation.',
    });
    expect(graph.updateMessageTemplate).not.toHaveBeenCalled();
  });

  it('rejects category changes locally while a template is approved', async () => {
    const row = makeTemplate({ category: 'UTILITY', status: 'APPROVED' });
    const graph = makeGraphClient();
    templateModel.findOne.mockResolvedValue(row);

    await expect(updateManagedWhatsAppTemplate(
      row.metaTemplateId,
      {
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Updated text' }],
      },
      91,
      graph as never,
    )).rejects.toMatchObject({
      status: 409,
      message: 'Meta does not allow changing the category of an approved template.',
    });
    expect(graph.updateMessageTemplate).not.toHaveBeenCalled();
  });

  it('preserves a blank TTL and omits category when updating an approved template', async () => {
    const row = makeTemplate({ category: 'UTILITY', status: 'APPROVED', messageSendTtlSeconds: 3_600 });
    const graph = makeGraphClient();
    templateModel.findOne.mockResolvedValue(row);
    graph.updateMessageTemplate.mockResolvedValue(undefined);
    graph.getMessageTemplate.mockRejectedValue(new Error('not visible yet'));

    await expect(updateManagedWhatsAppTemplate(
      row.metaTemplateId,
      {
        category: 'UTILITY',
        messageSendTtlSeconds: null,
        components: [{ type: 'BODY', text: 'Updated text' }],
      },
      91,
      graph as never,
    )).resolves.toMatchObject({ messageSendTtlSeconds: 3_600 });

    expect(graph.updateMessageTemplate).toHaveBeenCalledWith(
      't'.repeat(64),
      row.metaTemplateId,
      expect.objectContaining({ messageSendTtlSeconds: 3_600 }),
      { includeCategory: false },
    );
    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({
      messageSendTtlSeconds: 3_600,
    }));
  });

  it('marks provider-accepted writes as non-retryable when local reconciliation fails', async () => {
    const graph = makeGraphClient();
    graph.createMessageTemplate.mockResolvedValue({
      id: '444555666',
      status: 'PENDING',
      category: 'UTILITY',
    });
    graph.getMessageTemplate.mockRejectedValue(new Error('not visible yet'));
    templateModel.create.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(createManagedWhatsAppTemplate({
      name: 'booking_confirmation',
      language: 'en_US',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Hello guest' }],
    }, 91, graph as never)).rejects.toMatchObject({
      status: 502,
      details: {
        code: 'META_TEMPLATE_LOCAL_RECONCILIATION_REQUIRED',
        ambiguous: true,
      },
    });
    expect(graph.createMessageTemplate).toHaveBeenCalledTimes(1);
  });

  it('invalidates URL bindings when Meta externally reorders dynamic buttons', async () => {
    const row = makeTemplate({
      components: [
        { type: 'BODY', text: 'Hi {{guest_first_name}}' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Booking', url: 'https://example.test/bookings/{{1}}' },
            { type: 'URL', text: 'Guest', url: 'https://example.test/guests/{{1}}' },
          ],
        },
      ],
      bookingBindings: {
        buttons: { 0: ['booking_reference'], 1: ['guest_first_name'] },
      },
    });
    const graph = makeGraphClient();
    templateModel.findOne.mockResolvedValue(row);
    graph.listMessageTemplates.mockResolvedValue([{
      id: row.metaTemplateId,
      name: row.name,
      language: row.language,
      category: row.category,
      status: row.status,
      components: [
        { type: 'BODY', text: 'Hi {{guest_first_name}}' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Guest', url: 'https://example.test/guests/{{1}}' },
            { type: 'URL', text: 'Booking', url: 'https://example.test/bookings/{{1}}' },
          ],
        },
      ],
      qualityScore: 'GREEN',
      rejectedReason: null,
      previousCategory: null,
      correctCategory: null,
      lastUpdatedTime: null,
      messageSendTtlSeconds: 3_600,
      parameterFormat: 'NAMED',
    }]);

    await expect(syncManagedWhatsAppTemplates(91, graph as never)).resolves.toEqual([
      expect.objectContaining({
        bookingBindings: {},
        bookingSendSupported: false,
        bookingSupportReason: expect.stringContaining('needs a booking-variable mapping'),
      }),
    ]);
    expect(templateModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ bookingBindings: {} }),
      expect.any(Object),
    );
  });

  it('does not let an in-flight sync overwrite a newer local or webhook state', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-28T09:00:00.000Z'));
    try {
      const row = makeTemplate({
        status: 'PENDING',
        lastSyncedAt: new Date('2026-09-28T08:00:00.000Z'),
      });
      const graph = makeGraphClient();
      templateModel.findOne.mockResolvedValue(row);
      templateModel.update.mockResolvedValueOnce([0]);
      graph.listMessageTemplates.mockImplementation(async () => {
        jest.setSystemTime(new Date('2026-09-28T09:00:01.000Z'));
        row.status = 'APPROVED';
        row.lastSyncedAt = new Date('2026-09-28T09:00:01.000Z');
        return [{
          id: row.metaTemplateId,
          name: row.name,
          language: row.language,
          category: row.category,
          status: 'REJECTED',
          components: row.components,
          qualityScore: 'RED',
          rejectedReason: 'POLICY_VIOLATION',
          previousCategory: null,
          correctCategory: null,
          lastUpdatedTime: null,
          messageSendTtlSeconds: 3_600,
          parameterFormat: 'NAMED',
        }];
      });

      await expect(syncManagedWhatsAppTemplates(91, graph as never)).resolves.toEqual([
        expect.objectContaining({ status: 'APPROVED' }),
      ]);
      expect(templateModel.update).toHaveBeenCalledTimes(1);
      expect(templateEventModel.create).not.toHaveBeenCalledWith(expect.objectContaining({
        source: 'sync',
        eventType: 'status',
        eventValue: 'REJECTED',
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not mark a template missing when it changed after the sync snapshot began', async () => {
    const row = makeTemplate({ localState: 'synced' });
    const graph = makeGraphClient();
    graph.listMessageTemplates.mockResolvedValue([]);
    templateModel.findAll.mockResolvedValue([row]);
    templateModel.update.mockResolvedValueOnce([0]);

    await expect(syncManagedWhatsAppTemplates(91, graph as never)).resolves.toEqual([]);

    expect(row.localState).toBe('synced');
    expect(templateEventModel.create).not.toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'local_state',
      eventValue: 'missing',
    }));
    expect(auditLogModel.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'whatsapp.template.synced',
      metaJson: { remoteCount: 0, missingCount: 0 },
    }));
  });

  it.each([
    [
      'authentication templates',
      {
        category: 'AUTHENTICATION',
        components: [{ type: 'BODY', add_security_recommendation: true }],
      },
      'Authentication codes need a dedicated secure code source',
    ],
    [
      'media headers',
      {
        components: [
          { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['asset'] } },
          { type: 'BODY', text: 'Hi {{guest_first_name}}' },
        ],
      },
      'IMAGE headers need media or location values',
    ],
    [
      'specialized quick-reply buttons',
      {
        components: [
          { type: 'BODY', text: 'Hi {{guest_first_name}}' },
          { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Confirm' }] },
        ],
      },
      'QUICK_REPLY buttons need specialized send-time data',
    ],
  ])('gates booking sends for %s', async (_label, overrides, expectedReason) => {
    const row = makeTemplate(overrides);
    const graph = makeGraphClient();
    templateModel.findOne.mockResolvedValue(row);

    await expect(sendManagedWhatsAppTemplate({
      metaTemplateId: row.metaTemplateId,
      bookingId: 42,
      actorId: 91,
      graphClient: graph as never,
    })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(expectedReason),
      details: { code: 'UNSUPPORTED_BOOKING_TEMPLATE' },
    });
    expect(buildSendComponents).not.toHaveBeenCalled();
    expect(graph.sendTemplateMessage).not.toHaveBeenCalled();
    expect(templateSendModel.create).not.toHaveBeenCalled();
  });

  it('sends supported booking templates and stores only the recipient suffix and parameter keys', async () => {
    const row = makeTemplate({
      components: [
        { type: 'BODY', text: 'Hi {{guest_first_name}}, {{booking_reference}} is confirmed.' },
      ],
    });
    const graph = makeGraphClient();
    const resolvedComponents = [{
      type: 'body',
      parameters: [{ type: 'text', text: 'Alex', parameter_name: 'guest_first_name' }],
    }];
    templateModel.findOne.mockResolvedValue(row);
    buildSendComponents.mockResolvedValue(resolvedComponents);
    graph.sendTemplateMessage.mockResolvedValue('wamid.template-1');

    await expect(sendManagedWhatsAppTemplate({
      metaTemplateId: row.metaTemplateId,
      bookingId: 42,
      actorId: 91,
      graphClient: graph as never,
    })).resolves.toEqual({ messageId: 'wamid.template-1' });

    expect(graph.sendTemplateMessage).toHaveBeenCalledWith(
      't'.repeat(64),
      '987654321',
      {
        recipient: '+48600123987',
        templateName: 'booking_confirmation',
        languageCode: 'en_US',
        components: resolvedComponents,
      },
    );
    expect(templateSendModel.create).toHaveBeenCalledWith({
      templateId: 7,
      bookingId: 42,
      providerMessageId: 'wamid.template-1',
      templateName: 'booking_confirmation',
      language: 'en_US',
      recipientPhoneSuffix: '3987',
      parameterKeys: ['booking_reference', 'guest_first_name'],
      deliveryStatus: 'accepted',
      createdBy: 91,
    });
    expect(JSON.stringify(templateSendModel.create.mock.calls[0][0])).not.toContain('+48600123987');
  });

  it('returns Meta acceptance even if local send tracking fails after the provider write', async () => {
    const row = makeTemplate();
    const graph = makeGraphClient();
    templateModel.findOne.mockResolvedValue(row);
    graph.sendTemplateMessage.mockResolvedValue('wamid.accepted-before-db-error');
    templateSendModel.create.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(sendManagedWhatsAppTemplate({
      metaTemplateId: row.metaTemplateId,
      bookingId: 42,
      actorId: 91,
      graphClient: graph as never,
    })).resolves.toEqual({ messageId: 'wamid.accepted-before-db-error' });

    expect(graph.sendTemplateMessage).toHaveBeenCalledTimes(1);
    expect(auditLogModel.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'whatsapp.template.sent',
      metaJson: expect.objectContaining({ providerMessageId: 'wamid.accepted-before-db-error' }),
    }));
  });

  it('persists status, quality, category, and component webhook changes with event history', async () => {
    const row = makeTemplate();
    templateModel.findOne.mockResolvedValue(row);
    const occurredAt = new Date('2026-09-28T09:00:00.000Z');
    const events: NormalizedWhatsAppTemplateEvent[] = [
      templateEvent('message_template_status_update', {
        value: 'REJECTED',
        previousValue: 'PENDING',
        occurredAt,
        details: {
          reason: 'POLICY_VIOLATION',
          reason_info: 'A'.repeat(9_000),
          recommendation_info: 'Use transactional language.',
        },
      }),
      templateEvent('message_template_quality_update', {
        value: 'RED',
        previousValue: 'GREEN',
      }),
      templateEvent('template_category_update', {
        value: 'MARKETING',
        previousValue: 'UTILITY',
        details: {
          new_category: 'MARKETING',
          previous_category: 'UTILITY',
          correct_category: 'MARKETING',
        },
      }),
      templateEvent('message_template_components_update'),
    ];

    await expect(ingestWhatsAppTemplateEvents(events)).resolves.toBe(4);

    expect(templateModel.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: 'REJECTED',
      rejectedReason: 'POLICY_VIOLATION',
      reasonInfo: 'A'.repeat(8_000),
      recommendationInfo: 'Use transactional language.',
      lastSyncedAt: expect.any(Date),
    }), expect.any(Object));
    expect(templateModel.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      qualityScore: 'RED',
    }), expect.any(Object));
    expect(templateModel.update).toHaveBeenNthCalledWith(3, expect.objectContaining({
      category: 'MARKETING',
      previousCategory: 'UTILITY',
      correctCategory: 'MARKETING',
    }), expect.any(Object));
    expect(templateModel.update).toHaveBeenNthCalledWith(4, expect.objectContaining({
      localState: 'stale',
    }), expect.any(Object));
    expect(templateEventModel.create).toHaveBeenCalledTimes(4);
    expect(templateEventModel.create).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 7,
      metaTemplateId: '444555666',
      eventType: 'message_template_status_update',
      eventValue: 'REJECTED',
      previousValue: 'PENDING',
      source: 'webhook',
      occurredAt,
    }));
  });

  it('retains webhook history even when the referenced template is not mirrored yet', async () => {
    templateModel.findOne.mockResolvedValue(null);
    const incoming = templateEvent('message_template_quality_update', {
      templateId: '999888777',
      value: 'YELLOW',
    });

    await expect(ingestWhatsAppTemplateEvents([incoming])).resolves.toBe(1);

    expect(templateEventModel.create).toHaveBeenCalledWith(expect.objectContaining({
      templateId: null,
      metaTemplateId: '999888777',
      eventType: 'message_template_quality_update',
      eventValue: 'YELLOW',
    }));
  });

  it('records but does not apply stale template callbacks and deduplicates their replay', async () => {
    const row = makeTemplate({
      status: 'APPROVED',
      statusUpdatedAt: new Date('2026-09-28T10:00:00.000Z'),
    });
    const incoming = templateEvent('message_template_status_update', {
      value: 'REJECTED',
      previousValue: 'PENDING',
      occurredAt: new Date('2026-09-28T09:00:00.000Z'),
    });
    templateModel.findOne.mockResolvedValue(row);
    templateModel.update.mockResolvedValueOnce([0]);
    templateEventModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 44 });

    await expect(ingestWhatsAppTemplateEvents([incoming])).resolves.toBe(1);
    await expect(ingestWhatsAppTemplateEvents([incoming])).resolves.toBe(0);

    expect(templateModel.update).toHaveBeenCalledTimes(1);
    expect(row.update).not.toHaveBeenCalled();
    expect(templateEventModel.create).toHaveBeenCalledTimes(1);
    expect(templateEventModel.create).toHaveBeenCalledWith(expect.objectContaining({
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      payload: { ignored_as_stale: true },
    }));
  });

  it('advances send status monotonically and preserves failure diagnostics after delivery', async () => {
    const failedAt = new Date('2026-09-28T09:01:00.000Z');
    const deliveredAt = new Date('2026-09-28T09:02:00.000Z');
    await expect(updateWhatsAppTemplateSendStatuses([
      {
        messageId: 'wamid.template-1',
        status: 'failed',
        deliveryErrorCode: '131026',
        timestamp: failedAt,
      },
      {
        messageId: 'wamid.template-1',
        status: 'delivered',
        deliveryErrorCode: null,
        timestamp: deliveredAt,
      },
    ])).resolves.toBe(2);

    expect(templateSendModel.update).toHaveBeenNthCalledWith(1, {
      deliveryStatus: 'failed',
      deliveryErrorCode: '131026',
      statusUpdatedAt: failedAt,
    }, expect.any(Object));
    expect(templateSendModel.update).toHaveBeenNthCalledWith(2, {
      deliveryStatus: 'delivered',
      statusUpdatedAt: deliveredAt,
    }, expect.any(Object));
    expect(templateSendModel.update.mock.calls[1][0]).not.toHaveProperty('deliveryErrorCode');
  });

  it('ignores unknown messages, stale callbacks, and lower-ranked status regressions', async () => {
    templateSendModel.update
      .mockResolvedValueOnce([0])
      .mockResolvedValueOnce([0])
      .mockResolvedValueOnce([0]);

    await expect(updateWhatsAppTemplateSendStatuses([
      {
        messageId: 'wamid.unknown',
        status: 'sent',
        deliveryErrorCode: null,
        timestamp: new Date('2026-09-28T09:04:00.000Z'),
      },
      {
        messageId: 'wamid.template-1',
        status: 'played',
        deliveryErrorCode: null,
        timestamp: new Date('2026-09-28T09:02:00.000Z'),
      },
      {
        messageId: 'wamid.template-1',
        status: 'delivered',
        deliveryErrorCode: null,
        timestamp: new Date('2026-09-28T09:04:00.000Z'),
      },
    ])).resolves.toBe(0);

    expect(templateSendModel.update).toHaveBeenCalledTimes(3);
  });
});
