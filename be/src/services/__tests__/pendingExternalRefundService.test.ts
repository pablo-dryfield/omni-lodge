jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findAndCountAll: jest.fn() } }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../productScopeService.js', () => ({ scopeProductWhere: (scope: number[]) => ({ productTypeId: scope }) }));
import Booking from '../../models/Booking.js';
import { listPendingExternalRefunds } from '../pendingExternalRefundService.js';
const find = Booking.findAndCountAll as jest.Mock;
beforeEach(() => find.mockResolvedValue({ rows: [{ id: '4', guestFirstName: 'Diane', guestLastName: 'Jender', platform: 'viator',
  platformBookingId: 'BR-1', experienceDate: '2026-10-30', productName: 'Food Tour', addonRefundActions: [
    { id: 'pending', addonKey: 'photos', quantity: 2, counterId: 77 }, { id: 'done', addonKey: 'cocktails', quantity: 1, status: 'completed' },
    { id: 'declined', addonKey: 'tshirts', quantity: 1, status: 'declined' }], guestEmail: 'not-exposed' }], count: 12 }));
it('paginates pending bookings in the database and exposes only pending tasks and needed customer fields', async () => {
  const result = await listPendingExternalRefunds(null, 8, 8);
  expect(find).toHaveBeenCalledWith(expect.objectContaining({ limit: 8, offset: 8, distinct: true }));
  expect(result.meta).toEqual({ totalBookings: 12, limit: 8, offset: 8 });
  expect(result.data[0]).toMatchObject({ bookingId: 4, customerName: 'Diane Jender', actions: [{ id: 'pending', addonKey: 'photos', quantity: 2, counterId: 77, reason: null }] });
  expect(result.data[0]).not.toHaveProperty('guestEmail');
});
it('applies product scope to both rows and total using a required product join', async () => {
  await listPendingExternalRefunds([2], 4, 0);
  expect(find.mock.calls.at(-1)?.[0].include[0]).toMatchObject({ required: true, where: { productTypeId: [2] } });
});
