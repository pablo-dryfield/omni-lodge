import { Router } from 'express';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import {
  completeProfileFieldsAction,
  completeRequiredAction,
  createRequiredAction,
  decideManagerSwapRequiredAction,
  listMyRequiredActions,
  markRequiredActionPrompted,
  respondToSwapRequiredAction,
  updateRequiredActionStatus,
} from '../controllers/requiredActionController.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

router.use(authMiddleware);

router.get('/me', listMyRequiredActions);
router.post('/actions', authorizeModuleAction('requests-center', 'update'), createRequiredAction);
router.patch('/actions/:id/status', authorizeModuleAction('requests-center', 'update'), updateRequiredActionStatus);
router.post('/actions/:id/complete', completeRequiredAction);
router.post('/actions/:id/prompted', markRequiredActionPrompted);
router.post('/actions/:id/profile-fields', upload.single('profilePhoto'), completeProfileFieldsAction);
router.post('/schedule-swaps/:id/partner-response', respondToSwapRequiredAction);
router.post('/schedule-swaps/:id/manager-decision', decideManagerSwapRequiredAction);

export default router;
