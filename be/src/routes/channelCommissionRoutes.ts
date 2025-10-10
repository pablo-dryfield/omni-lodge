import express, { NextFunction, Request, Response, Router } from 'express';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  listChannelCommissions,
  createChannelCommission,
  updateChannelCommission,
  deleteChannelCommission,
} from '../controllers/channelCommissionController.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer'),
];

const validateBody = [
  check('channelId').isInt({ gt: 0 }).withMessage('channelId must be a positive integer'),
  check('rate').isFloat({ gt: 0 }).withMessage('rate must be a positive number'),
  check('validFrom').isISO8601().withMessage('validFrom must be a valid date'),
  check('validTo').optional({ nullable: true }).isISO8601().withMessage('validTo must be a valid date'),
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, requireRoles(['admin']), listChannelCommissions);
router.post('/', authMiddleware, requireRoles(['admin']), validateBody, validate, createChannelCommission);
router.put(
  '/:id',
  authMiddleware,
  requireRoles(['admin']),
  [...validateId, ...validateBody],
  validate,
  updateChannelCommission,
);
router.delete('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, deleteChannelCommission);

export default router;
