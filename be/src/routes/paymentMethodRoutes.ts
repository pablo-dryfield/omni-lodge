import express, { NextFunction, Request, Response, Router } from 'express';
import { check, param, validationResult } from 'express-validator';

import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import * as paymentMethodController from '../controllers/paymentMethodController.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer'),
];

const validateBody = [
  check('name').isString().trim().notEmpty().withMessage('Name is required'),
  check('description').optional({ nullable: true }).isString().trim(),
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, paymentMethodController.getAllPaymentMethods);
router.get('/:id', authMiddleware, validateId, validate, paymentMethodController.getPaymentMethodById);

router.post(
  '/',
  authMiddleware,
  requireRoles(['admin']),
  validateBody,
  validate,
  paymentMethodController.createPaymentMethod,
);

router.put(
  '/:id',
  authMiddleware,
  requireRoles(['admin']),
  [...validateId, ...validateBody],
  validate,
  paymentMethodController.updatePaymentMethod,
);

router.delete(
  '/:id',
  authMiddleware,
  requireRoles(['admin']),
  validateId,
  validate,
  paymentMethodController.deletePaymentMethod,
);

export default router;

