import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  dismissOngoingCart,
  listOngoingCarts,
  listRecoveredCarts,
  previewOngoingCartRecoveryEmail,
  sendOngoingCartRecoveryEmail,
} from '../controllers/storefrontOngoingCartController.js';

const router = Router();

router.use(authMiddleware);
router.get('/', listOngoingCarts);
router.get('/recovered', listRecoveredCarts);
router.get('/:publicId/recovery-preview', previewOngoingCartRecoveryEmail);
router.post('/:publicId/send-recovery', sendOngoingCartRecoveryEmail);
router.patch('/:publicId/dismiss', dismissOngoingCart);

export default router;
