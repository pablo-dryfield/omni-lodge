import dayjs from 'dayjs';
import sequelize from '../config/database.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import StorefrontOrderItem from '../models/StorefrontOrderItem.js';
import { sendMessage } from './bookings/gmailClient.js';
import { getConfigValue } from './configService.js';
import { findLockedStorefrontOrderWithItems } from './storefrontOrderPersistenceService.js';
import { getStorefrontCancellationPolicy } from './storefrontPublicConfigService.js';
import logger from '../utils/logger.js';
import type { StorefrontCancellationPolicy } from '../types/storefront.js';

const SUPPORT_PHONE = '+48791847981';
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

const money = (value: number | string, currency: string): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(value));

const dateLabel = (value: string | null): string => {
  if (!value) return 'To be confirmed';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('dddd, D MMMM YYYY') : value;
};

const timeLabel = (value: string | null): string => value || 'To be confirmed';

const detailRow = (label: string, value: unknown): string => `
  <tr>
    <td style="padding:11px 0;color:#746762;font-family:Arial,sans-serif;font-size:14px;line-height:1.4;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:11px 0 11px 16px;color:#241c19;font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.4;text-align:right;vertical-align:top">${escapeHtml(value)}</td>
  </tr>`;

const addonLabel = (addon: Record<string, unknown>): string => {
  const variants = Array.isArray(addon.variants)
    ? addon.variants
        .map((rawVariant) => {
          if (!rawVariant || typeof rawVariant !== 'object' || Array.isArray(rawVariant)) return null;
          const variant = rawVariant as Record<string, unknown>;
          const value = String(variant.value ?? '').trim();
          const quantity = Number(variant.quantity);
          return value && Number.isInteger(quantity) && quantity > 0 ? `${quantity} ${value}` : null;
        })
        .filter((value): value is string => value !== null)
    : [];
  const sizeBreakdown = variants.length > 0 ? ` (${variants.join(', ')})` : '';
  return `${addon.name ?? 'Add-on'} x ${addon.quantity ?? 1}${sizeBreakdown}`;
};

const itemCard = (item: StorefrontOrderItem, currency: string): string => {
  const addons = Array.isArray(item.addons) ? item.addons : [];
  const addonCopy = addons
    .map(addonLabel)
    .join(', ');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;background:#ffffff;border:1px solid #eadfd8;border-radius:16px">
      <tr><td style="padding:20px">
        <div style="color:#241c19;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;line-height:1.3">${escapeHtml(item.productName)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:9px">
          ${detailRow('Date', dateLabel(item.experienceDate))}
          ${detailRow('Start time', timeLabel(item.experienceTime))}
          ${detailRow('Guests', `${item.quantity} guest${item.quantity === 1 ? '' : 's'}`)}
          ${addonCopy ? detailRow('Add-ons', addonCopy) : ''}
          ${detailRow('Item total', money(item.total, currency))}
        </table>
      </td></tr>
    </table>`;
};

const shell = (preheader: string, content: string): string => `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(preheader)}</title>
  </head>
  <body style="margin:0;padding:0;background:#211a18">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#211a18">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#fffaf6;border:8px solid #f4a261;border-radius:28px">
            <tr><td style="padding:34px 26px 28px">${content}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const policyHtml = (policy: StorefrontCancellationPolicy): string => {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;background:#fff1e6;border:1px solid #f3d1b8;border-radius:16px">
      <tr><td style="padding:20px;color:#4f403a;font-family:Arial,sans-serif;font-size:14px;line-height:1.65">
        <div style="margin-bottom:8px;color:#241c19;font-size:17px;font-weight:700">${escapeHtml(policy.title)}</div>
        <div style="margin-bottom:8px">${escapeHtml(policy.summary)}</div>
        ${policy.items
          .map(
            (item) =>
              `<div style="margin-bottom:8px"><strong>${escapeHtml(item.title)}:</strong> ${escapeHtml(item.description)}</div>`,
          )
          .join('')}
      </td></tr>
    </table>`;
};

const contactHtml = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#ffffff;border:1px solid #eadfd8;border-radius:16px">
    <tr><td align="center" style="padding:20px;color:#5f514c;font-family:Arial,sans-serif;font-size:14px;line-height:1.7">
      <div style="color:#241c19;font-size:17px;font-weight:700">Need to change something?</div>
      <div style="margin-top:5px">Reply to this email, call <a href="tel:${SUPPORT_PHONE}" style="color:#9b4d2d;font-weight:700;text-decoration:none">${SUPPORT_PHONE}</a>, or email <a href="mailto:${SUPPORT_EMAIL}" style="color:#9b4d2d;font-weight:700;text-decoration:none">${SUPPORT_EMAIL}</a>.</div>
    </td></tr>
  </table>`;

export const buildCustomerStorefrontEmail = (order: StorefrontOrder) => {
  const firstName = order.customerFirstName || 'there';
  const items = order.items || [];
  const cancellationPolicy = getStorefrontCancellationPolicy();
  const firstItem = items[0];
  const preheader = `Payment received. Your ${firstItem?.productName ?? 'Krakow experience'} is confirmed.`;
  const content = `
    <div style="text-align:center;color:#9b4d2d;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">Payment confirmed</div>
    <h1 style="margin:12px 0 10px;text-align:center;color:#241c19;font-family:Georgia,'Times New Roman',serif;font-size:40px;line-height:1.08">You're booked, ${escapeHtml(firstName)}!</h1>
    <p style="margin:0 auto 24px;max-width:500px;text-align:center;color:#675b56;font-family:Arial,sans-serif;font-size:16px;line-height:1.6">Your payment was successful and your Krakow experience is confirmed. Everything you need is below.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background:#241c19;border-radius:16px">
      <tr><td align="center" style="padding:18px;color:#ffffff;font-family:Arial,sans-serif">
        <div style="color:#f4a261;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Booking reference</div>
        <div style="margin-top:7px;font-size:18px;font-weight:700;line-height:1.4;word-break:break-all">${escapeHtml(order.publicId)}</div>
      </td></tr>
    </table>
    ${items.map((item) => itemCard(item, order.currency)).join('')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;border-top:1px solid #eadfd8;border-bottom:1px solid #eadfd8">
      ${detailRow('Subtotal', money(order.subtotal, order.currency))}
      ${Number(order.addonTotal) ? detailRow('Add-ons', money(order.addonTotal, order.currency)) : ''}
      ${Number(order.discountTotal) ? detailRow('Discount', `-${money(order.discountTotal, order.currency)}`) : ''}
      ${detailRow('Total paid', money(order.total, order.currency))}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;background:#241c19;border-radius:16px">
      <tr><td style="padding:20px;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;line-height:1.65">
        <div style="color:#f4a261;font-size:17px;font-weight:700">Keep this email handy</div>
        <div style="margin-top:5px">Save your booking reference and show it to the team if requested. If any booking detail looks incorrect, contact us as soon as possible.</div>
      </td></tr>
    </table>
    ${cancellationPolicy ? policyHtml(cancellationPolicy) : ''}
    ${contactHtml}
    <p style="margin:24px 0 0;text-align:center;color:#766a66;font-family:Arial,sans-serif;font-size:13px;line-height:1.6">Krawl Through Krakow<br>We cannot wait to welcome you.</p>`;

  const text = [
    `YOU'RE BOOKED, ${firstName}!`,
    '',
    preheader,
    `Booking reference: ${order.publicId}`,
    '',
    ...items.flatMap((item) => [
      item.productName,
      `Date: ${dateLabel(item.experienceDate)}`,
      `Start time: ${timeLabel(item.experienceTime)}`,
      `Guests: ${item.quantity}`,
      ...(Array.isArray(item.addons) && item.addons.length > 0
        ? [`Add-ons: ${item.addons.map(addonLabel).join(', ')}`]
        : []),
      `Item total: ${money(item.total, order.currency)}`,
      '',
    ]),
    `Total paid: ${money(order.total, order.currency)}`,
    '',
    ...(cancellationPolicy
      ? [
          cancellationPolicy.title.toUpperCase(),
          cancellationPolicy.summary,
          ...cancellationPolicy.items.map((item) => `${item.title}: ${item.description}`),
          '',
        ]
      : []),
    `To cancel or ask about a cancellation, call ${SUPPORT_PHONE} or email ${SUPPORT_EMAIL}.`,
    '',
    'Krawl Through Krakow',
  ].join('\n');

  const subjectExperience = header(firstItem?.productName ?? 'Krakow experience');
  const subjectDate = firstItem?.experienceDate ? ` - ${dateLabel(firstItem.experienceDate)}` : '';
  return {
    subject: `Booking confirmed - ${subjectExperience}${subjectDate}`,
    htmlBody: shell(preheader, content),
    textBody: text,
  };
};

export const buildInternalStorefrontEmail = (order: StorefrontOrder) => {
  const items = order.items || [];
  const guest = `${order.customerFirstName} ${order.customerLastName}`.trim();
  const preheader = `${guest} completed a paid storefront checkout.`;
  const content = `
    <div style="text-align:center;color:#9b4d2d;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">New storefront booking</div>
    <h1 style="margin:12px 0 22px;text-align:center;color:#241c19;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.1">Payment received</h1>
    <div style="margin-bottom:18px;padding:18px;background:#241c19;border-radius:16px;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
      <strong style="color:#f4a261">Order ${escapeHtml(order.publicId)}</strong><br>
      ${escapeHtml(guest)} - ${escapeHtml(order.customerEmail)}${order.customerPhone ? `<br>${escapeHtml(order.customerPhone)}` : ''}
    </div>
    ${items.map((item) => itemCard(item, order.currency)).join('')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eadfd8;border-bottom:1px solid #eadfd8">
      ${detailRow('Payment', 'Paid')}
      ${detailRow('Total', money(order.total, order.currency))}
      ${order.discountCode ? detailRow('Discount code', order.discountCode) : ''}
      ${detailRow('Customer country', order.customerCountryCode || 'Not provided')}
    </table>
    <p style="margin:24px 0 0;text-align:center;color:#766a66;font-family:Arial,sans-serif;font-size:13px;line-height:1.6">Automatic Omni-Lodge notification</p>`;

  return {
    subject: `New paid storefront order - ${guest} - ${money(order.total, order.currency)}`,
    htmlBody: shell(preheader, content),
    textBody: [
      'NEW PAID STOREFRONT ORDER',
      `Order: ${order.publicId}`,
      `Guest: ${guest}`,
      `Email: ${order.customerEmail}`,
      `Phone: ${order.customerPhone || '-'}`,
      ...items.map((item) => `${item.productName} - ${dateLabel(item.experienceDate)} ${timeLabel(item.experienceTime)} - ${item.quantity} guests`),
      `Total: ${money(order.total, order.currency)}`,
      order.discountCode ? `Discount code: ${order.discountCode}` : '',
    ].join('\n'),
  };
};

export const deliverStorefrontOrderEmails = async (publicId: string): Promise<void> => {
  await sequelize.transaction(async (transaction) => {
    const order = await findLockedStorefrontOrderWithItems(publicId, transaction);
    if (!order || order.paymentStatus !== 'paid') return;

    const from = fromAddress();
    if (!order.customerEmailSentAt) {
      const email = buildCustomerStorefrontEmail(order);
      await sendMessage({ to: order.customerEmail, from, ...email });
      await order.update({ customerEmailSentAt: new Date() }, { transaction });
    }

    const internalTo = header(getConfigValue('STOREFRONT_NOTIFICATION_EMAIL'));
    if (internalTo && !order.internalEmailSentAt) {
      const email = buildInternalStorefrontEmail(order);
      await sendMessage({ to: internalTo, from, ...email });
      await order.update({ internalEmailSentAt: new Date() }, { transaction });
    }
  });

  logger.info(`[storefront-email] Completed paid-order email delivery for ${publicId}`);
};
