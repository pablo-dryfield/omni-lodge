import { getWalkInValidationError, isReceivedWalkInCash, readWalkInPaymentMetadata, readWalkInPriceMetadata } from './walkInMetadata';

it('preserves saved payment details and rejects invalid pricing metadata', () => {
  expect(readWalkInPaymentMetadata({ ticketType: 'group', paymentMethodId: 2, paymentMethodName: 'Bank Transfer', paymentStatus: 'awaiting' })).toEqual({ ticketType: 'group', paymentMethodId: 2, paymentMethodName: 'Bank Transfer', paymentStatus: 'awaiting' });
  expect(readWalkInPriceMetadata({ unitPrice: 100, addonUnitPrices: { '1': 25, '2': -3, 'abc': 4 } })).toEqual({ unitPrice: 100, addonUnitPrices: { 1: 25 } });
});
it('does not present transfer amounts or awaiting payments as collected cash', () => {
  expect(isReceivedWalkInCash({ paymentMethodName: 'Bank Transfer', paymentStatus: 'received' })).toBe(false);
  expect(isReceivedWalkInCash({ paymentStatus: 'awaiting' })).toBe(false);
  expect(isReceivedWalkInCash({ transfer: true })).toBe(false);
  expect(isReceivedWalkInCash({})).toBe(true);
});
it('requires an amount and guests for new entries without changing historical records', () => {
  const ticket = { name: 'Custom', currencyOrder: ['PLN'], currencies: { PLN: { people: 2, cash: '' } }, paymentMethodId: 2 };
  expect(getWalkInValidationError({ 5: { ticketOrder: ['entry:1'], tickets: { 'entry:1': ticket } } })).toMatch(/amount/);
  expect(getWalkInValidationError({ 5: { ticketOrder: ['Custom'], tickets: { Custom: ticket } } })).toBeNull();
  expect(getWalkInValidationError({ 5: { ticketOrder: ['entry:1'], tickets: { 'entry:1': { ...ticket, currencies: { PLN: { people: 2, cash: '120.50' } } } } } })).toBeNull();
});
