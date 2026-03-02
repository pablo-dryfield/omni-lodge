import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  captureHeapSnapshotController,
  getPerformanceSnapshotController,
  runPerformanceExplainController,
} from '../controllers/performanceController.js';

const router = Router();

router.get('/snapshot', authMiddleware, requireRoles(['admin']), getPerformanceSnapshotController);
router.post('/explain', authMiddleware, requireRoles(['admin']), runPerformanceExplainController);
router.post('/heap-snapshot', authMiddleware, requireRoles(['admin']), captureHeapSnapshotController);

export default router;
