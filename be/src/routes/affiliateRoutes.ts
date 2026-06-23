import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction, requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  getAffiliateOverviewController,
  updateAffiliateAssignmentsController,
  createAffiliatePayoutController,
  undoAffiliatePayoutController,
} from '../controllers/affiliateController.js';

const router = Router();

router.get('/overview', authMiddleware, authorizeModuleAction('affiliate-overview', 'view'), getAffiliateOverviewController);
router.put(
  '/assignments',
  authMiddleware,
  requireRoles(['owner', 'admin', 'administrator', 'manager']),
  updateAffiliateAssignmentsController,
);
router.post(
  '/payouts',
  authMiddleware,
  requireRoles(['owner', 'admin', 'administrator', 'manager']),
  createAffiliatePayoutController,
);
router.delete(
  '/payouts/:id',
  authMiddleware,
  requireRoles(['owner', 'admin', 'administrator', 'manager']),
  undoAffiliatePayoutController,
);

export default router;
