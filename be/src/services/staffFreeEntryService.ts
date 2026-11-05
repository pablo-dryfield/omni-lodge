import { Op, type Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import Counter from '../models/Counter.js';
import CounterUser from '../models/CounterUser.js';
import StaffFreeEntry from '../models/StaffFreeEntry.js';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import Product from '../models/Product.js';
import ProductType from '../models/ProductType.js';
import ShiftTypeProduct from '../models/ShiftTypeProduct.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import AuditLog from '../models/AuditLog.js';
import HttpError from '../errors/HttpError.js';
import { getStaffFreeQualification } from './staffFreeQualificationService.js';
import { getConfigValue, refreshConfigCacheKeys } from './configService.js';
import { getStaffProfileTypeAtDate } from './staffEligibilityHistoryService.js';
import { decideStaffFreeEntry, staffFreeBenefitLabel, staffFreeUnlimitedBenefit, type StaffFreePolicy } from './staffFreeEntryPolicy.js';
import { withStaffEntryNotes } from './staffEntryNotes.js';
import type { StaffFreeChanges } from './staffFreeEntryDraft.js';

const POLICY_KEYS = ['COUNTER_STAFF_FREE_ALLOWANCE', 'COUNTER_STAFF_FREE_BUSY_THRESHOLD', 'COUNTER_STAFF_FREE_PRODUCT_TYPES', 'COUNTER_STAFF_FREE_MINIMUM_PRICE_PERCENT', 'COUNTER_STAFF_PAID_TICKET_PLN'];
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const fullName = (user: User) => [user.firstName, user.lastName].filter(Boolean).join(' ') || `Staff #${user.id}`;
const isActiveStaffUser = (user: Pick<User, 'status' | 'approved'>, profile: StaffProfile | null | undefined): boolean =>
  user.status === true && user.approved === true && profile?.active === true;
const assignedRoleSlug = (user: User): string =>
  (user as User & { role?: UserType | null }).role?.slug?.trim() ?? '';

export async function getStaffFreePolicy(): Promise<StaffFreePolicy> {
  await refreshConfigCacheKeys(POLICY_KEYS);
  return {
    paidTicketPrice: Math.round(Number(getConfigValue(POLICY_KEYS[4]) ?? 30) * 100) / 100,
    allowance: Number(getConfigValue(POLICY_KEYS[0]) ?? 2),
    busyThreshold: Number(getConfigValue(POLICY_KEYS[1]) ?? 20),
    minimumPricePercent: Number(getConfigValue(POLICY_KEYS[3]) ?? 50),
    productTypeNames: String(getConfigValue(POLICY_KEYS[2]) ?? 'Main Product').split(',').map(s => s.trim()).filter(Boolean),
  };
}

export async function productEligibility(counter: Counter, policy: StaffFreePolicy, transaction?: Transaction) {
  const product = counter.productId ? await Product.findByPk(counter.productId, { transaction }) : null;
  const type = product ? await ProductType.findByPk(product.productTypeId, { transaction }) : null;
  return Boolean(type && policy.productTypeNames.some(name => normalized(name) === normalized(type.name)));
}

export async function onDutyUserIds(counter: Counter, transaction?: Transaction): Promise<Set<number>> {
  const members = await CounterUser.findAll({ where: { counterId: counter.id }, transaction });
  const ids = new Set([counter.userId, ...members.map(member => member.userId)]);
  // A scheduled assignment counts even if it has not been copied to the counter roster yet.
  const links = await ShiftTypeProduct.findAll({ where: { productId: counter.productId }, transaction });
  if (links.length) {
    const shifts = await ShiftInstance.findAll({ where: { date: counter.date, shiftTypeId: { [Op.in]: links.map(link => link.shiftTypeId) } }, transaction });
    if (shifts.length) {
      const assignments = await ShiftAssignment.findAll({ where: { shiftInstanceId: { [Op.in]: shifts.map(shift => shift.id) } }, transaction });
      assignments.forEach(assignment => ids.add(assignment.userId));
    }
  }
  return ids;
}

export async function staffIdentity(userId: number, date: string, transaction?: Transaction) {
  const user = await User.findByPk(userId, { include: [{ model: UserType, as: 'role', attributes: ['slug'] }], transaction });
  if (!user) throw new HttpError(404, 'Staff member not found.');
  const role = assignedRoleSlug(user);
  if (!role) throw new HttpError(409, 'Staff free entry requires an assigned user role.');
  const profile = await StaffProfile.findByPk(userId, { transaction });
  const period = await getStaffProfileTypeAtDate({ userId, date, transaction });
  const staffType = period?.staffType ?? profile?.staffType ?? null;
  const unlimitedBenefit = staffFreeUnlimitedBenefit(role, staffType);
  return { user, role, staffType, unlimitedBenefit, active: isActiveStaffUser(user, profile) };
}

export async function staffFreeCounterEntries(counterId: number, transaction?: Transaction) {
  const entries = await StaffFreeEntry.findAll({ where: { counterId, cancelledAt: null, benefit: { [Op.ne]: 'paid' } }, order: [['createdAt', 'ASC']], transaction });
  const users = entries.length ? await User.findAll({ where: { id: { [Op.in]: entries.map(entry => entry.userId) } }, attributes: ['id', 'firstName', 'lastName'], transaction }) : [];
  const names = new Map(users.map(user => [user.id, fullName(user)]));
  return entries.map(entry => ({ id: entry.id, userId: entry.userId, name: names.get(entry.userId) ?? `Staff #${entry.userId}`, benefit: entry.benefit, label: staffFreeBenefitLabel(entry.benefit), checkedInBefore: entry.checkedInBefore, overrideReason: entry.overrideReason, createdAt: entry.createdAt }));
}

export async function getStaffFreeOverview(counterId: number) {
  const counter = await Counter.findByPk(counterId);
  if (!counter) throw new HttpError(404, 'Counter not found.');
  const policy = await getStaffFreePolicy();
  const enabled = await productEligibility(counter, policy);
  if (!enabled) return { enabled, policy, checkedIn: 0, staff: [], entries: [] };
  const [users, profiles, onDuty, entries, qualification] = await Promise.all([
    User.findAll({ where: { status: true, approved: true }, attributes: ['id', 'firstName', 'lastName', 'status', 'approved'], include: [{ model: UserType, as: 'role', attributes: ['slug'], required: true }] }),
    StaffProfile.findAll({ where: { active: true } }), onDutyUserIds(counter),
    StaffFreeEntry.findAll({ where: { cancelledAt: null } }), getStaffFreeQualification(counter, policy.minimumPricePercent),
  ]);
  const checkedIn = qualification.count;
  const profilesById = new Map(profiles.map(profile => [profile.userId, profile]));
  const staff = users.flatMap(user => {
    const profile = profilesById.get(user.id);
    const role = assignedRoleSlug(user);
    if (!isActiveStaffUser(user, profile) || !role) return [];
    const unlimitedBenefit = staffFreeUnlimitedBenefit(role, profile?.staffType ?? null);
    if (!unlimitedBenefit && !['volunteer', 'long_term'].includes(profile?.staffType ?? '')) return [];
    const history = entries.filter(entry => entry.userId === user.id);
    const used = history.filter(entry => entry.benefit === 'allowance').length;
    const decision = decideStaffFreeEntry({ staffType: profile?.staffType ?? null, unlimitedBenefit, active: true, onShift: onDuty.has(user.id), used, checkedIn, policy });
    return [{ id: user.id, name: fullName(user), staffType: profile!.staffType, unlimited: Boolean(unlimitedBenefit),
      used, remaining: unlimitedBenefit ? null : Math.max(0, policy.allowance - used), totalVisits: history.filter(entry => entry.benefit !== 'paid').length, paidVisits: history.filter(entry => entry.benefit === 'paid' && entry.payment?.status === 'received').length,
      alreadyCheckedIn: history.some(entry => entry.counterId === counterId), onShift: onDuty.has(user.id), decision }];
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { enabled, policy, checkedIn, qualification, staff, entries: await staffFreeCounterEntries(counterId) };
}

export async function getStaffFreeHistory(userId: number) {
  const entries = await StaffFreeEntry.findAll({ where: { userId }, order: [['createdAt', 'DESC']] });
  const restored = entries.length ? await AuditLog.findAll({ where: { entity: 'staff_free_entry', entityId: { [Op.in]: entries.map(entry => String(entry.id)) }, action: 'staff_free_entry.allowance_restored' }, order: [['createdAt', 'DESC']] }) : [];
  const actorIds = Array.from(new Set(entries.flatMap(entry => [entry.createdBy, ...(entry.cancelledBy ? [entry.cancelledBy] : [])])));
  const users = actorIds.length ? await User.findAll({ where: { id: { [Op.in]: actorIds } }, attributes: ['id', 'firstName', 'lastName'] }) : [];
  const names = new Map(users.map(user => [user.id, fullName(user)]));
  return entries.map(entry => ({ id: entry.id, counterId: entry.counterId, date: entry.visitDate, benefit: entry.benefit, label: staffFreeBenefitLabel(entry.benefit),
    checkedInBefore: entry.checkedInBefore, recordedBy: names.get(entry.createdBy) ?? `User #${entry.createdBy}`, recordedAt: entry.createdAt,
    paidAmount: entry.paidAmount == null ? null : Number(entry.paidAmount), payment: entry.payment, overrideReason: entry.overrideReason, cancelledAt: entry.cancelledAt, cancelledBy: entry.cancelledBy ? names.get(entry.cancelledBy) : null, cancellationReason: entry.cancellationReason,
    allowanceReturnedAt: restored.find(event => event.entityId === String(entry.id))?.createdAt ?? null,
    allowanceReturnedAtCount: restored.find(event => event.entityId === String(entry.id))?.metaJson?.checkedInCustomers ?? null,
  }));
}

/** Self-service account summary. The HTTP caller must supply only the authenticated user's ID. */
export async function getStaffFreeAccount(userId: number) {
  const [user, profile, policy, history] = await Promise.all([
    User.findByPk(userId, { include: [{ model: UserType, as: 'role', attributes: ['slug'] }] }),
    StaffProfile.findByPk(userId), getStaffFreePolicy(), getStaffFreeHistory(userId),
  ]);
  if (!user) throw new HttpError(404, 'User not found.');
  const role = assignedRoleSlug(user);
  const unlimitedBenefit = staffFreeUnlimitedBenefit(role, profile?.staffType ?? null);
  const eligible = Boolean(role && isActiveStaffUser(user, profile)
    && (unlimitedBenefit || ['volunteer', 'long_term'].includes(profile?.staffType ?? '')));
  const visits = history.filter(entry => !entry.cancelledAt);
  const used = visits.filter(entry => entry.benefit === 'allowance').length;
  return {
    visible: eligible || history.length > 0, eligible, unlimited: eligible && Boolean(unlimitedBenefit),
    allowance: policy.allowance, busyThreshold: policy.busyThreshold,
    used, remaining: eligible && !unlimitedBenefit ? Math.max(0, policy.allowance - used) : null,
    totalVisits: visits.filter(entry => entry.benefit !== 'paid').length, paidVisits: visits.filter(entry => entry.benefit === 'paid' && entry.payment?.status === 'received').length, pendingPaidVisits: visits.filter(entry => entry.benefit === 'paid' && entry.payment?.status === 'awaiting').length, history,
  };
}

/** The counter row serializes admissions for a night; the user row serializes lifetime allowance use across nights. */
export async function checkInStaffFree(counterId: number, userId: number, actorId: number, overrideReason?: string, expectedBenefit?: string, batchTransaction?: Transaction) {
  const policy = await getStaffFreePolicy();
  const save = async (transaction: Transaction) => {
    const counter = await Counter.findByPk(counterId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!counter) throw new HttpError(404, 'Counter not found.');
    if (!(await productEligibility(counter, policy, transaction))) throw new HttpError(400, 'Staff free entry is not enabled for this product type.');
    await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    const existing = await StaffFreeEntry.findOne({ where: { counterId, userId, cancelledAt: null }, transaction });
    // A retried counter save may include a visit already committed by the previous request.
    if (existing && batchTransaction) return existing.id;
    if (existing) throw new HttpError(409, 'This staff member is already checked in.');
    const identity = await staffIdentity(userId, counter.date, transaction);
    const onDuty = await onDutyUserIds(counter, transaction);
    const qualification = await getStaffFreeQualification(counter, policy.minimumPricePercent, transaction);
    const checkedIn = qualification.count;
    await restoreAllowances(counter, actorId, transaction);
    const used = await StaffFreeEntry.count({ where: { userId, benefit: 'allowance', cancelledAt: null }, transaction });
    const decision = decideStaffFreeEntry({ ...identity, onShift: onDuty.has(userId), used, checkedIn, policy });
    const reason = overrideReason?.trim() || null;
    if (!decision.allowed && (!decision.canOverride || !reason)) throw new HttpError(409, decision.message);
    if (reason && reason.length > 2000) throw new HttpError(400, 'The override reason must not exceed 2,000 characters.');
    const benefit = decision.allowed ? decision.benefit! : 'override';
    if (expectedBenefit && benefit !== expectedBenefit) throw new HttpError(409, 'Attendance or allowance changed. Refresh the staff entry and confirm the updated decision.');
    const entry = await StaffFreeEntry.create({ counterId, userId, visitDate: counter.date, staffType: identity.staffType,
      benefit, checkedInBefore: checkedIn, policySnapshot: policy, overrideReason: benefit === 'override' ? reason : null, createdBy: actorId,
      cancelledAt: null, cancelledBy: null, cancellationReason: null }, { transaction });
    await AuditLog.create({ actorId, action: 'staff_free_entry.checked_in', entity: 'staff_free_entry', entityId: String(entry.id), metaJson: {
      counterId, userId, role: identity.role, staffType: identity.staffType, benefit, checkedInCustomers: checkedIn, qualification, policy, reason: entry.overrideReason,
    } }, { transaction });
    return entry.id;
  };
  return batchTransaction ? save(batchTransaction) : sequelize.transaction(save);
}

async function restoreAllowances(counter: Counter, actorId: number | null, transaction: Transaction) {
  const entries = await StaffFreeEntry.findAll({ where: { counterId: counter.id, cancelledAt: null, benefit: 'allowance' }, transaction, lock: transaction.LOCK.UPDATE });
  const qualifications = new Map<number, Awaited<ReturnType<typeof getStaffFreeQualification>>>();
  for (const entry of entries) {
    const percent = entry.policySnapshot.minimumPricePercent;
    if (!qualifications.has(percent)) qualifications.set(percent, await getStaffFreeQualification(counter, percent, transaction));
    const qualification = qualifications.get(percent)!;
    const checkedIn = qualification.count;
    if (checkedIn < entry.policySnapshot.busyThreshold) continue;
    await entry.update({ benefit: 'busy_night' }, { transaction });
    await AuditLog.create({ actorId, action: 'staff_free_entry.allowance_restored', entity: 'staff_free_entry', entityId: String(entry.id), metaJson: {
      counterId: counter.id, userId: entry.userId, previousBenefit: 'allowance', benefit: 'busy_night', checkedInCustomers: checkedIn,
      threshold: entry.policySnapshot.busyThreshold, qualification, reason: 'Checked-in customers reached the attendance exemption threshold.',
    } }, { transaction });
  }
}

export async function reconcileStaffFreeAllowances(counterId: number, actorId: number | null) {
  await sequelize.transaction(async transaction => {
    const counter = await Counter.findByPk(counterId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!counter) return;
    if (await StaffFreeEntry.count({ where: { counterId, cancelledAt: null, benefit: 'allowance' }, transaction })) {
      await restoreAllowances(counter, actorId, transaction);
    }
    const entries = await staffFreeCounterEntries(counterId, transaction);
    const notes = withStaffEntryNotes(counter.notes, entries.map(entry => ({ userId: entry.userId, name: entry.name, label: entry.label, reason: entry.overrideReason })));
    if (notes !== counter.notes) await counter.update({ notes }, { transaction });
  });
}

export async function cancelStaffFreeEntry(counterId: number, entryId: number, actorId: number, reason: string, batchTransaction?: Transaction) {
  if (!reason.trim() || reason.length > 2000) throw new HttpError(400, 'Provide a correction reason (up to 2,000 characters).');
  const save = async (transaction: Transaction) => {
    await Counter.findByPk(counterId, { transaction, lock: transaction.LOCK.UPDATE });
    const entry = await StaffFreeEntry.findOne({ where: { id: entryId, counterId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!entry) throw new HttpError(404, 'Staff entry not found.');
    if (entry.benefit === 'paid') throw new HttpError(409, 'Remove paid Staff Tickets from Walk-Ins to keep payments and attendance synchronized.');
    if (entry.cancelledAt) return;
    await entry.update({ cancelledAt: new Date(), cancelledBy: actorId, cancellationReason: reason.trim() }, { transaction });
    await AuditLog.create({ actorId, action: 'staff_free_entry.cancelled', entity: 'staff_free_entry', entityId: String(entry.id), metaJson: {
      counterId, userId: entry.userId, reason: reason.trim(), benefit: entry.benefit,
    } }, { transaction });
  };
  if (batchTransaction) await save(batchTransaction); else await sequelize.transaction(save);
}

/** Commit the entire staff draft together. Counter attendance/Walk-In prices are saved first. */
export async function saveStaffFreeChanges(counterId: number, changes: StaffFreeChanges, actorId: number) {
  await sequelize.transaction(async transaction => {
    const counter = await Counter.findByPk(counterId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!counter) throw new HttpError(404, 'Counter not found.');
    for (const removal of [...changes.removals].sort((a, b) => a.entryId - b.entryId)) {
      await cancelStaffFreeEntry(counterId, removal.entryId, actorId, removal.reason, transaction);
    }
    for (const addition of [...changes.additions].sort((a, b) => a.userId - b.userId)) {
      try {
        await checkInStaffFree(counterId, addition.userId, actorId, addition.overrideReason, undefined, transaction);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        const user = await User.findByPk(addition.userId, { transaction });
        throw new HttpError(error.status, `${user ? fullName(user) : `Staff #${addition.userId}`}: ${error.message}`);
      }
    }
  });
}
