import express, { Request, Response, NextFunction, Router } from 'express';
import * as productTypeController from '../controllers/productTypeController.js'; // Adjust the import path as necessary
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

// Get all productTypes
router.get('/', authMiddleware, productTypeController.getAllProductTypes);

// Get a single productType by ID
router.get('/:id', authMiddleware, validateId, validate, productTypeController.getProductTypeById);

// Create a new productType
router.post('/', authMiddleware, validate, productTypeController.createProductType);

// Update an existing productType by ID
router.put('/:id', authMiddleware, [...validateId], validate, productTypeController.updateProductType);

// Delete a productType by ID
router.delete('/:id', authMiddleware, validateId, validate, productTypeController.deleteProductType);

export default router;
