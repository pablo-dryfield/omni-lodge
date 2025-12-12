import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { listBookings, getManifest, amendEcwidBooking } from '../controllers/bookingController.js';

const router = Router();

router.get(['/', ''], authMiddleware, listBookings);
router.get(['/manifest', 'manifest'], authMiddleware, getManifest);
router.post('/:bookingId/amend-ecwid', authMiddleware, amendEcwidBooking);

export default router;
