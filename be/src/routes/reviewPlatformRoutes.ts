import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import {
  listReviewPlatforms,
  createReviewPlatform,
  updateReviewPlatform,
  deleteReviewPlatform,
} from '../controllers/reviewPlatformController.js';

const router: Router = express.Router();
const viewGuard = authorizeModuleAction('review-platform-management', 'view');
const createGuard = authorizeModuleAction('review-platform-management', 'create');
const updateGuard = authorizeModuleAction('review-platform-management', 'update');
const deleteGuard = authorizeModuleAction('review-platform-management', 'delete');

router.get('/', authMiddleware, viewGuard, listReviewPlatforms);
router.post('/', authMiddleware, createGuard, createReviewPlatform);
router.put('/:id', authMiddleware, updateGuard, updateReviewPlatform);
router.delete('/:id', authMiddleware, deleteGuard, deleteReviewPlatform);

export default router;
