jest.mock('../configService.js', () => ({ getConfigValue: jest.fn(), refreshConfigCacheKeys: jest.fn() }));
jest.mock('../bookings/gmailClient.js', () => ({ sendMessage: jest.fn() }));
jest.mock('../../models/BookingEmail.js', () => ({ __esModule: true, default: { findOrCreate: jest.fn() } }));
jest.mock('../bookings/customerEmailThreadService.js', () => ({ recordCustomerEmailThreadParticipant: jest.fn() }));
import type Booking from '../../models/Booking.js';
import BookingEmail from '../../models/BookingEmail.js';
import { getConfigValue, refreshConfigCacheKeys } from '../configService.js';
import { sendMessage } from '../bookings/gmailClient.js';
import { recordCustomerEmailThreadParticipant } from '../bookings/customerEmailThreadService.js';
import { buildLocalBookingActionEmail, notifyLocalBookingAction, type LocalActionEmailContext } from '../localBookingActionEmailService.js';
const booking = { id: 42, guestFirstName: '<Guest>', guestLastName: '& Test', guestEmail: 'guest@example.test',
  platform: 'viator', platformBookingId: 'TEST-42', productName: 'Pub Crawl <test>', partySizeTotal: 2,
  experienceStartAt: new Date('2027-01-10T20:00:00Z') } as Booking;
const context: LocalActionEmailContext = { operation: 'amend', reason: 'Private internal reason', actorId: 7,
  previousStartAt: new Date('2027-01-09T20:00:00Z'), emailFamily: 'STOREFRONT', sendCustomerEmail: true };
const values: Record<string, string> = { STOREFRONT_EMAIL_FROM_ADDRESS: 'pub@example.test', STOREFRONT_EMAIL_FROM_NAME: 'Pub Team',
  STOREFRONT_NOTIFICATION_EMAIL: 'pub-ops@example.test', DIRECT_BOOKINGS_EMAIL_FROM_ADDRESS: 'food@example.test',
  DIRECT_BOOKINGS_EMAIL_FROM_NAME: 'Food Team', DIRECT_BOOKINGS_NOTIFICATION_EMAIL: 'food-ops@example.test' };
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(refreshConfigCacheKeys).mockResolvedValue(undefined);
  jest.mocked(getConfigValue).mockImplementation(key => values[key]);
  jest.mocked(sendMessage).mockResolvedValue({ id: 'message-test', threadId: 'thread-test' } as any);
  jest.mocked(BookingEmail.findOrCreate).mockResolvedValue([{} as BookingEmail, true]);
  jest.mocked(recordCustomerEmailThreadParticipant).mockResolvedValue(undefined);
});
it('uses actual product and Warsaw schedule, escapes HTML, and does not invent Food Tour meeting instructions', () => {
  const email = buildLocalBookingActionEmail(booking, context, false);
  expect(email.htmlBody).toContain('Pub Crawl &lt;test&gt;'); expect(email.htmlBody).not.toContain('<Guest>');
  expect(email.textBody).toContain('2027-01-10 21:00 (Europe/Warsaw)');
  expect(email.textBody).toContain('2027-01-09 21:00 (Europe/Warsaw)');
  expect(email.textBody).not.toContain(context.reason); expect(email.textBody).not.toMatch(/pretzel|basilica|2:00 PM/i);
  expect(email.textBody).toContain('does not change the booking on the original platform');
});
it('does not claim a cancellation processed a refund', () => {
  const email = buildLocalBookingActionEmail(booking, { ...context, operation: 'cancel' }, false);
  expect(email.subject).toContain('cancelled'); expect(email.textBody).toContain('No payment or refund was processed.');
  expect(email.textBody).not.toMatch(/Stripe will|refund is processing/i);
});
it('keeps management reason and actor in internal notifications only', () => {
  const email = buildLocalBookingActionEmail(booking, context, true);
  expect(email.textBody).toContain(context.reason); expect(email.textBody).toContain('Changed by user: 7');
  expect(email.subject).toContain('OmniLodge-only');
});
it.each(['STOREFRONT', 'DIRECT_BOOKINGS'] as const)('uses live Control Panel configuration for %s', async emailFamily => {
  const result = await notifyLocalBookingAction(booking, { ...context, emailFamily });
  expect(refreshConfigCacheKeys).toHaveBeenCalled();
  expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ to: 'guest@example.test',
    from: expect.stringContaining(values[`${emailFamily}_EMAIL_FROM_ADDRESS`]) }));
  expect(sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ to: values[`${emailFamily}_NOTIFICATION_EMAIL`] }));
  expect(result.customer.status).toBe('sent'); expect(result.internal.status).toBe('sent');
});
it('honors the explicit customer opt-out but still sends the internal notification', async () => {
  const result = await notifyLocalBookingAction(booking, { ...context, sendCustomerEmail: false });
  expect(result.customer.status).toBe('skipped'); expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ to: 'pub-ops@example.test' }));
});
it('does not block a correction just because customer email is absent', async () => {
  const result = await notifyLocalBookingAction({ ...booking, guestEmail: null } as Booking, context);
  expect(result.customer.status).toBe('skipped'); expect(result.internal.status).toBe('sent');
});
it('reports missing sender and recipient explicitly', async () => {
  jest.mocked(getConfigValue).mockReturnValue(null);
  const result = await notifyLocalBookingAction(booking, context);
  expect(result.customer.status).toBe('failed'); expect(result.internal.status).toBe('skipped'); expect(sendMessage).not.toHaveBeenCalled();
});
it('still attempts the internal notification after a customer send fails', async () => {
  jest.mocked(sendMessage).mockRejectedValueOnce(new Error('Provider unavailable'));
  const result = await notifyLocalBookingAction(booking, context);
  expect(result.customer.status).toBe('failed'); expect(result.internal.status).toBe('sent'); expect(sendMessage).toHaveBeenCalledTimes(2);
});
it('fails notification delivery safely if configuration cannot be refreshed', async () => {
  jest.mocked(refreshConfigCacheKeys).mockRejectedValue(new Error('Configuration unavailable'));
  const result = await notifyLocalBookingAction(booking, context);
  expect(result.customer.status).toBe('failed'); expect(result.internal.status).toBe('failed'); expect(sendMessage).not.toHaveBeenCalled();
});
it('links the outgoing customer message to its booking and actor, including backup Gmail references', async () => {
  jest.mocked(sendMessage).mockResolvedValueOnce({ id: 'backup:message-test', threadId: 'thread-test' } as any);
  await notifyLocalBookingAction(booking, context);
  expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ returnAccountReference: true }));
  expect(BookingEmail.findOrCreate).toHaveBeenCalledTimes(1);
  expect(BookingEmail.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({ where: { messageId: 'backup:message-test' },
    defaults: expect.objectContaining({ bookingId: 42, ingestionStatus: 'sent', labelIds: ['SENT'], toAddresses: booking.guestEmail }) }));
  expect(recordCustomerEmailThreadParticipant).toHaveBeenCalledWith({ userId: 7, threadId: 'thread-test', messageId: 'backup:message-test' });
});
it('keeps a sent status if mailbox persistence fails and still sends the internal notification', async () => {
  jest.mocked(BookingEmail.findOrCreate).mockRejectedValueOnce(new Error('Mailbox unavailable'));
  const result = await notifyLocalBookingAction(booking, context);
  expect(result.customer).toMatchObject({ status: 'sent', reason: expect.stringContaining('mailbox history') });
  expect(result.internal.status).toBe('sent'); expect(sendMessage).toHaveBeenCalledTimes(2);
});
