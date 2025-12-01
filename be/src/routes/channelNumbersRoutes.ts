import express, { Router } from 'express';

import authMiddleware from '../middleware/authMiddleware.js';
import { getSummary, createCashCollectionLog } from '../controllers/channelNumbersController.js';

const router: Router = express.Router();

router.get('/summary', authMiddleware, getSummary);
router.post('/cash-collections', authMiddleware, createCashCollectionLog);

export default router;
