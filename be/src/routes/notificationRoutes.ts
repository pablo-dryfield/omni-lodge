import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  listMyNotifications,
  sendNotificationPushTest,
} from '../controllers/notificationController.js';

const router = express.Router();

router.get('/', authMiddleware, listMyNotifications);
router.post('/push/test', authMiddleware, sendNotificationPushTest);

export default router;
