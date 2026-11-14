import { assertIdempotentReplay, assertProducts, commissionAfterRefund, defaultAgreement, parseAgreement, requestHash } from '../partnerPolicy';

describe('partner commercial boundaries', () => {
  it('starts with no product access, no credit and platform collection only', () => {
    expect(parseAgreement({})).toEqual(defaultAgreement);
    expect(() => assertProducts(defaultAgreement, [{ productId: 28 }])).toThrow(/outside/);
  });
  it.each([-1, 100.01, NaN, Infinity, '20'])('rejects an invalid commission: %s', commissionPercent => {
    expect(() => parseAgreement({ commissionPercent })).toThrow(/commissionPercent/);
  });
  it.each(['https://partner.example/path', 'http://partner.example', 'https://*.example', 'https://user:password@partner.example', 'https://partner.example/'])('rejects an unsafe/ambiguous iframe origin: %s', allowedOrigin => {
    expect(() => parseAgreement({ allowedOrigins: [allowedOrigin] })).toThrow();
  });
  it('does not accept hidden price or credential overrides as an agreement field', () => {
    expect(() => parseAgreement({ stripeSecret: 'secret' })).toThrow(/Unknown/);
    expect(() => parseAgreement({ paymentModes: ['mark_paid'] })).toThrow(/supported/);
  });
  it('retains distinct start times and add-on quantities in retry identity', () => {
    const a = { items: [{ productId: 28, time: '17:00', addons: [{ quantity: 1 }] }], customer: { name: 'Alex' } };
    expect(requestHash(a)).toBe(requestHash({ customer: { name: 'Alex' }, items: a.items }));
    const b = { ...a, items: [{ ...a.items[0], time: '19:30' }] };
    expect(() => assertIdempotentReplay(requestHash(a), requestHash(b))).toThrow(/already used/);
    expect(requestHash({ ...a, items: [{ ...a.items[0], addons: [{ quantity: 2 }] }] })).not.toBe(requestHash(a));
  });
  it('calculates partial/full refund allocation in currency minor units', () => {
    expect(commissionAfterRefund(125, 25, 25)).toBe(20);
    expect(commissionAfterRefund(125, 25, 125)).toBe(0);
    expect(commissionAfterRefund(99.99, 19.99, 33.33)).toBe(13.33);
    expect(commissionAfterRefund(0, 0, 0)).toBe(0);
  });
  it('rejects unauthorized package products even in otherwise valid selections', () => {
    expect(() => assertProducts({ ...defaultAgreement, productIds: [28] }, [{ productId: 28 }, { productId: 44 }])).toThrow(/outside/);
  });
});
