import { buildPromotionTrackingModelPolicy } from '../promotionTrackingModelPolicy.js';

describe('promotion tracking model registration policy', () => {
  it('registers only read-side route models in dry-run without the live feature flag', () => {
    expect(buildPromotionTrackingModelPolicy({
      APP_RUNTIME_MODE: 'dry-run',
    })).toEqual({
      includeReadModels: true,
      includeLiveModels: false,
    });
  });

  it('never registers live mutation/session models in dry-run, even with the live flag enabled', () => {
    expect(buildPromotionTrackingModelPolicy({
      APP_RUNTIME_MODE: 'dry-run',
      FEATURE_PROMOTION_TRACKING_SERVER: 'true',
    })).toEqual({
      includeReadModels: true,
      includeLiveModels: false,
    });
  });

  it('registers read and live models together when live tracking is explicitly enabled', () => {
    expect(buildPromotionTrackingModelPolicy({
      APP_RUNTIME_MODE: 'primary',
      FEATURE_PROMOTION_TRACKING_SERVER: 'true',
    })).toEqual({
      includeReadModels: true,
      includeLiveModels: true,
    });
  });

  it('registers no promotion tracking models when neither dry-run nor live tracking is enabled', () => {
    expect(buildPromotionTrackingModelPolicy({
      APP_RUNTIME_MODE: 'primary',
    })).toEqual({
      includeReadModels: false,
      includeLiveModels: false,
    });
  });

  it('fails closed for an invalid runtime mode', () => {
    expect(() => buildPromotionTrackingModelPolicy({
      APP_RUNTIME_MODE: 'preview',
      FEATURE_PROMOTION_TRACKING_SERVER: 'true',
    })).toThrow('APP_RUNTIME_MODE is invalid');
  });
});
