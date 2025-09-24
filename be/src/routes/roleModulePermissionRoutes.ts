import express, { Request, Response, NextFunction, Router } from 'express';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import * as roleModulePermissionController from '../controllers/roleModulePermissionController.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer'),
];

const validateRoleId = [
  param('userTypeId').isInt({ gt: 0 }).withMessage('Role ID must be a positive integer'),
];

const validateModuleId = [
  param('moduleId').isInt({ gt: 0 }).withMessage('Module ID must be a positive integer'),
];

const validateCreateBody = [
  check('userTypeId').isInt({ gt: 0 }).withMessage('userTypeId must be a positive integer'),
  check('moduleId').isInt({ gt: 0 }).withMessage('moduleId must be a positive integer'),
  check('actionId').isInt({ gt: 0 }).withMessage('actionId must be a positive integer'),
  check('allowed').optional({ nullable: true }).isBoolean().withMessage('allowed must be a boolean'),
  check('status').optional({ nullable: true }).isBoolean().withMessage('status must be a boolean'),
];

const validateUpdateBody = [
  check('userTypeId')
    .optional({ nullable: true })
    .isInt({ gt: 0 })
    .withMessage('userTypeId must be a positive integer'),
  check('moduleId')
    .optional({ nullable: true })
    .isInt({ gt: 0 })
    .withMessage('moduleId must be a positive integer'),
  check('actionId')
    .optional({ nullable: true })
    .isInt({ gt: 0 })
    .withMessage('actionId must be a positive integer'),
  check('allowed').optional({ nullable: true }).isBoolean().withMessage('allowed must be a boolean'),
  check('status').optional({ nullable: true }).isBoolean().withMessage('status must be a boolean'),
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, requireRoles(['admin']), roleModulePermissionController.getAllRoleModulePermissions);
router.get('/role/:userTypeId', authMiddleware, requireRoles(['admin']), validateRoleId, validate, roleModulePermissionController.getRoleModulePermissionsByRole);
router.get('/module/:moduleId', authMiddleware, requireRoles(['admin']), validateModuleId, validate, roleModulePermissionController.getRoleModulePermissionsByModule);
router.get('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, roleModulePermissionController.getRoleModulePermissionById);
router.post('/', authMiddleware, requireRoles(['admin']), validateCreateBody, validate, roleModulePermissionController.createRoleModulePermission);
router.put(
  '/:id',
  authMiddleware,
  requireRoles(['admin']),
  [...validateId, ...validateUpdateBody],
  validate,
  roleModulePermissionController.updateRoleModulePermission,
);
router.delete('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, roleModulePermissionController.deleteRoleModulePermission);

export default router;
