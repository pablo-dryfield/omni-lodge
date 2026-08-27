import { Router } from 'express';
import {
  getWhatsAppBriefContext,
  getWhatsAppBriefMessages,
  getWhatsAppBriefStatus,
} from '../controllers/whatsappBriefController.js';
import { whatsappBriefAuth } from '../middleware/whatsappBriefAuth.js';

const router = Router();

router.use(whatsappBriefAuth);
router.get('/status', getWhatsAppBriefStatus);
router.get('/messages', getWhatsAppBriefMessages);
router.get('/messages/:providerMessageId/context', getWhatsAppBriefContext);

export default router;
