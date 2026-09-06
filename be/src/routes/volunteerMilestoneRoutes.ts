import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import {
  getMyVolunteerMilestones,
  getVolunteerMilestones,
  listVolunteerMilestones,
  putVolunteerAttendance,
  putVolunteerManagementFeedback,
} from '../controllers/volunteerMilestoneController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction, requireRoles } from '../middleware/authorizationMiddleware.js';
import { VOLUNTEER_ATTENDANCE_STATUSES } from '../models/VolunteerShiftAttendance.js';
import { MANAGER_ROLES } from './schedulingRoles.js';

const router = Router();
const MODULE_SLUG = 'volunteer-progress';
const managerGuard = requireRoles(MANAGER_ROLES);

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

const validateBodyKeys = (allowedKeys: readonly string[]) => (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const source = req.body;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    res.status(400).json({ message: 'A JSON object body is required.' });
    return;
  }
  const unknownKeys = Object.keys(source).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    res.status(400).json({ message: `Unknown field${unknownKeys.length === 1 ? '' : 's'}: ${unknownKeys.join(', ')}` });
    return;
  }
  next();
};

const periodQueryValidator = query('period')
  .optional()
  .isString()
  .matches(/^\d{4}-(0[1-9]|1[0-2])$/u)
  .withMessage('period must use YYYY-MM format');

const userIdValidator = param('userId')
  .isInt({ gt: 0 })
  .withMessage('userId must be a positive integer')
  .toInt();

router.get(
  '/me',
  authMiddleware,
  authorizeModuleAction(MODULE_SLUG, 'view'),
  periodQueryValidator,
  validate,
  getMyVolunteerMilestones,
);

router.get(
  '/',
  authMiddleware,
  managerGuard,
  authorizeModuleAction(MODULE_SLUG, 'view'),
  periodQueryValidator,
  validate,
  listVolunteerMilestones,
);

router.put(
  '/attendance/:shiftAssignmentId',
  authMiddleware,
  managerGuard,
  authorizeModuleAction(MODULE_SLUG, 'update'),
  validateBodyKeys(['status', 'notes']),
  param('shiftAssignmentId')
    .isInt({ gt: 0 })
    .withMessage('shiftAssignmentId must be a positive integer')
    .toInt(),
  body('status')
    .isIn(VOLUNTEER_ATTENDANCE_STATUSES)
    .withMessage(`status must be one of: ${VOLUNTEER_ATTENDANCE_STATUSES.join(', ')}`),
  body('notes')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 2000 })
    .withMessage('notes must be at most 2000 characters'),
  periodQueryValidator,
  validate,
  putVolunteerAttendance,
);

router.patch(
  '/:userId/:period/feedback',
  authMiddleware,
  managerGuard,
  authorizeModuleAction(MODULE_SLUG, 'update'),
  validateBodyKeys(['feedback', 'approved']),
  userIdValidator,
  param('period')
    .matches(/^\d{4}-(0[1-9]|1[0-2])$/u)
    .withMessage('period must use YYYY-MM format'),
  body('feedback')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 5000 })
    .withMessage('feedback must be at most 5000 characters'),
  body('approved')
    .exists()
    .withMessage('approved is required')
    .isBoolean()
    .withMessage('approved must be boolean')
    .toBoolean(),
  validate,
  putVolunteerManagementFeedback,
);

router.get(
  '/:userId',
  authMiddleware,
  managerGuard,
  authorizeModuleAction(MODULE_SLUG, 'view'),
  userIdValidator,
  periodQueryValidator,
  validate,
  getVolunteerMilestones,
);

export default router;
