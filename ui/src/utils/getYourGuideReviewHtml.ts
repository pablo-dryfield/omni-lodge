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
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const parseGetYourGuideReviewHtml = (html: string): ImportedGetYourGuideReview[] => {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const reviews: ImportedGetYourGuideReview[] = [];
  const seenIds = new Set<string>();

  document.querySelectorAll<HTMLElement>('[data-test-id="activity-review-card"]').forEach((card) => {
    const block = card.closest<HTMLElement>('[id^="reloadable-review-card-"]');
    const reviewId = block?.id.replace(/^reloadable-review-card-/, '').trim() ?? '';
    const reviewerName = normalizeText(
      card.querySelector('.review-card__author-details-name')?.textContent,
    );
    const dateLabel = normalizeText(
      card.querySelector('[date-test-id="activity-review-card-date"]')?.textContent,
    );
    const createTime = parseReviewDate(dateLabel);
    if (!reviewId || seenIds.has(reviewId) || !reviewerName || !createTime) return;

    const fullStars = card.querySelectorAll('.rating-star__icon--full').length;
    const halfStars = card.querySelectorAll('.rating-star__icon--half').length;
    const rating = fullStars + halfStars * 0.5;
    const comment = normalizeText(card.querySelector('[data-test-id="toggle-content"]')?.textContent);
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

  return reviews;
};
