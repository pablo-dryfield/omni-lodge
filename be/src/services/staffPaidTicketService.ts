import { getStaffFreeQualification } from './staffFreeQualificationService.js';
import sequelize from '../config/database.js';
import Counter from '../models/Counter.js';
import Channel from '../models/Channel.js';
import StaffFreeEntry from '../models/StaffFreeEntry.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import HttpError from '../errors/HttpError.js';
import { getStaffFreePolicy, onDutyUserIds, productEligibility, staffIdentity } from './staffFreeEntryService.js';

const START = '-- CASH-SNAPSHOT START --';
const END = '-- CASH-SNAPSHOT END --';

/** Named paid visits and their payment snapshot are saved together, never inferred from a name. */
export async function saveStaffPaidTickets(counterId: number, notes: string | null | undefined, actorId: number, roleSlug: string | null | undefined): Promise<boolean> {
  if (notes === undefined) return false;
  const start = (notes ?? '').indexOf(START);
  const end = (notes ?? '').indexOf(END, start + START.length);
  let snapshot: any = null;
  if (start >= 0) {
    if (end < 0) throw new HttpError(400, 'Invalid Walk-Ins snapshot. Reload the counter before saving.');
    try { snapshot = JSON.parse(notes!.slice(start + START.length, end)); }
    catch { throw new HttpError(400, 'Invalid Walk-Ins snapshot. Reload the counter before saving.'); }
  }
  const tickets: Array<{ channelId: number; ticket: any }> = [];
  for (const [id, channel] of Object.entries(snapshot?.channels ?? {}) as Array<[string, any]>) {
    for (const ticket of channel?.tickets ?? []) {
      if (ticket.ticketType === 'staff_paid' || ticket.staffGuests !== undefined) tickets.push({ channelId: Number(id), ticket });
    }
  }
  if (!tickets.length && !(await StaffFreeEntry.count({ where: { counterId, benefit: 'paid', cancelledAt: null } }))) return false;
  const role = String(roleSlug ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!['admin', 'administrator', 'owner', 'manager', 'mgr', 'assistantmanager', 'assistmanager'].includes(role)) throw new HttpError(403, 'Only management can record Staff Tickets.');
  if (tickets.length > 1) throw new HttpError(400, 'Keep all paid staff in one Staff Ticket.');
  const policy = await getStaffFreePolicy();
  await sequelize.transaction(async transaction => {
    const counter = await Counter.findByPk(counterId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!counter) throw new HttpError(404, 'Counter not found.');
    const existing = await StaffFreeEntry.findAll({ where: { counterId, benefit: 'paid', cancelledAt: null }, transaction });
    const wanted = new Set<number>();
    for (const { channelId, ticket } of tickets) {
      const channel = await Channel.findByPk(channelId, { transaction });
      if (channel?.name.toLowerCase().replace(/[^a-z0-9]/g, '') !== 'walkin' || ticket.ticketType !== 'staff_paid') throw new HttpError(400, 'Staff Tickets belong to the Walk-In channel.');
      if (!Array.isArray(ticket.staffGuests) || !ticket.staffGuests.length || ticket.staffGuests.length > 1000 || !Array.isArray(ticket.currencies) || ticket.currencies.length !== 1) throw new HttpError(400, 'Choose staff members for the Staff Ticket.');
      const ids = ticket.staffGuests.map((guest: any) => guest?.userId);
      if (ids.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) <= 0) || new Set(ids).size !== ids.length) throw new HttpError(400, 'Choose each staff member only once.');
      const row = ticket.currencies[0];
      const price = existing.length ? Number(existing[0].paidAmount) : policy.paidTicketPrice!;
      if (row.currency !== 'PLN' || row.people !== ticket.staffGuests.length || Number(row.unitPrice) !== price || Math.round(Number(row.cash) * 100) !== Math.round(price * row.people * 100) || Object.values(row.addons ?? {}).some(n => Number(n) > 0)) throw new HttpError(400, 'Staff Ticket price or quantity changed. Reload the counter and select staff again.');
      if (!(await productEligibility(counter, policy, transaction))) throw new HttpError(400, 'Staff Tickets are unavailable for this product.');
      const onDuty = await onDutyUserIds(counter, transaction);
      ticket.name = 'Staff Ticket';
      // Stable lock order avoids competing admissions deadlocking on user locks.
      for (const guest of [...ticket.staffGuests].sort((a, b) => a.userId - b.userId)) {
        if (!Number.isSafeInteger(guest.userId) || guest.userId <= 0 || wanted.has(guest.userId)) throw new HttpError(400, 'Choose each staff member only once.');
        wanted.add(guest.userId);
        await User.findByPk(guest.userId, { transaction, lock: transaction.LOCK.UPDATE });
        const previous = existing.find(entry => entry.userId === guest.userId);
        const identity = previous ? null : await staffIdentity(guest.userId, counter.date, transaction);
        const user = identity?.user ?? await User.findByPk(guest.userId, { transaction });
        guest.name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || `Staff #${guest.userId}`;
        const payment = { currency: 'PLN' as const, methodId: ticket.paymentMethodId, methodName: ticket.paymentMethodName, status: ticket.paymentStatus };
        if (previous) {
          if (!previous.payment || previous.payment.currency !== payment.currency || previous.payment.methodId !== payment.methodId || previous.payment.methodName !== payment.methodName || previous.payment.status !== payment.status) {
            await AuditLog.create({ actorId, action: 'staff_ticket.payment_updated', entity: 'staff_free_entry', entityId: String(previous.id), metaJson: { counterId, before: previous.payment, after: payment } }, { transaction });
            await previous.update({ payment }, { transaction });
          }
          continue;
        }
        if (!identity || !identity.active || identity.unlimitedBenefit || !['volunteer', 'long_term'].includes(identity.staffType ?? '') || onDuty.has(guest.userId)) throw new HttpError(409, `${guest.name} is not eligible for a paid Staff Ticket.`);
        if (await StaffFreeEntry.count({ where: { counterId, userId: guest.userId, cancelledAt: null }, transaction })) throw new HttpError(409, `${guest.name} already has a staff entry for this counter.`);
        const used = await StaffFreeEntry.count({ where: { userId: guest.userId, benefit: 'allowance', cancelledAt: null }, transaction });
        if (used < policy.allowance) throw new HttpError(409, `${guest.name} still has a free crawl available.`);
        const qualification = await getStaffFreeQualification(counter, policy.minimumPricePercent, transaction);
        const entry = await StaffFreeEntry.create({ counterId, userId: guest.userId, visitDate: counter.date, staffType: identity.staffType, benefit: 'paid', paidAmount: price, payment,
          policySnapshot: policy, checkedInBefore: qualification.count, createdBy: actorId, overrideReason: null, cancelledAt: null, cancelledBy: null, cancellationReason: null }, { transaction });
        await AuditLog.create({ actorId, action: 'staff_ticket.recorded', entity: 'staff_free_entry', entityId: String(entry.id), metaJson: { counterId, userId: guest.userId, amount: price, payment } }, { transaction });
      }
    }
    for (const entry of existing.filter(item => !wanted.has(item.userId))) {
      const reason = 'Staff Ticket removed from the counter.';
      await entry.update({ cancelledAt: new Date(), cancelledBy: actorId, cancellationReason: reason }, { transaction });
      await AuditLog.create({ actorId, action: 'staff_ticket.cancelled', entity: 'staff_free_entry', entityId: String(entry.id), metaJson: { counterId, reason, amount: entry.paidAmount, payment: entry.payment } }, { transaction });
    }
    const canonicalNotes = snapshot ? `${notes!.slice(0, start + START.length)}\n${JSON.stringify(snapshot)}\n${notes!.slice(end)}` : notes;
    await counter.update({ notes: canonicalNotes }, { transaction });
  });
  return true;
}
