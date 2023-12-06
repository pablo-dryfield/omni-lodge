import express from 'express';
import * as guestController from '../controllers/guestController.js';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Validation for ID parameter
const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

// Validation rules for guest data
const validateGuestPOST = [
  check('firstName').isString().trim().isLength({ min: 2, max: 50 }).withMessage('First name must be a string between 2 and 50 characters'),
  check('lastName').isString().trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be a string between 2 and 50 characters'),
  check('email').isEmail().trim().withMessage('Email must be a valid email address')
];

const validateGuestPUT = [
    check('firstName').optional().trim().isString().isLength({ min: 2, max: 50 }).withMessage('First name must be a string between 2 and 50 characters'),
    check('lastName').optional().trim().isString().isLength({ min: 2, max: 50 }).withMessage('Last name must be a string between 2 and 50 characters'),
    check('email').optional().trim().isEmail().withMessage('Email must be a valid email address')
  ];

// Middleware to check validation result
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Get all guests
router.get('/', /*authMiddleware,*/ guestController.getAllGuests);

// Get a single guest by ID
router.get('/:id', /*authMiddleware,*/ validateId, validate, guestController.getGuestById);

// Create a new guest
router.post('/', /*authMiddleware,*/ validateGuestPOST, validate, guestController.createGuest);

// Update an existing guest by ID
router.put('/:id', /*authMiddleware,*/ [...validateId, ...validateGuestPUT], validate, guestController.updateGuest);

// Delete a guest by ID
router.delete('/:id', /*authMiddleware,*/ validateId, validate, guestController.deleteGuest);

export default router;
