import express, { NextFunction, Request, Response, Router } from 'express';
import { body, check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  listChannelProductPrices,
  createChannelProductPrice,
  updateChannelProductPrice,
  deleteChannelProductPrice,
} from '../controllers/channelProductPriceController.js';
import { WALK_IN_TICKET_TYPE_VALUES } from '../constants/walkInTicketTypes.js';

const router: Router = express.Router();

const validateId = [param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')];

const validateCreateBody = [
  check('channelId').isInt({ gt: 0 }).withMessage('channelId must be a positive integer'),
  check('productId').isInt({ gt: 0 }).withMessage('productId must be a positive integer'),
  check('price').isFloat({ gt: 0 }).withMessage('price must be a positive number'),
  check('ticketType')
    .isIn([...WALK_IN_TICKET_TYPE_VALUES])
    .withMessage(`ticketType must be one of: ${WALK_IN_TICKET_TYPE_VALUES.join(', ')}`),
  check('currencyCode')
    .isString()
    .isLength({ min: 3, max: 3 })
    .withMessage('currencyCode must be a 3-letter ISO code'),
  check('validFrom').isISO8601().withMessage('validFrom must be a valid date'),
  check('validTo').optional({ nullable: true }).isISO8601().withMessage('validTo must be a valid date'),
];

const validateUpdateBody = [
  check('channelId').optional().isInt({ gt: 0 }).withMessage('channelId must be a positive integer'),
  check('productId').optional().isInt({ gt: 0 }).withMessage('productId must be a positive integer'),
  check('price').optional().isFloat({ gt: 0 }).withMessage('price must be a positive number'),
  check('ticketType')
    .optional()
    .isIn([...WALK_IN_TICKET_TYPE_VALUES])
    .withMessage(`ticketType must be one of: ${WALK_IN_TICKET_TYPE_VALUES.join(', ')}`),
  check('currencyCode')
    .optional()
    .isString()
    .isLength({ min: 3, max: 3 })
    .withMessage('currencyCode must be a 3-letter ISO code'),
  check('validFrom').optional().isISO8601().withMessage('validFrom must be a valid date'),
  check('validTo').optional({ nullable: true }).isISO8601().withMessage('validTo must be a valid date'),
  body().custom((payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Update payload must be an object');
    }
    if (Object.keys(payload).length === 0) {
      throw new Error('Update payload cannot be empty');
    }
    return true;
  }),
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, requireRoles(['admin']), listChannelProductPrices);
router.post('/', authMiddleware, requireRoles(['admin']), validateCreateBody, validate, createChannelProductPrice);
router.put(
  '/:id',
  authMiddleware,
  requireRoles(['admin']),
  [...validateId, ...validateUpdateBody],
  validate,
  updateChannelProductPrice,
);
router.delete('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, deleteChannelProductPrice);

export default router;
