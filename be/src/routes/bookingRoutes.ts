import express, { Request, Response, NextFunction, Router } from 'express';
import * as bookingController from '../controllers/bookingController.js'; // Adjust the import path as necessary
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js'; // Adjust the import path as necessary

const router: Router = express.Router();

// Validation for ID parameter
const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

// Validation rules for booking data
const validateBookingPOST = [
  check('guestId').isInt({ gt: 0 }).withMessage('guestId must be a positive integer'),
  check('channelId').isInt({ gt: 0 }).withMessage('channelId must be a positive integer'),
  check('checkInDate').isISO8601().withMessage('checkInDate must be a valid date (ISO 8601)'),
  check('checkOutDate').isISO8601().withMessage('checkOutDate must be a valid date (ISO 8601)'),
  check('paymentStatus').isIn(['confirmed', 'cancelled', 'pending']).withMessage('paymentStatus must be one of: confirmed, cancelled, pending'),
];

const validateBookingPUT = [
  check('guestId').optional().isInt({ gt: 0 }).withMessage('guestId must be a positive integer'),
  check('channelId').optional().isInt({ gt: 0 }).withMessage('channelId must be a positive integer'),
  check('checkInDate').isISO8601().withMessage('checkInDate must be a valid date (ISO 8601)'),
  check('checkOutDate').isISO8601().withMessage('checkOutDate must be a valid date (ISO 8601)'),
  check('paymentStatus').isIn(['confirmed', 'cancelled', 'pending']).withMessage('paymentStatus must be one of: confirmed, cancelled, pending'),
];

// Middleware to check validation result
const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() }); // Adjusted for TypeScript
    return;
  }
  next();
};

// Get all bookings
router.get('/', authMiddleware,  bookingController.getAllBookings);

// Get a single booking by ID
router.get('/:id', authMiddleware,  validateId, validate, bookingController.getBookingById);

// Create a new booking
router.post('/', authMiddleware,  validateBookingPOST, validate, bookingController.createBooking);

// Update an existing booking by ID
router.put('/:id', authMiddleware,  [...validateId, ...validateBookingPUT], validate, bookingController.updateBooking);

// Delete a booking by ID
router.delete('/:id', authMiddleware,  validateId, validate, bookingController.deleteBooking);

export default router;
