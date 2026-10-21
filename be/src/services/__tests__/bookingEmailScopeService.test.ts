jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../models/BookingEmail.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/BookingEvent.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../models/Guest.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../productScopeService.js', () => ({ getAllowedProductTypeIds: jest.fn() }));
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import type { Transaction } from 'sequelize';
import Booking from '../../models/Booking';
import BookingEmail from '../../models/BookingEmail';
import BookingEvent from '../../models/BookingEvent';
import Product from '../../models/Product';
import EmailTemplate from '../../models/EmailTemplate';
import { getAllowedProductTypeIds } from '../productScopeService';
import { getBookingEmailAccess, assertEmailMessageAccess, assertEmailRecipient, assertTemplateAccess, assertReprocessedBookingScope } from '../bookingEmailScopeService';
const req = { query: { bookingId: '12' }, body: {} } as unknown as AuthenticatedRequest;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue([3]);
  jest.mocked(Booking.findByPk).mockResolvedValue({ id: 12, productId: 48, guestEmail: 'guest@example.com', lastEmailMessageId: 'food' } as Booking);
  jest.mocked(Product.findByPk).mockResolvedValue({ id: 48, productTypeId: 3 } as Product);
  jest.mocked(Product.findAll).mockResolvedValue([{ id: 48, productTypeId: 3 }] as Product[]);
  jest.mocked(BookingEvent.findAll).mockResolvedValue([{ bookingId: 12, emailId: 1, emailMessageId: 'food' }] as BookingEvent[]);
  jest.mocked(Booking.findAll).mockResolvedValue([{ id: 12, productId: 48, lastEmailMessageId: 'food' }] as Booking[]);
  jest.mocked(BookingEmail.findAll).mockResolvedValue([{ id: 1, messageId: 'food', threadId: 'food-thread' }] as BookingEmail[]);
});
it('leaves company-wide access unchanged', async () => {
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue(null);
  expect(await getBookingEmailAccess({} as AuthenticatedRequest)).toBeNull();
  expect(Booking.findByPk).not.toHaveBeenCalled();
});
it.each([undefined, '0', '-1', '12x', ['12'], '9007199254740992'])('rejects invalid booking context %s', async bookingId => {
  await expect(getBookingEmailAccess({ query: { bookingId }, body: {} } as unknown as AuthenticatedRequest)).rejects.toMatchObject({ status: 400 });
});
it('rejects another product even if the user knows its email or booking ID', async () => {
  jest.mocked(Product.findByPk).mockResolvedValue({ id: 48, productTypeId: 1 } as Product);
  await expect(getBookingEmailAccess(req)).rejects.toMatchObject({ status: 403 });
});
it('allows linked messages and verified customer reply threads, never arbitrary addresses', async () => {
  const access = await getBookingEmailAccess(req);
  expect(access).toMatchObject({ messageIds: ['food'], threadIds: ['food-thread'] });
  expect(() => assertEmailMessageAccess(access, 'food')).not.toThrow();
  expect(() => assertEmailMessageAccess(access, 'reply', 'food-thread')).not.toThrow();
  expect(() => assertEmailMessageAccess(access, 'other', 'pub-thread')).toThrow();
  expect(() => assertEmailMessageAccess(access, 'backup:reply', 'food-thread')).toThrow();
  expect(() => assertEmailRecipient(access, ' GUEST@example.com ')).not.toThrow();
  expect(() => assertEmailRecipient(access, 'other@example.com')).toThrow();
});
it('removes an entire mixed-product thread, including otherwise authorized messages', async () => {
  jest.mocked(BookingEmail.findAll).mockResolvedValue([{ id: 1, messageId: 'food', threadId: 'shared' }, { id: 2, messageId: 'pub', threadId: 'shared' }] as BookingEmail[]);
  jest.mocked(BookingEvent.findAll).mockResolvedValue([{ bookingId: 12, emailId: 1, emailMessageId: 'food' }, { bookingId: 13, emailId: 2, emailMessageId: 'pub' }] as BookingEvent[]);
  jest.mocked(Booking.findAll).mockResolvedValue([{ id: 12, productId: 48 }, { id: 13, productId: 1 }] as Booking[]);
  const access = await getBookingEmailAccess(req);
  expect(access?.messageIds).toEqual([]);
  expect(access?.threadIds).toEqual([]);
});
it('rejects unassigned bookings and legacy last-email links to another product', async () => {
  jest.mocked(Booking.findAll).mockResolvedValue([{ id: 12, productId: 48 }, { id: 13, productId: null, lastEmailMessageId: 'food' }] as Booking[]);
  expect((await getBookingEmailAccess(req))?.messageIds).toEqual([]);
});
it.each([{ productTypeId: null, templateType: 'plain_text' }, { productTypeId: 1, templateType: 'plain_text' }, { productTypeId: 3, templateType: 'react_email' }])('blocks global, other-product and executable templates %s', async template => {
  await expect(assertTemplateAccess(req, template as EmailTemplate)).rejects.toMatchObject({ status: 403 });
});
it('allows only own plain-text templates', async () => {
  await expect(assertTemplateAccess(req, { productTypeId: 3, templateType: 'plain_text' } as EmailTemplate)).resolves.toBeUndefined();
});
it('checks both the booking identity and final product inside the write transaction', async () => {
  const tx = { LOCK: { SHARE: 'share' } } as Transaction;
  const access = { bookingIds: [12], productTypeIds: [3] };
  await expect(assertReprocessedBookingScope({ id: 13, productId: 48 } as Booking, access, tx)).rejects.toMatchObject({ status: 403 });
  await expect(assertReprocessedBookingScope(null, access, tx)).rejects.toMatchObject({ status: 403 });
  jest.mocked(Product.findByPk).mockResolvedValue({ productTypeId: 1 } as Product);
  await expect(assertReprocessedBookingScope({ id: 12, productId: 1 } as Booking, access, tx)).rejects.toMatchObject({ status: 403 });
  expect(Product.findByPk).toHaveBeenLastCalledWith(1, { transaction: tx, lock: 'share' });
});
