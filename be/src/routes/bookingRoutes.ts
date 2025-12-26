import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  listBookings,
  getManifest,
  amendEcwidBooking,
  cancelEcwidBooking,
  importEcwidBooking,
} from '../controllers/bookingController.js';

const router = Router();

router.get(['/', ''], authMiddleware, listBookings);
router.get(['/manifest', 'manifest'], authMiddleware, getManifest);
router.post('/import-ecwid', authMiddleware, importEcwidBooking);
router.post('/:bookingId/amend-ecwid', authMiddleware, amendEcwidBooking);
router.post('/:bookingId/cancel-ecwid', authMiddleware, cancelEcwidBooking);

export default router;
