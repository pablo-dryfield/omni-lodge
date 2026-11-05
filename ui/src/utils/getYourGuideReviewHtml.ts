export type ImportedGetYourGuideReview = {
  reviewId: string;
  comment: string;
  createTime: string;
  updateTime: string;
  starRating: number;
  reviewer: { displayName: string; profilePhotoUrl: string };
  importedFromHtml: true;
};

const MONTHS = new Map([
  ['january', 0], ['february', 1], ['march', 2], ['april', 3],
  ['may', 4], ['june', 5], ['july', 6], ['august', 7],
  ['september', 8], ['october', 9], ['november', 10], ['december', 11],
]);

const normalizeText = (value: string | null | undefined): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim();

const parseReviewDate = (label: string): string | null => {
  const match = label.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  const month = match ? MONTHS.get(match[1].toLowerCase()) : undefined;
  if (!match || month == null) return null;
  const date = new Date(Date.UTC(Number(match[3]), month, Number(match[2]), 12));
  return date.getUTCMonth() !== month || date.getUTCDate() !== Number(match[2])
    ? null : date.toISOString();
};

export const inspectGetYourGuideReviewHtml = (html: string) => {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const reviews: ImportedGetYourGuideReview[] = [];
  const seenIds = new Set<string>();
  let skippedCards = 0;

  document.querySelectorAll<HTMLElement>('[data-test-id="activity-review-card"]').forEach((card) => {
    const block = card.closest<HTMLElement>('[id^="reloadable-review-card-"]');
    // A copied card may omit its reloadable wrapper. Its child block IDs retain
    // the same provider ID; never manufacture IDs from names or review text.
    const reviewId = block?.id.match(/^reloadable-review-card-(\d+)$/)?.[1]
      ?? card.querySelector('[data-block-id^="review-review-list-"]')
        ?.getAttribute('data-block-id')?.match(/^review-review-list-(\d+)-/)?.[1] ?? '';
    if (reviewId && seenIds.has(reviewId)) return;
    const reviewerName = normalizeText(
      card.querySelector('.review-card__author-details-name, .paginated-review-card-author [data-block-id$="-1-vertical-0-text"]')?.textContent,
    );
    const dateLabel = normalizeText(
      card.querySelector('[date-test-id="activity-review-card-date"], [data-test-id="activity-review-card-date"], .paginated-review-card-author [data-block-id$="-1-vertical-1-text"]')?.textContent,
    );
    const createTime = parseReviewDate(dateLabel);
    const fullStars = card.querySelectorAll('.rating-star__icon--full, .i-star-fill-compact').length;
    const halfStars = card.querySelectorAll('.rating-star__icon--half, .i-star-half-compact').length;
    const rating = fullStars + halfStars * 0.5;
    const commentElement = card.querySelector('[data-test-id="toggle-content"], .clamp-with-suffix-content, [data-block-id^="review-review-list-"][data-block-id$="-vertical-0-styled-text"]');
    // A present empty comment is a valid rating-only review. A missing comment
    // element may mean the copied card is incomplete; do not erase saved text.
    if (!reviewId || !reviewerName || !createTime || rating < 1 || rating > 5 || !commentElement) {
      skippedCards += 1;
      return;
    }
    const comment = normalizeText(commentElement.textContent);
    seenIds.add(reviewId);
    reviews.push({
      reviewId,
      comment,
      createTime,
      updateTime: createTime,
      starRating: rating,
      reviewer: { displayName: reviewerName, profilePhotoUrl: '' },
      importedFromHtml: true,
    });
  });

  return { reviews, skippedCards };
};

export const parseGetYourGuideReviewHtml = (html: string): ImportedGetYourGuideReview[] =>
  inspectGetYourGuideReviewHtml(html).reviews;
