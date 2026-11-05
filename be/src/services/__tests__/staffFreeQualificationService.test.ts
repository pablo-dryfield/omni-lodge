jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/Channel.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ChannelProductPrice.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/Counter.js', () => ({ __esModule: true, default: {} }));
import Booking from '../../models/Booking';
import Channel from '../../models/Channel';
import ChannelProductPrice from '../../models/ChannelProductPrice';
import { bookingBaseTicketTotal, getStaffFreeQualification } from '../staffFreeQualificationService';

const booking = (values: Record<string, unknown> = {}) => ({ priceGross: '110', discountAmount: null, addonsAmount: null, addonsSnapshot: null, tipAmount: null, refundedAmount: null, currency: 'PLN', partySizeTotal: 1, attendedTotal: 1, ...values });
const snapshot = (name: string, channels: unknown) => `-- ${name}-SNAPSHOT START --\n${JSON.stringify({ channels })}\n-- ${name}-SNAPSHOT END --`;
beforeEach(() => {
  jest.clearAllMocks();
  (Channel.findAll as jest.Mock).mockResolvedValue([{ id: 5, name: 'Walk-In' }]);
  (ChannelProductPrice.findAll as jest.Mock).mockResolvedValue([{ currencyCode: 'PLN', price: 110 }, { currencyCode: 'EUR', price: 26 }]);
  (Booking.findAll as jest.Mock).mockResolvedValue([]);
});
it('removes add-ons, discounts, tips and refunds from gross without subtracting platform commission', () => {
  expect(bookingBaseTicketTotal(booking({ priceGross: '210', addonsAmount: '50', discountAmount: '10', tipAmount: '5', refundedAmount: '5', priceNet: '80', commissionAmount: '60' }) as never)).toBe(140);
});
it('uses priced add-on snapshots and excludes unpriced extras', () => {
  expect(bookingBaseTicketTotal(booking({ priceGross: '150', addonsSnapshot: { addons: [{ quantity: 2, unitPrice: '20' }] } }) as never)).toBe(110);
  expect(bookingBaseTicketTotal(booking({ addonsSnapshot: { extras: { cocktails: 1 } } }) as never)).toBeNull();
});
it('counts only attended people at or above the minimum, in each matching currency', async () => {
  (Booking.findAll as jest.Mock).mockResolvedValue([
    booking({ partySizeTotal: 3, attendedTotal: 2, priceGross: '165' }),
    booking({ priceGross: '54.99' }), booking({ priceGross: '0' }),
    booking({ currency: 'EUR', priceGross: '13' }), booking({ currency: 'USD', priceGross: '100' }),
    booking({ partySizeTotal: 0, attendedTotal: 4, priceGross: '80' }),
  ]);
  expect(await getStaffFreeQualification({ id: 1, productId: 28, date: '2026-11-05', notes: null } as never, 50)).toMatchObject({ count: 3, belowMinimum: 1, free: 1, unpriced: 1, totalCustomers: 6 });
});
it('counts paid walk-ins once, excludes anonymous free customers, and ignores duplicated booking cash collections', async () => {
  const notes = snapshot('CASH', { 5: { tickets: [
    { key: 'entry:one', currencies: [{ currency: 'PLN', people: 2, cash: 160, addons: { 1: 2 }, addonUnitPrices: { 1: 25 } }] },
    { key: 'entry:two', currencies: [{ currency: 'PLN', people: 1, cash: 54.99, addons: {} }] },
    { key: 'booking-cash:xperiencepoland:12', currencies: [{ currency: 'PLN', people: 4, cash: 440 }] },
  ] } }) + snapshot('FREE', { 5: { people: { qty: 5 } } });
  expect(await getStaffFreeQualification({ id: 1, productId: 28, date: '2026-11-05', notes } as never, 50)).toMatchObject({ count: 2, belowMinimum: 1, free: 5, totalCustomers: 8 });
});
it('does not count unknown legacy price breakdowns as qualifying', async () => {
  const notes = snapshot('CASH', { 5: { currency: 'PLN', qty: 25, amount: 2750 } });
  expect(await getStaffFreeQualification({ id: 1, productId: 28, date: '2026-11-05', notes } as never, 50)).toMatchObject({ count: 0, unpriced: 25 });
});
