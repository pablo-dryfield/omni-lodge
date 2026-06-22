import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction, requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  getAffiliateOverviewController,
  updateAffiliateAssignmentsController,
} from '../controllers/affiliateController.js';

const router = Router();

router.get('/overview', authMiddleware, authorizeModuleAction('affiliate-overview', 'view'), getAffiliateOverviewController);
router.put(
  '/assignments',
  authMiddleware,
  requireRoles(['owner', 'admin', 'administrator', 'manager']),
  updateAffiliateAssignmentsController,
);

export default router;
