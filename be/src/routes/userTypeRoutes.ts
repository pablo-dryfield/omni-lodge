import express, { Request, Response, NextFunction, Router } from 'express';
import * as userTypeController from '../controllers/userTypeController.js';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

const validateBody = [
  check('name').isString().trim().notEmpty().withMessage('Name is required'),
  check('slug').optional().isString().withMessage('Slug must be a string')
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, validate, userTypeController.getAllUserTypes);
router.get('/:id', authMiddleware, validateId, validate, userTypeController.getUserTypeById);
router.post('/', authMiddleware, validateBody, validate, userTypeController.createUserType);
router.put('/:id', authMiddleware, [...validateId, ...validateBody], validate, userTypeController.updateUserType);
router.delete('/:id', authMiddleware, validateId, validate, userTypeController.deleteUserType);

export default router;

