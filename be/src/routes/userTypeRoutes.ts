import express, { Request, Response, NextFunction, Router } from 'express';
import * as userTypeController from '../controllers/userTypeController.js';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

const validateBody = [
  check('name').isString().trim().notEmpty().withMessage('Name is required'),
  check('slug').optional().isString().withMessage('Slug must be a string')
];

const validateUpdateBody = [
  check('name').optional().isString().trim().notEmpty().withMessage('Name must not be empty'),
  check('slug').optional().isString().trim().notEmpty().withMessage('Slug must not be empty'),
  check('productTypeIds').optional().isArray().withMessage('productTypeIds must be an array'),
  check('productTypeIds.*').isInt({ gt: 0 }).withMessage('Product type IDs must be positive integers'),
];

const validatePermissionsBody = [
  check('action')
    .isString()
    .isIn(['add_all', 'remove_all', 'copy_from'])
    .withMessage('action must be add_all, remove_all, or copy_from'),
  check('sourceUserTypeId')
    .optional()
    .isInt({ gt: 0 })
    .withMessage('sourceUserTypeId must be a positive integer'),
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
router.post(
  '/:id/permissions',
  authMiddleware,
  requireRoles(['admin']),
  [...validateId, ...validatePermissionsBody],
  validate,
  userTypeController.applyUserTypePermissions,
);
router.put('/:id', authMiddleware, [...validateId, ...validateUpdateBody], validate, userTypeController.updateUserType);
router.delete('/:id', authMiddleware, validateId, validate, userTypeController.deleteUserType);

export default router;

