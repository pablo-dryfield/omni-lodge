import express, { Router } from 'express';

import authMiddleware from '../middleware/authMiddleware.js';
import {
  getSummary,
  createCashCollectionLog,
  getDetails,
  getBootstrap,
} from '../controllers/channelNumbersController.js';

const router: Router = express.Router();

router.get('/summary', authMiddleware, getSummary);
router.get('/bootstrap', authMiddleware, getBootstrap);
router.get('/details', authMiddleware, getDetails);
router.post('/cash-collections', authMiddleware, createCashCollectionLog);

export default router;
