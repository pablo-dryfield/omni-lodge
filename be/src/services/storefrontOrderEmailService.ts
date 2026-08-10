import dayjs from 'dayjs';
import sequelize from '../config/database.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import StorefrontOrderItem from '../models/StorefrontOrderItem.js';
import { sendMessage } from './bookings/gmailClient.js';
import { getConfigValue } from './configService.js';
import { findLockedStorefrontOrderWithItems } from './storefrontOrderPersistenceService.js';
import logger from '../utils/logger.js';

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

const row = (label: string, value: unknown): string => `
  <tr>
    <td style="padding:11px 0;color:#766a66;font:14px Arial,sans-serif;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:11px 0 11px 16px;color:#211b19;font:bold 14px Arial,sans-serif;text-align:right;vertical-align:top">${escapeHtml(value)}</td>
  </tr>`;

const itemCard = (item: StorefrontOrderItem, currency: string): string => {
  const addons = Array.isArray(item.addons) ? item.addons : [];
  const addonCopy = addons
    .map((addon) => `${addon.name ?? 'Add-on'} × ${addon.quantity ?? 1}`)
    .join(', ');
  return `
    <div style="margin:0 0 12px;padding:18px;background:#fff;border:1px solid #eadfd8;border-radius:16px">
      <div style="font:bold 18px Georgia,serif;color:#211b19">${escapeHtml(item.productName)}</div>
      <div style="margin-top:7px;color:#675b56;font:14px/1.5 Arial,sans-serif">
        ${escapeHtml(dateLabel(item.experienceDate))} · ${escapeHtml(timeLabel(item.experienceTime))}<br>
        ${escapeHtml(`${item.quantity} guest${item.quantity === 1 ? '' : 's'}`)}
        ${addonCopy ? `<br><span style="color:#8d4c30">${escapeHtml(addonCopy)}</span>` : ''}
      </div>
      <div style="margin-top:8px;color:#211b19;font:bold 15px Arial,sans-serif">${escapeHtml(money(item.total, currency))}</div>
    </div>`;
};

const shell = (eyebrow: string, title: string, intro: string, body: string, footer: string): string => `
<!doctype html>
<html lang="en">
  <head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#201a18">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(intro)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#201a18">
      <tr><td style="padding:24px 12px">
        <div style="max-width:620px;margin:auto;background:#f4a261;border-radius:28px;padding:10px">
          <div style="background:#fffaf6;border-radius:21px;padding:32px 24px">
            <div style="text-align:center;color:#9b4d2d;font:bold 12px Arial,sans-serif;letter-spacing:3px;text-transform:uppercase">${escapeHtml(eyebrow)}</div>
            <h1 style="margin:12px 0 10px;text-align:center;color:#211b19;font:42px/1.05 Georgia,serif">${escapeHtml(title)}</h1>
            <p style="margin:0 auto 26px;max-width:480px;text-align:center;color:#675b56;font:16px/1.6 Arial,sans-serif">${escapeHtml(intro)}</p>
            ${body}
            <p style="margin:26px 0 0;text-align:center;color:#766a66;font:13px/1.6 Arial,sans-serif">${escapeHtml(footer)}</p>
          </div>
        </div>
      </td></tr>
    </table>
  </body>
</html>`;

export const buildCustomerStorefrontEmail = (order: StorefrontOrder) => {
  const firstName = order.customerFirstName || 'there';
  const items = order.items || [];
  const intro = `Hi ${firstName}, your payment went through and your Kraków experience is confirmed. Here is everything you need in one place.`;
  const body = `
    <div style="margin:0 0 22px;padding:18px;text-align:center;background:#211b19;border-radius:16px;color:#fff">
      <div style="color:#f4a261;font:bold 11px Arial,sans-serif;letter-spacing:2px;text-transform:uppercase">Booking reference</div>
      <div style="margin-top:6px;font:bold 18px Arial,sans-serif;word-break:break-all">${escapeHtml(order.publicId)}</div>
    </div>
    ${items.map((item) => itemCard(item, order.currency)).join('')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid #eadfd8;border-bottom:1px solid #eadfd8">
      ${row('Subtotal', money(order.subtotal, order.currency))}
      ${Number(order.addonTotal) ? row('Add-ons', money(order.addonTotal, order.currency)) : ''}
      ${Number(order.discountTotal) ? row('Discount', `−${money(order.discountTotal, order.currency)}`) : ''}
      ${row('Total paid', money(order.total, order.currency))}
    </table>
    <div style="margin-top:22px;padding:18px;background:#fff1e6;border-radius:16px;color:#4f403a;font:14px/1.6 Arial,sans-serif">
      <strong style="color:#211b19">What happens next?</strong><br>
      Save this email and bring your booking reference. If anything changes or you have a question, simply reply to this message and our Kraków team will help.
    </div>`;
  const text = [
    `You're booked, ${firstName}!`,
    intro,
    `Booking reference: ${order.publicId}`,
    '',
    ...items.flatMap((item) => [
      item.productName,
      `${dateLabel(item.experienceDate)} · ${timeLabel(item.experienceTime)}`,
      `${item.quantity} guest${item.quantity === 1 ? '' : 's'} · ${money(item.total, order.currency)}`,
      '',
    ]),
    `Total paid: ${money(order.total, order.currency)}`,
    '',
    'Save this email and bring your booking reference. Reply to this email if you need help.',
  ].join('\n');
  return {
    subject: `You're booked! Kraków confirmation ${order.publicId.slice(0, 8).toUpperCase()}`,
    htmlBody: shell('Payment confirmed', `You're booked, ${firstName}!`, intro, body, 'Krawl Through Krakow · See you soon'),
    textBody: text,
  };
};

export const buildInternalStorefrontEmail = (order: StorefrontOrder) => {
  const items = order.items || [];
  const guest = `${order.customerFirstName} ${order.customerLastName}`.trim();
  const intro = `${guest} completed a paid storefront checkout.`;
  const body = `
    <div style="margin-bottom:18px;padding:18px;background:#211b19;border-radius:16px;color:#fff;font:14px/1.6 Arial,sans-serif">
      <strong style="color:#f4a261">Order ${escapeHtml(order.publicId)}</strong><br>
      ${escapeHtml(guest)} · ${escapeHtml(order.customerEmail)}${order.customerPhone ? `<br>${escapeHtml(order.customerPhone)}` : ''}
    </div>
    ${items.map((item) => itemCard(item, order.currency)).join('')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eadfd8;border-bottom:1px solid #eadfd8">
      ${row('Payment', 'Paid')}
      ${row('Total', money(order.total, order.currency))}
      ${order.discountCode ? row('Discount code', order.discountCode) : ''}
      ${row('Customer country', order.customerCountryCode || 'Not provided')}
    </table>`;
  return {
    subject: `New paid storefront order · ${guest} · ${money(order.total, order.currency)}`,
    htmlBody: shell('New storefront booking', 'Payment received', intro, body, 'This is an automatic Omni-Lodge notification.'),
    textBody: [
      'NEW PAID STOREFRONT ORDER',
      `Order: ${order.publicId}`,
      `Guest: ${guest}`,
      `Email: ${order.customerEmail}`,
      `Phone: ${order.customerPhone || '-'}`,
      ...items.map((item) => `${item.productName} — ${dateLabel(item.experienceDate)} ${timeLabel(item.experienceTime)} — ${item.quantity} guests`),
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
