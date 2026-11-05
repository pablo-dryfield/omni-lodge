// The legacy Jest mapper redirects service-level User.js imports to this stub.
jest.mock('../../__mocks__/sequelizeModelStub', () => jest.requireMock('../../models/User.js'));
jest.mock('../staffFreeQualificationService.js', () => ({ getStaffFreeQualification: jest.fn().mockResolvedValue({ count: 15 }) }));
jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/Counter.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/Channel.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/StaffFreeEntry.js', () => ({ __esModule: true, default: { findAll: jest.fn(), count: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../staffFreeEntryService.js', () => ({ getStaffFreePolicy: jest.fn(), onDutyUserIds: jest.fn(), productEligibility: jest.fn(), staffIdentity: jest.fn() }));
import sequelize from '../../config/database';
import Counter from '../../models/Counter';
import Channel from '../../models/Channel';
import StaffFreeEntry from '../../models/StaffFreeEntry';
import User from '../../models/User';
import AuditLog from '../../models/AuditLog';
import { getStaffFreePolicy, onDutyUserIds, productEligibility, staffIdentity } from '../staffFreeEntryService';
import { saveStaffPaidTickets } from '../staffPaidTicketService';
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const updateCounter = jest.fn();
let saved: any[];
const ticket = () => ({ key: 'entry:staff', name: 'Staff Ticket', ticketType: 'staff_paid', paymentMethodId: 3, paymentMethodName: 'Transfer', paymentStatus: 'awaiting', staffGuests: [{ userId: 7, name: 'Untrusted name' }], currencies: [{ currency: 'PLN', people: 1, cash: 30, unitPrice: 30, addons: {} }] });
const notes = (t = ticket()) => `Manager note\n-- CASH-SNAPSHOT START --\n${JSON.stringify({ version: 3, channels: { 5: { tickets: [t] } } })}\n-- CASH-SNAPSHOT END --`;
beforeEach(() => {
  jest.clearAllMocks(); saved = [];
  (sequelize.transaction as jest.Mock).mockImplementation(fn => fn(transaction));
  (Counter.findByPk as jest.Mock).mockResolvedValue({ id: 1, date: '2026-11-05', update: updateCounter });
  (Channel.findByPk as jest.Mock).mockResolvedValue({ name: 'Walk-In' });
  (getStaffFreePolicy as jest.Mock).mockResolvedValue({ allowance: 2, paidTicketPrice: 30 });
  (onDutyUserIds as jest.Mock).mockResolvedValue(new Set());
  (productEligibility as jest.Mock).mockResolvedValue(true);
  (staffIdentity as jest.Mock).mockResolvedValue({ active: true, staffType: 'volunteer', unlimitedBenefit: null, user: { id: 7, firstName: 'Sam', lastName: 'Guide' } });
  (User.findByPk as jest.Mock).mockResolvedValue({ id: 7, firstName: 'Sam', lastName: 'Guide' });
  (StaffFreeEntry.findAll as jest.Mock).mockImplementation(async () => saved);
  (StaffFreeEntry.count as jest.Mock).mockImplementation(async ({ where }) => where.benefit === 'allowance' ? 2 : saved.length);
  (StaffFreeEntry.create as jest.Mock).mockImplementation(async value => { const entry = { ...value, id: 99, update: jest.fn(async patch => Object.assign(entry, patch)) }; saved.push(entry); return entry; });
});
it('saves one named paid visit with attendance independent of its awaiting status', async () => {
  await saveStaffPaidTickets(1, notes(), 99, 'assistant-manager');
  expect(saved[0]).toMatchObject({ benefit: 'paid', paidAmount: 30, payment: { status: 'awaiting', currency: 'PLN' } });
  expect(updateCounter.mock.calls[0][0].notes).toContain('Sam Guide');
  expect(updateCounter.mock.calls[0][0].notes).toContain('"people":1');
});
it('is idempotent and audits payment receipt without adding a second visit', async () => {
  await saveStaffPaidTickets(1, notes(), 99, 'manager');
  const received = { ...ticket(), paymentStatus: 'received' };
  await saveStaffPaidTickets(1, notes(received), 99, 'manager');
  saved[0].payment = { status: 'received', methodName: 'Transfer', methodId: 3, currency: 'PLN' };
  await saveStaffPaidTickets(1, notes(received), 99, 'manager');
  expect((AuditLog.create as jest.Mock).mock.calls.filter(([entry]) => entry.action === 'staff_ticket.payment_updated')).toHaveLength(1);
  expect(StaffFreeEntry.create).toHaveBeenCalledTimes(1);
  expect(saved[0].payment.status).toBe('received');
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff_ticket.payment_updated' }), { transaction });
});
it.each(['inactive', 'on duty', 'unlimited', 'unused allowance'])('rejects %s staff before writing paid visits', async scenario => {
  if (scenario === 'inactive') (staffIdentity as jest.Mock).mockResolvedValue({ active: false, user: { firstName: 'Sam' } });
  if (scenario === 'on duty') (onDutyUserIds as jest.Mock).mockResolvedValue(new Set([7]));
  if (scenario === 'unlimited') (staffIdentity as jest.Mock).mockResolvedValue({ active: true, staffType: 'volunteer', unlimitedBenefit: 'management', user: { firstName: 'Sam' } });
  if (scenario === 'unused allowance') (StaffFreeEntry.count as jest.Mock).mockResolvedValue(0);
  await expect(saveStaffPaidTickets(1, notes(), 99, 'manager')).rejects.toThrow();
  expect(StaffFreeEntry.create).not.toHaveBeenCalled();
});
it('rejects duplicate staff, altered prices and ordinary-user writes', async () => {
  const duplicate = ticket(); duplicate.staffGuests.push({ ...duplicate.staffGuests[0] }); duplicate.currencies[0].people = 2; duplicate.currencies[0].cash = 60;
  await expect(saveStaffPaidTickets(1, notes(duplicate), 99, 'manager')).rejects.toThrow('only once');
  saved = [];
  const wrong = ticket(); wrong.currencies[0].cash = 1;
  await expect(saveStaffPaidTickets(1, notes(wrong), 99, 'manager')).rejects.toThrow('price or quantity');
  await expect(saveStaffPaidTickets(1, notes(), 99, 'guide')).rejects.toThrow('Only management');
});
it('keeps a cancelled paid visit in history when its ticket is removed', async () => {
  await saveStaffPaidTickets(1, notes(), 99, 'manager');
  await saveStaffPaidTickets(1, 'Manager note', 99, 'manager');
  expect(saved[0]).toMatchObject({ cancelledAt: expect.any(Date), cancelledBy: 99, paidAmount: 30 });
  expect(updateCounter).toHaveBeenLastCalledWith({ notes: 'Manager note' }, { transaction });
});

it('does not cancel paid history when a damaged cash snapshot is submitted', async () => {
  await saveStaffPaidTickets(1, notes(), 99, 'manager');
  await expect(saveStaffPaidTickets(1, '-- CASH-SNAPSHOT START --bad-- CASH-SNAPSHOT END --', 99, 'manager')).rejects.toThrow('Invalid Walk-Ins snapshot');
  expect(saved[0].cancelledAt).toBeNull();
});
