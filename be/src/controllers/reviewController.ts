import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Review from '../models/Review.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { scrapeTripAdvisor } from '../scrapers/tripAdvisorScraper.js';
import axios from 'axios';

const ACCOUNT_ID = '113350814099227260053';
const LOCATION_ID = '13077434667897843628';

export const getAllGoogleReviews = async (req: Request, res: Response) => {
  try {
    // Step 1: Get fresh access token
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', null, {
      params: {
        client_id: '306087693282-lfhmu5656j47v3a9d432asr851bibk5m.apps.googleusercontent.com',
        client_secret: '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',
        refresh_token: '1//04SBYXI7JG00bCgYIARAAGAQSNwF-L9IrzOBCKEujNHynHKaS7nOyZyh4_7j3ftIG2auTxa4tf5Oj4HWXFM2Lq-f7VbF8jKnWwzc',
        grant_type: 'refresh_token',
      },
    });

    const accessToken = tokenResponse.data.access_token;

    // Step 2: Fetch reviews
    const reviewsResponse = await axios.get(
      `https://mybusiness.googleapis.com/v4/accounts/${ACCOUNT_ID}/locations/${LOCATION_ID}/reviews`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    res.status(200).json([{ data: reviewsResponse.data.reviews || [], columns:[] }]);
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

// // Scrape
// export const scrapeTripadvisor = async (req: Request, res: Response) => {
//     try {
//       const reviews = await scrapeTripAdvisor('https://www.tripadvisor.com/AttractionProductReview-g274772-d13998447-Pub_Crawl_Krawl_Through_Krakow-Krakow_Lesser_Poland_Province_Southern_Poland.html');
//     } catch (error) {
//       console.error('Error scraping TripAdvisor:', error);
//       res.status(500).send('Error scraping TripAdvisor');
//     }
// }