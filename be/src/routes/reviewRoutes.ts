import express, { Request, Response, NextFunction, Router } from 'express';
import * as reviewController from '../controllers/reviewController.js'; // Adjust import path as necessary
import authMiddleware from '../middleware/authMiddleware.js';

const router: Router = express.Router();

// Get all reviews
// router.get('/', reviewController.getAllReviews);

// // Get a single review by ID
// router.get('/:id', reviewController.getReviewById);

// // Create a new review
// router.post('/', reviewController.createReview);

// // Scrape Tripadvisor
// router.get('/scrape/Tripadvisor', reviewController.scrapeTripadvisor);

// Google revies
router.get('/googleReviews', authMiddleware, reviewController.getAllGoogleReviews);

export default router;
