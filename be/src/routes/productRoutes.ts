import express, { Request, Response, NextFunction, Router } from 'express';
import * as productController from '../controllers/productController.js'; // Adjust the import path as necessary
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

// Get all products
router.get('/', authMiddleware, productController.getAllProducts);

// Get a single product by ID
router.get('/:id', authMiddleware, validateId, validate, productController.getProductById);

// Create a new product
router.post('/', authMiddleware, validate, productController.createProduct);

// Update an existing product by ID
router.put('/:id', authMiddleware, [...validateId], validate, productController.updateProduct);

// Delete a product by ID
router.delete('/:id', authMiddleware, validateId, validate, productController.deleteProduct);

export default router;
