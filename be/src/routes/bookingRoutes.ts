import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireBookingProductScope } from '../services/productScopeService.js';
import {
  backfillEcwidPaymentMetadata,
  fixEcwidOrderFromSource,
  fixEcwidOrderToExternal,
  fixEcwidOrdersFromSourceBulk,
  fixEcwidOrdersToExternalBulk,
  getSanityCheckEcwidComparison,
  getSanityCheckOmniSummary,
  reprocessEcwidSanityHints,
} from '../controllers/bookingSanityController.js';
import {
  listBookingEmails,
  listBookingMailboxEmails,
  getBookingEmailPreview,
  getMailboxEmailPreview,
  getBookingEmailTshirtAvailability,
  getBookingEmailTemplateGallery,
  renderBookingEmailPreview,
  sendBookingEmail,
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
  resendDirectFoodTourConfirmation,
  amendDirectFoodTourBooking,
  cancelDirectFoodTourBooking,
  partialRefundDirectFoodTourBooking,
  cancelEcwidBooking,
  cancelCivitatisBooking,
  cancelXperiencePolandBooking,
  getEcwidRefundPreview,
  importEcwidBooking,
  updateBulkBookingAttendance,
  updateBookingAttendance,
  completeBookingAddonRefundAction,
  deleteBookingAddonRefundAction,
} from '../controllers/bookingController.js';
import { listBookingsWithSummary } from '../controllers/bookingSummaryController.js';

const router = Router();

router.get(['/', ''], authMiddleware, listBookingsWithSummary);
router.get('/emails', authMiddleware, listBookingEmails);
router.get('/emails/mailbox', authMiddleware, listBookingMailboxEmails);
router.get('/emails/tshirt-availability', authMiddleware, getBookingEmailTshirtAvailability);
router.get('/emails/template-gallery', authMiddleware, getBookingEmailTemplateGallery);
router.get('/emails/:messageId/preview', authMiddleware, getBookingEmailPreview);
router.get('/emails/gmail/:messageId/preview', authMiddleware, getMailboxEmailPreview);
router.post('/emails/render-preview', authMiddleware, renderBookingEmailPreview);
router.post('/emails/send', authMiddleware, sendBookingEmail);
router.post('/emails/reprocess', authMiddleware, reprocessBookingEmails);
router.post('/emails/:messageId/reprocess', authMiddleware, reprocessBookingEmail);
router.post('/emails/backfill', authMiddleware, backfillBookingEmails);
router.get(['/manifest', 'manifest'], authMiddleware, getManifest);
router.get('/sanity-check/omni', authMiddleware, getSanityCheckOmniSummary);
router.get('/sanity-check/ecwid', authMiddleware, getSanityCheckEcwidComparison);
router.post('/sanity-check/ecwid/reprocess-hints', authMiddleware, reprocessEcwidSanityHints);
router.post('/sanity-check/ecwid/fix-order', authMiddleware, fixEcwidOrderFromSource);
router.post('/sanity-check/ecwid/fix-orders', authMiddleware, fixEcwidOrdersFromSourceBulk);
router.post('/sanity-check/ecwid/fix-to-ecwid', authMiddleware, fixEcwidOrderToExternal);
router.post('/sanity-check/ecwid/fix-to-ecwid-bulk', authMiddleware, fixEcwidOrdersToExternalBulk);
router.post('/sanity-check/ecwid/backfill-payment-metadata', authMiddleware, backfillEcwidPaymentMetadata);
router.post('/ingest-emails', authMiddleware, ingestBookingEmails);
router.post('/import-ecwid', authMiddleware, importEcwidBooking);
router.patch('/attendance/bulk', authMiddleware, updateBulkBookingAttendance);
router.patch('/:bookingId/attendance', authMiddleware, requireBookingProductScope, updateBookingAttendance);
router.patch('/:bookingId/addon-refund-actions/:actionId', authMiddleware, requireBookingProductScope, completeBookingAddonRefundAction);
router.delete('/:bookingId/addon-refund-actions/:actionId', authMiddleware, requireBookingProductScope, deleteBookingAddonRefundAction);
router.get('/:bookingId/details', authMiddleware, requireBookingProductScope, getBookingDetails);
router.get('/:bookingId/amend-ecwid-preview', authMiddleware, requireBookingProductScope, getEcwidAmendPreview);
router.post('/:bookingId/reconcile-ecwid', authMiddleware, requireBookingProductScope, reconcileEcwidBooking);
router.post('/:bookingId/amend-ecwid', authMiddleware, requireBookingProductScope, amendEcwidBooking);
router.post('/:bookingId/amend-xperience', authMiddleware, requireBookingProductScope, amendXperiencePolandBooking);
router.post('/:bookingId/direct-actions/confirmation', authMiddleware, requireBookingProductScope, resendDirectFoodTourConfirmation);
router.post('/:bookingId/direct-actions/amend', authMiddleware, requireBookingProductScope, amendDirectFoodTourBooking);
router.post('/:bookingId/direct-actions/cancellation', authMiddleware, requireBookingProductScope, cancelDirectFoodTourBooking);
router.post('/:bookingId/direct-actions/partial-refund', authMiddleware, requireBookingProductScope, partialRefundDirectFoodTourBooking);
router.get('/:bookingId/refund-preview', authMiddleware, requireBookingProductScope, getEcwidRefundPreview);
router.get('/:bookingId/partial-refund-preview', authMiddleware, requireBookingProductScope, getPartialRefundPreview);
router.post('/:bookingId/partial-refund', authMiddleware, requireBookingProductScope, partialRefundEcwidBooking);
router.post('/:bookingId/cancel-ecwid', authMiddleware, requireBookingProductScope, cancelEcwidBooking);
router.post('/:bookingId/cancel-civitatis', authMiddleware, requireBookingProductScope, cancelCivitatisBooking);
router.post('/:bookingId/cancel-xperience', authMiddleware, requireBookingProductScope, cancelXperiencePolandBooking);

export default router;
