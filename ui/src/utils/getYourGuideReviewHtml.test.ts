import { parseGetYourGuideReviewHtml } from './getYourGuideReviewHtml';

describe('parseGetYourGuideReviewHtml', () => {
  it('extracts and deduplicates saved GetYourGuide review cards', () => {
    const card = `
      <div id="reloadable-review-card-127289978">
        <section data-test-id="activity-review-card">
          <div data-test-id="activity-review-card-rating">
            <span class="rating-star__icon--full"></span>
            <span class="rating-star__icon--full"></span>
            <span class="rating-star__icon--full"></span>
            <span class="rating-star__icon--full"></span>
            <span class="rating-star__icon--full"></span>
          </div>
          <span class="review-card__author-details-name">Maia Sanmartín – Spain</span>
          <span date-test-id="activity-review-card-date">September 1, 2026 - Verified booking</span>
          <div data-test-id="toggle-content"> A wonderful   evening! </div>
        </section>
      </div>`;

    const reviews = parseGetYourGuideReviewHtml(`${card}${card}`);

    expect(reviews).toEqual([{
      reviewId: '127289978',
      comment: 'A wonderful evening!',
      createTime: '2026-09-01T12:00:00.000Z',
      updateTime: '2026-09-01T12:00:00.000Z',
      starRating: 5,
      reviewer: { displayName: 'Maia Sanmartín – Spain', profilePhotoUrl: '' },
      importedFromHtml: true,
    }]);
  });

  it('ignores cards without a stable ID or parseable date', () => {
    expect(parseGetYourGuideReviewHtml(`
      <section data-test-id="activity-review-card">
        <span class="review-card__author-details-name">Traveler</span>
      </section>
    `)).toEqual([]);
  });
});
