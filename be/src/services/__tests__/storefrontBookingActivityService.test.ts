import StorefrontOngoingCart from '../../models/StorefrontOngoingCart';
import StorefrontOrder from '../../models/StorefrontOrder';
import { getBookingStorefrontActivity } from '../storefrontBookingActivityService';
import { getOngoingCartJourney } from '../storefrontJourneyService';

jest.mock('../../models/StorefrontOngoingCart.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/StorefrontOrder.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../storefrontJourneyService.js', () => ({ getOngoingCartJourney: jest.fn() }));

const orderModel = StorefrontOrder as unknown as { findOne: jest.Mock };
const cartModel = StorefrontOngoingCart as unknown as { findOne: jest.Mock };
const mockedJourney = getOngoingCartJourney as jest.MockedFunction<typeof getOngoingCartJourney>;

describe('storefront booking activity service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not query storefront data for a non-storefront booking', async () => {
    await expect(getBookingStorefrontActivity({
      platform: 'ecwid',
      platformOrderId: '12345',
    })).resolves.toBeNull();
    expect(orderModel.findOne).not.toHaveBeenCalled();
  });

  it('returns an empty storefront activity contract when the order is unavailable', async () => {
    orderModel.findOne.mockResolvedValue(null);
    await expect(getBookingStorefrontActivity({
      platform: 'omnilodge',
      platformOrderId: 'order-public-id',
    })).resolves.toEqual({ order: null, cart: null, visits: [] });
    expect(cartModel.findOne).not.toHaveBeenCalled();
  });

  it('connects the booking order to its cart and visit timeline', async () => {
    const paidAt = new Date('2026-08-28T18:00:00Z');
    orderModel.findOne.mockResolvedValue({
      id: 41,
      publicId: 'order-public-id',
      status: 'confirmed',
      paymentStatus: 'paid',
      paidAt,
      metadata: { ongoingCartPublicId: 'cart-public-id' },
    });
    cartModel.findOne.mockResolvedValue({
      id: 73,
      publicId: 'cart-public-id',
      status: 'converted',
      total: '360.00',
      currency: 'PLN',
      openedAt: new Date('2026-08-28T17:30:00Z'),
      checkoutStartedAt: new Date('2026-08-28T17:50:00Z'),
      recoverySentAt: null,
      recoveryOpenedAt: null,
      recoveredAt: null,
      convertedAt: paidAt,
    });
    mockedJourney.mockResolvedValue([{ id: 'visit-1', events: [] } as never]);

    const result = await getBookingStorefrontActivity({
      platform: 'omnilodge',
      platformOrderId: 'order-public-id',
    });

    expect(result).toMatchObject({
      order: { publicId: 'order-public-id', paymentStatus: 'paid' },
      cart: { publicId: 'cart-public-id', total: 360, status: 'converted' },
      visits: [{ id: 'visit-1' }],
    });
    expect(mockedJourney).toHaveBeenCalledWith(73);
  });
});
