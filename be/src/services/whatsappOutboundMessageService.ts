import {
  getWhatsAppEmbeddedSignupConfig,
  WhatsAppConfigError,
} from '../config/whatsappConfig.js';
import HttpError from '../errors/HttpError.js';
import {
  getConfigValueRaw,
  refreshConfigCacheKeys,
} from './configService.js';
import {
  WhatsAppMetaGraphClient,
  WhatsAppMetaGraphError,
  type WhatsAppMessageTemplateRecord,
} from './whatsappMetaGraphClient.js';

const OUTBOUND_CONFIG_KEYS = [
  'WHATSAPP_META_APP_ID',
  'WHATSAPP_META_APP_SECRET',
  'WHATSAPP_META_GRAPH_API_VERSION',
  'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID',
  'WHATSAPP_BUSINESS_ACCESS_TOKEN',
  'WHATSAPP_WABA_ID',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const;

const E164_RECIPIENT = /^\+[1-9]\d{7,14}$/;
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_CODE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
const NUMERIC_META_ID = /^\d{1,64}$/;

type TemplateMessageClient = Pick<
  WhatsAppMetaGraphClient,
  'listMessageTemplates' | 'sendTemplateMessage'
>;

interface OutboundConnection {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  graphClient: TemplateMessageClient;
}

const exactString = (value: unknown): string | null =>
  typeof value === 'string' && value === value.trim() && value.length > 0 ? value : null;

export interface SendWhatsAppTemplateMessageParams {
  recipient: unknown;
  templateName: unknown;
  languageCode: unknown;
  graphClient?: TemplateMessageClient;
}

export interface WhatsAppAvailableTemplate {
  name: string;
  language: string;
  category: string;
}

const containsTemplateParameter = (value: unknown): boolean => {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string' && /\{\{[\s\S]*?\}\}/.test(current)) {
      return true;
    }
    if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current !== null && typeof current === 'object') {
      pending.push(...Object.values(current as Record<string, unknown>));
    }
  }
  return false;
};

const hasUnsupportedHeader = (components: Array<Record<string, unknown>>): boolean =>
  components.some((component) => {
    if (String(component.type ?? '').toUpperCase() !== 'HEADER') return false;
    return String(component.format ?? '').toUpperCase() !== 'TEXT';
  });

const resolveOutboundConnection = async (
  graphClientOverride?: TemplateMessageClient,
): Promise<OutboundConnection> => {
  await refreshConfigCacheKeys(OUTBOUND_CONFIG_KEYS);
  const accessToken = getConfigValueRaw('WHATSAPP_BUSINESS_ACCESS_TOKEN')?.trim() || null;
  const wabaId = getConfigValueRaw('WHATSAPP_WABA_ID')?.trim() || null;
  const phoneNumberId = getConfigValueRaw('WHATSAPP_PHONE_NUMBER_ID')?.trim() || null;
  if (
    !accessToken
    || accessToken.length < 32
    || accessToken.length > 4096
    || !wabaId
    || !NUMERIC_META_ID.test(wabaId)
    || !phoneNumberId
    || !NUMERIC_META_ID.test(phoneNumberId)
  ) {
    throw new HttpError(409, 'WhatsApp Business is not connected for outbound messaging.');
  }

  let graphClient = graphClientOverride;
  if (!graphClient) {
    try {
      graphClient = new WhatsAppMetaGraphClient(getWhatsAppEmbeddedSignupConfig());
    } catch (error) {
      if (error instanceof WhatsAppConfigError) {
        throw new HttpError(409, 'WhatsApp Business is not connected for outbound messaging.');
      }
      throw error;
    }
  }
  return { accessToken, wabaId, phoneNumberId, graphClient };
};

const readAvailableTemplates = async (
  connection: OutboundConnection,
): Promise<WhatsAppAvailableTemplate[]> => {
  let templates: WhatsAppMessageTemplateRecord[];
  try {
    templates = await connection.graphClient.listMessageTemplates(
      connection.accessToken,
      connection.wabaId,
    );
  } catch (error) {
    if (error instanceof WhatsAppMetaGraphError) {
      throw new HttpError(502, 'Unable to read approved WhatsApp message templates.', {
        code: error.safeCode,
      });
    }
    throw error;
  }

  const unique = new Map<string, WhatsAppAvailableTemplate>();
  templates.forEach((template) => {
    if (
      template.status !== 'APPROVED'
      || containsTemplateParameter(template.components)
      || hasUnsupportedHeader(template.components)
    ) {
      return;
    }
    const safeTemplate = {
      name: template.name,
      language: template.language,
      category: template.category,
    };
    unique.set(`${safeTemplate.name}\u0000${safeTemplate.language}`, safeTemplate);
  });
  return [...unique.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.language.localeCompare(right.language));
};

export const listWhatsAppMessageTemplates = async (
  graphClient?: TemplateMessageClient,
): Promise<WhatsAppAvailableTemplate[]> => {
  const connection = await resolveOutboundConnection(graphClient);
  return readAvailableTemplates(connection);
};

export const sendWhatsAppTemplateMessage = async (
  params: SendWhatsAppTemplateMessageParams,
): Promise<{ messageId: string }> => {
  const recipient = exactString(params.recipient);
  const templateName = exactString(params.templateName);
  const languageCode = exactString(params.languageCode);
  if (!recipient || !E164_RECIPIENT.test(recipient)) {
    throw new HttpError(400, 'WhatsApp recipient must be an E.164 number beginning with +.');
  }
  if (!templateName || !TEMPLATE_NAME.test(templateName)) {
    throw new HttpError(400, 'WhatsApp template name is invalid.');
  }
  if (!languageCode || !LANGUAGE_CODE.test(languageCode)) {
    throw new HttpError(400, 'WhatsApp template language code is invalid.');
  }

  const connection = await resolveOutboundConnection(params.graphClient);
  const availableTemplates = await readAvailableTemplates(connection);
  if (!availableTemplates.some((template) =>
    template.name === templateName && template.language === languageCode)) {
    throw new HttpError(
      409,
      'The selected WhatsApp template is not currently approved and parameter-free.',
    );
  }

  try {
    const messageId = await connection.graphClient.sendTemplateMessage(
      connection.accessToken,
      connection.phoneNumberId,
      {
        recipient,
        templateName,
        languageCode,
      },
    );
    return { messageId };
  } catch (error) {
    if (error instanceof WhatsAppMetaGraphError) {
      if (error.ambiguous) {
        throw new HttpError(
          502,
          'Meta did not confirm whether the WhatsApp message was accepted. Check the destination chat before retrying.',
          { code: error.safeCode, ambiguous: true },
        );
      }
      throw new HttpError(502, 'Meta rejected the WhatsApp message.', {
        code: error.safeCode,
        ambiguous: false,
      });
    }
    throw error;
  }
};
