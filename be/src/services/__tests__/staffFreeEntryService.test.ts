// The legacy Jest mapper redirects service-level User.js imports to this stub.
jest.mock('../../__mocks__/sequelizeModelStub', () => jest.requireMock('../../models/User.js'));
import { Op } from 'sequelize';
jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/Counter.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/CounterUser.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/StaffFreeEntry.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), count: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../models/UserType.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ProductType.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ShiftTypeProduct.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ShiftInstance.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ShiftAssignment.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn(), findAll: jest.fn() } }));
jest.mock('../configService.js', () => ({ refreshConfigCacheKeys: jest.fn(), getConfigValue: jest.fn() }));
jest.mock('../staffEligibilityHistoryService.js', () => ({ getStaffProfileTypeAtDate: jest.fn() }));
jest.mock('../staffFreeQualificationService.js', () => ({ getStaffFreeQualification: jest.fn() }));

import sequelize from '../../config/database';
import Counter from '../../models/Counter';
import CounterUser from '../../models/CounterUser';
import StaffFreeEntry from '../../models/StaffFreeEntry';
import StaffProfile from '../../models/StaffProfile';
import User from '../../models/User';
import Product from '../../models/Product';
import ProductType from '../../models/ProductType';
import ShiftTypeProduct from '../../models/ShiftTypeProduct';
import ShiftInstance from '../../models/ShiftInstance';
import ShiftAssignment from '../../models/ShiftAssignment';
import AuditLog from '../../models/AuditLog';
import { getConfigValue } from '../configService';
import { getStaffProfileTypeAtDate } from '../staffEligibilityHistoryService';
import { getStaffFreeQualification } from '../staffFreeQualificationService';
import { checkInStaffFree, cancelStaffFreeEntry, reconcileStaffFreeAllowances, getStaffFreeOverview, getStaffFreeAccount, saveStaffFreeChanges } from '../staffFreeEntryService';

type Entry = { id: number; counterId: number; userId: number; benefit: string; cancelledAt: Date | null; policySnapshot: { busyThreshold: number; minimumPricePercent: number }; update: jest.Mock; [key: string]: unknown };
let entries: Entry[];
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const addEntry = (values: Record<string, unknown> = {}) => {
  const entry: Entry = { id: entries.length + 1, counterId: 1, userId: 7, benefit: 'allowance', cancelledAt: null, policySnapshot: { busyThreshold: 20, minimumPricePercent: 50 }, update: jest.fn(), ...values };
  entry.update.mockImplementation(async next => Object.assign(entry, next)); entries.push(entry); return entry;
};
const matching = (where: Record<string, unknown>) => entries.filter(entry => Object.entries(where).every(([key, value]) => value && typeof value === 'object' && Op.ne in value ? entry[key] !== (value as Record<symbol, unknown>)[Op.ne] : entry[key] === value));
beforeEach(() => {
  jest.clearAllMocks(); entries = [];
  (sequelize.transaction as jest.Mock).mockImplementation(fn => fn(transaction));
  (Counter.findByPk as jest.Mock).mockImplementation(async id => ({ id, productId: 28, date: '2026-11-05', userId: 99, notes: null, update: jest.fn() }));
  (User.findByPk as jest.Mock).mockImplementation(async id => ({ id, status: true, approved: true, role: { slug: 'guide' } }));
  (User.findAll as jest.Mock).mockResolvedValue([]);
  (AuditLog.findAll as jest.Mock).mockResolvedValue([]);
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue({ active: true, staffType: 'volunteer' });
  (getStaffProfileTypeAtDate as jest.Mock).mockResolvedValue(null);
  (CounterUser.findAll as jest.Mock).mockResolvedValue([]);
  (ShiftTypeProduct.findAll as jest.Mock).mockResolvedValue([]);
  (Product.findByPk as jest.Mock).mockResolvedValue({ productTypeId: 1 });
  (ProductType.findByPk as jest.Mock).mockResolvedValue({ name: 'Pub Crawl' });
  (getConfigValue as jest.Mock).mockImplementation(key => ({ COUNTER_STAFF_FREE_ALLOWANCE: 2, COUNTER_STAFF_FREE_BUSY_THRESHOLD: 20, COUNTER_STAFF_FREE_PRODUCT_TYPES: 'Pub Crawl', COUNTER_STAFF_FREE_MINIMUM_PRICE_PERCENT: 50 } as Record<string, unknown>)[key]);
  (getStaffFreeQualification as jest.Mock).mockResolvedValue({ count: 19 });
  (StaffFreeEntry.findAll as jest.Mock).mockImplementation(async ({ where }) => matching(where));
  (StaffFreeEntry.findOne as jest.Mock).mockImplementation(async ({ where }) => matching(where)[0] ?? null);
  (StaffFreeEntry.count as jest.Mock).mockImplementation(async ({ where }) => matching(where).length);
  (StaffFreeEntry.create as jest.Mock).mockImplementation(async values => addEntry(values));
});

it('locks the counter and person, records one lifetime usage and audits the policy', async () => {
  await checkInStaffFree(1, 7, 99, undefined, 'allowance');
  expect(entries[0]).toMatchObject({ userId: 7, counterId: 1, benefit: 'allowance', checkedInBefore: 19, createdBy: 99 });
  expect(User.findByPk).toHaveBeenCalledWith(7, expect.objectContaining({ lock: 'UPDATE', transaction }));
  expect(Counter.findByPk).toHaveBeenCalledWith(1, expect.objectContaining({ lock: 'UPDATE', transaction }));
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff_free_entry.checked_in', metaJson: expect.objectContaining({ policy: expect.objectContaining({ allowance: 2, minimumPricePercent: 50 }) }) }), { transaction });
});
it('prevents duplicate admission and requires a reason for exhausted-allowance overrides', async () => {
  addEntry({ counterId: 2 }); addEntry({ counterId: 3 });
  await expect(checkInStaffFree(1, 7, 99, '   ')).rejects.toThrow('Lifetime allowance used');
  await checkInStaffFree(1, 7, 99, 'Approved farewell evening', 'override');
  expect(entries[2]).toMatchObject({ benefit: 'override', overrideReason: 'Approved farewell evening' });
  await expect(checkInStaffFree(1, 7, 99, 'Retry')).rejects.toThrow('already checked in');
});
it('never allows an override for on-duty staff, including scheduled assignments', async () => {
  (ShiftTypeProduct.findAll as jest.Mock).mockResolvedValue([{ shiftTypeId: 4 }]);
  (ShiftInstance.findAll as jest.Mock).mockResolvedValue([{ id: 35 }]);
  (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([{ userId: 7 }]);
  await expect(checkInStaffFree(1, 7, 99, 'Override')).rejects.toThrow('Assigned to work');
  expect(StaffFreeEntry.create).not.toHaveBeenCalled();
});
it('gives Assistant Managers unlimited recorded visits without using allowance', async () => {
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue({ active: true, staffType: 'assistant_manager' });
  await checkInStaffFree(1, 7, 99, undefined, 'assistant_manager');
  expect(entries[0].benefit).toBe('assistant_manager');
});
it.each(['admin', 'administrator', 'owner', 'manager'])('records unlimited %s visits consistently in check-in, the staff list and Account', async role => {
  const user = { id: 7, firstName: 'Management', lastName: 'Staff', status: true, approved: true, role: { slug: role } };
  (User.findByPk as jest.Mock).mockResolvedValue(user);
  (User.findAll as jest.Mock).mockResolvedValue([user]);
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue({ userId: 7, active: true, staffType: 'guide' });
  (StaffProfile.findAll as jest.Mock).mockResolvedValue([{ userId: 7, active: true, staffType: 'guide' }]);
  (getStaffFreeQualification as jest.Mock).mockResolvedValue({ count: 0 });
  addEntry({ counterId: 2 }); addEntry({ counterId: 3 });
  expect((await getStaffFreeOverview(1)).staff).toEqual([expect.objectContaining({ id: 7, unlimited: true, remaining: null, decision: expect.objectContaining({ allowed: true, benefit: 'management' }) })]);
  await checkInStaffFree(1, 7, 99, undefined, 'management');
  expect(entries[2]).toMatchObject({ benefit: 'management', staffType: 'guide', checkedInBefore: 0 });
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ metaJson: expect.objectContaining({ role, benefit: 'management' }) }), { transaction });
  const account = await getStaffFreeAccount(7);
  expect(account).toMatchObject({ visible: true, eligible: true, unlimited: true, remaining: null, used: 2, totalVisits: 3 });
  expect(account.history).toContainEqual(expect.objectContaining({ benefit: 'management', label: 'Unlimited management entry' }));
});
it.each(['admin', 'administrator', 'owner', 'manager'])('keeps active-profile, account-approval and off-duty requirements for %s', async role => {
  const user = { id: 7, status: true, approved: true, role: { slug: role } };
  (User.findByPk as jest.Mock).mockResolvedValue({ ...user, approved: false });
  await expect(checkInStaffFree(1, 7, 99, 'Override')).rejects.toThrow('inactive');
  (User.findByPk as jest.Mock).mockResolvedValue({ ...user, status: false });
  await expect(checkInStaffFree(1, 7, 99, 'Override')).rejects.toThrow('inactive');
  (User.findByPk as jest.Mock).mockResolvedValue(user);
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue(null);
  await expect(checkInStaffFree(1, 7, 99, 'Override')).rejects.toThrow('inactive');
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue({ active: false, staffType: 'manager' });
  await expect(checkInStaffFree(1, 7, 99, 'Override')).rejects.toThrow('inactive');
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue({ active: true, staffType: 'manager' });
  (CounterUser.findAll as jest.Mock).mockResolvedValue([{ userId: 7 }]);
  await expect(checkInStaffFree(1, 7, 99, 'Override')).rejects.toThrow('Assigned to work');
  expect(StaffFreeEntry.create).not.toHaveBeenCalled();
});
it.each([
  ['inactive account', false, true, { active: true, staffType: 'volunteer' }],
  ['unapproved account', true, false, { active: true, staffType: 'volunteer' }],
  ['inactive staff profile', true, true, { active: false, staffType: 'volunteer' }],
  ['Assistant Manager without a staff profile', true, true, null],
] as const)('rejects an %s at check-in, even with an override reason', async (_label, status, approved, profile) => {
  (User.findByPk as jest.Mock).mockResolvedValue({ id: 7, status, approved, role: { slug: 'assistant-manager' } });
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue(profile);
  await expect(checkInStaffFree(1, 7, 99, 'Override')).rejects.toThrow('inactive');
  expect(StaffFreeEntry.create).not.toHaveBeenCalled();
});
it.each([null, undefined, { slug: '' }])('rejects a missing user role at admission even with an Assistant Manager profile, 20 customers and an override: %j', async role => {
  (User.findByPk as jest.Mock).mockResolvedValue({ id: 7, status: true, approved: true, role });
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue({ active: true, staffType: 'assistant_manager' });
  (getStaffFreeQualification as jest.Mock).mockResolvedValue({ count: 20 });
  await expect(checkInStaffFree(1, 7, 99, 'Override')).rejects.toThrow('requires an assigned user role');
  expect(StaffFreeEntry.create).not.toHaveBeenCalled();
});
it('only offers active approved users with assigned roles and active eligible staff profiles, keeping previous visits visible', async () => {
  const users = [
    { id: 7, firstName: 'Active', lastName: 'Volunteer', status: true, approved: true, role: { slug: 'guide' } },
    { id: 8, firstName: 'Inactive', lastName: 'Account', status: false, approved: true, role: { slug: 'guide' } },
    { id: 9, firstName: 'Pending', lastName: 'Approval', status: true, approved: false, role: { slug: 'guide' } },
    { id: 10, firstName: 'Inactive', lastName: 'Profile', status: true, approved: true, role: { slug: 'assistant-manager' } },
    { id: 11, firstName: 'Missing', lastName: 'Profile', status: true, approved: true, role: { slug: 'assistant-manager' } },
    { id: 12, firstName: 'Active', lastName: 'Assistant', status: true, approved: true, role: { slug: 'assistant-manager' } },
    { id: 13, firstName: 'Active', lastName: 'Long Term', status: true, approved: true, role: { slug: 'guide' } },
    { id: 14, firstName: 'Missing', lastName: 'Role', status: true, approved: true, role: null },
    { id: 15, firstName: 'Empty', lastName: 'Role', status: true, approved: true, role: { slug: '' } },
  ];
  (User.findAll as jest.Mock).mockResolvedValue(users);
  (StaffProfile.findAll as jest.Mock).mockResolvedValue([
    { userId: 7, active: true, staffType: 'volunteer' }, { userId: 8, active: true, staffType: 'volunteer' },
    { userId: 9, active: true, staffType: 'volunteer' }, { userId: 10, active: false, staffType: 'assistant_manager' },
    { userId: 12, active: true, staffType: 'assistant_manager' }, { userId: 13, active: true, staffType: 'long_term' },
    { userId: 14, active: true, staffType: 'volunteer' }, { userId: 15, active: true, staffType: 'assistant_manager' },
  ]);
  addEntry({ userId: 8 });
  const result = await getStaffFreeOverview(1);
  expect(result.staff.map(person => person.id).sort((a, b) => a - b)).toEqual([7, 12, 13]);
  expect(result.entries).toEqual([expect.objectContaining({ userId: 8, name: 'Inactive Account' })]);
  expect(User.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { status: true, approved: true } }));
  expect(StaffProfile.findAll).toHaveBeenCalledWith({ where: { active: true } });
});
it('returns an earlier allowance at 20 qualifying customers exactly once and retains visit history', async () => {
  const entry = addEntry();
  (getStaffFreeQualification as jest.Mock).mockResolvedValue({ count: 20 });
  await reconcileStaffFreeAllowances(1, 99);
  await reconcileStaffFreeAllowances(1, 99);
  expect(entry.benefit).toBe('busy_night');
  expect(entry.cancelledAt).toBeNull();
  expect(AuditLog.create).toHaveBeenCalledTimes(1);
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff_free_entry.allowance_restored', metaJson: expect.objectContaining({ checkedInCustomers: 20 }) }), { transaction });
});
it('retains the recorded exemption if attendance is later corrected below 20', async () => {
  const entry = addEntry({ benefit: 'busy_night' });
  await reconcileStaffFreeAllowances(1, 99);
  expect(entry.benefit).toBe('busy_night'); expect(entry.update).not.toHaveBeenCalled();
});
it('uses the price rule saved for each admission when returning an allowance', async () => {
  addEntry({ policySnapshot: { busyThreshold: 20, minimumPricePercent: 75 } });
  await reconcileStaffFreeAllowances(1, 99);
  expect(getStaffFreeQualification).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 75, transaction);
});
it('requires a reason to undo an admission and keeps an auditable cancelled record', async () => {
  const entry = addEntry();
  await expect(cancelStaffFreeEntry(1, entry.id, 99, '')).rejects.toThrow('correction reason');
  await cancelStaffFreeEntry(1, entry.id, 99, 'Wrong person selected');
  expect(entry).toMatchObject({ cancelledBy: 99, cancellationReason: 'Wrong person selected', cancelledAt: expect.any(Date) });
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff_free_entry.cancelled' }), { transaction });
});
it('does not silently consume allowance when the displayed admission decision has changed', async () => {
  await expect(checkInStaffFree(1, 7, 99, undefined, 'busy_night')).rejects.toThrow('Attendance or allowance changed');
  expect(StaffFreeEntry.create).not.toHaveBeenCalled();
});

it('shows personal allowance usage separately from exempt and cancelled visits', async () => {
  addEntry();
  addEntry({ benefit: 'busy_night' });
  addEntry({ benefit: 'override' });
  addEntry({ cancelledAt: new Date() });
  addEntry({ userId: 8 });
  const result = await getStaffFreeAccount(7);
  expect(result).toMatchObject({ visible: true, eligible: true, unlimited: false, allowance: 2, used: 1, remaining: 1, totalVisits: 3 });
  expect(result.history).toHaveLength(4);
});

it('keeps personal history visible after staff eligibility ends without granting a new allowance', async () => {
  addEntry();
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue({ active: false, staffType: 'volunteer' });
  expect(await getStaffFreeAccount(7)).toMatchObject({ visible: true, eligible: false, remaining: null, totalVisits: 1 });
});

it('shows unlimited entries for eligible Assistant Managers and hides the card for non-staff without history', async () => {
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue({ active: true, staffType: 'assistant_manager' });
  expect(await getStaffFreeAccount(7)).toMatchObject({ unlimited: true, remaining: null, visible: true });
  (StaffProfile.findByPk as jest.Mock).mockResolvedValue(null);
  expect(await getStaffFreeAccount(7)).toMatchObject({ eligible: false, visible: false });
});


it('saves a batch once, even after a lost response is retried', async () => {
  const changes = { additions: [{ userId: 7 }, { userId: 8 }], removals: [] };
  await saveStaffFreeChanges(1, changes, 99);
  await saveStaffFreeChanges(1, changes, 99);
  expect(entries).toHaveLength(2);
  expect(StaffFreeEntry.create).toHaveBeenCalledTimes(2);
  expect(AuditLog.create).toHaveBeenCalledTimes(2);
});
it('rolls back every staff addition and removal if one person is ineligible', async () => {
  const existing = addEntry({ userId: 9 });
  (sequelize.transaction as jest.Mock).mockImplementation(async fn => {
    const snapshot = entries.map(row => ({ ...row }));
    try { return await fn(transaction); } catch (error) {
      entries = snapshot;
      throw error;
    }
  });
  (User.findByPk as jest.Mock).mockImplementation(async id => ({ id, firstName: 'Staff', lastName: String(id), status: id !== 8, approved: true, role: { slug: 'guide' } }));
  await expect(saveStaffFreeChanges(1, { additions: [{ userId: 7 }, { userId: 8 }], removals: [{ entryId: existing.id, reason: 'Correction' }] }, 99)).rejects.toThrow('Staff 8');
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ userId: 9, cancelledAt: null });
  expect(StaffFreeEntry.create).toHaveBeenCalledWith(expect.anything(), { transaction });
});
it('uses final saved attendance for the batch, not the draft creation time', async () => {
  addEntry({ counterId: 2 }); addEntry({ counterId: 3 });
  (getStaffFreeQualification as jest.Mock).mockResolvedValue({ count: 20 });
  await saveStaffFreeChanges(1, { additions: [{ userId: 7 }], removals: [] }, 99);
  expect(entries[2]).toMatchObject({ benefit: 'busy_night', checkedInBefore: 20 });
});
it('retains recorded corrections on repeated saves without creating duplicate cancellation events', async () => {
  const entry = addEntry();
  const changes = { additions: [], removals: [{ entryId: entry.id, reason: 'Wrong person' }] };
  await saveStaffFreeChanges(1, changes, 99);
  await saveStaffFreeChanges(1, changes, 99);
  expect(entry).toMatchObject({ cancelledAt: expect.any(Date), cancellationReason: 'Wrong person' });
  expect(AuditLog.create).toHaveBeenCalledTimes(1);
});

it('keeps paid and awaiting staff visits separate from free visits and lifetime allowance usage', async () => {
  (User.findByPk as jest.Mock).mockResolvedValue({ id: 7, status: true, approved: true, role: { slug: 'guide' } });
  addEntry({ userId: 7, benefit: 'allowance' });
  addEntry({ userId: 7, counterId: 2, benefit: 'busy_night' });
  addEntry({ userId: 7, counterId: 3, benefit: 'paid', paidAmount: 30, payment: { status: 'received', currency: 'PLN', methodName: 'Cash' } });
  addEntry({ userId: 7, counterId: 4, benefit: 'paid', paidAmount: 30, payment: { status: 'awaiting', currency: 'PLN', methodName: 'Transfer' } });
  addEntry({ userId: 7, counterId: 5, benefit: 'paid', paidAmount: 30, payment: { status: 'received' }, cancelledAt: new Date() });
  const result = await getStaffFreeAccount(7);
  expect(result).toMatchObject({ used: 1, totalVisits: 2, paidVisits: 1, pendingPaidVisits: 1 });
  expect(result.history).toHaveLength(5);
});

it('requires paid tickets to be removed through Walk-Ins rather than the free-entry endpoint', async () => {
  const entry = addEntry({ benefit: 'paid', paidAmount: 30 });
  await expect(cancelStaffFreeEntry(1, entry.id, 99, 'Correction')).rejects.toThrow('Remove paid Staff Tickets from Walk-Ins');
  expect(entry.update).not.toHaveBeenCalled();
});
