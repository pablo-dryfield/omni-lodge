import { getConfigValue, getConfigValueRaw } from '../configService';
import {
  getStorefrontPublicConfig,
  normalizeStorefrontCancellationPolicy,
} from '../storefrontPublicConfigService';

jest.mock('../configService.js', () => ({ getConfigValue: jest.fn(), getConfigValueRaw: jest.fn() }));

const mockedGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;
const mockedGetConfigValueRaw = getConfigValueRaw as jest.MockedFunction<typeof getConfigValueRaw>;

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

  it('returns one shared public configuration object for config and product responses', () => {
    mockedGetConfigValueRaw.mockImplementation((key) => (
      key === 'STRIPE_TEST_SECRET_KEY' ? 'sk_test_example' : null
    ));
    mockedGetConfigValue.mockImplementation((key) => ({
      STOREFRONT_CANCELLATION_POLICY: {
        title: 'Cancellation policy',
        summary: 'Our complete cancellation terms.',
        items: [],
      },
      STOREFRONT_CLARITY_REPLAY_ENABLED: true,
      STOREFRONT_CLARITY_PROJECT_ID: 'clarity-project',
      STOREFRONT_CLARITY_SAMPLE_PERCENT: 20,
      STOREFRONT_CLARITY_REQUIRE_ANALYTICS_CONSENT: true,
    } as Record<string, unknown>)[key]);

    expect(getStorefrontPublicConfig()).toEqual({
      currency: 'PLN',
      stripeConfigured: true,
      stripeMode: 'test',
      checkoutEnabled: true,
      cancellationPolicy: {
        title: 'Cancellation policy',
        summary: 'Our complete cancellation terms.',
        items: [],
      },
      journeyReplay: {
        enabled: true,
        projectId: 'clarity-project',
        samplePercent: 20,
        requireAnalyticsConsent: true,
      },
    });
  });
});
