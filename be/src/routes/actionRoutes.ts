import express, { Request, Response, NextFunction, Router } from 'express';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import * as actionController from '../controllers/actionController.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

const validateActionBody = [
  check('key').isString().trim().notEmpty().withMessage('Key is required'),
  check('name').isString().trim().notEmpty().withMessage('Name is required')
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, requireRoles(['admin']), validate, actionController.getAllActions);
router.get('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, actionController.getActionById);
router.post('/', authMiddleware, requireRoles(['admin']), validateActionBody, validate, actionController.createAction);
router.put('/:id', authMiddleware, requireRoles(['admin']), [...validateId, ...validateActionBody], validate, actionController.updateAction);
router.delete('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, actionController.deleteAction);

export default router;

