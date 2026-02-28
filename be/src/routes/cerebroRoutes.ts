import express, { NextFunction, Request, Response } from 'express';
import { param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import {
  acknowledgeCerebroEntry,
  createCerebroEntry,
  createCerebroQuiz,
  createCerebroSection,
  getCerebroBootstrap,
  getCerebroEntries,
  getCerebroQuizzes,
  getCerebroSections,
  submitCerebroQuiz,
  updateCerebroEntry,
  updateCerebroQuiz,
  updateCerebroSection,
} from '../controllers/cerebroController.js';

const router = express.Router();

const validateId = [param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/bootstrap', authMiddleware, authorizeModuleAction('cerebro-library', 'view'), getCerebroBootstrap);
router.get('/sections', authMiddleware, authorizeModuleAction('cerebro-admin', 'view'), getCerebroSections);
router.get('/entries', authMiddleware, authorizeModuleAction('cerebro-admin', 'view'), getCerebroEntries);
router.get('/quizzes', authMiddleware, authorizeModuleAction('cerebro-admin', 'view'), getCerebroQuizzes);

router.post('/sections', authMiddleware, authorizeModuleAction('cerebro-admin', 'create'), createCerebroSection);
router.put('/sections/:id', authMiddleware, authorizeModuleAction('cerebro-admin', 'update'), validateId, validate, updateCerebroSection);
router.post('/entries', authMiddleware, authorizeModuleAction('cerebro-admin', 'create'), createCerebroEntry);
router.put('/entries/:id', authMiddleware, authorizeModuleAction('cerebro-admin', 'update'), validateId, validate, updateCerebroEntry);
router.post('/quizzes', authMiddleware, authorizeModuleAction('cerebro-admin', 'create'), createCerebroQuiz);
router.put('/quizzes/:id', authMiddleware, authorizeModuleAction('cerebro-admin', 'update'), validateId, validate, updateCerebroQuiz);
router.post('/entries/:id/acknowledge', authMiddleware, authorizeModuleAction('cerebro-library', 'create'), validateId, validate, acknowledgeCerebroEntry);
router.post('/quizzes/:id/submit', authMiddleware, authorizeModuleAction('cerebro-library', 'create'), validateId, validate, submitCerebroQuiz);

export default router;
