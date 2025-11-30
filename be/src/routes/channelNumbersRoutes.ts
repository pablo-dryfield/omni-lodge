import express, { Router } from 'express';

import authMiddleware from '../middleware/authMiddleware.js';
import { getSummary } from '../controllers/channelNumbersController.js';

const router: Router = express.Router();

router.get('/summary', authMiddleware, getSummary);

export default router;
