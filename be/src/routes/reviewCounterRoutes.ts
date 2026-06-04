import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import {
  listReviewCounters,
  createReviewCounter,
  updateReviewCounter,
  deleteReviewCounter,
  listReviewCounterEntries,
  createReviewCounterEntry,
  updateReviewCounterEntry,
  deleteReviewCounterEntry,
  getReviewCounterAnalytics,
  getReviewCounterStaffSummary,
  updateReviewCounterMonthlyApproval,
} from '../controllers/reviewCounterController.js';

const router: Router = express.Router();

const viewGuard = authorizeModuleAction('review-counter-management', 'view');
const createGuard = authorizeModuleAction('review-counter-management', 'create');
const updateGuard = authorizeModuleAction('review-counter-management', 'update');
const deleteGuard = authorizeModuleAction('review-counter-management', 'delete');

router.get('/', authMiddleware, viewGuard, listReviewCounters);
router.get('/analytics', authMiddleware, viewGuard, getReviewCounterAnalytics);
router.get('/staff-summary', authMiddleware, viewGuard, getReviewCounterStaffSummary);
router.patch('/staff-summary/:userId/approval', authMiddleware, updateGuard, updateReviewCounterMonthlyApproval);
router.post('/', authMiddleware, createGuard, createReviewCounter);
router.put('/:id', authMiddleware, updateGuard, updateReviewCounter);
router.delete('/:id', authMiddleware, deleteGuard, deleteReviewCounter);

router.get('/:id/entries', authMiddleware, viewGuard, listReviewCounterEntries);
router.post('/:id/entries', authMiddleware, createGuard, createReviewCounterEntry);
router.put('/:id/entries/:entryId', authMiddleware, updateGuard, updateReviewCounterEntry);
router.delete('/:id/entries/:entryId', authMiddleware, deleteGuard, deleteReviewCounterEntry);

export default router;
