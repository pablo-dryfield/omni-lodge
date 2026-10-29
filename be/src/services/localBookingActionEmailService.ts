import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import type Booking from '../models/Booking.js';
import BookingEmail from '../models/BookingEmail.js';
import { getConfigValue, refreshConfigCacheKeys } from './configService.js';
import { sendMessage as sendGmailMessage } from './bookings/gmailClient.js';
import { recordCustomerEmailThreadParticipant } from './bookings/customerEmailThreadService.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
export type LocalBookingAction = 'amend' | 'cancel';
export type LocalActionEmailContext = {
  operation: LocalBookingAction; reason: string; actorId: number;
  previousStartAt: Date | null; emailFamily: 'DIRECT_BOOKINGS' | 'STOREFRONT'; sendCustomerEmail: boolean;
};
type Delivery = { status: 'sent' | 'skipped' | 'failed'; messageId?: string | null; reason?: string };
const keys = ['STOREFRONT_EMAIL_FROM_ADDRESS', 'STOREFRONT_EMAIL_FROM_NAME', 'STOREFRONT_NOTIFICATION_EMAIL',
  'DIRECT_BOOKINGS_EMAIL_FROM_ADDRESS', 'DIRECT_BOOKINGS_EMAIL_FROM_NAME', 'DIRECT_BOOKINGS_NOTIFICATION_EMAIL'] as const;
const escape = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const displayStart = (value: Date | null) => value && dayjs(value).isValid()
  ? dayjs(value).tz('Europe/Warsaw').format('YYYY-MM-DD HH:mm') + ' (Europe/Warsaw)' : 'Not specified';

export const buildLocalBookingActionEmail = (booking: Booking, context: LocalActionEmailContext, internal: boolean) => {
  const action = context.operation === 'cancel' ? 'cancelled' : 'amended';
  const guestName = [booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' ') || 'Guest';
  const subject = internal ? `OmniLodge-only booking ${action} — ${booking.platformBookingId}`
    : `${booking.productName || 'Experience'} booking ${action} — ${booking.platformBookingId}`;
  const lines = [internal ? 'Manual reservation correction' : `Hi ${guestName},`, '',
    `Your ${booking.productName || 'experience'} reservation has been ${action} in OmniLodge.`,
    `Booking reference: ${booking.platformBookingId}`, `Platform: ${booking.platform}`,
    `Guests: ${booking.partySizeTotal ?? 'Not specified'}`,
    ...(context.operation === 'amend' ? [`Previous start: ${displayStart(context.previousStartAt)}`] : []),
    `Start: ${displayStart(booking.experienceStartAt)}`, '',
    'This updates our OmniLodge reservation only. It does not change the booking on the original platform.',
    'No payment or refund was processed. Any platform changes or refunds must be handled separately with the booking platform.',
    ...(internal ? ['', `OmniLodge booking ID: ${booking.id}`, `Changed by user: ${context.actorId}`,
      `Management reason: ${context.reason}`] : []),
  ];
  return { subject, textBody: lines.join('\n'),
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px;line-height:1.6">${lines
      .map(line => line ? `<p>${escape(line)}</p>` : '').join('')}</div>` };
};

export const notifyLocalBookingAction = async (booking: Booking, context: LocalActionEmailContext): Promise<{
  customer: Delivery; internal: Delivery;
}> => {
  try { await refreshConfigCacheKeys(keys); } catch (error) {
    logger.error('[local-booking-actions] Notification configuration could not be refreshed.', error);
    return { customer: { status: 'failed', reason: 'Notification configuration unavailable.' },
      internal: { status: 'failed', reason: 'Notification configuration unavailable.' } };
  }
  const address = String(getConfigValue(`${context.emailFamily}_EMAIL_FROM_ADDRESS`) ?? '').trim().replace(/[\r\n]/g, '');
  const name = String(getConfigValue(`${context.emailFamily}_EMAIL_FROM_NAME`) ?? '').replace(/["\r\n]/g, '').trim();
  const from = address ? (name ? `"${name}" <${address}>` : address) : null;
  const internalTo = String(getConfigValue(`${context.emailFamily}_NOTIFICATION_EMAIL`) ?? '').trim();
  const deliver = async (to: string | null | undefined, internal: boolean): Promise<Delivery> => {
    if (!internal && !context.sendCustomerEmail) return { status: 'skipped', reason: 'Customer notification disabled for this action.' };
    if (!to?.trim()) return { status: 'skipped', reason: internal ? 'No internal notification recipient configured.' : 'No customer email on this booking.' };
    if (!from) return { status: 'failed', reason: 'No sender address configured in Control Panel.' };
    try {
      const rendered = buildLocalBookingActionEmail(booking, context, internal);
      const result = await sendGmailMessage({ returnAccountReference: true, to: to.trim(), from, ...rendered });
      if (!internal) {
        try {
          if (!result.id) throw new Error('Gmail returned no message ID');
          await BookingEmail.findOrCreate({ where: { messageId: result.id }, defaults: {
            messageId: result.id, threadId: result.threadId, bookingId: booking.id, fromAddress: result.from || from,
            toAddresses: to.trim(), subject: rendered.subject, snippet: rendered.textBody.slice(0, 250),
            labelIds: ['SENT'], receivedAt: new Date(), ingestionStatus: 'sent',
            rawPayload: JSON.stringify({ id: result.id, threadId: result.threadId,
              payload: { mimeType: 'text/plain', body: { data: Buffer.from(rendered.textBody).toString('base64url') } } }),
          } as BookingEmail });
          if (result.threadId) await recordCustomerEmailThreadParticipant({
            threadId: result.threadId, userId: context.actorId, messageId: result.id,
          });
        } catch (error) {
          logger.error(`[local-booking-actions] Customer email sent but mailbox history could not be fully recorded for booking ${booking.id}.`, error);
          return { status: 'sent', messageId: result.id, reason: 'Email sent, but mailbox history could not be fully recorded. Do not resend the booking action.' };
        }
      }
      return { status: 'sent', messageId: result.id };
    } catch (error) {
      logger.error(`[local-booking-actions] ${internal ? 'Internal' : 'Customer'} notification failed for booking ${booking.id}.`, error);
      return { status: 'failed', reason: 'Email delivery failed. The booking change is already saved.' };
    }
  };
  const customer = await deliver(booking.guestEmail, false);
  const internal = await deliver(internalTo, true);
  return { customer, internal };
};
