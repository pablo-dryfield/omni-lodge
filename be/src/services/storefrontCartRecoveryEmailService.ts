import dayjs from 'dayjs';
import { latestCartExperiences } from './storefrontCartExperienceService.js';
import { quoteStorefrontCart } from './storefrontCommerceService.js';
import { normalizeSavedCartFromQuote } from './storefrontSavedCartService.js';
import { randomUUID } from 'node:crypto';
import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import HttpError from '../errors/HttpError.js';
import { dismissCartWithPaidMatch } from './storefrontCartBookingMatchService.js';
import { sendMessage } from './bookings/gmailClient.js';
import { getConfigValue } from './configService.js';

const SUPPORT_EMAIL = 'pubthroughkrakow@gmail.com';

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const header = (value: unknown): string => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

const fromAddress = (): string | null => {
  const address = header(getConfigValue('STOREFRONT_EMAIL_FROM_ADDRESS'));
  if (!address) return null;
  const name = header(getConfigValue('STOREFRONT_EMAIL_FROM_NAME'));
  return name ? `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${address}>` : address;
};

const storefrontUrl = (): string => {
  const configured = String(getConfigValue('STOREFRONT_PUBLIC_URL') ?? '').trim();
  return (configured || 'https://krawlthroughkrakow.com/store2').replace(/\/+$/, '');
};

const money = (amount: number, currency: string): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(amount || 0));

const itemDate = (value: string | null): string => {
  if (!value) return 'Date to be confirmed';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('ddd, D MMM YYYY') : value;
};

const guestLabel = (quantity: number, options: Record<string, unknown>): string => {
  const raw = options?.participants;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return `${quantity} guest${quantity === 1 ? '' : 's'}`;
  }
  const participants = raw as Record<string, unknown>;
  const men = Number(participants.men) || 0;
  const women = Number(participants.women) || 0;
  return `${men} ${men === 1 ? 'man' : 'men'}, ${women} ${women === 1 ? 'woman' : 'women'}`;
};

const addonLabel = (addon: StorefrontOngoingCart['quoteSnapshot']['items'][number]['addons'][number]): string => {
  if (addon.variants.length > 0) {
    return `${addon.name}: ${addon.variants.map((variant) => `${variant.value} x ${variant.quantity}`).join(', ')}`;
  }
  return addon.value ? `${addon.name}: ${addon.value}` : `${addon.name} x ${addon.quantity}`;
};

const itemCard = (item: StorefrontOngoingCart['quoteSnapshot']['items'][number], currency: string): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;background:#171315;border:1px solid #49353f">
    <tr><td style="padding:22px;text-align:center">
      <div style="font-family:Arial,sans-serif;color:#ff168f;font-size:11px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase">Your experience</div>
      <div style="margin-top:7px;font-family:Arial,sans-serif;color:#fff8f2;font-size:23px;font-weight:800;line-height:1.25">${escapeHtml(item.productName)}</div>
      <div style="margin-top:11px;font-family:Arial,sans-serif;color:#c9bdc2;font-size:14px;line-height:1.65">
        ${escapeHtml(itemDate(item.experienceDate))}${item.experienceTime ? ` at ${escapeHtml(item.experienceTime)}` : ''}<br>
        ${escapeHtml(guestLabel(item.quantity, item.options))}
      </div>
      ${item.addons.length ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid #49353f;font-family:Arial,sans-serif;color:#fff8f2;font-size:13px;line-height:1.75">${item.addons.map((addon) => escapeHtml(addonLabel(addon))).join('<br>')}</div>` : ''}
      <div style="margin-top:16px;font-family:Arial,sans-serif;color:#ffd438;font-size:18px;font-weight:800">${escapeHtml(money(item.total, currency))}</div>
    </td></tr>
  </table>`;

export const buildStorefrontCartRecoveryEmail = (ongoing: StorefrontOngoingCart) => {
  const quote = ongoing.quoteSnapshot;
  const firstName = ongoing.customer.fullName.split(/\s+/)[0] || 'there';
  const productNames = quote.items.map((item) => item.productName);
  const subjectProduct = productNames.length === 1 ? productNames[0] : 'Krakow experiences';
  const recoveryUrl = `${storefrontUrl()}/cart?recover=${encodeURIComponent(ongoing.publicId)}`
    + (ongoing.recoveryToken ? `&rt=${encodeURIComponent(ongoing.recoveryToken)}` : '');
  const subject = `Your ${subjectProduct} booking is still waiting`;
  const preheader = `Return to your cart and complete your booking for ${money(quote.total, quote.currency)}.`;
  const textBody = [
    `Hi ${firstName},`,
    '',
    'Your Krawl Through Krakow booking is still waiting for you.',
    ...quote.items.map((item) => `${item.productName} - ${itemDate(item.experienceDate)}${item.experienceTime ? ` at ${item.experienceTime}` : ''} - ${guestLabel(item.quantity, item.options)} - ${money(item.total, quote.currency)}`),
    '',
    `Cart total: ${money(quote.total, quote.currency)}`,
    `Complete your booking: ${recoveryUrl}`,
    '',
    `Questions? Reply to this email or contact ${SUPPORT_EMAIL}.`,
  ].join('\n');
  const htmlBody = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#080708">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#080708">
    <tr><td align="center" style="padding:26px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:#110d0f;border:1px solid #49353f">
        <tr><td style="height:7px;background:#ff168f"></td></tr>
        <tr><td style="padding:38px 26px 30px;text-align:center">
          <div style="font-family:Arial,sans-serif;color:#ffd438;font-size:12px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase">Krawl Through Krakow</div>
          <h1 style="margin:13px 0 10px;font-family:Arial,sans-serif;color:#fff8f2;font-size:34px;line-height:1.1">Your night out is waiting</h1>
          <p style="margin:0 0 25px;font-family:Arial,sans-serif;color:#c9bdc2;font-size:16px;line-height:1.65">Hi ${escapeHtml(firstName)}, your selections are saved. Return to your cart to finish the booking whenever you are ready.</p>
          ${quote.items.map((item) => itemCard(item, quote.currency)).join('')}
          <div style="margin:24px 0 6px;font-family:Arial,sans-serif;color:#c9bdc2;font-size:13px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">Cart total</div>
          <div style="font-family:Arial,sans-serif;color:#ffd438;font-size:30px;font-weight:900">${escapeHtml(money(quote.total, quote.currency))}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:25px auto 0"><tr><td bgcolor="#ff168f">
            <a href="${escapeHtml(recoveryUrl)}" style="display:inline-block;padding:17px 28px;font-family:Arial,sans-serif;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none">COMPLETE MY BOOKING</a>
          </td></tr></table>
          <p style="margin:25px 0 0;font-family:Arial,sans-serif;color:#8f8288;font-size:13px;line-height:1.6">Questions or changes? Reply to this email and our Krakow team will help.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, textBody, htmlBody, recoveryUrl };
};

export const deliverStorefrontCartRecoveryEmail = async (
  ongoing: StorefrontOngoingCart,
): Promise<{ messageId: string | null }> => {
  const email = buildStorefrontCartRecoveryEmail(ongoing);
  const result = await sendMessage({
    to: ongoing.customer.email,
    from: fromAddress(),
    subject: email.subject,
    textBody: email.textBody,
    htmlBody: email.htmlBody,
  });
  return { messageId: result.id };
};

export const ensureStorefrontCartRecoveryToken = async (
  ongoing: StorefrontOngoingCart,
): Promise<void> => {
  if (!ongoing.recoveryToken) {
    await ongoing.update({ recoveryToken: randomUUID() });
  }
};

export const refreshDuplicateRecoveryCart = async (ongoing: StorefrontOngoingCart): Promise<void> => {
  const expectedStatus = ongoing.status;
  if (!['active', 'checkout_started', 'sending_recovery', 'recovery_sent'].includes(expectedStatus)) {
    throw new HttpError(409, 'This cart is no longer available for changes.');
  }
  // Old unpaid drafts can still contain selections appended by an earlier storefront.
  // Reprice the latest selection before emailing; completed carts never reach this claimed state.
  if (latestCartExperiences(ongoing.quoteSnapshot.items).length !== ongoing.quoteSnapshot.items.length) {
    const quote = await quoteStorefrontCart(ongoing.cart);
    const [saved] = await StorefrontOngoingCart.update({
      cart: normalizeSavedCartFromQuote(quote), quoteSnapshot: quote, currency: quote.currency, total: quote.total,
      metadata: { ...ongoing.metadata, events: [...(Array.isArray(ongoing.metadata?.events) ? ongoing.metadata.events : []), {
        id: randomUUID(), occurredAt: new Date().toISOString(), type: 'cart_item_updated', severity: 'info',
        message: 'Duplicate unpaid experience selections replaced by the latest selection before recovery email.',
        details: { previousItemCount: ongoing.quoteSnapshot.items.length, itemCount: quote.items.length,
          previousTotal: Number(ongoing.total), total: quote.total, currency: quote.currency,
          previousSelections: ongoing.quoteSnapshot.items.map(({ productId, quantity, experienceDate, experienceTime, addons }) =>
            ({ productId, quantity, experienceDate, experienceTime, addons })) },
      }] },
    }, { where: { id: ongoing.id, status: expectedStatus, updatedAt: ongoing.updatedAt } });
    if (!saved) throw new HttpError(409, 'This cart changed before the recovery email could be sent.');
    await ongoing.reload();
    if (ongoing.status !== expectedStatus) throw new HttpError(409, 'This cart changed before the recovery email could be sent.');
  }
};

export const sendAndRecordStorefrontCartRecoveryEmail = async (
  ongoing: StorefrontOngoingCart,
): Promise<StorefrontOngoingCart> => {
  await ongoing.reload();
  if (ongoing.status !== 'sending_recovery') {
    throw new HttpError(409, 'This cart changed before the recovery email could be sent.');
  }
  if (await dismissCartWithPaidMatch(ongoing)) {
    throw new HttpError(409, 'This customer already has a matching paid booking. The cart has been removed from ongoing carts.');
  }
  await ongoing.reload();
  if (ongoing.status !== 'sending_recovery') {
    throw new HttpError(409, 'This cart changed before the recovery email could be sent.');
  }
  await refreshDuplicateRecoveryCart(ongoing);
  await ensureStorefrontCartRecoveryToken(ongoing);

  const result = await deliverStorefrontCartRecoveryEmail(ongoing);
  const metadata = ongoing.metadata && typeof ongoing.metadata === 'object' ? ongoing.metadata : {};
  const recoveryCount = Number(ongoing.recoveryCount) || Number(metadata.recoveryCount) || 0;
  const sentAt = new Date();
  const [updated] = await StorefrontOngoingCart.update(
    {
      status: 'recovery_sent',
      recoverySentAt: sentAt,
      firstRecoverySentAt: ongoing.firstRecoverySentAt || sentAt,
      lastRecoverySentAt: sentAt,
      recoveryCount: recoveryCount + 1,
      recoveryMessageId: result.messageId,
      recoveryError: null,
      metadata: { ...metadata, recoveryCount: recoveryCount + 1 },
    },
    { where: { id: ongoing.id, status: 'sending_recovery' } },
  );
  if (!updated) throw new Error('The cart changed while its recovery email was being sent.');

  await ongoing.reload();
  return ongoing;
};
