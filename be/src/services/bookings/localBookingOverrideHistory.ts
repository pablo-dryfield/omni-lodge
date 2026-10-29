import { Op, type Transaction } from 'sequelize';
import BookingEvent from '../../models/BookingEvent.js';

/** A replayed provider snapshot must not erase an explicitly newer local correction. */
export const findNewerLocalBookingOverride = async (bookingId: number, incomingAt: Date, transaction?: Transaction) => {
  const event = await BookingEvent.findOne({ where: { bookingId,
    eventType: { [Op.in]: ['amended', 'cancelled'] }, eventPayload: { source: 'manifest-local-action' },
    occurredAt: { [Op.gte]: incomingAt } }, order: [['occurredAt', 'DESC'], ['id', 'DESC']], transaction });
  return event?.eventPayload?.source === 'manifest-local-action' && event.eventPayload.localOnly === true
    && event.occurredAt && new Date(event.occurredAt).getTime() >= incomingAt.getTime() ? event : null;
};
