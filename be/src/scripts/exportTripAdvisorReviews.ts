import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchTripAdvisorRaw, TripAdvisorReview } from '../scrapers/tripAdvisorScraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_PATH = path.resolve(__dirname, '../../tripadvisor-reviews.json');
const MAX_PAGES = 200;

const PAGE_SIZE = Number.parseInt(process.env.TRIP_ADVISOR_PAGE_SIZE ?? '20', 10);

const dedupeAndFilterReviews = (
  reviews: TripAdvisorReview[],
  seen: Set<string>,
): TripAdvisorReview[] => {
  const filtered: TripAdvisorReview[] = [];
  reviews.forEach((review) => {
    const name = review.name?.trim() ?? '';
    const description = review.description?.trim() ?? '';
    if (!name || !description) {
      return;
    }
    const key = review.reviewId ?? `${name}-${description}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    filtered.push({
      ...review,
      name,
      description,
    });
  });
  return filtered;
};

const main = async () => {
  const aggregated: TripAdvisorReview[] = [];
  const seenReviews = new Set<string>();
  let offset = 0;
  let totalCount = Infinity;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    if (offset >= totalCount) break;

    console.info(`[TripAdvisor dump] Fetching reviews offset ${offset}`);
    const page = await fetchTripAdvisorRaw(offset);
    totalCount = page.totalCount ?? totalCount;
    const reviews = dedupeAndFilterReviews(page.reviews ?? [], seenReviews);
    aggregated.push(...reviews);

    if (!page.reviews?.length) {
      break;
    }

    offset += PAGE_SIZE;
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(aggregated, null, 2), { encoding: 'utf-8' });
  console.info(`Saved ${aggregated.length} TripAdvisor reviews to ${OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error('Failed to export TripAdvisor reviews:', error);
  process.exit(1);
});
