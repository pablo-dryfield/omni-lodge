import express from 'express';

import authMiddleware from '../middleware/authMiddleware.js';
import { listAddons } from '../controllers/addonController.js';

const router = express.Router();

router.get('/', authMiddleware, listAddons);

export default router;
