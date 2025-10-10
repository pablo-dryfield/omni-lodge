import express, { NextFunction, Request, Response, Router } from 'express';
import { check, param, validationResult } from 'express-validator';

import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { createAddon, deleteAddon, getAddonById, listAddons, updateAddon } from '../controllers/addonController.js';

const router: Router = express.Router();

const validateId = [param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')];

const validateBody = [
  check('name').isString().trim().notEmpty().withMessage('Name is required'),
  check('basePrice').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('basePrice must be a positive number'),
  check('taxRate')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('taxRate must be a positive number'),
  check('isActive').optional({ nullable: true }).isBoolean().withMessage('isActive must be a boolean'),
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, listAddons);
router.get('/:id', authMiddleware, validateId, validate, getAddonById);

router.post(
  '/',
  authMiddleware,
  requireRoles(['admin']),
  validateBody,
  validate,
  createAddon,
);

router.put(
  '/:id',
  authMiddleware,
  requireRoles(['admin']),
  [...validateId, ...validateBody],
  validate,
  updateAddon,
);

router.delete(
  '/:id',
  authMiddleware,
  requireRoles(['admin']),
  validateId,
  validate,
  deleteAddon,
);

export default router;
