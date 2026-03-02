import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { getPerformanceSnapshotController } from '../controllers/performanceController.js';

const router = Router();

router.get('/snapshot', authMiddleware, requireRoles(['admin']), getPerformanceSnapshotController);

export default router;
