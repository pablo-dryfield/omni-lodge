import express, { Request, Response, NextFunction, Router } from 'express';
import * as reviewController from '../controllers/reviewController.js'; // Adjust import path as necessary

const router: Router = express.Router();

// Get all reviews
router.get('/', reviewController.getAllReviews);

// Get a single review by ID
router.get('/:id', reviewController.getReviewById);

// Create a new review
router.post('/', reviewController.createReview);

// Scrape Tripadvisor
router.get('/scrape/Tripadvisor', reviewController.scrapeTripadvisor);

export default router;
