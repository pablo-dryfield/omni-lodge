import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, validationResult } from 'express-validator';
import {
  completeWhatsAppEmbeddedSignupAttemptController,
  createWhatsAppEmbeddedSignupAttemptController,
  getWhatsAppAdminStatusController,
  getWhatsAppMessageTemplatesController,
  repairWhatsAppWebhookSubscriptionController,
  sendWhatsAppTemplateMessageController,
} from '../controllers/whatsappAdminController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const router = Router();

const adminRateLimitKey = (req: Request): string => {
  const adminId = (req as AuthenticatedRequest).authContext?.id;
  return adminId ? `admin:${adminId}:ip:${req.ip}` : `ip:${req.ip}`;
};

const attemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminRateLimitKey,
  message: [{ message: 'Too many WhatsApp onboarding attempts. Try again later.' }],
});

const completionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminRateLimitKey,
  message: [{ message: 'Too many WhatsApp onboarding completions. Try again later.' }],
});

const outboundMessageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminRateLimitKey,
  message: [{ message: 'Too many WhatsApp message attempts. Try again later.' }],
});

const subscriptionRepairLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminRateLimitKey,
  message: [{ message: 'Too many WhatsApp subscription repair attempts. Try again later.' }],
});

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json(errors.array().map((error) => ({
      message: String(error.msg),
      field: error.type === 'field' ? error.path : undefined,
    })));
    return;
  }
  next();
};

router.use(authMiddleware, requireRoles(['admin']));
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/status', getWhatsAppAdminStatusController);
router.get('/messages/templates', getWhatsAppMessageTemplatesController);
router.post(
  '/webhook-subscription/repair',
  subscriptionRepairLimiter,
  body('password').isString().isLength({ min: 1, max: 512 }),
  validate,
  repairWhatsAppWebhookSubscriptionController,
);
router.post(
  '/messages/template',
  outboundMessageLimiter,
  body('password').isString().isLength({ min: 1, max: 512 }),
  body('recipient').isString().matches(/^\+[1-9]\d{7,14}$/),
  body('templateName').isString().matches(/^[a-z0-9_]{1,512}$/),
  body('languageCode').isString().matches(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
  validate,
  sendWhatsAppTemplateMessageController,
);
router.post(
  '/embedded-signup/attempts',
  attemptLimiter,
  body('password').isString().isLength({ min: 1, max: 512 }),
  body('reconnectAfterOffboarding').optional().isBoolean({ strict: true }),
  validate,
  createWhatsAppEmbeddedSignupAttemptController,
);
router.post(
  '/embedded-signup/attempts/:id/complete',
  completionLimiter,
  param('id').isUUID(),
  body('nonce').isString().matches(/^[A-Za-z0-9_-]{43}$/),
  body('code').optional().isString().isLength({ min: 1, max: 4096 }),
  body('session').optional().isObject({ strict: true }),
  validate,
  completeWhatsAppEmbeddedSignupAttemptController,
);

export default router;
