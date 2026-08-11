import { normalizeStorefrontCancellationPolicy } from '../storefrontPublicConfigService';

jest.mock('../configService.js', () => ({ getConfigValue: jest.fn() }));

describe('normalizeStorefrontCancellationPolicy', () => {
  it('returns no policy for missing configuration', () => {
    expect(normalizeStorefrontCancellationPolicy(null)).toBeNull();
  });

  it('returns no policy when required content is missing', () => {
    expect(normalizeStorefrontCancellationPolicy({ title: 'Cancellation policy' })).toBeNull();
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
    expect(policy.items).toEqual([]);
  });

  it('keeps an edited policy without items summary-only', () => {
    const policy = normalizeStorefrontCancellationPolicy({
      title: 'Cancellation policy',
      summary: 'Our complete cancellation terms.',
    });
    expect(policy.items).toEqual([]);
  });
});
