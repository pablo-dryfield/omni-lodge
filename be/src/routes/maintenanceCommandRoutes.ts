import { Router } from 'express';

import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { getMaintenanceCommandJobHandler, runMaintenanceCommandHandler } from '../controllers/maintenanceCommandController.js';

const router = Router();

router.post(
  '/commands',
  authMiddleware,
  requireRoles(['admin', 'owner']),
  runMaintenanceCommandHandler,
);
router.get(
  '/commands/:jobId',
  authMiddleware,
  requireRoles(['admin', 'owner']),
  getMaintenanceCommandJobHandler,
);

export default router;
