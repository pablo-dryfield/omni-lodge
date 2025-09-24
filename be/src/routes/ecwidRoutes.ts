import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { getOrders } from '../controllers/ecwidController.js';

const router = Router();

router.get('/orders', authMiddleware, getOrders);

export default router;