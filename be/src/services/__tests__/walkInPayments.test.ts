import { isReceivedWalkInCash, normalizeWalkInPaymentNotes, receivedCashByCurrency } from '../walkInPaymentUtils';

const methods = [{ id: 4, name: 'Cash' }, { id: 2, name: 'Bank Transfer' }];
const note = (tickets: unknown[]) => `Staff note\n-- CASH-SNAPSHOT START --\n${JSON.stringify({ version: 3, channels: { '5': { currency: 'PLN', amount: 220, qty: 2, tickets } } })}\n-- CASH-SNAPSHOT END --\nEnd note`;
const ticket = () => ({ key: 'entry:one', name: 'Normal', ticketType: 'normal', paymentMethodId: 2, paymentMethodName: 'Cash', paymentStatus: 'awaiting', currencies: [{ currency: 'PLN', people: 2, cash: 220, addons: {} }] });

describe('Walk-Ins payment accounting', () => {
  it('does not treat awaiting payments or received transfers/cards as physical cash', () => {
    expect(isReceivedWalkInCash({ paymentMethodName: 'Cash', paymentStatus: 'awaiting' })).toBe(false);
    expect(isReceivedWalkInCash({ paymentMethodName: 'Bank Transfer', paymentStatus: 'received' })).toBe(false);
    expect(isReceivedWalkInCash({ paymentMethodName: 'Online/Card', paymentStatus: 'received' })).toBe(false);
    expect(isReceivedWalkInCash({ paymentMethodName: 'Cash', paymentStatus: 'received' })).toBe(true);
  });
  it('preserves legacy cash behavior and recognizes the old custom transfer checkbox', () => {
    expect(isReceivedWalkInCash({})).toBe(true);
    expect(isReceivedWalkInCash({ transfer: true })).toBe(false);
    expect(receivedCashByCurrency({ currency: 'PLN', amount: 80 })).toEqual(new Map([['PLN', 80]]));
  });
  it('keeps currencies separate and never falls back to gross sales for non-cash tickets', () => {
    expect(receivedCashByCurrency({ currency: 'PLN', amount: 500, tickets: [
      { paymentMethodName: 'Cash', currencies: [{ currency: 'PLN', cash: 110 }, { currency: 'EUR', cash: 26 }] },
      { paymentStatus: 'awaiting', currencies: [{ currency: 'PLN', cash: 220 }] },
      { paymentMethodName: 'Bank Transfer', currencies: [{ currency: 'PLN', cash: 110 }] },
    ] })).toEqual(new Map([['PLN', 110], ['EUR', 26]]));
    expect(receivedCashByCurrency({ currency: 'PLN', amount: 220, tickets: [{ paymentStatus: 'awaiting', currencies: [{ currency: 'PLN', cash: 220 }] }] }).size).toBe(0);
  });
  it('uses the configured method name and preserves outstanding guests, amounts and surrounding notes', () => {
    const result = normalizeWalkInPaymentNotes(note([ticket()]), methods)!;
    expect(result).toContain('Staff note'); expect(result).toContain('End note');
    expect(result).toContain('"paymentMethodName":"Bank Transfer"');
    expect(result).toContain('"paymentStatus":"awaiting"');
    expect(result).toContain('"people":2'); expect(result).toContain('"cash":220');
  });
  it.each([
    { paymentMethodId: 99 }, { paymentStatus: 'paid-ish' }, { name: '' }, { ticketType: 42 },
    { currencies: [{ currency: 'PLN', people: 0, cash: 110, addons: {} }] },
    { currencies: [{ currency: 'PLN', people: 1, cash: 0, addons: {} }] },
    { currencies: [{ currency: 'PLN', people: 1, cash: 110, addons: { '1': -2 } }] },
  ])('rejects an invalid new entry before saving: %j', (change) => {
    expect(() => normalizeWalkInPaymentNotes(note([{ ...ticket(), ...change }]), methods)).toThrow();
  });
  it('rejects duplicate type/currency combinations and duplicate entry IDs', () => {
    expect(() => normalizeWalkInPaymentNotes(note([ticket(), { ...ticket(), key: 'entry:two', name: 'Different label', paymentMethodId: 4 }]), methods)).toThrow('already added');
    expect(() => normalizeWalkInPaymentNotes(note([ticket(), ticket()]), methods)).toThrow('Duplicate');
  });
  it('allows the same standard type in different currencies or channels', () => {
    const eur = { ...ticket(), key: 'entry:two', currencies: [{ currency: 'EUR', people: 1, cash: 25, addons: {} }] };
    expect(() => normalizeWalkInPaymentNotes(note([ticket(), eur]), methods)).not.toThrow();
    const channels = { 5: { tickets: [ticket()] }, 8: { tickets: [ticket()] } };
    expect(() => normalizeWalkInPaymentNotes(`-- CASH-SNAPSHOT START --\n${JSON.stringify({ version: 3, channels })}\n-- CASH-SNAPSHOT END --`, methods)).not.toThrow();
  });
  it('prevents a new entry from duplicating a legacy type and currency', () => {
    const legacy = { key: 'Normal', name: 'Normal', currencies: [{ currency: 'PLN', people: 1, cash: 100, addons: {} }] };
    expect(() => normalizeWalkInPaymentNotes(note([legacy, ticket()]), methods)).toThrow('already added');
  });
  it.each(['Private group', ' PRIVATE   group ', 'Ｐｒｉｖａｔｅ group'])('rejects ambiguous custom names: %s', name => {
    const custom = { ...ticket(), name: 'Private group', ticketType: 'custom' };
    expect(() => normalizeWalkInPaymentNotes(note([custom, { ...custom, key: 'entry:two', name }]), methods)).toThrow('unique ticket name');
  });
  it('requires custom names to differ across currencies and from standard names', () => {
    const custom = { ...ticket(), key: 'entry:two', ticketType: 'custom', name: ' normal ' };
    expect(() => normalizeWalkInPaymentNotes(note([ticket(), custom]), methods)).toThrow('unique ticket name');
    expect(() => normalizeWalkInPaymentNotes(note([custom, { ...custom, key: 'entry:three', currencies: [{ currency: 'EUR', people: 1, cash: 25, addons: {} }] }]), methods)).toThrow('unique ticket name');
  });
  it('allows custom tickets with distinct names in the same currency', () => {
    const custom = { ...ticket(), ticketType: 'custom', name: 'Private group' };
    expect(() => normalizeWalkInPaymentNotes(note([custom, { ...custom, key: 'entry:two', name: 'Birthday group' }]), methods)).not.toThrow();
  });
  it('does not require new payment metadata on historical entries', () => {
    const legacy = { key: 'Old ticket', name: 'Old ticket', currencies: [{ currency: 'PLN', cash: 81.45, people: 1, addons: {} }] };
    expect(normalizeWalkInPaymentNotes(note([legacy]), methods)).toContain('81.45');
  });
});
