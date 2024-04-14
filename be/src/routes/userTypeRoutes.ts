import express, { Request, Response, NextFunction, Router } from 'express';
import * as userTypeController from '../controllers/userTypeController.js'; // Adjust the import path as necessary
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js'; // Adjust the import path as necessary

const router: Router = express.Router();

// Validation for ID parameter
const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

// Middleware to check validation result
const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() }); // Removed 'return' to adhere to 'void' type
    return; 
  }
  next();
};

// Get all userTypes
router.get('/', authMiddleware, userTypeController.getAllUserTypes);

// Get a single userType by ID
router.get('/:id', authMiddleware, validateId, validate, userTypeController.getUserTypeById);

// Create a new userType
router.post('/', authMiddleware, validate, userTypeController.createUserType);

// Update an existing userType by ID
router.put('/:id', authMiddleware, [...validateId], validate, userTypeController.updateUserType);

// Delete a userType by ID
router.delete('/:id', authMiddleware, validateId, validate, userTypeController.deleteUserType);

export default router;
