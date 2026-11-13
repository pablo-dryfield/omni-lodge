import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  dismissOngoingCart,
  getOngoingCartActivity,
  listOngoingCarts,
  listRecoveredCarts,
  previewOngoingCartRecoveryEmail,
  sendOngoingCartRecoveryEmail,
  listRecoveryCoupons,
  updateCartRecoveryOffer,
} from '../controllers/storefrontOngoingCartController.js';

const router = Router();

router.use(authMiddleware);
router.get('/', listOngoingCarts);
router.get('/recovered', listRecoveredCarts);
router.get('/recovery-coupons', requireRoles(['admin', 'owner', 'manager']), listRecoveryCoupons);
router.put('/:publicId/recovery-offer', requireRoles(['admin', 'owner', 'manager']), updateCartRecoveryOffer);
router.get('/:publicId/activity', getOngoingCartActivity);
router.get('/:publicId/recovery-preview', previewOngoingCartRecoveryEmail);
router.post('/:publicId/send-recovery', sendOngoingCartRecoveryEmail);
router.patch('/:publicId/dismiss', dismissOngoingCart);

export default router;
