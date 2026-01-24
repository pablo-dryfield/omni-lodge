import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  listBookings,
  listBookingEmails,
  getBookingEmailPreview,
  reprocessBookingEmail,
  reprocessBookingEmails,
  backfillBookingEmails,
  getManifest,
  ingestBookingEmails,
  amendEcwidBooking,
  cancelEcwidBooking,
  getEcwidRefundPreview,
  importEcwidBooking,
} from '../controllers/bookingController.js';

const router = Router();

router.get(['/', ''], authMiddleware, listBookings);
router.get('/emails', authMiddleware, listBookingEmails);
router.get('/emails/:messageId/preview', authMiddleware, getBookingEmailPreview);
router.post('/emails/reprocess', authMiddleware, reprocessBookingEmails);
router.post('/emails/:messageId/reprocess', authMiddleware, reprocessBookingEmail);
router.post('/emails/backfill', authMiddleware, backfillBookingEmails);
router.get(['/manifest', 'manifest'], authMiddleware, getManifest);
router.post('/ingest-emails', authMiddleware, ingestBookingEmails);
router.post('/import-ecwid', authMiddleware, importEcwidBooking);
router.post('/:bookingId/amend-ecwid', authMiddleware, amendEcwidBooking);
router.get('/:bookingId/refund-preview', authMiddleware, getEcwidRefundPreview);
router.post('/:bookingId/cancel-ecwid', authMiddleware, cancelEcwidBooking);

export default router;
