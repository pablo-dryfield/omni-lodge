import { Request, Response } from 'express';
import { fetchTripAdvisorRaw, TRIP_ADVISOR_PAGE_SIZE } from '../scrapers/tripAdvisorScraper.js';
import axios from 'axios';
import dotenv from 'dotenv';
import { getConfigValue } from '../services/configService.js';

const environment = (process.env.NODE_ENV || 'development').trim();
const envFile = environment === 'production' ? '.env.prod' : '.env.dev';
dotenv.config({ path: envFile });

const ACCOUNT_ID = '113350814099227260053';
const LOCATION_ID = '13077434667897843628';
const DEFAULT_GYG_ACTIVITY_URL =
  'https://www.getyourguide.com/en-gb/krakow-l40/krakow-pub-crawl-1h-open-bar-vip-entry-welcome-shots-t443425/?ranking_uuid=6bad85ec-f460-4e0a-9bb0-160af6978600';
const DEFAULT_AIRBNB_OPERATION_NAME = 'ReviewsModalContentQuery';
const DEFAULT_AIRBNB_PERSISTED_HASH = '04698412017b60fca29eb960d89ed9a84a5ea612800a3ea6964ec42c39aa4323';
const DEFAULT_AIRBNB_ACTIVITY_LISTING_ID = 'QWN0aXZpdHlMaXN0aW5nOjY4MDk5OTI=';
const DEFAULT_AIRBNB_API_KEY = 'd306zoyjsyarp7ifhu67rjxn52tv0t20';
const DEFAULT_AIRBNB_LOCALE = 'en';
const DEFAULT_AIRBNB_CURRENCY = 'PLN';

export const getAllGoogleReviews = async (req: Request, res: Response) => {
  try {
    const clientId = getConfigValue('GOOGLE_CLIENT_ID') as string | null;
    const clientSecret = getConfigValue('GOOGLE_CLIENT_SECRET') as string | null;
    const refreshToken = getConfigValue('GOOGLE_REFRESH_TOKEN') as string | null;

    if (!clientId || !clientSecret || !refreshToken) {
      res.status(400).json({ error: 'Google API credentials are not configured.' });
      return;
    }

    // Step 1: Get fresh access token
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', null, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      },
    });

    const accessToken = tokenResponse.data.access_token;
    // Step 2: Fetch reviews
    const reviewsResponse = await axios.get(
      `https://mybusiness.googleapis.com/v4/accounts/${ACCOUNT_ID}/locations/${LOCATION_ID}/reviews${req.query.pageToken ? `?pageToken=${req.query.pageToken}` : ''}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    res.status(200).json([{ data: reviewsResponse.data.reviews || [], columns: [reviewsResponse.data.nextPageToken] }]);
  } catch (error: any) {
    console.error('Error fetching reviews:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch reviews from Google' });
  }
};

// Get All Reviews
// export const getAllReviews = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const data = await Review.findAll();
//     const attributes = Review.getAttributes();
//     const columns = Object.entries(attributes)
//       .map(([key, attribute]) => {
//         return {
//           header: key.charAt(0).toUpperCase() + key.slice(1),
//           accessorKey: key,
//           type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
//         };
//       });
//     res.status(200).json([{ data, columns }]);
//   } catch (error) {
//     const e = error as ErrorWithMessage;
//     res.status(500).json([{ message: e.message }]);
//   }
// };

// // Get Review by ID
// export const getReviewById = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { id } = req.params;
//     const data = await Review.findByPk(id);

//     if (!data) {
//       res.status(404).json([{ message: 'Review not found' }]);
//       return;
//     }

//     res.status(200).json([data]);
//   } catch (error) {
//     const e = error as ErrorWithMessage;
//     res.status(500).json([{ message: e.message }]);
//   }
// };

// // Create New Review
// export const createReview = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const newReview = await Review.create(req.body);
//     res.status(201).json([newReview]);
//   } catch (error) {
//     const e = error as ErrorWithMessage;
//     res.status(500).json([{ message: e.message }]);
//   }
// };

const mapScoreToStarRating = (score?: number): "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" => {
  if (!score || score <= 1) return "ONE";
  if (score <= 2) return "TWO";
  if (score <= 3) return "THREE";
  if (score <= 4) return "FOUR";
  return "FIVE";
};

const parseLocalizedAirbnbDate = (value?: string | null): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return new Date().toISOString();
  const parsed = new Date(`${normalized} 1, 00:00:00 UTC`);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
};

const resolveStringConfig = (key: string, fallback: string): string => {
  const configuredValue = getConfigValue(key);
  if (typeof configuredValue === 'string' && configuredValue.trim().length > 0) {
    return configuredValue.trim();
  }
  return fallback;
};

export const getTripAdvisorReviews = async (req: Request, res: Response) => {
  try {
    const offsetParam =
      typeof req.query.offset === 'string' && !Number.isNaN(Number(req.query.offset))
        ? Number(req.query.offset)
        : 0;
    const safeOffset = Math.max(0, offsetParam);
    const page = await fetchTripAdvisorRaw(safeOffset);
    const normalized = (page.reviews ?? []).map((review, index) => ({
      reviewId: review.reviewId ?? `tripadvisor-${safeOffset + index}-${review.date ?? Date.now()}`,
      comment: review.description ?? "",
      createTime: review.createdDate ?? review.date ?? new Date().toISOString(),
      updateTime: review.publishedDate ?? review.date ?? new Date().toISOString(),
      starRating: mapScoreToStarRating(review.score),
      reviewer: {
        displayName: review.name ?? "TripAdvisor guest",
        profilePhotoUrl: review.profilePhotoUrl ?? "",
      },
    }));

    const nextOffset = safeOffset + normalized.length;
    res.status(200).json([{
      data: normalized,
      columns: [{
        offset: safeOffset,
        nextOffset,
        pageSize: TRIP_ADVISOR_PAGE_SIZE,
        totalCount: page.totalCount ?? normalized.length,
        hasMore: nextOffset < (page.totalCount ?? nextOffset),
      }],
    }]);
  } catch (error) {
    console.error('Error scraping TripAdvisor:', error);
    res.status(500).json({ error: 'Failed to fetch reviews from TripAdvisor' });
  }
};

export const getAirbnbReviews = async (req: Request, res: Response) => {
  try {
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.trim().length > 0
      ? req.query.cursor.trim()
      : undefined;
    const operationName = resolveStringConfig('AIRBNB_REVIEWS_OPERATION_NAME', DEFAULT_AIRBNB_OPERATION_NAME);
    const persistedHash = resolveStringConfig('AIRBNB_REVIEWS_PERSISTED_HASH', DEFAULT_AIRBNB_PERSISTED_HASH);
    const activityListingId = resolveStringConfig('AIRBNB_REVIEWS_ACTIVITY_LISTING_ID', DEFAULT_AIRBNB_ACTIVITY_LISTING_ID);
    const locale = resolveStringConfig('AIRBNB_REVIEWS_LOCALE', DEFAULT_AIRBNB_LOCALE);
    const currency = resolveStringConfig('AIRBNB_REVIEWS_CURRENCY', DEFAULT_AIRBNB_CURRENCY);
    const apiKey = resolveStringConfig('AIRBNB_REVIEWS_API_KEY', DEFAULT_AIRBNB_API_KEY);
    const reviewsEndpoint = `https://www.airbnb.com/api/v3/${operationName}/${persistedHash}`;

    const variables: Record<string, unknown> = {
      id: activityListingId,
      sort: {
        recency: 'DESCENDING',
      },
    };
    if (cursor) {
      variables.after = cursor;
    }

    const response = await axios.get(reviewsEndpoint, {
      params: {
        operationName,
        locale,
        currency,
        variables: JSON.stringify(variables),
        extensions: JSON.stringify({
          persistedQuery: {
            version: 1,
            sha256Hash: persistedHash,
          },
        }),
      },
      headers: {
        accept: 'application/json',
        'x-airbnb-api-key': apiKey,
        'x-airbnb-graphql-platform': 'web',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });

    const apiErrors = Array.isArray(response.data?.errors) ? response.data.errors : [];
    if (apiErrors.length > 0) {
      const firstError = apiErrors[0];
      const topMessage =
        typeof firstError?.message === 'string' ? firstError.message : 'unknown Airbnb API error';
      const nestedMessage =
        typeof firstError?.extensions?.response?.body?.error_message === 'string'
          ? firstError.extensions.response.body.error_message
          : null;
      throw new Error(`Airbnb API error: ${nestedMessage ?? topMessage}`);
    }

    const reviewsSearch = response.data?.data?.node?.reviewsSearch;
    const pageInfo = reviewsSearch?.pageInfo;
    const edges = Array.isArray(reviewsSearch?.edges) ? reviewsSearch.edges : [];

    const normalized = edges.map((edge: any, index: number) => {
      const review = edge?.node?.review ?? {};
      const reviewer = review?.reviewer ?? {};
      const contextualReviewer = review?.contextualReviewer ?? {};

      const displayName =
        contextualReviewer?.displayFirstName ??
        reviewer?.displayFirstName ??
        'Airbnb guest';
      const profilePhotoUrl =
        contextualReviewer?.profilePictureUrl ??
        reviewer?.presentation?.avatar?.avatarImage?.baseUrl ??
        '';

      const comment =
        review?.commentV2 ??
        review?.localizedCommentV2?.localizedStringWithTranslationPreference ??
        edge?.node?.highlightedComment ??
        '';

      const createdAt = parseLocalizedAirbnbDate(review?.localizedCreatedAtDate);

      return {
        reviewId: review?.id ?? `airbnb-${cursor ?? 'first'}-${index}-${createdAt}`,
        comment,
        createTime: createdAt,
        updateTime: createdAt,
        starRating: mapScoreToStarRating(Number(review?.rating ?? 0)),
        reviewer: {
          displayName,
          profilePhotoUrl,
        },
      };
    });

    res.status(200).json([
      {
        data: normalized,
        columns: [
          {
            cursorUsed: cursor ?? null,
            endCursor: pageInfo?.endCursor ?? null,
            hasMore: Boolean(pageInfo?.hasNextPage),
            totalCount:
              typeof pageInfo?.totalCount === 'number'
                ? pageInfo.totalCount
                : normalized.length,
          },
        ],
      },
    ]);
  } catch (error: any) {
    const details = error?.response?.data || error?.message || error;
    console.error('Error fetching Airbnb reviews:', details);
    const detailMessage = typeof error?.message === 'string' ? error.message : undefined;
    res.status(500).json({
      error: 'Failed to fetch reviews from Airbnb',
      ...(detailMessage ? { details: detailMessage } : {}),
    });
  }
};

export const getGetYourGuideReviewLink = async (_req: Request, res: Response) => {
  try {
    const configuredUrl = (getConfigValue('GYG_ACTIVITY_URL') as string | null) ?? DEFAULT_GYG_ACTIVITY_URL;
    const url = typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
      ? configuredUrl.trim()
      : DEFAULT_GYG_ACTIVITY_URL;
    res.status(200).json({ url });
  } catch (error) {
    console.error('Error resolving GetYourGuide review link:', error);
    res.status(200).json({ url: DEFAULT_GYG_ACTIVITY_URL });
  }
};
