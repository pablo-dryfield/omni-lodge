import express, { NextFunction, Request, Response, Router } from 'express';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import * as staffProfileController from '../controllers/staffProfileController.js';

const router: Router = express.Router();

const STAFF_TYPE_VALUES = ['volunteer', 'long_term'] as const;

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

const validateUserIdParam = [
  param('userId')
    .isInt({ gt: 0 })
    .withMessage('userId must be a positive integer')
    .toInt(),
];

const createValidators = [
  check('userId')
    .isInt({ gt: 0 })
    .withMessage('userId must be a positive integer')
    .toInt(),
  check('staffType')
    .isString()
    .trim()
    .custom((value) => STAFF_TYPE_VALUES.includes(value as (typeof STAFF_TYPE_VALUES)[number]))
    .withMessage(`staffType must be one of: ${STAFF_TYPE_VALUES.join(', ')}`),
  check('livesInAccom')
    .optional()
    .isBoolean()
    .withMessage('livesInAccom must be boolean')
    .toBoolean(),
  check('active')
    .optional()
    .isBoolean()
    .withMessage('active must be boolean')
    .toBoolean(),
];

const updateValidators = [
  check('staffType')
    .optional()
    .isString()
    .trim()
    .custom((value) => STAFF_TYPE_VALUES.includes(value as (typeof STAFF_TYPE_VALUES)[number]))
    .withMessage(`staffType must be one of: ${STAFF_TYPE_VALUES.join(', ')}`),
  check('livesInAccom')
    .optional()
    .isBoolean()
    .withMessage('livesInAccom must be boolean')
    .toBoolean(),
  check('active')
    .optional()
    .isBoolean()
    .withMessage('active must be boolean')
    .toBoolean(),
];

router.get(
  '/',
  authMiddleware,
  authorizeModuleAction('staff-profile-directory', 'view'),
  validate,
  staffProfileController.listStaffProfiles,
);

router.get(
  '/:userId',
  authMiddleware,
  authorizeModuleAction('staff-profile-directory', 'view'),
  validateUserIdParam,
  validate,
  staffProfileController.getStaffProfile,
);

router.post(
  '/',
  authMiddleware,
  authorizeModuleAction('staff-profile-directory', 'create'),
  createValidators,
  validate,
  staffProfileController.createStaffProfile,
);

router.patch(
  '/:userId',
  authMiddleware,
  authorizeModuleAction('staff-profile-directory', 'update'),
  validateUserIdParam,
  updateValidators,
  validate,
  staffProfileController.updateStaffProfile,
);

router.delete(
  '/:userId',
  authMiddleware,
  authorizeModuleAction('staff-profile-directory', 'delete'),
  validateUserIdParam,
  validate,
  staffProfileController.deleteStaffProfile,
);

export default router;

