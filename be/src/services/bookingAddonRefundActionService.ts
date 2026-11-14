import sequelize from '../config/database.js';
import Booking from '../models/Booking.js';
import Product from '../models/Product.js';
import Counter from '../models/Counter.js';
import AuditLog from '../models/AuditLog.js';
import HttpError from '../errors/HttpError.js';
import CounterRegistryService from './counterRegistryService.js';
import { normalizeBookingAddonRefundActions, removeAddonFromBookingSnapshot } from './bookingAddonRefundActions.js';

/** Shared by Counter Summary and the homepage: one committed booking/counter change. */
export const changeBookingAddonRefundAction = async (
  bookingId: number, actionId: string, operation: 'complete' | 'delete', actorId: number,
): Promise<Booking> => sequelize.transaction(async transaction => {
  // Lock the counter before the booking, matching counter finalization order.
  // Different bookings on the same night must rebuild from each other's commit.
  const initial = await Booking.findByPk(bookingId, { attributes: ['id', 'addonRefundActions'], transaction });
  if (!initial) throw new HttpError(404, 'Booking not found');
  const initialAction = normalizeBookingAddonRefundActions(initial.addonRefundActions).find(entry => entry.id === actionId);
  if (!initialAction) throw new HttpError(404, 'Add-on refund action not found');
  const counterId = Number(initialAction.counterId);
  const counter = Number.isSafeInteger(counterId) && counterId > 0
    ? await Counter.findByPk(counterId, { attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE }) : null;
  const booking = await Booking.findByPk(bookingId, {
    include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
    transaction, lock: { level: transaction.LOCK.UPDATE, of: Booking },
  });
  if (!booking) throw new HttpError(404, 'Booking not found');
  const actions = normalizeBookingAddonRefundActions(booking.addonRefundActions);
  const action = actions.find(entry => entry.id === actionId);
  if (!action) throw new HttpError(404, 'Add-on refund action not found');
  if (String(action.counterId ?? '') !== String(initialAction.counterId ?? '')) throw new HttpError(409, 'This refund changed. Refresh and try again.');
  const before = { ...action };
  if (operation === 'complete') {
    // The row lock makes double clicks and concurrent managers idempotent.
    if (action.status !== 'completed') removeAddonFromBookingSnapshot(booking, action.addonKey, action.quantity);
    const now = new Date().toISOString();
    Object.assign(action, { status: 'completed', completedAt: action.completedAt || now,
      completedSource: action.completedSource || 'manual', completedBy: action.completedBy ?? actorId, updatedAt: now });
    booking.addonRefundActions = actions;
  } else {
    booking.addonRefundActions = actions.filter(entry => entry.id !== actionId);
  }
  booking.updatedBy = actorId;
  await booking.save({ transaction });
  if (counter) await CounterRegistryService.upsertMetrics(counterId, [], actorId, undefined, transaction);
  if (operation === 'delete' || before.status !== 'completed') {
    await AuditLog.create({ actorId, action: `booking.addon_refund.${operation}`, entity: 'booking',
      entityId: String(bookingId), metaJson: { actionId, counterId: Number.isSafeInteger(counterId) ? counterId : null,
        before, after: operation === 'complete' ? action : null } }, { transaction });
  }
  return booking;
});
