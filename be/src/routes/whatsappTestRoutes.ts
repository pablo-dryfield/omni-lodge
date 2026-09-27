import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { param, validationResult } from 'express-validator';
import {
  getWhatsAppDeliveryTestStatus,
  sendWhatsAppDeliveryTest,
} from '../controllers/whatsappTestController.js';
import { whatsappTestAuth } from '../middleware/whatsappTestAuth.js';

const router = Router();
router.use(whatsappTestAuth);
router.post('/messages', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'A WhatsApp delivery test was already requested recently.' },
}), sendWhatsAppDeliveryTest);
router.get(
  '/messages/:messageId',
  param('messageId').isString().isLength({ min: 1, max: 256 }),
  (req, res, next) => {
    if (!validationResult(req).isEmpty()) {
      res.status(400).json({ error: 'Invalid WhatsApp message reference.' });
      return;
    }
    next();
  },
  getWhatsAppDeliveryTestStatus,
);

export default router;
