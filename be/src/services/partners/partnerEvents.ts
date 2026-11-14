import type { Transaction } from 'sequelize';
import { PartnerDelivery, PartnerEvent, PartnerWebhook } from '../../models/Partner.js';

export async function partnerEvent(partnerId: number, type: string, data: Record<string, unknown>, actorId: number | null, bookingId: number | null, transaction?: Transaction): Promise<PartnerEvent> {
  const event = await PartnerEvent.create({ partnerId, type, data, actorId, bookingId }, { transaction });
  const webhook = await PartnerWebhook.findOne({ where: { partnerId, active: true }, transaction });
  if (webhook) await PartnerDelivery.create({ partnerId, eventId: event.id, status: 'pending', attempts: 0, nextAttemptAt: new Date() }, { transaction });
  return event;
}
