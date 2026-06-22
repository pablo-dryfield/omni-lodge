import { Router } from 'express';
import { getYourGuideBasicAuthMiddleware } from '../middleware/getYourGuideBasicAuth.js';
import {
  getBooking,
  getAvailability,
  healthCheck,
  ingestBooking,
  ingestCancellation,
  ingestReservation,
} from '../controllers/getYourGuideController.js';

const router = Router();

router.get('/', getYourGuideBasicAuthMiddleware, healthCheck);
router.get('/health', getYourGuideBasicAuthMiddleware, healthCheck);
router.get('/availability', getYourGuideBasicAuthMiddleware, getAvailability);
router.get('/:version/get-availabilities', getYourGuideBasicAuthMiddleware, getAvailability);
router.get('/:version/get-availabilities/', getYourGuideBasicAuthMiddleware, getAvailability);
router.get('/products/:productId/availability', getYourGuideBasicAuthMiddleware, getAvailability);
router.get('/bookings/:platformBookingId', getYourGuideBasicAuthMiddleware, getBooking);

router.post('/bookings', getYourGuideBasicAuthMiddleware, ingestBooking);
router.post('/bookings/:platformBookingId', getYourGuideBasicAuthMiddleware, ingestBooking);
router.post('/bookings/:platformBookingId/cancel', getYourGuideBasicAuthMiddleware, ingestCancellation);
router.post('/reserve', getYourGuideBasicAuthMiddleware, ingestReservation);
router.post('/cancel-reserve', getYourGuideBasicAuthMiddleware, ingestCancellation);
router.post('/:version/reserve', getYourGuideBasicAuthMiddleware, ingestReservation);
router.post('/:version/cancel-reserve', getYourGuideBasicAuthMiddleware, ingestCancellation);
router.post('/:version/bookings', getYourGuideBasicAuthMiddleware, ingestBooking);
router.post('/:version/bookings/:platformBookingId', getYourGuideBasicAuthMiddleware, ingestBooking);
router.post('/:version/bookings/:platformBookingId/cancel', getYourGuideBasicAuthMiddleware, ingestCancellation);
router.get('/:version/bookings/:platformBookingId', getYourGuideBasicAuthMiddleware, getBooking);

export default router;
