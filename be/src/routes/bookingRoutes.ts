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
  getEcwidAmendPreview,
  getBookingDetails,
  getPartialRefundPreview,
  reconcileEcwidBooking,
  partialRefundEcwidBooking,
  amendEcwidBooking,
  amendXperiencePolandBooking,
  cancelEcwidBooking,
  cancelXperiencePolandBooking,
  getEcwidRefundPreview,
  importEcwidBooking,
  updateBulkBookingAttendance,
  updateBookingAttendance,
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
router.patch('/attendance/bulk', authMiddleware, updateBulkBookingAttendance);
router.patch('/:bookingId/attendance', authMiddleware, updateBookingAttendance);
router.get('/:bookingId/details', authMiddleware, getBookingDetails);
router.get('/:bookingId/amend-ecwid-preview', authMiddleware, getEcwidAmendPreview);
router.post('/:bookingId/reconcile-ecwid', authMiddleware, reconcileEcwidBooking);
router.post('/:bookingId/amend-ecwid', authMiddleware, amendEcwidBooking);
router.post('/:bookingId/amend-xperience', authMiddleware, amendXperiencePolandBooking);
router.get('/:bookingId/refund-preview', authMiddleware, getEcwidRefundPreview);
router.get('/:bookingId/partial-refund-preview', authMiddleware, getPartialRefundPreview);
router.post('/:bookingId/partial-refund', authMiddleware, partialRefundEcwidBooking);
router.post('/:bookingId/cancel-ecwid', authMiddleware, cancelEcwidBooking);
router.post('/:bookingId/cancel-xperience', authMiddleware, cancelXperiencePolandBooking);

export default router;
