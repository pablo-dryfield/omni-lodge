import { canManageDirectCancellations, isDirectCancellationOrder } from './bookingCancellation';

it.each(['direct', ' Direct ', 'DIRECT'])('recognizes Direct channel %s without a product name', platform => {
  expect(isDirectCancellationOrder({ platform })).toBe(true);
});
it.each(['rezdy', 'viator', 'omnilodge', 'ecwid', 'getyourguide', ''])('does not treat %s as Direct', platform => {
  expect(isDirectCancellationOrder({ platform })).toBe(false);
});
it.each(['owner', 'admin', 'administrator', 'manager', ' Administrator ', 'mgr'])(
  'allows global %s cancellation controls', role => expect(canManageDirectCancellations(role, false, false)).toBe(true),
);
it.each(['food-tour-owner', 'food-tour-manager'])(
  'allows scoped %s only with booking update permission', role => {
    expect(canManageDirectCancellations(role, true, true)).toBe(true);
    expect(canManageDirectCancellations(role, true, false)).toBe(false);
    expect(canManageDirectCancellations(role, false, true)).toBe(false);
  },
);
it.each(['guide', 'food-tour-guide', 'assistant-manager', '', null, undefined])(
  'does not give %s Direct cancellation controls', role => {
    expect(canManageDirectCancellations(role, true, true)).toBe(false);
    expect(canManageDirectCancellations(role, false, true)).toBe(false);
  },
);
it.each(['owner', 'admin', 'manager'])('does not bypass product restrictions with global %s role claims', role => {
  expect(canManageDirectCancellations(role, true, true)).toBe(false);
});
