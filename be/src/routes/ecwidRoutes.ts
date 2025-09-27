import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { getManifest, getOrders } from '../controllers/ecwidController.js';

const router = Router();

router.get('/orders', authMiddleware, getOrders);
router.get('/manifest', authMiddleware, getManifest);

export default router;
