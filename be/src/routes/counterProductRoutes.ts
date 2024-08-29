import express, { Request, Response, NextFunction, Router } from 'express';
import * as counterProductController from '../controllers/counterProductController.js'; // Adjust the import path as necessary
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

// Get all counterProducts
router.get('/', authMiddleware, counterProductController.getAllCounterProducts);

// Get a single counterProduct by ID
router.get('/:id', authMiddleware, validateId, validate, counterProductController.getCounterProductById);

// Create a new counterProduct
router.post('/', authMiddleware, validate, counterProductController.createCounterProduct);

// Create a new bulkCounterProduct
router.post('/bulkCounterProducts', authMiddleware, counterProductController.createBulkCounterProduct);

// Update an existing counterProduct by ID
router.put('/:id', authMiddleware, [...validateId], validate, counterProductController.updateCounterProduct);

// Delete a counterProduct by ID
router.delete('/:id', authMiddleware, validateId, validate, counterProductController.deleteCounterProduct);

export default router;
