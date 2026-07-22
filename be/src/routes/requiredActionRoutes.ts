import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import {
  completeProfileFieldsAction,
  completeRequiredAction,
  createRequiredAction,
  decideManagerSwapRequiredAction,
  listMyRequiredActions,
  respondToSwapRequiredAction,
} from '../controllers/requiredActionController.js';

const router = Router();

router.use(authMiddleware);

router.get('/me', listMyRequiredActions);
router.post('/actions', authorizeModuleAction('requests-center', 'update'), createRequiredAction);
router.post('/actions/:id/complete', completeRequiredAction);
router.post('/actions/:id/profile-fields', completeProfileFieldsAction);
router.post('/schedule-swaps/:id/partner-response', respondToSwapRequiredAction);
router.post('/schedule-swaps/:id/manager-decision', decideManagerSwapRequiredAction);

export default router;
