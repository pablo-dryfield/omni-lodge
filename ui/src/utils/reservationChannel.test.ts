import { partnerCashOnArrival, reservationChannelId, walkInReservationBaseline } from './reservationChannel';

it('keeps partner attribution instead of placing every storefront booking in OmniLodge', () => {
  expect(reservationChannelId({ platform: 'omnilodge', rawData: { channelId: 25 } } as never, new Map([['omnilodge', 7]]))).toBe(25);
  expect(reservationChannelId({ platform: 'GetYourGuide', rawData: {} } as never, new Map([['getyourguide', 3]]))).toBe(3);
});
it('collects partner arrival cash through the reservation flow only while unpaid', () => {
  expect(partnerCashOnArrival({ platform: 'omnilodge', paymentStatus: 'unpaid', rawData: { paymentMethod: 'cash' } } as never)).toBe(true);
  expect(partnerCashOnArrival({ platform: 'omnilodge', paymentStatus: 'paid', rawData: { paymentMethod: 'cash' } } as never)).toBe(false);
  expect(partnerCashOnArrival({ platform: 'omnilodge', paymentStatus: 'unpaid', rawData: { paymentMethod: 'stripe' } } as never)).toBe(false);
  expect(partnerCashOnArrival({ platform: 'omnilodge', paymentStatus: 'partial', rawData: { paymentMethod: 'cash' } } as never)).toBe(false);
});
it('adds genuine walk-ins to reservations without double counting cash collection tickets', () => {
  const result = walkInReservationBaseline({ tickets: { normal: { currencies: { PLN: { people: 3, addons: { 1: 1 } } } }, 'booking-cash:xperiencepoland:3': { currencies: { PLN: { people: 2, addons: {} } } } } } as never, [1]);
  expect(result.people).toBe(2);
  expect(result.addons.get(1)).toBe(1);
});
