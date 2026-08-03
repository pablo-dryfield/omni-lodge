import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction, requireRoles } from '../middleware/authorizationMiddleware.js';
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
const reviewManager = requireRoles(['owner', 'manager', 'admin', 'administrator']);

router.get('/', authMiddleware, viewGuard, listReviewCounters);
router.get('/analytics', authMiddleware, viewGuard, getReviewCounterAnalytics);
router.get('/staff-summary', authMiddleware, viewGuard, getReviewCounterStaffSummary);
router.patch('/staff-summary/:userId/approval', authMiddleware, reviewManager, updateGuard, updateReviewCounterMonthlyApproval);
router.post('/', authMiddleware, reviewManager, createGuard, createReviewCounter);
router.put('/:id', authMiddleware, reviewManager, updateGuard, updateReviewCounter);
router.delete('/:id', authMiddleware, reviewManager, deleteGuard, deleteReviewCounter);

router.get('/:id/entries', authMiddleware, viewGuard, listReviewCounterEntries);
router.post('/:id/entries', authMiddleware, reviewManager, createGuard, createReviewCounterEntry);
router.put('/:id/entries/:entryId', authMiddleware, reviewManager, updateGuard, updateReviewCounterEntry);
router.delete('/:id/entries/:entryId', authMiddleware, reviewManager, deleteGuard, deleteReviewCounterEntry);

export default router;
