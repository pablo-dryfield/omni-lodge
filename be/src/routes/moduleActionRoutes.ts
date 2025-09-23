import express, { Request, Response, NextFunction, Router } from 'express';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import * as moduleActionController from '../controllers/moduleActionController.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

const validateModuleActionBody = [
  check('moduleId').isInt({ gt: 0 }).withMessage('moduleId must be a positive integer'),
  check('actionId').isInt({ gt: 0 }).withMessage('actionId must be a positive integer')
];

const validateModuleId = [
  param('moduleId').isInt({ gt: 0 }).withMessage('Module ID must be a positive integer')
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, requireRoles(['admin']), validate, moduleActionController.getAllModuleActions);
router.get('/module/:moduleId', authMiddleware, requireRoles(['admin']), validateModuleId, validate, moduleActionController.getModuleActionsByModule);
router.get('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, moduleActionController.getModuleActionById);
router.post('/', authMiddleware, requireRoles(['admin']), validateModuleActionBody, validate, moduleActionController.createModuleAction);
router.put('/:id', authMiddleware, requireRoles(['admin']), [...validateId, ...validateModuleActionBody], validate, moduleActionController.updateModuleAction);
router.delete('/:id', authMiddleware, requireRoles(['admin']), validateId, validate, moduleActionController.deleteModuleAction);

export default router;

