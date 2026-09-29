import {
  isPubCrawlGuideUserType,
  isPubCrawlGuidingComponentName,
  shouldRoutePubCrawlGuidingToVolunteerBudget,
} from '../pubCrawlGuidingReviewTargetRoutingService.js';

describe('pub crawl guiding review-target routing', () => {
  it('identifies the regular Pub Crawl Guiding component without matching NYE', () => {
    expect(isPubCrawlGuidingComponentName('Pub Crawl Guiding')).toBe(true);
    expect(isPubCrawlGuidingComponentName('pub-crawl guiding')).toBe(true);
    expect(isPubCrawlGuidingComponentName('NYE Pub Crawl Guiding')).toBe(false);
  });

  it('accepts Pub Crawl Guide user-type slugs or names', () => {
    expect(isPubCrawlGuideUserType({
      userTypeSlug: 'pub-crawl-guide',
      userTypeName: null,
    })).toBe(true);
    expect(isPubCrawlGuideUserType({
      userTypeSlug: null,
      userTypeName: 'Pub Crawl Guides',
    })).toBe(true);
    expect(isPubCrawlGuideUserType({
      userTypeSlug: 'guide',
      userTypeName: 'Guide',
    })).toBe(false);
  });

  it('routes only long-term accommodation Pub Crawl Guides who missed the review target', () => {
    const base = {
      staffType: 'long_term',
      livesInAccom: true,
      userTypeSlug: 'pub-crawl-guide',
      userTypeName: 'Pub Crawl Guide',
      reviewPaymentOverride: false,
      totalEligibleReviews: 14,
      minReviews: 15,
    };

    expect(shouldRoutePubCrawlGuidingToVolunteerBudget(base)).toBe(true);
    expect(shouldRoutePubCrawlGuidingToVolunteerBudget({
      ...base,
      totalEligibleReviews: 15,
    })).toBe(false);
    expect(shouldRoutePubCrawlGuidingToVolunteerBudget({
      ...base,
      reviewPaymentOverride: true,
    })).toBe(false);
    expect(shouldRoutePubCrawlGuidingToVolunteerBudget({
      ...base,
      livesInAccom: false,
    })).toBe(false);
    expect(shouldRoutePubCrawlGuidingToVolunteerBudget({
      ...base,
      staffType: 'volunteer',
    })).toBe(false);
    expect(shouldRoutePubCrawlGuidingToVolunteerBudget({
      ...base,
      userTypeSlug: 'guide',
      userTypeName: 'Guide',
    })).toBe(false);
  });
});
