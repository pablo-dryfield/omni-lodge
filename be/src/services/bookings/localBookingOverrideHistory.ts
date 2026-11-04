import { Op, type Transaction } from 'sequelize';
import BookingEvent from '../../models/BookingEvent.js';

/** A replayed provider snapshot must not erase an explicitly newer local correction. */
export const findNewerLocalBookingOverride = async (bookingId: number, incomingAt: Date, transaction?: Transaction) => {
  const event = await BookingEvent.findOne({ where: { bookingId,
    eventType: { [Op.in]: ['amended', 'cancelled'] }, eventPayload: { source: 'manifest-local-action' },
    occurredAt: { [Op.gte]: incomingAt } }, order: [['occurredAt', 'DESC'], ['id', 'DESC']], transaction });
  if (event?.eventPayload?.source === 'manifest-local-action' && event.eventPayload.localOnly === true
    && event.occurredAt && new Date(event.occurredAt).getTime() >= incomingAt.getTime()) return event;
  // Native amendment screens may synchronize the schedule to the provider,
  // while the chosen OmniLodge product is an internal correction.
  const productCorrection = await BookingEvent.findOne({ where: { bookingId,
    eventType: 'amended', eventPayload: { source: 'manual', productChangeLocalOnly: true },
    occurredAt: { [Op.gte]: incomingAt } }, order: [['occurredAt', 'DESC'], ['id', 'DESC']], transaction });
  return productCorrection?.eventPayload?.source === 'manual' && productCorrection.eventPayload.productChangeLocalOnly === true
    && productCorrection.occurredAt && new Date(productCorrection.occurredAt).getTime() >= incomingAt.getTime() ? productCorrection : null;
};
