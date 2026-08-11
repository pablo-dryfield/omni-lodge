import dayjs from 'dayjs';
import { getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min';
import sequelize from '../config/database.js';
import Booking from '../models/Booking.js';
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

type BookingIdByItemId = ReadonlyMap<number, number>;

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

const countryLabel = (countryCode: string | null): string => {
  if (!countryCode) return 'Not provided';
  try {
    return `${countryNames.of(countryCode) || countryCode} (+${getCountryCallingCode(countryCode as CountryCode)})`;
  } catch {
    return countryCode;
  }
};

const guestLabel = (item: StorefrontOrderItem): string => {
  const options = item.options && typeof item.options === 'object' ? item.options : {};
  const rawParticipants = options.participants;
  if (!rawParticipants || typeof rawParticipants !== 'object' || Array.isArray(rawParticipants)) {
    return `${item.quantity} guest${item.quantity === 1 ? '' : 's'}`;
  }
  const participants = rawParticipants as Record<string, unknown>;
  const men = Number(participants.men) || 0;
  const women = Number(participants.women) || 0;
  return `${men} ${men === 1 ? 'man' : 'men'} · ${women} ${women === 1 ? 'woman' : 'women'}`;
};

const detailRow = (label: string, value: unknown): string => `
  <tr>
    <td style="padding:11px 0;color:#746762;font-family:Arial,sans-serif;font-size:14px;line-height:1.4;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:11px 0 11px 16px;color:#241c19;font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.4;text-align:right;vertical-align:top">${escapeHtml(value)}</td>
  </tr>`;

const addonSelection = (addon: Record<string, unknown>): string => {
  const variants = Array.isArray(addon.variants)
    ? addon.variants
        .map((rawVariant) => {
          if (!rawVariant || typeof rawVariant !== 'object' || Array.isArray(rawVariant)) return null;
          const variant = rawVariant as Record<string, unknown>;
          const value = String(variant.value ?? '').trim();
          const quantity = Number(variant.quantity);
          return value && Number.isInteger(quantity) && quantity > 0 ? `${value} × ${quantity}` : null;
        })
        .filter((value): value is string => value !== null)
    : [];
  if (variants.length > 0) return variants.join(' · ');
  const value = String(addon.value ?? '').trim();
  if (value) return value;
  return String(addon.quantity ?? 1);
};

const addonLabel = (addon: Record<string, unknown>): string =>
  `${addon.name ?? 'Add-on'}: ${addonSelection(addon)}`;

const bookingIdForItem = (
  item: StorefrontOrderItem,
  bookingIdsByItemId: BookingIdByItemId,
): number | null => bookingIdsByItemId.get(Number(item.id)) ?? null;

const itemCard = (
  item: StorefrontOrderItem,
  currency: string,
  bookingIdsByItemId: BookingIdByItemId,
  showBookingId: boolean,
): string => {
  const addons = Array.isArray(item.addons) ? item.addons : [];
  const bookingId = bookingIdForItem(item, bookingIdsByItemId);
  const experienceLabel = item.quantity > 1
    ? `Experience (${item.quantity} × ${money(item.unitPrice, currency)})`
    : 'Experience';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;background:#ffffff;border:1px solid #eadfd8;border-radius:16px">
      <tr><td style="padding:20px">
        <div style="text-align:center;color:#241c19;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;line-height:1.3">${escapeHtml(item.productName)}</div>
        ${showBookingId && bookingId ? `<div style="margin-top:7px;text-align:center;color:#9b4d2d;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase">OmniLodge booking ID <span style="color:#241c19;font-size:16px;letter-spacing:0">${bookingId}</span></div>` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:9px">
          ${detailRow('Date', dateLabel(item.experienceDate))}
          ${detailRow('Start time', timeLabel(item.experienceTime))}
          ${detailRow('Guests', guestLabel(item))}
          ${detailRow(experienceLabel, money(item.baseTotal, currency))}
          ${addons.length > 0 ? '<tr><td colspan="2" style="padding:15px 0 4px;color:#9b4d2d;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;text-align:center;text-transform:uppercase">Add-ons</td></tr>' : ''}
          ${addons.map((addon) => detailRow(addonLabel(addon), money(Number(addon.total) || 0, currency))).join('')}
          ${detailRow('Experience total', money(item.total, currency))}
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

const referenceDetails = (
  order: StorefrontOrder,
  bookingIdsByItemId: BookingIdByItemId,
): { label: string; value: string } => {
  const items = order.items || [];
  const bookingId = items.length === 1 ? bookingIdForItem(items[0], bookingIdsByItemId) : null;
  return bookingId
    ? { label: 'Booking reference', value: String(bookingId) }
    : { label: 'Order reference', value: order.publicId };
};

const referenceHtml = (
  order: StorefrontOrder,
  bookingIdsByItemId: BookingIdByItemId,
): string => {
  const reference = referenceDetails(order, bookingIdsByItemId);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background:#241c19;border-radius:16px">
      <tr><td align="center" style="padding:22px;color:#ffffff;font-family:Arial,sans-serif">
        <div style="color:#f4a261;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase">${escapeHtml(reference.label)}</div>
        <div style="margin-top:7px;color:${reference.label === 'Booking reference' ? '#ffd43b' : '#ffffff'};font-size:28px;font-weight:700;line-height:1.25;word-break:break-all">${escapeHtml(reference.value)}</div>
      </td></tr>
    </table>`;
};

const paymentHtml = (order: StorefrontOrder): string => `
  <div style="margin:24px 0 8px;text-align:center;color:#9b4d2d;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Payment</div>
  <div style="margin-bottom:10px;text-align:center;color:#241c19;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700">Paid in full</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eadfd8;border-bottom:1px solid #eadfd8">
    ${detailRow('Experiences', money(order.subtotal, order.currency))}
    ${detailRow('Add-ons', money(order.addonTotal, order.currency))}
    ${Number(order.discountTotal) > 0 ? detailRow('Discount', `-${money(order.discountTotal, order.currency)}`) : ''}
    ${detailRow('Total paid', money(order.total, order.currency))}
  </table>`;

const customerHtml = (order: StorefrontOrder): string => {
  const name = `${order.customerFirstName} ${order.customerLastName}`.trim();
  return `
    <div style="margin:24px 0 8px;text-align:center;color:#9b4d2d;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Booked for</div>
    <div style="margin-bottom:10px;text-align:center;color:#241c19;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700">Customer details</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eadfd8;border-bottom:1px solid #eadfd8">
      ${detailRow('Name', name)}
      ${detailRow('Email', order.customerEmail)}
      ${detailRow('Phone', order.customerPhone || 'Not provided')}
      ${detailRow('Country', countryLabel(order.customerCountryCode))}
    </table>`;
};

const coreHtml = (
  order: StorefrontOrder,
  bookingIdsByItemId: BookingIdByItemId,
): string => {
  const items = order.items || [];
  return `
    ${referenceHtml(order, bookingIdsByItemId)}
    <div style="margin:0 0 10px;text-align:center;color:#9b4d2d;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Your booking</div>
    <div style="margin-bottom:16px;text-align:center;color:#241c19;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700">Experience details</div>
    ${items.map((item) => itemCard(item, order.currency, bookingIdsByItemId, items.length > 1)).join('')}
    ${paymentHtml(order)}
    ${customerHtml(order)}`;
};

const itemText = (
  item: StorefrontOrderItem,
  currency: string,
  bookingIdsByItemId: BookingIdByItemId,
  showBookingId: boolean,
): string[] => {
  const addons = Array.isArray(item.addons) ? item.addons : [];
  const bookingId = bookingIdForItem(item, bookingIdsByItemId);
  const experienceLabel = item.quantity > 1
    ? `Experience (${item.quantity} × ${money(item.unitPrice, currency)})`
    : 'Experience';
  return [
    item.productName,
    ...(showBookingId && bookingId ? [`OmniLodge booking ID: ${bookingId}`] : []),
    `Date: ${dateLabel(item.experienceDate)}`,
    `Start time: ${timeLabel(item.experienceTime)}`,
    `Guests: ${guestLabel(item)}`,
    `${experienceLabel}: ${money(item.baseTotal, currency)}`,
    ...(addons.length > 0 ? ['Add-ons:', ...addons.map((addon) => `- ${addonLabel(addon)}: ${money(Number(addon.total) || 0, currency)}`)] : []),
    `Experience total: ${money(item.total, currency)}`,
    '',
  ];
};

const coreText = (
  order: StorefrontOrder,
  bookingIdsByItemId: BookingIdByItemId,
): string[] => {
  const items = order.items || [];
  const reference = referenceDetails(order, bookingIdsByItemId);
  return [
    `${reference.label}: ${reference.value}`,
    '',
    'EXPERIENCE DETAILS',
    ...items.flatMap((item) => itemText(item, order.currency, bookingIdsByItemId, items.length > 1)),
    'PAYMENT',
    'Status: Paid in full',
    `Experiences: ${money(order.subtotal, order.currency)}`,
    `Add-ons: ${money(order.addonTotal, order.currency)}`,
    ...(Number(order.discountTotal) > 0 ? [`Discount: -${money(order.discountTotal, order.currency)}`] : []),
    `Total paid: ${money(order.total, order.currency)}`,
    '',
    'CUSTOMER DETAILS',
    `Name: ${order.customerFirstName} ${order.customerLastName}`.trim(),
    `Email: ${order.customerEmail}`,
    `Phone: ${order.customerPhone || 'Not provided'}`,
    `Country: ${countryLabel(order.customerCountryCode)}`,
  ];
};

export const buildCustomerStorefrontEmail = (
  order: StorefrontOrder,
  bookingIdsByItemId: BookingIdByItemId = new Map(),
) => {
  const firstName = order.customerFirstName || 'there';
  const items = order.items || [];
  const cancellationPolicy = getStorefrontCancellationPolicy();
  const firstItem = items[0];
  const preheader = `Payment received. Your ${firstItem?.productName ?? 'Krakow experience'} is confirmed.`;
  const content = `
    <div style="text-align:center;color:#9b4d2d;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">Payment confirmed</div>
    <h1 style="margin:12px 0 10px;text-align:center;color:#241c19;font-family:Georgia,'Times New Roman',serif;font-size:40px;line-height:1.08">You're booked, ${escapeHtml(firstName)}!</h1>
    <p style="margin:0 auto 24px;max-width:500px;text-align:center;color:#675b56;font-family:Arial,sans-serif;font-size:16px;line-height:1.6">Your payment was successful and your Krakow experience is confirmed. Everything you need is below.</p>
    ${coreHtml(order, bookingIdsByItemId)}
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
    '',
    ...coreText(order, bookingIdsByItemId),
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

export const buildInternalStorefrontEmail = (
  order: StorefrontOrder,
  bookingIdsByItemId: BookingIdByItemId = new Map(),
) => {
  const guest = `${order.customerFirstName} ${order.customerLastName}`.trim();
  const preheader = `${guest} completed a paid storefront checkout.`;
  const content = `
    <div style="text-align:center;color:#9b4d2d;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">New storefront booking</div>
    <h1 style="margin:12px 0 22px;text-align:center;color:#241c19;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.1">Payment received</h1>
    <p style="margin:0 auto 24px;max-width:500px;text-align:center;color:#675b56;font-family:Arial,sans-serif;font-size:16px;line-height:1.6">${escapeHtml(guest)} completed payment. The confirmed booking and customer details are below.</p>
    ${coreHtml(order, bookingIdsByItemId)}
    ${order.discountCode ? `<div style="margin-top:18px;text-align:center;color:#675b56;font-family:Arial,sans-serif;font-size:14px">Discount code: <strong>${escapeHtml(order.discountCode)}</strong></div>` : ''}
    <p style="margin:24px 0 0;text-align:center;color:#766a66;font-family:Arial,sans-serif;font-size:13px;line-height:1.6">Automatic Omni-Lodge notification</p>`;

  return {
    subject: `New paid storefront order - ${guest} - ${money(order.total, order.currency)}`,
    htmlBody: shell(preheader, content),
    textBody: [
      'NEW PAID STOREFRONT ORDER',
      '',
      ...coreText(order, bookingIdsByItemId),
      '',
      order.discountCode ? `Discount code: ${order.discountCode}` : '',
    ].join('\n'),
  };
};

export const deliverStorefrontOrderEmails = async (publicId: string): Promise<void> => {
  await sequelize.transaction(async (transaction) => {
    const order = await findLockedStorefrontOrderWithItems(publicId, transaction);
    if (!order || order.paymentStatus !== 'paid') return;

    const bookings = await Booking.findAll({
      where: { platform: 'omnilodge', platformOrderId: order.publicId },
      attributes: ['id', 'platformBookingId'],
      transaction,
    });
    const bookingIdsByItemId = new Map<number, number>();
    for (const item of order.items || []) {
      const booking = bookings.find(
        (candidate) => candidate.platformBookingId === `${order.publicId}-${item.id}`,
      );
      if (booking) bookingIdsByItemId.set(Number(item.id), Number(booking.id));
    }

    const from = fromAddress();
    if (!order.customerEmailSentAt) {
      const email = buildCustomerStorefrontEmail(order, bookingIdsByItemId);
      await sendMessage({ to: order.customerEmail, from, ...email });
      await order.update({ customerEmailSentAt: new Date() }, { transaction });
    }

    const internalTo = header(getConfigValue('STOREFRONT_NOTIFICATION_EMAIL'));
    if (internalTo && !order.internalEmailSentAt) {
      const email = buildInternalStorefrontEmail(order, bookingIdsByItemId);
      await sendMessage({ to: internalTo, from, ...email });
      await order.update({ internalEmailSentAt: new Date() }, { transaction });
    }
  });

  logger.info(`[storefront-email] Completed paid-order email delivery for ${publicId}`);
};
