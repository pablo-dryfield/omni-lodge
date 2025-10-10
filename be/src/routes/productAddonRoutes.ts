import express, { NextFunction, Request, Response, Router } from 'express';
import { check, param, validationResult } from 'express-validator';

import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  createProductAddon,
  deleteProductAddon,
  getAllProductAddons,
  getProductAddonById,
  updateProductAddon,
} from '../controllers/productAddonController.js';

const router: Router = express.Router();

const validateId = [param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')];

const validateBody = [
  check('productId').isInt({ gt: 0 }).withMessage('productId is required'),
  check('addonId').isInt({ gt: 0 }).withMessage('addonId is required'),
  check('maxPerAttendee')
    .optional({ nullable: true })
    .isInt({ gt: 0 })
    .withMessage('maxPerAttendee must be a positive integer'),
  check('priceOverride')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('priceOverride must be a positive number'),
  check('sortOrder')
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage('sortOrder must be a non-negative integer'),
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, getAllProductAddons);
router.get('/:id', authMiddleware, validateId, validate, getProductAddonById);

router.post(
  '/',
  authMiddleware,
  requireRoles(['admin']),
  validateBody,
  validate,
  createProductAddon,
);

router.put(
  '/:id',
  authMiddleware,
  requireRoles(['admin']),
  [...validateId, ...validateBody],
  validate,
  updateProductAddon,
);

router.delete(
  '/:id',
  authMiddleware,
  requireRoles(['admin']),
  validateId,
  validate,
  deleteProductAddon,
);

export default router;

