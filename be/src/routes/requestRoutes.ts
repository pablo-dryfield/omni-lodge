import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction, requireRoles } from '../middleware/authorizationMiddleware.js';
import { MANAGER_ROLES } from './schedulingRoles.js';
import {
  approveUserRequest,
  decideFinanceRequest,
  decideScheduleSwapRequest,
  decideScheduleShiftRequest,
  listRequests,
  rejectUserRequest,
} from '../controllers/requestController.js';

const router = Router();

router.use(authMiddleware);
router.use(authorizeModuleAction('requests-center', 'view'));

router.get('/', listRequests);

router.post('/users/:id/approve', authorizeModuleAction('requests-center', 'update'), approveUserRequest);
router.post('/users/:id/reject', authorizeModuleAction('requests-center', 'update'), rejectUserRequest);
router.post(
  '/schedule-swaps/:id/decision',
  authorizeModuleAction('requests-center', 'update'),
  requireRoles(MANAGER_ROLES),
  decideScheduleSwapRequest,
);
router.post(
  '/shift-change-requests/:id/decision',
  authorizeModuleAction('requests-center', 'update'),
  requireRoles(MANAGER_ROLES),
  decideScheduleShiftRequest,
);
router.post('/finance/:id/:action(approve|return|reject)', authorizeModuleAction('requests-center', 'update'), decideFinanceRequest);

export default router;
