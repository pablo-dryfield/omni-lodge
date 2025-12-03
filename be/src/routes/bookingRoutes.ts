import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { listBookings, getManifest } from '../controllers/bookingController.js';

const router = Router();

router.get(['/', ''], authMiddleware, listBookings);
router.get(['/manifest', 'manifest'], authMiddleware, getManifest);

export default router;
