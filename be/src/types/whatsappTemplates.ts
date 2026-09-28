export type WhatsAppTemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
export type WhatsAppTemplateParameterFormat = 'NAMED' | 'POSITIONAL';
export type WhatsAppTemplateQualityScore = 'UNKNOWN' | 'GREEN' | 'YELLOW' | 'RED' | string;

export type WhatsAppTemplateJsonValue =
  | string
  | number
  | boolean
  | null
  | WhatsAppTemplateJsonValue[]
  | { [key: string]: WhatsAppTemplateJsonValue };

export type WhatsAppTemplateComponent = Record<string, WhatsAppTemplateJsonValue>;

export interface WhatsAppTemplateBookingBindings {
  buttons?: Record<string, string[]>;
}

export interface WhatsAppTemplateDefinition {
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  parameterFormat: WhatsAppTemplateParameterFormat;
  messageSendTtlSeconds: number | null;
  components: WhatsAppTemplateComponent[];
  bookingBindings?: WhatsAppTemplateBookingBindings;
}

export interface WhatsAppTemplateVariableDefinition {
  key: string;
  label: string;
  description: string;
  source: string;
  dataType: 'text' | 'date' | 'time' | 'integer' | 'money';
  sampleValue: string;
  sensitivity: 'customer' | 'booking' | 'financial';
  nullable: boolean;
}

export interface WhatsAppTemplateResolvedVariable extends WhatsAppTemplateVariableDefinition {
  value: string | null;
  missing: boolean;
}

export interface WhatsAppTemplatePreviewButton {
  type: string;
  text: string;
  url?: string;
  phoneNumber?: string;
}

export interface WhatsAppTemplatePreview {
  header: {
    format: string;
    text: string | null;
  } | null;
  body: string;
  footer: string | null;
  buttons: WhatsAppTemplatePreviewButton[];
  variables: WhatsAppTemplateResolvedVariable[];
  missingVariables: string[];
}

export interface WhatsAppTemplateBookingSearchResult {
  id: number;
  reference: string;
  guestName: string;
  productName: string;
  experienceAt: string | null;
  phoneSuffix: string | null;
}
