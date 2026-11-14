jest.mock('../../../models/Booking.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../../models/BookingEvent.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
import Booking from '../../../models/Booking';
import { projectPartnerRefund } from '../partnerRefundProjection';

const transaction = { LOCK: { UPDATE: 'update' } } as any;
const line = (gross: number, refunded: number) => ({ id: Math.random(), priceGross: gross, priceNet: gross, refundedAmount: refunded, update: jest.fn() });
it('adds only the provider difference, preserving previous experience allocations', async () => {
  const rows = [line(100, 100), line(100, 0), line(100, 0)];
  (Booking.findAll as jest.Mock).mockResolvedValue(rows);
  await projectPartnerRefund('order', 10001, transaction);
  expect(rows[0].update).not.toHaveBeenCalled();
  expect(rows[1].update).toHaveBeenCalledWith(expect.objectContaining({ refundedAmount: '0.01' }), expect.anything());
  expect(rows[2].update).not.toHaveBeenCalled();
});
it('repairs a failed provider refund without removing unrelated successful refunds', async () => {
  const rows = [line(100, 20), line(100, 30)];
  (Booking.findAll as jest.Mock).mockResolvedValue(rows);
  await projectPartnerRefund('order', 2500, transaction);
  expect(rows[0].update).toHaveBeenCalledWith(expect.objectContaining({ refundedAmount: '10.00', baseAmount: '90.00' }), expect.anything());
  expect(rows[1].update).toHaveBeenCalledWith(expect.objectContaining({ refundedAmount: '15.00', baseAmount: '85.00' }), expect.anything());
});
it('leaves a matching snapshot unchanged on repeated events', async () => {
  const row = line(100, 20);
  (Booking.findAll as jest.Mock).mockResolvedValue([row]);
  expect(await projectPartnerRefund('order', 2000, transaction)).toBeNull();
  expect(row.update).not.toHaveBeenCalled();
});
it('uses the actual discounted payment as the refundable capacity', async () => {
  const row = { ...line(100, 0), priceNet: 80 };
  (Booking.findAll as jest.Mock).mockResolvedValue([row]);
  await projectPartnerRefund('order', 8000, transaction);
  expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ refundedAmount: '80.00', baseAmount: '0.00', paymentStatus: 'refunded' }), expect.anything());
});
