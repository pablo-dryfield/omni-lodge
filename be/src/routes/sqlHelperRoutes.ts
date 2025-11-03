import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { executeSql } from '../controllers/sqlHelperController.js';

const router = Router();

router.post(
  '/execute',
  authMiddleware,
  requireRoles(['admin']),
  executeSql,
);

export default router;
