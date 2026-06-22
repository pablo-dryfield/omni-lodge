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
router.get('/products/:productId/availability', getYourGuideBasicAuthMiddleware, getAvailability);
router.get('/bookings/:platformBookingId', getYourGuideBasicAuthMiddleware, getBooking);

router.post('/bookings', getYourGuideBasicAuthMiddleware, ingestBooking);
router.post('/bookings/:platformBookingId', getYourGuideBasicAuthMiddleware, ingestBooking);
router.post('/bookings/:platformBookingId/cancel', getYourGuideBasicAuthMiddleware, ingestCancellation);
router.post('/reserve', getYourGuideBasicAuthMiddleware, ingestReservation);
router.post('/cancel-reserve', getYourGuideBasicAuthMiddleware, ingestCancellation);

export default router;
