import express, { Request, Response, NextFunction, Router } from 'express';
import * as counterUserController from '../controllers/counterUserController.js'; // Adjust the import path as necessary
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

// Get all counterUsers
router.get('/', authMiddleware, counterUserController.getAllCounterUsers);

// Get a single counterUser by ID
router.get('/:id', authMiddleware, validateId, validate, counterUserController.getCounterUserById);

// Create a new counterUser
router.post('/', authMiddleware, validate, counterUserController.createCounterUser);

// Create a new bulkCounterUser
router.post('/bulkCounterUsers', authMiddleware, counterUserController.createBulkCounterUser);

// Update an existing counterUser by ID
router.put('/:id', authMiddleware, [...validateId], validate, counterUserController.updateCounterUser);

// Delete a counterUser by ID
router.delete('/:id', authMiddleware, validateId, validate, counterUserController.deleteCounterUser);

export default router;
