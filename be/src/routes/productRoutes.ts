import express, { Request, Response, NextFunction, Router } from 'express';
import * as productController from '../controllers/productController.js'; // Adjust the import path as necessary
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js'; // Adjust the import path as necessary
import multer from 'multer';

const router: Router = express.Router();
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    callback(null, allowed.includes(file.mimetype));
  },
});

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

// Get all active products
router.get('/active', authMiddleware, productController.getAllActiveProducts);

// Get a single product by ID
router.get('/:id', authMiddleware, validateId, validate, productController.getProductById);

// Create a new product
router.post('/', authMiddleware, validate, productController.createProduct);

// Update an existing product by ID
router.put('/:id', authMiddleware, [...validateId], validate, productController.updateProduct);

// Upload and remove product media in the configured Cloudflare R2 bucket.
router.post('/:id/media', authMiddleware, validateId, validate, imageUpload.single('file'), productController.uploadProductImage);
router.delete('/:id/media', authMiddleware, validateId, validate, productController.removeProductImage);

// Delete a product by ID
router.delete('/:id', authMiddleware, validateId, validate, productController.deleteProduct);

export default router;
