import { Router, type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';
import { authenticateStaffPayoutReceiptAccess } from '../middleware/staffPayoutReceiptAccessMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import {
  confirmStaffPayoutReceiptAccess,
  exchangeStaffPayoutReceiptAccess,
  getStaffPayoutReceiptAccess,
} from '../controllers/staffPayoutReceiptAccessController.js';
import {
  completeProfileFieldsAction,
  completeRequiredAction,
  confirmStaffPayoutReceiptRequiredAction,
  createRequiredAction,
  decideManagerSwapRequiredAction,
  decideManagerShiftRequestRequiredAction,
  listMyRequiredActions,
  markRequiredActionPrompted,
  respondToSwapRequiredAction,
  respondToShiftRequestRequiredAction,
  updateRequiredActionStatus,
} from '../controllers/requiredActionController.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});
const receiptEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 4,
    parts: 5,
    fieldNameSize: 64,
    // A valid 2 MB PNG signature expands to roughly 2.7 MB as base64.
    fieldSize: 3 * 1024 * 1024,
  },
});
const uploadReceiptEvidence = (req: Request, res: Response, next: NextFunction): void => {
  receiptEvidenceUpload.single('photo')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FIELD_VALUE';
      res.status(tooLarge ? 413 : 400).json([{
        message: tooLarge
          ? 'Payout receipt evidence is too large.'
          : 'Payout receipt evidence has an invalid multipart format.',
      }]);
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
};
const receiptAccessIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: [{ message: 'Too many payout receipt access attempts. Try again later.' }],
});
const receiptAccessCredentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const identity = typeof req.body?.identity === 'string'
      ? req.body.identity.trim().toLowerCase().slice(0, 255)
      : typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase().slice(0, 255)
        : '';
    const receiptId = String(req.body?.receiptId ?? '').trim().slice(0, 32);
    const scopeHash = crypto
      .createHash('sha256')
      .update(`${identity}\u0000${receiptId}`)
      .digest('hex');
    return `${req.ip}:${scopeHash}`;
  },
  message: [{ message: 'Too many payout receipt access attempts. Try again later.' }],
});
const receiptAccessConfirmationLimiter = rateLimit({
  windowMs: 20 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const request = req as import('../types/AuthenticatedRequest.js').AuthenticatedRequest;
    const access = request.receiptAccess;
    return `${req.ip}:${access?.userId ?? 0}:${access?.receiptId ?? 0}`;
  },
  message: [{ message: 'Too many payout receipt confirmation attempts. Try again later.' }],
});

// These are the only routes on which an inactive account may authenticate.
// They intentionally run before normal account auth and receive only the
// receipt-bound context populated by authenticateStaffPayoutReceiptAccess.
router.post(
  '/staff-payout-receipts/access',
  receiptAccessIpLimiter,
  receiptAccessCredentialLimiter,
  exchangeStaffPayoutReceiptAccess,
);
router.get(
  '/staff-payout-receipts/:receiptId/access',
  authenticateStaffPayoutReceiptAccess,
  getStaffPayoutReceiptAccess,
);
router.post(
  '/staff-payout-receipts/:receiptId/access/confirm',
  authenticateStaffPayoutReceiptAccess,
  receiptAccessConfirmationLimiter,
  uploadReceiptEvidence,
  confirmStaffPayoutReceiptAccess,
);

router.use(authMiddleware);

router.get('/me', listMyRequiredActions);
router.post('/actions', authorizeModuleAction('requests-center', 'update'), createRequiredAction);
router.patch('/actions/:id/status', authorizeModuleAction('requests-center', 'update'), updateRequiredActionStatus);
router.post('/actions/:id/complete', completeRequiredAction);
router.post('/actions/:id/prompted', markRequiredActionPrompted);
router.post('/actions/:id/profile-fields', upload.single('profilePhoto'), completeProfileFieldsAction);
router.post(
  '/staff-payout-receipts/:receiptId/confirm',
  uploadReceiptEvidence,
  confirmStaffPayoutReceiptRequiredAction,
);
router.post('/schedule-swaps/:id/partner-response', respondToSwapRequiredAction);
router.post('/schedule-swaps/:id/manager-decision', decideManagerSwapRequiredAction);
router.post('/schedule-shift-requests/:id/partner-response', respondToShiftRequestRequiredAction);
router.post('/schedule-shift-requests/:id/manager-decision', decideManagerShiftRequestRequiredAction);

export default router;
