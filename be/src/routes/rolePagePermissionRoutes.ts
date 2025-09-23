import express, { Request, Response, NextFunction, Router } from 'express';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import * as rolePagePermissionController from '../controllers/rolePagePermissionController.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

const validateRoleId = [
  param('userTypeId').isInt({ gt: 0 }).withMessage('Role ID must be a positive integer')
];

const validatePageId = [
  param('pageId').isInt({ gt: 0 }).withMessage('Page ID must be a positive integer')
];

const validateBody = [
  check('userTypeId').isInt({ gt: 0 }).withMessage('userTypeId must be a positive integer'),
  check('pageId').isInt({ gt: 0 }).withMessage('pageId must be a positive integer'),
  check('canView').optional().isBoolean().withMessage('canView must be a boolean')
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, requireRoles(['admin']), validate, rolePagePermissionController.getAllRolePagePermissions);
router.get('/role/:userTypeId', authMiddleware, requireRoles(['admin']), validateRoleId, validate, rolePagePermissionController.getRolePagePermissionsByRole);
router.get('/page/:pageId', authMiddleware, requireRoles(['admin']), validatePageId, validate, rolePagePermissionController.getRolePagePermissionsByPage);
router.get('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, rolePagePermissionController.getRolePagePermissionById);
router.post('/', authMiddleware, requireRoles(['admin']), validateBody, validate, rolePagePermissionController.createRolePagePermission);
router.put('/:id', authMiddleware, requireRoles(['admin']), [...validateId, ...validateBody], validate, rolePagePermissionController.updateRolePagePermission);
router.delete('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, rolePagePermissionController.deleteRolePagePermission);

export default router;

