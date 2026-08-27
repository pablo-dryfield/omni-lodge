export type WhatsAppWebhookSource = 'messages' | 'history' | 'smb_message_echoes';
export type WhatsAppMessageDirection = 'inbound' | 'outbound';
export type WhatsAppMessageAction = 'create' | 'edit' | 'revoke';

export interface WhatsAppWebhookScope {
  wabaId: string;
  phoneNumberId: string;
  timestamp: Date;
}

export interface NormalizedWhatsAppMessageEvent extends WhatsAppWebhookScope {
  kind: 'message';
  source: WhatsAppWebhookSource;
  direction: WhatsAppMessageDirection;
  action: WhatsAppMessageAction;
  messageId: string;
  targetMessageId: string | null;
  senderWaId: string | null;
  recipientWaId: string | null;
  contactName: string | null;
  messageType: string;
  text: string | null;
  contextMessageId: string | null;
}

export interface NormalizedWhatsAppStatusEvent extends WhatsAppWebhookScope {
  kind: 'status';
  source: 'messages';
  messageId: string;
  recipientWaId: string | null;
  status: string;
  conversationId: string | null;
}

export interface NormalizedWhatsAppHistorySyncEvent {
  kind: 'history_sync';
  source: 'history';
  wabaId: string;
  phoneNumberId: string;
  status: 'in_progress' | 'complete' | 'declined' | 'failed';
  progress: number | null;
  phase: number | null;
  chunkOrder: number | null;
  errorCode: string | null;
}

export interface NormalizedWhatsAppAccountStateEvent {
  kind: 'account_state';
  source: 'account_update';
  wabaId: string;
  phoneNumberId: string | null;
  event: string;
  unavailable: boolean;
}

export type NormalizedWhatsAppWebhookEvent =
  | NormalizedWhatsAppMessageEvent
  | NormalizedWhatsAppStatusEvent
  | NormalizedWhatsAppHistorySyncEvent
  | NormalizedWhatsAppAccountStateEvent;

export interface WhatsAppWebhookBatch {
  events: NormalizedWhatsAppWebhookEvent[];
}

export interface WhatsAppWebhookParserOptions {
  expectedWabaId: string;
  expectedPhoneNumberId: string;
}
