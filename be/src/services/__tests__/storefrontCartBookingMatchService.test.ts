import { Op } from 'sequelize';
import Booking from '../../models/Booking';
import StorefrontOrder from '../../models/StorefrontOrder';
import StorefrontOngoingCart from '../../models/StorefrontOngoingCart';
import { dismissCartWithPaidMatch, findPaidCartMatch } from '../storefrontCartBookingMatchService';

jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/StorefrontOrder.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/StorefrontOngoingCart.js', () => ({ __esModule: true, default: { update: jest.fn() } }));

const cart = {
  id: 777, createdAt: new Date('2026-10-20T10:00:00Z'),
  customer: { fullName: 'Anthony Example', email: 'example@example.com', phone: '500100200', phoneCountry: 'PL' },
  cart: { items: [{ productId: 29, quantity: 3, experienceDate: '2026-10-31', experienceTime: '21:00' }] },
  metadata: { events: [] },
} as unknown as StorefrontOngoingCart;
const booking = {
  id: 11686, platform: 'omnilodge', platformOrderId: 'paid-order',
  guestEmail: 'example@example.com', guestPhone: '+48500100200', guestFirstName: 'Tony', guestLastName: 'Example',
  productId: 29, experienceDate: '2026-10-31', experienceStartAt: new Date('2026-10-31T20:00:00Z'), partySizeTotal: 1,
  createdAt: new Date('2026-10-20T11:00:00Z'),
};
const order = { id: 849, publicId: 'paid-order', customerCountryCode: 'PL' };

beforeEach(() => {
  jest.resetAllMocks();
  (Booking.findAll as jest.Mock).mockResolvedValue([booking]);
  (StorefrontOrder.findAll as jest.Mock).mockResolvedValue([order]);
  (StorefrontOngoingCart.update as jest.Mock).mockResolvedValue([1]);
});

it('finds a paid booking despite a shortened name and a changed guest count', async () => {
  expect(await findPaidCartMatch(cart)).toEqual({ kind: 'order', id: 849 });
  expect(Booking.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    status: 'confirmed', paymentStatus: 'paid', experienceDate: { [Op.in]: ['2026-10-31'] },
  }) }));
  expect(StorefrontOrder.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    status: 'confirmed', paymentStatus: 'paid', paidAt: { [Op.gte]: cart.createdAt },
  }) }));
});

it.each([
  { experienceDate: '2026-11-01' }, { experienceStartAt: new Date('2026-10-31T18:30:00Z') }, { productId: 88 },
])('does not close another product, date or time: %j', async difference => {
  (Booking.findAll as jest.Mock).mockResolvedValue([{ ...booking, ...difference }]);
  expect(await findPaidCartMatch(cart)).toBeNull();
});

it('does not rely on a converted-cart snapshot when the current booking is cancelled or refunded', async () => {
  (Booking.findAll as jest.Mock).mockResolvedValue([]);
  expect(await findPaidCartMatch(cart)).toBeNull();
  expect(StorefrontOrder.findAll).not.toHaveBeenCalled();
});

it('keeps a new cart created after the existing order was paid', async () => {
  // The query excludes orders paid before this cart, even if the same trip is selected again.
  (StorefrontOrder.findAll as jest.Mock).mockResolvedValue([]);
  expect(await findPaidCartMatch(cart)).toBeNull();
});

it('matches a national phone through its order country when email changed', async () => {
  (Booking.findAll as jest.Mock).mockResolvedValue([{ ...booking, guestEmail: 'other@example.com', guestPhone: '500100200' }]);
  expect(await findPaidCartMatch(cart)).toEqual({ kind: 'order', id: 849 });
});

it('does not close a cart from an exact name alone', async () => {
  (Booking.findAll as jest.Mock).mockResolvedValue([{ ...booking, guestFirstName: 'Anthony', guestEmail: 'other@example.com', guestPhone: '+48600100200' }]);
  expect(await findPaidCartMatch(cart)).toBeNull();
});

it('covers paid bookings without an ongoing cart or a storefront order', async () => {
  (Booking.findAll as jest.Mock).mockResolvedValue([{ ...booking, platform: 'viator' }]);
  expect(await findPaidCartMatch(cart)).toEqual({ kind: 'booking', id: 11686 });
});

it('dismisses a matching paid cart with audit evidence but no recovered-sale attribution', async () => {
  expect(await dismissCartWithPaidMatch(cart)).toBe(true);
  const values = (StorefrontOngoingCart.update as jest.Mock).mock.calls[0][0];
  expect(values).toMatchObject({ status: 'dismissed', metadata: { alreadyBooked: { kind: 'order', id: 849 } } });
  expect(values).not.toHaveProperty('recoveredAt');
});
