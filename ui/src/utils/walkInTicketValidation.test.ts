import { getWalkInValidationError } from './walkInMetadata';
import { getWalkInTicketIdentityErrors, hasWalkInTicketType } from './walkInTicketValidation';

const standard = { name: 'Normal', ticketType: 'normal', currencyOrder: ['PLN'], currencies: { PLN: { people: 1, cash: '110' } }, paymentMethodId: 4 };
const custom = { ...standard, name: 'Private group', ticketType: 'custom' };
const channel = (first = standard, second = standard) => ({ ticketOrder: ['entry:one', 'entry:two'], tickets: { 'entry:one': first, 'entry:two': second } });

it('blocks saving duplicate types even with different names or payment methods', () => {
  expect(getWalkInValidationError({ 5: channel(standard, { ...standard, name: 'Other name', paymentMethodId: 2 }) })).toMatch(/already added/);
});
it('allows standard tickets in different currencies or channels', () => {
  expect(getWalkInTicketIdentityErrors(channel(standard, { ...standard, currencyOrder: ['EUR'] }))).toEqual({});
  const one = { ticketOrder: ['entry:one'], tickets: { 'entry:one': standard } };
  expect(getWalkInValidationError({ 5: one, 8: one })).toBeNull();
});
it('recognizes legacy types and every currency on a saved ticket', () => {
  const legacy = { name: 'Normal', currencyOrder: ['PLN', 'EUR'] };
  const saved = { ticketOrder: ['Normal'], tickets: { Normal: legacy } };
  expect(hasWalkInTicketType(saved, 'normal', 'EUR')).toBe(true);
  expect(hasWalkInTicketType(saved, 'normal', 'PLN')).toBe(true);
  expect(getWalkInTicketIdentityErrors({ ticketOrder: ['Normal', 'entry:one'], tickets: { Normal: legacy, 'entry:one': standard } })['entry:one']).toMatch(/already added/);
});
it.each(['Private group', ' PRIVATE   group ', 'Ｐｒｉｖａｔｅ group'])('blocks saving duplicate custom names: %s', name => {
  expect(getWalkInValidationError({ 5: channel(custom, { ...custom, name }) })).toMatch(/unique ticket name/);
});
it('requires distinct custom names across currencies and from standard tickets', () => {
  expect(getWalkInTicketIdentityErrors(channel(custom, { ...custom, currencyOrder: ['EUR'] }))['entry:two']).toMatch(/unique/);
  expect(getWalkInValidationError({ 5: channel(standard, { ...custom, name: 'normal' }) })).toMatch(/unique/);
});
it('allows distinct custom names and identical custom names in another channel', () => {
  expect(getWalkInValidationError({ 5: channel(custom, { ...custom, name: 'Birthday group' }) })).toBeNull();
  const one = { ticketOrder: ['entry:one'], tickets: { 'entry:one': custom } };
  expect(getWalkInValidationError({ 5: one, 8: one })).toBeNull();
});
