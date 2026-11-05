import { inspectGetYourGuideReviewHtml, parseGetYourGuideReviewHtml } from './getYourGuideReviewHtml';

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

// Structural fixture from the current paginated-review layout, with synthetic identity/content.
const currentCard = (id = '9001', body = 'Lovely evening &amp; friendly guides!') => `
<div id="reloadable-review-card-${id}"><div data-test-id="activity-review-card">
  <div data-block-id="review-review-list-${id}-vertical-0-horizontal">
    ${Array.from({ length: 5 }, () => '<span class="i-compact-star i-star-fill-compact"></span>').join('')}
  </div>
  <div class="paginated-review-card-author">
    <span class="text-atom" data-block-id="review-review-list-${id}-vertical-2-horizontal-0-z-layout-1-text">A</span>
    <span data-block-id="review-review-list-${id}-vertical-2-horizontal-1-vertical-0-text"><span>Alex ? Poland</span></span>
    <span data-block-id="review-review-list-${id}-vertical-2-horizontal-1-vertical-1-text"><span>November 1, 2026 - Verified booking</span></span>
  </div>
  <span class="clamp-with-suffix"><span class="clamp-with-suffix-content"><span>${body}</span></span><button>Read more</button></span>
  <div class="paginated-review-card-footer">Was this helpful?</div>
</div></div>`;

test('reads a copied modern block or full page and deduplicates by provider ID', () => {
  const html = currentCard();
  const result = inspectGetYourGuideReviewHtml(`<html><body>${html}${html}</body></html>`);
  expect(result.skippedCards).toBe(0);
  expect(result.reviews).toEqual([expect.objectContaining({
    reviewId: '9001', starRating: 5, createTime: '2026-11-01T12:00:00.000Z',
    comment: 'Lovely evening & friendly guides!', reviewer: { displayName: 'Alex ? Poland', profilePhotoUrl: '' },
  })]);
});

test('finds the provider ID inside a card copied without its outer wrapper', () => {
  const html = currentCard().replace('<div id="reloadable-review-card-9001">', '').replace(/<\/div>$/, '');
  expect(parseGetYourGuideReviewHtml(html)[0].reviewId).toBe('9001');
});

test('supports rating-only cards without inventing a comment or a zero rating', () => {
  const html = currentCard().replace(/<span class="clamp-with-suffix">.*?<\/span><button>Read more<\/button><\/span>/,
    '<span data-block-id="review-review-list-9001-vertical-4-vertical-0-styled-text"><span></span></span>');
  expect(parseGetYourGuideReviewHtml(html)[0].comment).toBe('');
  const result = inspectGetYourGuideReviewHtml(html.replace(/i-star-fill-compact/g, 'unrecognized-star'));
  expect(result).toEqual({ reviews: [], skippedCards: 1 });
});

test('reports incomplete cards, impossible dates and unsupported date languages instead of silently importing them', () => {
  const invalidDate = currentCard('9002').replace('November 1, 2026', 'February 31, 2026');
  const unsupportedDate = currentCard('9003').replace('November 1, 2026', '1 listopada 2026');
  const partial = currentCard('9004').replace(/<span class="clamp-with-suffix">.*?<\/span><button>Read more<\/button><\/span>/, '');
  const result = inspectGetYourGuideReviewHtml(currentCard() + invalidDate + unsupportedDate + partial);
  expect(result.reviews).toHaveLength(1);
  expect(result.skippedCards).toBe(3);
});


test('a photo gallery can shift the rating-only comment block without losing the review', () => {
  const html = currentCard().replace(/<span class="clamp-with-suffix">.*?<\/span><button>Read more<\/button><\/span>/,
    '<div class="paginated-review-card-images"></div><span data-block-id="review-review-list-9001-vertical-6-vertical-0-styled-text"></span>');
  expect(inspectGetYourGuideReviewHtml(html)).toEqual({ reviews: [expect.objectContaining({ reviewId: '9001', comment: '' })], skippedCards: 0 });
});
