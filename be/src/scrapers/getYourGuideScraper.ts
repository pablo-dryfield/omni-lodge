import puppeteer from 'puppeteer';
import { getConfigValue } from '../services/configService.js';

export const GET_YOUR_GUIDE_PAGE_SIZE = 3;

type ReviewBlock = {
  type?: string;
  reviewId?: number | string;
  rating?: number;
  activityId?: number;
  author?: { title?: { text?: string }; subtitle?: { text?: string } };
  message?: { text?: string };
  travelerType?: string;
  travelerTypeLabel?: { text?: string };
  onImpressionTrackingEvent?: {
    properties?: { review_date?: string; countryCode?: string; language?: string };
  };
};

export type GetYourGuideReview = {
  reviewId: string;
  comment: string;
  createTime: string;
  updateTime: string;
  starRating: number;
  reviewer: { displayName: string; profilePhotoUrl: string };
  activityId?: number;
  travelerType?: string;
  travelerTypeLabel?: string;
  countryCode?: string;
  language?: string;
};

const resolveActivity = () => {
  const configured = getConfigValue('GYG_ACTIVITY_URL');
  const url = typeof configured === 'string' ? configured.trim() : '';
  const match = url.match(/-t(\d+)(?:[/?]|$)/i);
  if (!url || !match) throw new Error('GYG_ACTIVITY_URL must contain a GetYourGuide activity ID (for example, -t443425).');
  return { url, activityId: Number(match[1]) };
};

const collectReviewBlocks = (value: unknown, target: ReviewBlock[] = []): ReviewBlock[] => {
  if (!value || typeof value !== 'object') return target;
  const record = value as Record<string, unknown>;
  if (record.type === 'review' && record.reviewId != null) target.push(record as ReviewBlock);
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) nested.forEach(item => collectReviewBlocks(item, target));
    else if (nested && typeof nested === 'object') collectReviewBlocks(nested, target);
  }
  return target;
};

const normalizeReview = (review: ReviewBlock): GetYourGuideReview => {
  const tracking = review.onImpressionTrackingEvent?.properties;
  const parsedDate = tracking?.review_date ? new Date(tracking.review_date) : new Date(review.author?.subtitle?.text ?? '');
  const date = Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
  return {
    reviewId: String(review.reviewId),
    comment: review.message?.text ?? '',
    createTime: date,
    updateTime: date,
    starRating: Number(review.rating ?? 0),
    reviewer: { displayName: review.author?.title?.text?.trim() || 'GetYourGuide traveler', profilePhotoUrl: '' },
    activityId: review.activityId,
    travelerType: review.travelerType,
    travelerTypeLabel: review.travelerTypeLabel?.text,
    countryCode: tracking?.countryCode,
    language: tracking?.language,
  };
};

export const fetchGetYourGuideReviews = async (offset = 0) => {
  const { url, activityId } = resolveActivity();
  const safeOffset = Math.max(0, Math.floor(offset));
  const activityUrl = new URL(url);
  activityUrl.search = '';
  activityUrl.searchParams.set('locale_autoredirect_optout', 'true');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36');
    const navigation = await page.goto(activityUrl.toString(), { waitUntil: 'networkidle2', timeout: 60_000 });
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += 800) {
        window.scrollTo(0, y);
        await new Promise(resolve => window.setTimeout(resolve, 80));
      }
    });
    try {
      await page.waitForSelector('button[data-test-id="see-more-reviews-button"], .show-more__label', { timeout: 45_000 });
    } catch {
      throw new Error(
        `GetYourGuide reviews did not render (HTTP ${navigation?.status() ?? 'unknown'}, title: ${await page.title()}, URL: ${page.url()})`,
      );
    }
    if (!await page.$('.show-more__label')) {
      await page.click('button[data-test-id="see-more-reviews-button"]');
      await page.waitForSelector('.show-more__label', { timeout: 15_000 });
    }

    const totalCount = await page.evaluate(() => {
      for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
        try {
          const parsed = JSON.parse(script.textContent ?? '{}');
          const entries = Array.isArray(parsed) ? parsed : [parsed];
          for (const entry of entries) {
            const count = Number(entry?.aggregateRating?.reviewCount);
            if (Number.isFinite(count)) return count;
          }
        } catch { /* Ignore unrelated structured-data blocks. */ }
      }
      return 0;
    });

    await page.setRequestInterception(true);
    page.on('request', request => {
      if (!request.url().includes('/user-interface/activity-details-page/blocks') || request.method() !== 'POST') {
        void request.continue();
        return;
      }
      try {
        const body = JSON.parse(request.postData() ?? '{}');
        body.payload = {
          ...body.payload,
          activityId,
          contentIdentifier: 'next-reviews-page',
          reviewsOffset: safeOffset,
          reviewsLimit: GET_YOUR_GUIDE_PAGE_SIZE,
        };
        const headers = { ...request.headers() };
        delete headers['content-length'];
        void request.continue({ postData: JSON.stringify(body), headers });
      } catch {
        void request.continue();
      }
    });

    const responsePayload = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for GetYourGuide reviews')), 30_000);
      page.on('response', async response => {
        if (!response.url().includes('/user-interface/activity-details-page/blocks') || response.request().method() !== 'POST') return;
        clearTimeout(timer);
        if (!response.ok()) {
          reject(new Error(`GetYourGuide reviews request failed with HTTP ${response.status()}`));
          return;
        }
        try { resolve(await response.json()); } catch (error) { reject(error); }
      });
    });

    const clicked = await page.evaluate(() => {
      const paginationLabel = document.querySelector('.show-more__label');
      const button = paginationLabel?.closest('button');
      if (!button) return false;
      (button as HTMLButtonElement).click();
      return true;
    });
    if (!clicked) throw new Error('GetYourGuide review pagination control was not found');

    const payload = await responsePayload;
    const reviews = collectReviewBlocks(payload).map(normalizeReview);
    return {
      reviews,
      totalCount: totalCount || safeOffset + reviews.length,
      nextOffset: safeOffset + reviews.length,
      hasMore: totalCount ? safeOffset + reviews.length < totalCount : reviews.length === GET_YOUR_GUIDE_PAGE_SIZE,
    };
  } finally {
    await browser.close();
  }
};
