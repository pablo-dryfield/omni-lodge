import express from 'express';
import * as bookingController from '../controllers/bookingController.js';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Validation for ID parameter
const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

// Validation rules for booking data
const validateBookingPOST = [
  check('guestId').isInt({ gt: 0 }).withMessage('guestId must be a positive integer'),
  check('channelId').isInt({ gt: 0 }).withMessage('channelId must be a positive integer'),
  check('startDate').isISO8601().withMessage('startDate must be a valid date (ISO 8601)'),
  check('endDate').isISO8601().withMessage('endDate must be a valid date (ISO 8601)'),
  check('status').isIn(['confirmed', 'cancelled', 'pending']).withMessage('status must be one of: confirmed, cancelled, pending'),
];

const validateBookingPUT = [
    check('guestId').optional().isInt({ gt: 0 }).withMessage('guestId must be a positive integer'),
    check('channelId').optional().isInt({ gt: 0 }).withMessage('channelId must be a positive integer'),
    check('startDate').optional().isISO8601().withMessage('startDate must be a valid date (ISO 8601)'),
    check('endDate').optional().isISO8601().withMessage('endDate must be a valid date (ISO 8601)'),
    check('status').optional().isIn(['confirmed', 'cancelled', 'pending']).withMessage('status must be one of: confirmed, cancelled, pending'),
  ];

// Middleware to check validation result
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Get all bookings
router.get('/', authMiddleware, bookingController.getAllBookings);

// Get a single booking by ID
router.get('/:id', authMiddleware, validateId, validate, bookingController.getBookingById);

// Create a new booking
router.post('/', authMiddleware, validateBookingPOST, validate, bookingController.createBooking);

// Update an existing booking by ID
router.put('/:id', authMiddleware, [...validateId, ...validateBookingPUT], validate, bookingController.updateBooking);

// Delete a booking by ID
router.delete('/:id', authMiddleware, validateId, validate, bookingController.deleteBooking);

export default router;
