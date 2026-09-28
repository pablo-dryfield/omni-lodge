import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, validationResult } from 'express-validator';
import {
  archiveManagedWhatsAppTemplatesController,
  completeWhatsAppEmbeddedSignupAttemptController,
  createManagedWhatsAppTemplateController,
  createWhatsAppEmbeddedSignupAttemptController,
  deleteManagedWhatsAppTemplateController,
  getManagedWhatsAppTemplateEventsController,
  getWhatsAppAdminStatusController,
  getWhatsAppMessageTemplatesController,
  getWhatsAppTemplateVariablesController,
  listManagedWhatsAppTemplatesController,
  previewManagedWhatsAppTemplateController,
  repairWhatsAppWebhookSubscriptionController,
  searchWhatsAppTemplateBookingsController,
  sendManagedWhatsAppTemplateController,
  sendWhatsAppTemplateMessageController,
  syncManagedWhatsAppTemplatesController,
  unarchiveManagedWhatsAppTemplatesController,
  unpauseManagedWhatsAppTemplateController,
  updateManagedWhatsAppTemplateController,
} from '../controllers/whatsappAdminController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const router = Router();

const adminRateLimitKey = (req: Request): string => {
  const adminId = (req as AuthenticatedRequest).authContext?.id;
  return adminId ? `admin:${adminId}:ip:${req.ip}` : `ip:${req.ip}`;
};

const adminReauthenticationRateLimitKey = (req: Request): string => {
  const adminId = (req as AuthenticatedRequest).authContext?.id;
  return adminId ? `admin:${adminId}` : `ip:${req.ip}`;
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
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminRateLimitKey,
  message: [{ message: 'Too many WhatsApp message attempts. Try again in a minute.' }],
});

const templateMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminRateLimitKey,
  message: [{ message: 'Too many WhatsApp template changes. Try again in a minute.' }],
});

const reauthenticationFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminReauthenticationRateLimitKey,
  // Only retain password-confirmation failures in the counter. Validation,
  // provider, and successful responses must not consume the administrator's
  // small re-authentication budget or reduce legitimate send throughput.
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 403,
  message: [{ message: 'Too many password confirmation failures. Try again later.' }],
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
router.get('/templates', listManagedWhatsAppTemplatesController);
router.get('/templates/variables', getWhatsAppTemplateVariablesController);
router.post(
  '/templates/bookings/search',
  body('q').optional().isString().isLength({ max: 128 }),
  validate,
  searchWhatsAppTemplateBookingsController,
);
router.post(
  '/templates/sync',
  reauthenticationFailureLimiter,
  templateMutationLimiter,
  body('password').isString().isLength({ min: 1, max: 512 }),
  validate,
  syncManagedWhatsAppTemplatesController,
);
router.post(
  '/templates/preview',
  body('metaTemplateId').optional().isString().matches(/^\d{1,64}$/),
  body('definition').optional().isObject({ strict: true }),
  body('bookingId').optional({ nullable: true }).isInt({ min: 1 }),
  body().custom((value) => {
    if (!value?.metaTemplateId && !value?.definition) {
      throw new Error('A template ID or definition is required.');
    }
    return true;
  }),
  validate,
  previewManagedWhatsAppTemplateController,
);
router.post(
  '/templates/archive',
  reauthenticationFailureLimiter,
  templateMutationLimiter,
  body('password').isString().isLength({ min: 1, max: 512 }),
  body('templateIds').isArray({ min: 1, max: 100 }),
  body('templateIds.*').isString().matches(/^\d{1,64}$/),
  validate,
  archiveManagedWhatsAppTemplatesController,
);
router.post(
  '/templates/unarchive',
  reauthenticationFailureLimiter,
  templateMutationLimiter,
  body('password').isString().isLength({ min: 1, max: 512 }),
  body('templateIds').isArray({ min: 1, max: 100 }),
  body('templateIds.*').isString().matches(/^\d{1,64}$/),
  validate,
  unarchiveManagedWhatsAppTemplatesController,
);
router.post(
  '/templates',
  reauthenticationFailureLimiter,
  templateMutationLimiter,
  body('password').isString().isLength({ min: 1, max: 512 }),
  body('name').isString().matches(/^[a-z0-9_]{1,512}$/),
  body('language').isString().matches(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
  body('category').isIn(['UTILITY', 'MARKETING', 'AUTHENTICATION']),
  body('parameterFormat').optional().isIn(['NAMED', 'POSITIONAL']),
  body('messageSendTtlSeconds').optional({ nullable: true }).isInt({ min: -1, max: 2_592_000 }),
  body('components').isArray({ min: 1, max: 50 }),
  body('bookingBindings').optional().isObject({ strict: true }),
  validate,
  createManagedWhatsAppTemplateController,
);
router.put(
  '/templates/:id',
  reauthenticationFailureLimiter,
  templateMutationLimiter,
  param('id').isString().matches(/^\d{1,64}$/),
  body('password').isString().isLength({ min: 1, max: 512 }),
  body('category').isIn(['UTILITY', 'MARKETING', 'AUTHENTICATION']),
  body('parameterFormat').optional().isIn(['NAMED', 'POSITIONAL']),
  body('messageSendTtlSeconds').optional({ nullable: true }).isInt({ min: -1, max: 2_592_000 }),
  body('components').isArray({ min: 1, max: 50 }),
  body('bookingBindings').optional().isObject({ strict: true }),
  validate,
  updateManagedWhatsAppTemplateController,
);
router.delete(
  '/templates/:id',
  reauthenticationFailureLimiter,
  templateMutationLimiter,
  param('id').isString().matches(/^\d{1,64}$/),
  body('password').isString().isLength({ min: 1, max: 512 }),
  body('name').isString().matches(/^[a-z0-9_]{1,512}$/),
  validate,
  deleteManagedWhatsAppTemplateController,
);
router.post(
  '/templates/:id/unpause',
  reauthenticationFailureLimiter,
  templateMutationLimiter,
  param('id').isString().matches(/^\d{1,64}$/),
  body('password').isString().isLength({ min: 1, max: 512 }),
  validate,
  unpauseManagedWhatsAppTemplateController,
);
router.get(
  '/templates/:id/events',
  param('id').isString().matches(/^\d{1,64}$/),
  validate,
  getManagedWhatsAppTemplateEventsController,
);
router.post(
  '/templates/:id/send',
  reauthenticationFailureLimiter,
  outboundMessageLimiter,
  param('id').isString().matches(/^\d{1,64}$/),
  body('password').isString().isLength({ min: 1, max: 512 }),
  body('bookingId').isInt({ min: 1 }),
  body('recipient').optional().isString().matches(/^\+[1-9]\d{7,14}$/),
  validate,
  sendManagedWhatsAppTemplateController,
);
router.post(
  '/webhook-subscription/repair',
  reauthenticationFailureLimiter,
  subscriptionRepairLimiter,
  body('password').isString().isLength({ min: 1, max: 512 }),
  validate,
  repairWhatsAppWebhookSubscriptionController,
);
router.post(
  '/messages/template',
  reauthenticationFailureLimiter,
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
  reauthenticationFailureLimiter,
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
