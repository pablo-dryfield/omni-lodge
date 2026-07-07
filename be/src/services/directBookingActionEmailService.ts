import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import Booking from '../models/Booking.js';
import { sendMessage as sendGmailMessage } from './bookings/gmailClient.js';
import type { SendMessageResult } from './bookings/gmailClient.js';
import logger from '../utils/logger.js';
import { getConfigValue } from './configService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export type DirectBookingActionEmailKind = 'confirmation' | 'cancellation' | 'amend' | 'partial_refund';

export type DirectBookingActionEmailOptions = {
  kind: DirectBookingActionEmailKind;
  previousExperienceStartAt?: Date | null;
  refundedAmount?: number | null;
  refundCurrency?: string | null;
  previousPartySizeTotal?: number | null;
  currentPartySizeTotal?: number | null;
};

const DISPLAY_TIMEZONE = 'Europe/Warsaw';
const MEETING_POINT = "St. Mary's Basilica, plac Mariacki 5, 31-042 Krakow, Poland";
const GUIDE_NOTE = "Look for the guide holding a pretzel on a stick.";

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const stripHtml = (value: string): string =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const SYSTEM_NOTE_PREFIXES = [
  'requested start time:',
  'stripe payment_intent:',
  'stripe payment intent:',
  'stripe livemode:',
  'stripe mode:',
  'checkout source:',
];

const sanitizeEmailHeaderPart = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

const quoteEmailDisplayName = (value: string): string =>
  `"${sanitizeEmailHeaderPart(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const resolveDirectBookingEmailFrom = (): string | null => {
  const address = sanitizeEmailHeaderPart(String(getConfigValue('DIRECT_BOOKINGS_EMAIL_FROM_ADDRESS') ?? ''));
  if (!address) {
    return null;
  }

  const name = sanitizeEmailHeaderPart(String(getConfigValue('DIRECT_BOOKINGS_EMAIL_FROM_NAME') ?? 'Food Tour Krakow'));
  return name ? `${quoteEmailDisplayName(name)} <${address}>` : address;
};

const resolveDirectBookingNotificationEmail = (): string | null => {
  const email = sanitizeEmailHeaderPart(String(getConfigValue('DIRECT_BOOKINGS_NOTIFICATION_EMAIL') ?? ''));
  return email || null;
};

const extractCustomerNotes = (notes: string | null | undefined): string | null => {
  const rawNotes = notes?.trim();
  if (!rawNotes) {
    return null;
  }

  const customerNotes = rawNotes
    .split(/\s*\|\s*|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const normalizedPart = part.toLowerCase();
      return !SYSTEM_NOTE_PREFIXES.some((prefix) => normalizedPart.startsWith(prefix));
    })
    .join(' | ')
    .trim();

  return customerNotes || null;
};

const formatDisplayDate = (value: string | Date | null): string => {
  if (!value) {
    return 'To be confirmed';
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('DD/MM/YYYY') : 'To be confirmed';
};

const formatDisplayTime = (value: Date | null): string => {
  if (!value) {
    return '2:00 PM';
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.tz(DISPLAY_TIMEZONE).format('h:mm A') : '2:00 PM';
};

const formatMoney = (amount: string | number | null | undefined, currency: string | null | undefined): string => {
  if (amount === null || amount === undefined || amount === '') {
    return 'Paid';
  }

  const parsed = typeof amount === 'number' ? amount : Number.parseFloat(String(amount));
  if (!Number.isFinite(parsed)) {
    return String(amount);
  }

  const normalizedCurrency = (currency ?? '').toUpperCase();
  const suffix = normalizedCurrency === 'PLN' ? 'zł' : normalizedCurrency || '';
  const normalizedAmount = Number.isInteger(parsed) ? parsed.toFixed(0) : parsed.toFixed(2);
  return `${normalizedAmount}${suffix ? ` ${suffix}` : ''}`;
};

const buildGuestName = (booking: Booking): string => {
  const fullName = [booking.guestFirstName, booking.guestLastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');

  return fullName || 'Guest';
};

const bookingInfoRow = (label: string, value: unknown): string => `
  <tr>
    <td style="padding:12px 0;color:#7d6b70;font-family:Arial,sans-serif;font-size:15px;">${escapeHtml(label)}</td>
    <td style="padding:12px 0;color:#2f2128;font-family:Arial,sans-serif;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(value || '-')}</td>
  </tr>
`;

const getEmailCopy = (
  booking: Booking,
  options: DirectBookingActionEmailOptions,
): { eyebrow: string; headline: string; body: string; subject: string } => {
  const tourName = booking.productName ?? 'Krakow Food Tour';
  const guestName = buildGuestName(booking);
  switch (options.kind) {
    case 'cancellation':
      return {
        eyebrow: 'Booking cancelled',
        headline: 'Your tour was cancelled',
        body: `Hi ${guestName}, your ${tourName} booking has been cancelled. If a refund was issued, Stripe will return it to the original payment method.`,
        subject: `Your ${tourName} booking was cancelled`,
      };
    case 'amend':
      return {
        eyebrow: 'Booking updated',
        headline: 'Your tour was updated',
        body: `Hi ${guestName}, your ${tourName} booking details have been updated. Please check the new date and start time below.`,
        subject: `Your ${tourName} booking was updated`,
      };
    case 'partial_refund':
      if (
        options.previousPartySizeTotal != null &&
        options.currentPartySizeTotal != null &&
        options.previousPartySizeTotal !== options.currentPartySizeTotal
      ) {
        return {
          eyebrow: 'Participants updated',
          headline: 'Your refund is processing',
          body: `Hi ${guestName}, we updated your ${tourName} booking from ${options.previousPartySizeTotal} to ${options.currentPartySizeTotal} participants and issued the related partial refund. Stripe will return it to the original payment method.`,
          subject: `Participants updated for your ${tourName} booking`,
        };
      }
      return {
        eyebrow: 'Partial refund issued',
        headline: 'Your refund is processing',
        body: `Hi ${guestName}, we issued a partial refund for your ${tourName} booking. Stripe will return it to the original payment method.`,
        subject: `Partial refund for your ${tourName} booking`,
      };
    case 'confirmation':
    default:
      return {
        eyebrow: 'Booking confirmed',
        headline: 'You are booked',
        body: `Hi ${guestName}, your ${tourName} is confirmed. Bring your appetite.`,
        subject: `Your ${tourName} booking is confirmed`,
      };
  }
};

const getInternalEmailCopy = (
  booking: Booking,
  options: DirectBookingActionEmailOptions,
): { eyebrow: string; headline: string; subject: string } => {
  const date = formatDisplayDate(booking.experienceDate);
  const parsedDate = booking.experienceDate ? dayjs(booking.experienceDate) : null;
  const subjectDate = parsedDate?.isValid() ? parsedDate.format('ddd, MMM D, YYYY') : date;

  switch (options.kind) {
    case 'cancellation':
      return {
        eyebrow: 'Direct booking cancelled',
        headline: 'Booking cancelled',
        subject: `Booking Cancelled for ${subjectDate} (${booking.id})`,
      };
    case 'amend':
      return {
        eyebrow: 'Direct booking amended',
        headline: 'Booking amended',
        subject: `Booking Amended for ${subjectDate} (${booking.id})`,
      };
    case 'partial_refund':
      return {
        eyebrow: 'Direct booking partially refunded',
        headline: 'Partial refund issued',
        subject: `Partial Refund for ${subjectDate} (${booking.id})`,
      };
    case 'confirmation':
    default:
      return {
        eyebrow: 'Direct booking confirmed',
        headline: 'Booking confirmed',
        subject: `New Booking for ${subjectDate} (${booking.id})`,
      };
  }
};

export const buildDirectBookingActionEmail = (
  booking: Booking,
  options: DirectBookingActionEmailOptions,
): { subject: string; htmlBody: string; textBody: string } => {
  const tourName = booking.productName ?? 'Krakow Food Tour';
  const orderNumber = booking.id;
  const date = formatDisplayDate(booking.experienceDate);
  const time = formatDisplayTime(booking.experienceStartAt);
  const previousDateTime = options.previousExperienceStartAt
    ? `${formatDisplayDate(options.previousExperienceStartAt)} ${formatDisplayTime(options.previousExperienceStartAt)}`
    : null;
  const guests = booking.partySizeTotal ?? 1;
  const totalPaid = formatMoney(booking.priceGross ?? booking.baseAmount, booking.currency);
  const refundedAmount =
    options.refundedAmount != null
      ? formatMoney(options.refundedAmount, options.refundCurrency ?? booking.refundedCurrency ?? booking.currency)
      : null;
  const hasParticipantChange =
    options.kind === 'partial_refund' &&
    options.previousPartySizeTotal != null &&
    options.currentPartySizeTotal != null &&
    options.previousPartySizeTotal !== options.currentPartySizeTotal;
  const notes = extractCustomerNotes(booking.notes);
  const copy = getEmailCopy(booking, options);

  const htmlBody = `
<!doctype html>
<html>
  <body style="margin:0;background:#2f2128;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#fac7b3;border-radius:32px;padding:18px;font-family:Arial,sans-serif;">
      <div style="background:#fffaf6;border-radius:26px;padding:34px 28px;text-align:center;">
        <p style="margin:0 0 18px;color:#8b4a2e;font-family:Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:5px;text-transform:uppercase;">${escapeHtml(copy.eyebrow)}</p>
        <h1 style="margin:0;color:#2f2128;font-family:Georgia,serif;font-size:44px;line-height:1.02;font-weight:500;">${escapeHtml(copy.headline)}</h1>
        <p style="margin:18px 0 0;color:#4b3b40;font-size:17px;line-height:1.55;">${escapeHtml(copy.body)}</p>

        <div style="margin:28px auto 0;background:#2f2128;color:#fff;border-radius:20px;padding:18px 20px;max-width:340px;">
          <div style="color:#e39b6e;font-size:12px;font-weight:900;letter-spacing:4px;text-transform:uppercase;">Order number</div>
          <div style="font-size:30px;font-weight:900;line-height:1.2;">${escapeHtml(orderNumber)}</div>
        </div>

        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:28px 0 0;border-collapse:collapse;border-top:1px solid #f0ded6;border-bottom:1px solid #f0ded6;">
          ${bookingInfoRow('Tour', tourName)}
          ${previousDateTime ? bookingInfoRow('Previous start', previousDateTime) : ''}
          ${bookingInfoRow('Date', date)}
          ${bookingInfoRow('Start time', time)}
          ${bookingInfoRow('Guests', guests)}
          ${hasParticipantChange ? bookingInfoRow('Previous participants', options.previousPartySizeTotal) : ''}
          ${hasParticipantChange ? bookingInfoRow('Current participants', options.currentPartySizeTotal) : ''}
          ${bookingInfoRow('Total paid', totalPaid)}
          ${refundedAmount ? bookingInfoRow('Refund amount', refundedAmount) : ''}
          ${bookingInfoRow('Payment method', booking.paymentMethod ?? 'Card')}
          ${bookingInfoRow('Customer email', booking.guestEmail)}
          ${bookingInfoRow('Customer phone', booking.guestPhone)}
        </table>

        ${
          notes
            ? `<div style="margin:24px 0 0;text-align:left;background:#fff3ed;border:1px solid #f0d2c3;border-radius:18px;padding:18px;color:#4b3b40;font-size:15px;line-height:1.55;"><strong style="color:#2f2128;">Dietary notes or requests</strong><br>${escapeHtml(notes)}</div>`
            : ''
        }

        <div style="margin:24px 0 0;background:#2f2128;color:#fff;border-radius:20px;padding:20px;font-size:15px;line-height:1.6;">
          <strong>Meeting point</strong><br>
          ${escapeHtml(MEETING_POINT)}<br>
          ${escapeHtml(GUIDE_NOTE)}
        </div>

        <p style="margin:24px 0 0;color:#7d6b70;font-size:13px;line-height:1.5;">If you have questions, reply to this email.</p>
      </div>
    </div>
  </body>
</html>`;

  const textBody = [
    copy.eyebrow,
    '',
    copy.body,
    `Order number: ${orderNumber}`,
    previousDateTime ? `Previous start: ${previousDateTime}` : null,
    `Date: ${date}`,
    `Start time: ${time}`,
    `Guests: ${guests}`,
    hasParticipantChange ? `Previous participants: ${options.previousPartySizeTotal}` : null,
    hasParticipantChange ? `Current participants: ${options.currentPartySizeTotal}` : null,
    `Total paid: ${totalPaid}`,
    refundedAmount ? `Refund amount: ${refundedAmount}` : null,
    `Payment method: ${booking.paymentMethod ?? 'Card'}`,
    `Customer email: ${booking.guestEmail ?? ''}`,
    `Customer phone: ${booking.guestPhone ?? ''}`,
    notes ? `Dietary notes or requests: ${notes}` : null,
    '',
    `Meeting point: ${MEETING_POINT}`,
    GUIDE_NOTE,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return {
    subject: copy.subject,
    htmlBody,
    textBody: textBody || stripHtml(htmlBody),
  };
};

export const sendDirectBookingActionEmail = async (
  booking: Booking,
  options: DirectBookingActionEmailOptions,
): Promise<SendMessageResult | null> => {
  const to = booking.guestEmail?.trim();
  if (!to) {
    logger.warn(`[direct-bookings] Skipping ${options.kind} email for booking ${booking.id}: missing guest email`);
    return null;
  }

  const email = buildDirectBookingActionEmail(booking, options);
  const result = await sendGmailMessage({
    to,
    from: resolveDirectBookingEmailFrom(),
    subject: email.subject,
    textBody: email.textBody,
    htmlBody: email.htmlBody,
  });

  logger.info(`[direct-bookings] Sent ${options.kind} email for booking ${booking.id}`, {
    messageId: result.id,
    rfcMessageId: result.rfcMessageId,
    threadId: result.threadId,
    labelIds: result.labelIds,
    to: result.to,
    from: result.from,
  });

  return result;
};

export const buildInternalDirectBookingActionEmail = (
  booking: Booking,
  options: DirectBookingActionEmailOptions,
): { subject: string; htmlBody: string; textBody: string } => {
  const tourName = booking.productName ?? 'Krakow Food Tour';
  const guestName = buildGuestName(booking);
  const date = formatDisplayDate(booking.experienceDate);
  const time = formatDisplayTime(booking.experienceStartAt);
  const previousDateTime = options.previousExperienceStartAt
    ? `${formatDisplayDate(options.previousExperienceStartAt)} ${formatDisplayTime(options.previousExperienceStartAt)}`
    : null;
  const guests = booking.partySizeTotal ?? 1;
  const totalPaid = formatMoney(booking.priceGross ?? booking.baseAmount, booking.currency);
  const refundedAmount =
    options.refundedAmount != null
      ? formatMoney(options.refundedAmount, options.refundCurrency ?? booking.refundedCurrency ?? booking.currency)
      : null;
  const hasParticipantChange =
    options.kind === 'partial_refund' &&
    options.previousPartySizeTotal != null &&
    options.currentPartySizeTotal != null &&
    options.previousPartySizeTotal !== options.currentPartySizeTotal;
  const notes = extractCustomerNotes(booking.notes);
  const copy = getInternalEmailCopy(booking, options);

  const htmlBody = `
<!doctype html>
<html>
  <body style="margin:0;background:#2f2128;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#fac7b3;border-radius:28px;padding:18px;font-family:Arial,sans-serif;">
      <div style="background:#fffaf6;border-radius:22px;padding:30px 26px;">
        <p style="margin:0 0 14px;color:#8b4a2e;font-size:13px;font-weight:800;letter-spacing:4px;text-transform:uppercase;text-align:center;">${escapeHtml(copy.eyebrow)}</p>
        <h1 style="margin:0;color:#2f2128;font-family:Georgia,serif;font-size:36px;line-height:1.08;font-weight:500;text-align:center;">${escapeHtml(copy.headline)}</h1>
        <div style="margin:24px auto;background:#2f2128;color:#fff;border-radius:18px;padding:16px 18px;max-width:320px;text-align:center;">
          <div style="color:#e39b6e;font-size:12px;font-weight:900;letter-spacing:3px;text-transform:uppercase;">Omni-Lodge reference</div>
          <div style="font-size:28px;font-weight:900;line-height:1.2;">${escapeHtml(booking.id)}</div>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-top:1px solid #f0ded6;border-bottom:1px solid #f0ded6;">
          ${bookingInfoRow('Action', copy.headline)}
          ${bookingInfoRow('Tour', tourName)}
          ${previousDateTime ? bookingInfoRow('Previous start', previousDateTime) : ''}
          ${bookingInfoRow('Date', date)}
          ${bookingInfoRow('Start time', time)}
          ${bookingInfoRow('Guests', guests)}
          ${hasParticipantChange ? bookingInfoRow('Previous participants', options.previousPartySizeTotal) : ''}
          ${hasParticipantChange ? bookingInfoRow('Current participants', options.currentPartySizeTotal) : ''}
          ${bookingInfoRow('Guest name', guestName)}
          ${bookingInfoRow('Guest email', booking.guestEmail)}
          ${bookingInfoRow('Guest phone', booking.guestPhone)}
          ${bookingInfoRow('Total paid', totalPaid)}
          ${refundedAmount ? bookingInfoRow('Refund amount', refundedAmount) : ''}
          ${bookingInfoRow('Payment status', booking.paymentStatus ?? '-')}
          ${bookingInfoRow('Booking status', booking.status ?? '-')}
          ${bookingInfoRow('Platform booking ID', booking.platformBookingId)}
        </table>
        ${
          notes
            ? `<div style="margin:24px 0 0;background:#fff3ed;border:1px solid #f0d2c3;border-radius:18px;padding:18px;color:#4b3b40;font-size:15px;line-height:1.55;"><strong style="color:#2f2128;">Dietary notes or requests</strong><br>${escapeHtml(notes)}</div>`
            : ''
        }
      </div>
    </div>
  </body>
</html>`;

  const textBody = [
    copy.eyebrow,
    '',
    `Action: ${copy.headline}`,
    `Omni-Lodge reference: ${booking.id}`,
    `Tour: ${tourName}`,
    previousDateTime ? `Previous start: ${previousDateTime}` : null,
    `Date: ${date}`,
    `Start time: ${time}`,
    `Guests: ${guests}`,
    hasParticipantChange ? `Previous participants: ${options.previousPartySizeTotal}` : null,
    hasParticipantChange ? `Current participants: ${options.currentPartySizeTotal}` : null,
    `Guest name: ${guestName}`,
    `Guest email: ${booking.guestEmail ?? ''}`,
    `Guest phone: ${booking.guestPhone ?? ''}`,
    `Total paid: ${totalPaid}`,
    refundedAmount ? `Refund amount: ${refundedAmount}` : null,
    `Payment status: ${booking.paymentStatus ?? ''}`,
    `Booking status: ${booking.status ?? ''}`,
    `Platform booking ID: ${booking.platformBookingId ?? ''}`,
    notes ? `Dietary notes or requests: ${notes}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return {
    subject: copy.subject,
    htmlBody,
    textBody: textBody || stripHtml(htmlBody),
  };
};

export const sendInternalDirectBookingActionEmail = async (
  booking: Booking,
  options: DirectBookingActionEmailOptions,
): Promise<SendMessageResult | null> => {
  const to = resolveDirectBookingNotificationEmail();
  if (!to) {
    logger.warn(`[direct-bookings] Skipping internal ${options.kind} notification for booking ${booking.id}: missing notification email`);
    return null;
  }

  const email = buildInternalDirectBookingActionEmail(booking, options);
  const result = await sendGmailMessage({
    to,
    from: resolveDirectBookingEmailFrom(),
    subject: email.subject,
    textBody: email.textBody,
    htmlBody: email.htmlBody,
  });

  logger.info(`[direct-bookings] Sent internal ${options.kind} notification for booking ${booking.id}`, {
    messageId: result.id,
    rfcMessageId: result.rfcMessageId,
    threadId: result.threadId,
    labelIds: result.labelIds,
    to: result.to,
    from: result.from,
  });

  return result;
};

export const sendDirectBookingConfirmationEmail = (
  booking: Booking,
): Promise<SendMessageResult | null> =>
  sendDirectBookingActionEmail(booking, { kind: 'confirmation' });
