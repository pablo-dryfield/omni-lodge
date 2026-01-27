import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { getCounterSetupCatalog } from '../controllers/catalogController.js';

const router = Router();

router.get('/counter-setup', authMiddleware, getCounterSetupCatalog);

export default router;
