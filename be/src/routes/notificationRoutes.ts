import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  listNotificationPushSubscriptions,
  listMyNotifications,
  sendNotificationPushTest,
} from '../controllers/notificationController.js';

const router = express.Router();

router.get('/', authMiddleware, listMyNotifications);
router.get('/push/subscriptions', authMiddleware, listNotificationPushSubscriptions);
router.post('/push/test', authMiddleware, sendNotificationPushTest);

export default router;
