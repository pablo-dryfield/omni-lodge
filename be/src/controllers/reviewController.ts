import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Review from '../models/Review.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { scrapeTripAdvisor } from '../scrapers/tripAdvisorScraper.js';

// Get All Reviews
export const getAllReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await Review.findAll();
    const attributes = Review.getAttributes();
    const columns = Object.entries(attributes)
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Get Review by ID
export const getReviewById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await Review.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Review not found' }]);
      return;
    }

    res.status(200).json([data]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Create New Review
export const createReview = async (req: Request, res: Response): Promise<void> => {
  try {
    const newReview = await Review.create(req.body);
    res.status(201).json([newReview]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Scrape
export const scrapeTripadvisor = async (req: Request, res: Response) => {
    try {
      const reviews = await scrapeTripAdvisor('https://www.tripadvisor.com/AttractionProductReview-g274772-d13998447-Pub_Crawl_Krawl_Through_Krakow-Krakow_Lesser_Poland_Province_Southern_Poland.html');
    } catch (error) {
      console.error('Error scraping TripAdvisor:', error);
      res.status(500).send('Error scraping TripAdvisor');
    }
}