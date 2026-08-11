import {
  DEFAULT_STOREFRONT_CANCELLATION_POLICY,
  normalizeStorefrontCancellationPolicy,
} from '../storefrontPublicConfigService';

jest.mock('../configService.js', () => ({ getConfigValue: jest.fn() }));

describe('normalizeStorefrontCancellationPolicy', () => {
  it('returns the global default for missing configuration', () => {
    expect(normalizeStorefrontCancellationPolicy(null)).toEqual(
      DEFAULT_STOREFRONT_CANCELLATION_POLICY,
    );
  });

  it('normalizes an editable cancellation policy', () => {
    expect(
      normalizeStorefrontCancellationPolicy({
        title: 'Flexible cancellation',
        summary: 'Cancel early for a refund.',
        items: [{ title: 'Before 24 hours', description: 'Full refund.' }],
      }),
    ).toEqual({
      title: 'Flexible cancellation',
      summary: 'Cancel early for a refund.',
      items: [{ title: 'Before 24 hours', description: 'Full refund.' }],
    });
  });

  it('drops malformed items instead of exposing invalid public data', () => {
    const policy = normalizeStorefrontCancellationPolicy({
      title: 'Cancellation policy',
      summary: 'Our terms.',
      items: [{ title: 'Incomplete' }, null],
    });
    expect(policy.items).toEqual(DEFAULT_STOREFRONT_CANCELLATION_POLICY.items);
  });
});
