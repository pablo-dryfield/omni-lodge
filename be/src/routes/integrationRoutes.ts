import { Router } from 'express';
import { ingestDirectBooking } from '../controllers/directBookingIntegrationController.js';
import { directBookingIntegrationAuth } from '../middleware/directBookingIntegrationAuth.js';

const router = Router();

router.post('/direct-bookings', directBookingIntegrationAuth, ingestDirectBooking);

export default router;
