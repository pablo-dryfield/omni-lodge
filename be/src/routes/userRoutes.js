import express from 'express';
import * as userController from '../controllers/userController.js';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Validation for ID parameter
const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

// Validation rules for user registration
const validateUserPOST = [
  check('username').isString().trim().isLength({ min: 3, max: 50 }).withMessage('Username must be a string between 3 and 50 characters'),
  check('email').trim().isEmail().normalizeEmail().withMessage('Email must be a valid email address'),
  check('password').trim().isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
];

// Validation rules for user login
const validateUserLogin = [
  check('email').trim().isEmail().normalizeEmail().withMessage('Email must be a valid email address'),
  check('password').trim().exists().withMessage('Password is required')
];

// Validation rules for updating user
const validateUserPUT = [
  check('username').optional().isString().trim().isLength({ min: 3, max: 50 }).withMessage('Username must be a string between 3 and 50 characters'),
  check('email').optional().trim().isEmail().withMessage('Email must be a valid email address'),
  check('password').optional().trim().isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
];

// Middleware to check validation result
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Register a new user
router.post('/register', validateUserPOST, validate, userController.registerUser);

// Login a user
router.post('/login', validateUserLogin, validate, userController.loginUser);

// Get all users
router.get('/', /*authMiddleware,*/ validate, userController.getAllUsers);

// Get a single user by ID
router.get('/:id', /*authMiddleware,*/ validateId, validate, userController.getUserById);

// Update an existing user by ID
router.put('/:id', /*authMiddleware,*/ [...validateId, ...validateUserPUT], validate, userController.updateUser);

// Delete a user by ID
router.delete('/:id', /*authMiddleware,*/ validateId, validate, userController.deleteUser);

export default router;
