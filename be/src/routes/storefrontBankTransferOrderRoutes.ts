import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import {
  cancelStorefrontBankTransferOrder,
  createStorefrontBankTransferOrder,
  listStorefrontBankTransferCatalog,
  listStorefrontBankTransferOrders,
  markStorefrontBankTransferPaymentReceived,
  resendStorefrontBankTransferInstructions,
  resendStorefrontBankTransferCancellation,
  retryStorefrontBankTransferConfirmation,
} from '../controllers/storefrontBankTransferOrderController.js';

const router = Router();
const moduleSlug = 'bank-transfer-booking-management';

router.get(
  '/catalog',
  authMiddleware,
  authorizeModuleAction(moduleSlug, 'view'),
  listStorefrontBankTransferCatalog,
);

router.get(
  '/',
  authMiddleware,
  authorizeModuleAction(moduleSlug, 'view'),
  listStorefrontBankTransferOrders,
);
router.post(
  '/',
  authMiddleware,
  authorizeModuleAction(moduleSlug, 'create'),
  createStorefrontBankTransferOrder,
);
router.patch(
  '/:publicId/payment-received',
  authMiddleware,
  authorizeModuleAction(moduleSlug, 'update'),
  markStorefrontBankTransferPaymentReceived,
);
router.patch(
  '/:publicId/cancel',
  authMiddleware,
  authorizeModuleAction(moduleSlug, 'update'),
  cancelStorefrontBankTransferOrder,
);
router.post(
  '/:publicId/resend-instructions',
  authMiddleware,
  authorizeModuleAction(moduleSlug, 'update'),
  resendStorefrontBankTransferInstructions,
);
router.post(
  '/:publicId/retry-confirmation',
  authMiddleware,
  authorizeModuleAction(moduleSlug, 'update'),
  retryStorefrontBankTransferConfirmation,
);
router.post(
  '/:publicId/resend-cancellation',
  authMiddleware,
  authorizeModuleAction(moduleSlug, 'update'),
  resendStorefrontBankTransferCancellation,
);

export default router;
