import HttpError from '../errors/HttpError.js';
import { renderWebsiteEnquiry, resolveEnquiryRecipients, validateWebsiteEnquiry, websiteEnquiryFingerprint, isEmailAddress } from './websiteEnquiryContract.js';

export type EnquiryDeliveryRecord = {
  requestId: string; formId: string; payloadHash: string; status: 'sending' | 'sent' | 'uncertain';
  rfcMessageId: string; providerMessageId: string | null;
};
export type EnquiryDeliveryRepository = {
  reserve: (record: EnquiryDeliveryRecord) => Promise<boolean>;
  find: (requestId: string) => Promise<EnquiryDeliveryRecord | null>;
  markSent: (requestId: string, providerId: string) => Promise<void>;
  markUncertain: (requestId: string) => Promise<void>;
};
export type WebsiteEnquiryMail = {
  to: string; cc?: string; from: string; replyTo: string; subject: string; textBody: string;
  rfcMessageId: string; singleAttempt: true;
};
export type EnquiryServiceDependencies = {
  repository: EnquiryDeliveryRepository;
  getConfig: (key: string) => unknown;
  assertOutboundAllowed: () => void;
  sendMail: (mail: WebsiteEnquiryMail) => Promise<{ id: string | null }>;
};
export type EnquiryDeliveryResult = { requestId: string; status: 'sent'; deduplicated: boolean };
export const createWebsiteEnquiryService = (deps: EnquiryServiceDependencies) => async (input: unknown): Promise<EnquiryDeliveryResult> => {
  const {payload, form} = validateWebsiteEnquiry(input);
  const recipients = resolveEnquiryRecipients(deps.getConfig('STAGING_WEBSITE_ENQUIRY_RECIPIENTS'), form);
  const address = String(deps.getConfig('STOREFRONT_EMAIL_FROM_ADDRESS') ?? '').trim();
  const name = String(deps.getConfig('STOREFRONT_EMAIL_FROM_NAME') ?? '').trim();
  if (!isEmailAddress(address) || /[\r\n]/.test(name)) throw new HttpError(503, 'Enquiry sender is unavailable.');
  const from = name ? `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${address}>` : address;
  const email = renderWebsiteEnquiry(payload, form);
  const rfcMessageId = `<ktk-staging-enquiry-${payload.requestId}@krawlthroughkrakow.com>`;
  const mail: WebsiteEnquiryMail = { ...email, to: recipients.to.join(', '), ...(recipients.cc.length ? {cc: recipients.cc.join(', ')} : {}), from, rfcMessageId, singleAttempt: true };
  const payloadHash = websiteEnquiryFingerprint({ formId: form.id, schema: payload.schemaSha256, mail });
  // A process explicitly isolated for local development cannot reserve, send or fall back.
  deps.assertOutboundAllowed();
  const claimed = await deps.repository.reserve({requestId: payload.requestId, formId: form.id, payloadHash, status: 'sending', rfcMessageId, providerMessageId: null});
  if (!claimed) {
    const existing = await deps.repository.find(payload.requestId);
    if (!existing || existing.payloadHash !== payloadHash) throw new HttpError(409, 'This enquiry reference is already in use.', {code: 'idempotency_conflict'});
    if (existing.status === 'sent' && existing.providerMessageId) return {requestId: payload.requestId, status: 'sent', deduplicated: true};
    throw new HttpError(409, 'Delivery is not yet confirmed. Please do not submit again; contact the team with this reference.', {code: 'delivery_unconfirmed', requestId: payload.requestId});
  }
  try {
    const receipt = await deps.sendMail(mail);
    if (!receipt.id) throw new Error('Missing provider receipt');
    await deps.repository.markSent(payload.requestId, receipt.id);
    return {requestId: payload.requestId, status: 'sent', deduplicated: false};
  } catch {
    // A crash, send timeout or metadata failure never grants a second delivery attempt.
    // If this update fails, the already committed 'sending' reservation still blocks replay.
    try { await deps.repository.markUncertain(payload.requestId); } catch { /* Keep the original reservation. */ }
    throw new HttpError(503, 'Delivery could not be confirmed. Please do not submit again; contact the team with this reference.', {code: 'delivery_unconfirmed', requestId: payload.requestId});
  }
};
