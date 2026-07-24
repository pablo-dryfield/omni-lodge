import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  listNotificationPushSubscriptions,
  listMyNotifications,
  markMyNotificationsRead,
  recordNotificationPushReceipt,
  sendNotificationPushTest,
} from '../controllers/notificationController.js';

const router = express.Router();

router.get('/', authMiddleware, listMyNotifications);
router.post('/read-all', authMiddleware, markMyNotificationsRead);
router.get('/push/subscriptions', authMiddleware, listNotificationPushSubscriptions);
router.post('/push/receipt', recordNotificationPushReceipt);
router.post('/push/test', authMiddleware, sendNotificationPushTest);

export default router;
