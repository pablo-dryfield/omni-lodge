import { normalizeBookingAddonRefundActions, removeAddonFromBookingSnapshot } from '../bookingAddonRefundActions.js';
import type Booking from '../../models/Booking.js';

it('uses the same pending interpretation as Counter Summary and rejects unusable actions', () => {
  expect(normalizeBookingAddonRefundActions([null, {}, { id: 'bad', addonKey: 'other', quantity: 1 },
    { id: 'zero', addonKey: 'photos', quantity: 0 }, { id: 'pending', addonKey: 'cocktails', quantity: 2 },
    { id: 'completed', addonKey: 'photos', quantity: 1, status: ' COMPLETED ' },
    { id: 'declined', addonKey: 'tshirts', quantity: '1', status: 'declined' }]))
    .toEqual([expect.objectContaining({ id: 'pending', status: 'pending', quantity: 2 }),
      expect.objectContaining({ id: 'completed', status: 'completed' }), expect.objectContaining({ id: 'declined', status: 'declined' })]);
  expect(normalizeBookingAddonRefundActions({})).toEqual([]);
});
it('removes only the refunded add-on quantity and preserves guests, other extras and metadata', () => {
  const booking = { partySizeTotal: 3, addonsSnapshot: { extras: { cocktails: 2, photos: 3, tshirts: 1 }, note: 'keep' } } as unknown as Booking;
  expect(removeAddonFromBookingSnapshot(booking, 'cocktails', 1)).toBe(1);
  expect(booking.addonsSnapshot).toEqual({ extras: { cocktails: 1, photos: 3, tshirts: 1 }, note: 'keep' });
  expect(booking.partySizeTotal).toBe(3);
  expect(removeAddonFromBookingSnapshot(booking, 'cocktails', 9)).toBe(1);
  expect(removeAddonFromBookingSnapshot(booking, 'cocktails', 1)).toBe(0);
});
