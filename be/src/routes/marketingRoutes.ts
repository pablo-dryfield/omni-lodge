import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { getMarketingOverviewController } from '../controllers/marketingController.js';

const router = Router();

router.get('/overview', authMiddleware, getMarketingOverviewController);

export default router;
