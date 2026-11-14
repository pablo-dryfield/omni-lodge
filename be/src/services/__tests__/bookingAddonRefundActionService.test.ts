jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Counter.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../counterRegistryService.js', () => ({ __esModule: true, default: { upsertMetrics: jest.fn() } }));
import sequelize from '../../config/database.js';
import Booking from '../../models/Booking.js';
import Counter from '../../models/Counter.js';
import AuditLog from '../../models/AuditLog.js';
import Registry from '../counterRegistryService.js';
import { changeBookingAddonRefundAction } from '../bookingAddonRefundActionService.js';
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
let booking: any;
beforeEach(() => {
  jest.clearAllMocks();
  (sequelize.transaction as jest.Mock).mockImplementation(callback => callback(transaction));
  booking = { id: 41, partySizeTotal: 3, addonsSnapshot: { extras: { cocktails: 2, photos: 1, tshirts: 0 } },
    addonRefundActions: [{ id: 'refund-1', addonKey: 'cocktails', quantity: 1, status: 'pending', counterId: 77 }], save: jest.fn() };
  (Booking.findByPk as jest.Mock).mockResolvedValue(booking);
  (Counter.findByPk as jest.Mock).mockResolvedValue({ id: 77 });
  (Registry.upsertMetrics as jest.Mock).mockResolvedValue({});
});
it('completes on the booking and recalculates the exact counter in the same transaction', async () => {
  await changeBookingAddonRefundAction(41, 'refund-1', 'complete', 7);
  expect(booking.addonsSnapshot.extras).toEqual({ cocktails: 1, photos: 1, tshirts: 0 });
  expect(booking.addonRefundActions[0]).toMatchObject({ status: 'completed', completedBy: 7 });
  expect(booking.save).toHaveBeenCalledWith({ transaction });
  expect(Booking.findByPk).toHaveBeenCalledWith(41, expect.objectContaining({ transaction, lock: { level: 'UPDATE', of: Booking } }));
  expect(Registry.upsertMetrics).toHaveBeenCalledWith(77, [], 7, undefined, transaction);
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'booking.addon_refund.complete', entityId: '41' }), { transaction });
});
it('does not remove add-ons or replace the original actor on a repeated completion', async () => {
  booking.addonRefundActions[0] = { ...booking.addonRefundActions[0], status: 'completed', completedBy: 9, completedAt: '2026-11-01' };
  await changeBookingAddonRefundAction(41, 'refund-1', 'complete', 7);
  expect(booking.addonsSnapshot.extras.cocktails).toBe(2);
  expect(booking.addonRefundActions[0].completedBy).toBe(9);
  expect(AuditLog.create).not.toHaveBeenCalled();
});
it('deletes only the task and rebuilds metrics without claiming a refund', async () => {
  await changeBookingAddonRefundAction(41, 'refund-1', 'delete', 7);
  expect(booking.addonRefundActions).toEqual([]);
  expect(booking.addonsSnapshot.extras.cocktails).toBe(2);
  expect(Registry.upsertMetrics).toHaveBeenCalledWith(77, [], 7, undefined, transaction);
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'booking.addon_refund.delete' }), { transaction });
});
it('fails the transaction when counter recalculation fails', async () => {
  (Registry.upsertMetrics as jest.Mock).mockRejectedValue(new Error('counter unavailable'));
  await expect(changeBookingAddonRefundAction(41, 'refund-1', 'complete', 7)).rejects.toThrow('counter unavailable');
  expect(AuditLog.create).not.toHaveBeenCalled();
});
it('does not complete an unknown or already deleted task', async () => {
  await expect(changeBookingAddonRefundAction(41, 'other', 'complete', 7)).rejects.toMatchObject({ status: 404 });
  expect(booking.save).not.toHaveBeenCalled();
});
