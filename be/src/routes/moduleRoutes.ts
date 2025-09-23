import express, { Request, Response, NextFunction, Router } from 'express';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import * as moduleController from '../controllers/moduleController.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

const validateModuleBody = [
  check('pageId').isInt({ gt: 0 }).withMessage('pageId must be a positive integer'),
  check('slug').isString().trim().notEmpty().withMessage('Slug is required'),
  check('name').isString().trim().notEmpty().withMessage('Name is required')
];

const validatePageId = [
  param('pageId').isInt({ gt: 0 }).withMessage('Page ID must be a positive integer')
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, requireRoles(['admin']), validate, moduleController.getAllModules);
router.get('/page/:pageId', authMiddleware, requireRoles(['admin']), validatePageId, validate, moduleController.getModulesByPage);
router.get('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, moduleController.getModuleById);
router.post('/', authMiddleware, requireRoles(['admin']), validateModuleBody, validate, moduleController.createModule);
router.put('/:id', authMiddleware, requireRoles(['admin']), [...validateId, ...validateModuleBody], validate, moduleController.updateModule);
router.delete('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, moduleController.deleteModule);

export default router;

