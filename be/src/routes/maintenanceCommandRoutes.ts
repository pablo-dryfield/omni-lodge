import { Router } from 'express';

import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { runMaintenanceCommandHandler } from '../controllers/maintenanceCommandController.js';

const router = Router();

router.post(
  '/commands',
  authMiddleware,
  requireRoles(['admin', 'owner']),
  runMaintenanceCommandHandler,
);

export default router;
