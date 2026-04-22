import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  createEmailTemplate,
  listEmailTemplates,
  updateEmailTemplate,
} from '../controllers/bookingController.js';

const router = Router();

router.get(['/', ''], authMiddleware, listEmailTemplates);
router.post(['/', ''], authMiddleware, createEmailTemplate);
router.patch('/:templateId', authMiddleware, updateEmailTemplate);

export default router;
