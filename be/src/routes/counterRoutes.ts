import express, { Request, Response, NextFunction, Router } from 'express';
import * as counterController from '../controllers/counterController.js'; // Adjust the import path as necessary
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

// Get all counters
router.get('/', authMiddleware, counterController.getAllCounters);

// Get a single counter by ID
router.get('/:id', authMiddleware, validateId, validate, counterController.getCounterById);

// Create a new counter
router.post('/', authMiddleware, validate, counterController.createCounter);

// Update an existing counter by ID
router.put('/:id', authMiddleware, [...validateId], validate, counterController.updateCounter);

// Delete a counter by ID
router.delete('/:id', authMiddleware, validateId, validate, counterController.deleteCounter);

export default router;
