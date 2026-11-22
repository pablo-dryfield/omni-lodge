import { createHash } from 'node:crypto';
import HttpError from '../errors/HttpError.js';
import { KTK_WEBSITE_FORMS, KTK_WEBSITE_FORMS_SHA256 } from '../config/ktkWebsiteForms.js';

export type EnquiryField = {
  id: string; name: string; label: string; type: string; required: boolean; maxBytes: number;
  maxLength?: number; min?: number; options?: readonly string[];
};
export type EnquiryForm = {
  id: string; route: string; subjectPattern: string; successMessage: string;
  recipients: { to: readonly string[]; cc: readonly string[] };
  bodyTemplate: string | null; fields: readonly EnquiryField[];
};
export type EnquiryPayload = {
  requestId: string; formId: string; schemaSha256: string;
  fields: Record<string, string | string[]>;
};
export const ENQUIRY_FORMS: readonly EnquiryForm[] = KTK_WEBSITE_FORMS.forms;
export const ENQUIRY_SCHEMA_SHA256 = KTK_WEBSITE_FORMS_SHA256;
export const isEmailAddress = (value: string): boolean => {
  const local = value.split('@')[0];
  return value.length <= 254 && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(value);
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
function invalid(field?: string): never {
  throw new HttpError(422, 'Please check the enquiry fields.', { code: 'invalid_field', ...(field ? { field } : {}) });
}

export const validateWebsiteEnquiry = (raw: unknown): { payload: EnquiryPayload; form: EnquiryForm } => {
  if (!object(raw) || !exactKeys(raw, ['requestId', 'formId', 'schemaSha256', 'fields'])) invalid();
  if (typeof raw.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.requestId)) invalid();
  if (raw.schemaSha256 !== ENQUIRY_SCHEMA_SHA256) throw new HttpError(409, 'The enquiry form version is unavailable.', { code: 'schema_mismatch' });
  const form = ENQUIRY_FORMS.find(candidate => candidate.id === raw.formId);
  if (!form || !object(raw.fields) || !exactKeys(raw.fields, form.fields.map(field => field.id))) invalid();
  const fields: EnquiryPayload['fields'] = {};
  for (const field of form.fields) {
    const value = raw.fields[field.id];
    if (field.type === 'multiselect') {
      if (!Array.isArray(value) || value.length > (field.options?.length ?? 0) || value.some(item => typeof item !== 'string' || !field.options?.includes(item))) invalid(field.id);
      if (field.required && !value.length) invalid(field.id);
      fields[field.id] = value as string[];
      continue;
    }
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > field.maxBytes || /\u0000/.test(value)) invalid(field.id);
    if (field.maxLength !== undefined && value.length > field.maxLength) invalid(field.id);
    if (field.type !== 'textarea' && /[\r\n]/.test(value)) invalid(field.id);
    const text = value.replace(/\r\n?/g, '\n').trim();
    if (field.required && !text) invalid(field.id);
    if (text && field.type === 'email' && !isEmailAddress(text)) invalid(field.id);
    if (text && field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text + 'T00:00:00Z')) || new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) !== text)) invalid(field.id);
    if (text && field.type === 'number' && (!/^-?\d+(?:\.0+)?$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < (field.min ?? -Number.MAX_SAFE_INTEGER))) invalid(field.id);
    fields[field.id] = text;
  }
  return { payload: { requestId: raw.requestId, formId: form.id, schemaSha256: ENQUIRY_SCHEMA_SHA256, fields }, form };
};

export type EnquiryRecipients = { to: string[]; cc: string[] };
export const resolveEnquiryRecipients = (configured: unknown, form: EnquiryForm): EnquiryRecipients => {
  const source = typeof configured === 'string' ? JSON.parse(configured) as unknown : configured;
  const map = source == null ? Object.fromEntries(ENQUIRY_FORMS.map(candidate => [candidate.id, candidate.recipients])) : source;
  if (!object(map) || Object.keys(map).some(key => !ENQUIRY_FORMS.some(candidate => candidate.id === key))) throw new HttpError(503, 'Enquiry routing is unavailable.');
  const selected = map[form.id];
  if (!object(selected) || !exactKeys(selected, ['to', 'cc'])) throw new HttpError(503, 'Enquiry routing is unavailable.');
  for (const name of ['to', 'cc'] as const) {
    const addresses = selected[name];
    if (!Array.isArray(addresses) || addresses.length > 5 || name === 'to' && !addresses.length || addresses.some(value => typeof value !== 'string' || !isEmailAddress(value))) throw new HttpError(503, 'Enquiry routing is unavailable.');
  }
  return { to: selected.to as string[], cc: selected.cc as string[] };
};

const valueText = (value: string | string[]): string => Array.isArray(value) ? value.join(', ') : value;
export const renderWebsiteEnquiry = (payload: EnquiryPayload, form: EnquiryForm): { subject: string; textBody: string; replyTo: string } => {
  // Only source-owned placeholders are substituted; inserted customer text is never reinterpreted.
  const substitute = (template: string): string => template.replace(/%%([^%]+)%%/g, (token, rawId: string) => {
    const field = form.fields.find(candidate => candidate.id.toLowerCase() === rawId.toLowerCase());
    return field ? valueText(payload.fields[field.id]) : token;
  });
  const subject = substitute(form.subjectPattern).replace(/[\r\n]/g, ' ').slice(0, 240);
  const body = form.bodyTemplate ? substitute(form.bodyTemplate) : form.fields.map(field => `${field.label}: ${valueText(payload.fields[field.id])}`).join('\n\n');
  const replyField = form.fields.find(field => field.type === 'email');
  return {
    subject,
    textBody: body + '\n\nPage: https://krawlthroughkrakow.com/staging' + form.route + '\nReference: ' + payload.requestId,
    replyTo: replyField ? String(payload.fields[replyField.id]) : '',
  };
};

export const websiteEnquiryFingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
