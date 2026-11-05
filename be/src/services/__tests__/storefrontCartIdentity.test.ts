import { normalizedCartPhone, resolveCartIdentity, sameCartExperiences } from '../storefrontCartIdentity';

const customer = { fullName: 'Alex Smith', email: 'alex@example.com', phoneCountry: 'PL', phone: '500100200' };
const candidate = (id: number, details = customer) => ({ id, customer: details });
const item = { productId: 28, quantity: 2, experienceDate: '2026-11-14', experienceTime: '21:00' };

describe('cart customer matching priority', () => {
  it('prefers email and does not combine a different phone-only result', () => {
    const email = candidate(1, { ...customer, email: ' ALEX@EXAMPLE.COM ', phone: '600100200' });
    const phone = candidate(2, { ...customer, email: 'different@example.com' });
    expect(resolveCartIdentity(customer, [phone, email])).toEqual({ kind: 'matched', matchedBy: 'email', carts: [email] });
  });

  it('falls back to the international phone number when no email matches', () => {
    const phone = candidate(2, { ...customer, email: 'different@example.com', phone: '+48 500 100 200' });
    expect(resolveCartIdentity(customer, [phone])).toEqual({ kind: 'matched', matchedBy: 'phone', carts: [phone] });
    expect(normalizedCartPhone({ phone: '0048 500 100 200' })).toBe('+48500100200');
  });

  it('does not merge one or several exact-name matches without matching contact details', () => {
    const names = [candidate(1, { ...customer, fullName: ' alex   SMITH ', email: 'other@example.com', phone: '600100200' }),
      candidate(2, { ...customer, email: 'another@example.com', phone: '700100200' })];
    expect(resolveCartIdentity(customer, names).kind).toBe('name_only');
    expect(resolveCartIdentity(customer, names.slice(0, 1)).kind).toBe('name_only');
  });

  it('does not treat missing or invalid contact details as an identity match', () => {
    expect(resolveCartIdentity({}, [{ customer: {} }]).kind).toBe('none');
    expect(normalizedCartPhone({ phone: '123' })).toBe('');
    expect(normalizedCartPhone({ phone: '500100200' })).toBe('');
  });
});

describe('paid experience matching for cart recovery', () => {
  it('ignores guest counts, discounts, add-ons and contact edits', () => {
    expect(sameCartExperiences({ items: [item], discountCode: 'STUDENT' }, {
      items: [{ ...item, quantity: 5, options: { fullName: 'Different spelling' } }],
    })).toBe(true);
  });

  it.each([
    { experienceDate: '2026-11-15' }, { experienceTime: '19:30' }, { productId: 99 },
  ])('keeps a cart for a different experience: %j', difference => {
    expect(sameCartExperiences({ items: [item] }, { items: [{ ...item, ...difference }] })).toBe(false);
  });

  it('requires coverage of every experience in a multi-item cart', () => {
    const second = { ...item, experienceDate: '2026-11-15' };
    expect(sameCartExperiences({ items: [item, second] }, { items: [item] })).toBe(false);
    expect(sameCartExperiences({ items: [item, second] }, { items: [second, { ...item, quantity: 1 }] })).toBe(true);
  });

  it('does not guess when an experience date or time is absent', () => {
    expect(sameCartExperiences({ items: [] }, { items: [] })).toBe(false);
    expect(sameCartExperiences({ items: [{ ...item, experienceDate: null }] }, { items: [item] })).toBe(false);
    expect(sameCartExperiences({ items: [{ ...item, experienceTime: null }] }, { items: [item] })).toBe(false);
  });
});
