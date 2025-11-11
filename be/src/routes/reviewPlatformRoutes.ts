import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  listReviewPlatforms,
  createReviewPlatform,
  updateReviewPlatform,
  deleteReviewPlatform,
} from '../controllers/reviewPlatformController.js';

const router: Router = express.Router();
const adminGuard = requireRoles(['admin', 'owner']);
const viewGuard = requireRoles(['admin', 'owner', 'manager', 'assistant-manager']);

router.get('/', authMiddleware, viewGuard, listReviewPlatforms);
router.post('/', authMiddleware, adminGuard, createReviewPlatform);
router.put('/:id', authMiddleware, adminGuard, updateReviewPlatform);
router.delete('/:id', authMiddleware, adminGuard, deleteReviewPlatform);

export default router;
