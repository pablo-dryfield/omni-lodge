import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { listMyNotifications } from '../controllers/notificationController.js';

const router = express.Router();

router.get('/', authMiddleware, listMyNotifications);

export default router;

