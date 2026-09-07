import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import {
  getMyVolunteerMilestones,
  getVolunteerMilestones,
  listVolunteerMilestones,
  putVolunteerAttendance,
  putVolunteerManagementFeedback,
  createVolunteerStay,
  updateVolunteerStay,
  putVolunteerStayFeedback,
  streamVolunteerProfilePhoto,
} from '../controllers/volunteerMilestoneController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction, requireRoles } from '../middleware/authorizationMiddleware.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { VOLUNTEER_ATTENDANCE_STATUSES } from '../models/VolunteerShiftAttendance.js';
import { isSchedulingManagerRole, MANAGER_ROLES } from './schedulingRoles.js';

const router = Router();
const MODULE_SLUG = 'volunteer-progress';
const managerGuard = requireRoles(MANAGER_ROLES);

const validate = (req: Request, res: Response, next: NextFunction): void => {
  if (req.query.period != null && req.query.stayId != null) {
    res.status(400).json({ message: 'Choose either a saved stay or a calendar period.' });
    return;
  }
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

const stayIdQueryValidator = query('stayId').optional().isInt({ gt: 0 }).withMessage('stayId must be a positive integer').toInt();
const stayIdValidator = param('stayId').isInt({ gt: 0 }).withMessage('stayId must be a positive integer').toInt();
const revisionValidator = body('expectedRevision').isInt({ gt: 0 }).withMessage('expectedRevision must be a positive integer').toInt();
const stayFields = ['startDate', 'endDate', 'position', 'monthlyTargets', 'shiftTypeIds', 'changeReason'] as const;

const selfOrManagerGuard = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const requestedUserId = Number(req.params.userId);
  const context = req.authContext;
  if (context?.id === requestedUserId || isSchedulingManagerRole(context?.roleSlug, context?.userTypeSlug)) {
    next();
    return;
  }
  res.status(403).json([{ message: 'Forbidden' }]);
};

router.get(
  '/me',
  authMiddleware,
  authorizeModuleAction(MODULE_SLUG, 'view'),
  periodQueryValidator,
  stayIdQueryValidator,
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

router.post(
  '/:userId/stays',
  authMiddleware, managerGuard, authorizeModuleAction(MODULE_SLUG, 'update'),
  validateBodyKeys(stayFields), userIdValidator, validate, createVolunteerStay,
);

router.patch(
  '/:userId/stays/:stayId',
  authMiddleware, managerGuard, authorizeModuleAction(MODULE_SLUG, 'update'),
  validateBodyKeys([...stayFields, 'expectedRevision']), userIdValidator, stayIdValidator,
  revisionValidator, validate, updateVolunteerStay,
);

router.patch(
  '/:userId/stays/:stayId/feedback',
  authMiddleware, managerGuard, authorizeModuleAction(MODULE_SLUG, 'update'),
  validateBodyKeys(['feedback', 'approved', 'expectedRevision']), userIdValidator, stayIdValidator,
  revisionValidator,
  body('feedback').optional({ nullable: true }).isString().isLength({ max: 5000 }),
  body('approved').isBoolean().toBoolean(), validate, putVolunteerStayFeedback,
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
  stayIdQueryValidator,
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
  '/:userId/profile-photo',
  authMiddleware,
  authorizeModuleAction(MODULE_SLUG, 'view'),
  userIdValidator,
  validate,
  selfOrManagerGuard,
  streamVolunteerProfilePhoto,
);

router.get(
  '/:userId',
  authMiddleware,
  managerGuard,
  authorizeModuleAction(MODULE_SLUG, 'view'),
  userIdValidator,
  periodQueryValidator,
  stayIdQueryValidator,
  validate,
  getVolunteerMilestones,
);

export default router;
