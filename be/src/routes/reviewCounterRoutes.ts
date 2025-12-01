import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
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

const roleGuard = requireRoles(['admin', 'owner', 'manager', 'assistant-manager']);

router.get('/', authMiddleware, roleGuard, listReviewCounters);
router.get('/analytics', authMiddleware, roleGuard, getReviewCounterAnalytics);
router.get('/staff-summary', authMiddleware, roleGuard, getReviewCounterStaffSummary);
router.patch('/staff-summary/:userId/approval', authMiddleware, roleGuard, updateReviewCounterMonthlyApproval);
router.post('/', authMiddleware, roleGuard, createReviewCounter);
router.put('/:id', authMiddleware, roleGuard, updateReviewCounter);
router.delete('/:id', authMiddleware, roleGuard, deleteReviewCounter);

router.get('/:id/entries', authMiddleware, roleGuard, listReviewCounterEntries);
router.post('/:id/entries', authMiddleware, roleGuard, createReviewCounterEntry);
router.put('/:id/entries/:entryId', authMiddleware, roleGuard, updateReviewCounterEntry);
router.delete('/:id/entries/:entryId', authMiddleware, roleGuard, deleteReviewCounterEntry);

export default router;
