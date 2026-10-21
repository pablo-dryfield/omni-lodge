import { Op, type Transaction } from 'sequelize';
import Booking from '../models/Booking.js';
import BookingEmail from '../models/BookingEmail.js';
import BookingEvent from '../models/BookingEvent.js';
import Product from '../models/Product.js';
import Guest from '../models/Guest.js';
import EmailTemplate from '../models/EmailTemplate.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { getAllowedProductTypeIds } from './productScopeService.js';

export type BookingEmailAccess = {
  booking: Booking; productTypeIds: number[]; customerEmail: string;
  messageIds: string[]; threadIds: string[]; threadKeys: string[];
};
const threadKey = (messageId: string, threadId: string) => `${messageId.startsWith('backup:') ? 'backup' : 'primary'}:${threadId}`;
const denied = () => new HttpError(403, 'This email is not exclusively linked to bookings in your product scope.');
export const emailAddress = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/** Never authorize an email by customer address alone: customers can book several products. */
export async function getBookingEmailAccess(req: AuthenticatedRequest): Promise<BookingEmailAccess | null> {
  const scope = await getAllowedProductTypeIds(req);
  if (scope === null) return null;
  const rawId = req.query.bookingId ?? req.body?.bookingId;
  if (!['string', 'number'].includes(typeof rawId) || !/^[1-9]\d*$/.test(String(rawId)) || !Number.isSafeInteger(Number(rawId))) throw new HttpError(400, 'A bookingId is required for product-scoped email access.');
  const booking = await Booking.findByPk(Number(rawId));
  if (!booking?.productId) throw denied();
  const product = await Product.findByPk(booking.productId);
  if (!product || !scope.includes(product.productTypeId)) throw denied();
  const guest = booking.guestId ? await Guest.findByPk(booking.guestId) : null;
  const customerEmail = emailAddress(booking.guestEmail || guest?.email);
  const events = await BookingEvent.findAll({ where: { bookingId: booking.id }, attributes: ['emailMessageId', 'emailId'] });
  const ids = events.map(e => e.emailMessageId).filter((id): id is string => Boolean(id));
  if (booking.lastEmailMessageId) ids.push(booking.lastEmailMessageId);
  const emailIds = events.map(e => e.emailId).filter((id): id is number => id != null);
  const seeds = await BookingEmail.findAll({ where: { [Op.or]: [{ bookingId: booking.id }, { messageId: { [Op.in]: ids } }, { id: { [Op.in]: emailIds } }] }, attributes: ['id', 'messageId', 'threadId', 'bookingId'] });
  ids.push(...seeds.map(e => e.messageId));
  const seedThreads = seeds.map(e => e.threadId).filter((id): id is string => Boolean(id));
  const seedKeys = new Set(seeds.filter(e => e.threadId).map(e => threadKey(e.messageId, e.threadId!)));
  const candidateRows = await BookingEmail.findAll({ where: { [Op.or]: [{ messageId: { [Op.in]: ids } }, { threadId: { [Op.in]: seedThreads } }] }, attributes: ['id', 'messageId', 'threadId', 'bookingId'] });
  const candidates = candidateRows.filter(e => ids.includes(e.messageId) || Boolean(e.threadId && seedKeys.has(threadKey(e.messageId, e.threadId))));
  const links = await BookingEvent.findAll({ where: { [Op.or]: [{ emailId: { [Op.in]: candidates.map(e => e.id) } }, { emailMessageId: { [Op.in]: candidates.map(e => e.messageId) } }] }, attributes: ['bookingId', 'emailId', 'emailMessageId'] });
  const linkedIds = [...links.map(e => e.bookingId), ...candidates.map(e => e.bookingId).filter((id): id is number => id != null)];
  const linkedBookings: Booking[] = await Booking.findAll({ where: { [Op.or]: [{ id: { [Op.in]: linkedIds } }, { lastEmailMessageId: { [Op.in]: candidates.map(e => e.messageId) } }] }, attributes: ['id', 'productId', 'lastEmailMessageId'] });
  const products = await Product.findAll({ where: { id: { [Op.in]: linkedBookings.map(b => b.productId).filter((id): id is number => id != null) } }, attributes: ['id', 'productTypeId'] });
  const safeBookings = new Set(linkedBookings.filter(b => products.some(p => p.id === b.productId && scope.includes(p.productTypeId))).map(b => String(b.id)));
  const unsafeMessages = new Set<string>();
  for (const email of candidates) if (email.bookingId != null && !safeBookings.has(String(email.bookingId))) unsafeMessages.add(email.messageId);
  for (const link of links) if (!safeBookings.has(String(link.bookingId))) {
    const email = candidates.find(e => String(e.id) === String(link.emailId) || e.messageId === link.emailMessageId);
    if (email) unsafeMessages.add(email.messageId);
  }
  for (const b of linkedBookings) if (!safeBookings.has(String(b.id)) && b.lastEmailMessageId) unsafeMessages.add(b.lastEmailMessageId);
  const unsafeThreads = new Set(candidates.filter(e => unsafeMessages.has(e.messageId) && e.threadId).map(e => threadKey(e.messageId, e.threadId!)));
  const safe = candidates.filter(e => !unsafeMessages.has(e.messageId) && (!e.threadId || !unsafeThreads.has(threadKey(e.messageId, e.threadId))));
  return { booking, productTypeIds: scope, customerEmail, messageIds: safe.map(e => e.messageId),
    threadIds: [...new Set(safe.map(e => e.threadId).filter((id): id is string => Boolean(id)))],
    threadKeys: [...new Set(safe.filter(e => e.threadId).map(e => threadKey(e.messageId, e.threadId!)))] };
}

export function canAccessEmailMessage(access: BookingEmailAccess | null, messageId: string, threadId?: string | null): boolean {
  return !access || access.messageIds.includes(messageId) || Boolean(threadId && access.threadKeys.includes(threadKey(messageId, threadId)));
}
export function assertEmailMessageAccess(access: BookingEmailAccess | null, messageId: string, threadId?: string | null): void {
  if (!canAccessEmailMessage(access, messageId, threadId)) throw denied();
}
export function assertEmailRecipient(access: BookingEmailAccess | null, recipient: unknown): void {
  if (access && (!access.customerEmail || emailAddress(recipient) !== access.customerEmail)) throw new HttpError(403, 'Use the customer email on this booking.');
}
export async function assertTemplateAccess(req: AuthenticatedRequest, template: EmailTemplate): Promise<void> {
  const scope = await getAllowedProductTypeIds(req);
  if (scope && (template.productTypeId == null || !scope.includes(template.productTypeId) || template.templateType !== 'plain_text')) {
    throw new HttpError(403, 'This template is outside your product scope.');
  }
}
/** Recheck inside the ingestion transaction, before any write and after reassignment. */
export async function assertReprocessedBookingScope(booking: Booking | null, access: { productTypeIds: number[]; bookingIds: number[] }, transaction: Transaction): Promise<void> {
  if (!booking || !access.bookingIds.some(id => String(id) === String(booking.id)) || !booking.productId) throw denied();
  const product = await Product.findByPk(booking.productId, { transaction, lock: transaction.LOCK.SHARE });
  if (!product || !access.productTypeIds.includes(product.productTypeId)) throw denied();
}
