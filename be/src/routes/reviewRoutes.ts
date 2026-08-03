import express, { Router } from 'express';
import * as reviewController from '../controllers/reviewController.js'; // Adjust import path as necessary
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import {completeReviewSync,createManualReviewCredit,getReviewCreditSummary,getReviewTrends,ingestReviewSyncPage,listArchivedReviews,replaceReviewAssignments,startReviewSync,updateReviewFlags} from '../controllers/reviewArchiveController.js';

const router: Router = express.Router();
const archiveView=authorizeModuleAction('review-counter-management','view');
const archiveCreate=authorizeModuleAction('review-counter-management','create');
const archiveUpdate=authorizeModuleAction('review-counter-management','update');

// Get all reviews
// router.get('/', reviewController.getAllReviews);

// // Get a single review by ID
// router.get('/:id', reviewController.getReviewById);

// // Create a new review
// router.post('/', reviewController.createReview);

router.get('/tripadvisorReviews', authMiddleware, reviewController.getTripAdvisorReviews);
router.get('/airbnbReviews', authMiddleware, reviewController.getAirbnbReviews);

// Google revies
router.get('/googleReviews', authMiddleware, reviewController.getAllGoogleReviews);
router.get('/getyourguideLink', authMiddleware, reviewController.getGetYourGuideReviewLink);
router.get('/archive',authMiddleware,archiveView,listArchivedReviews);
router.get('/archive/trends',authMiddleware,archiveView,getReviewTrends);
router.post('/archive/sync/start',authMiddleware,archiveCreate,startReviewSync);
router.post('/archive/sync/:runId/page',authMiddleware,archiveCreate,ingestReviewSyncPage);
router.post('/archive/sync/:runId/complete',authMiddleware,archiveCreate,completeReviewSync);
router.put('/archive/:id/assignments',authMiddleware,archiveUpdate,replaceReviewAssignments);
router.put('/archive/:id/flags',authMiddleware,archiveUpdate,updateReviewFlags);
router.post('/archive/manual-credits',authMiddleware,archiveCreate,createManualReviewCredit);
router.get('/archive/summary',authMiddleware,archiveView,getReviewCreditSummary);

export default router;
