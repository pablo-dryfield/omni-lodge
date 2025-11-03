import express, { Request, Response, NextFunction, Router } from 'express';
import * as reportController from '../controllers/reportController.js'; // Adjust the import path as necessary
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

router.get('/getCommissionByDateRange', authMiddleware, reportController.getCommissionByDateRange);
router.get('/models', authMiddleware, reportController.listReportModels);
router.post('/preview', authMiddleware, reportController.runReportPreview);

export default router;
