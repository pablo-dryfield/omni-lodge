import express, { Request, Response, NextFunction, Router } from 'express';
import * as userController from '../controllers/userController.js';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

const validateUserPOST = [
  check('username').isString().trim().isLength({ min: 3, max: 50 }).withMessage('Username must be a string between 3 and 50 characters'),
  check('email').trim().isEmail().normalizeEmail().withMessage('Email must be a valid email address'),
  check('password').trim().isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
];

const validateUserLogin = [
  check('password').trim().exists().withMessage('Password is required')
];

const validateUserPUT = [
  check('username').optional().isString().trim().isLength({ min: 3, max: 50 }).withMessage('Username must be a string between 3 and 50 characters'),
  check('email').optional().trim().isEmail().withMessage('Email must be a valid email address'),
  check('password').optional().trim().isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.post('/register', validateUserPOST, validate, userController.registerUser);
router.post('/login', validateUserLogin, validate, userController.loginUser);
router.post('/logout', validate, userController.logoutUser);

router.get('/', authMiddleware, authorizeModuleAction('user-directory', 'view'), validate, userController.getAllUsers);
router.get('/active', authMiddleware, authorizeModuleAction('user-directory', 'view'), validate, userController.getAllActiveUsers);
router.get('/:id', authMiddleware, authorizeModuleAction('user-directory', 'view'), validateId, validate, userController.getUserById);
router.put('/:id', authMiddleware, authorizeModuleAction('user-directory', 'update'), [...validateId, ...validateUserPUT], validate, userController.updateUser);
router.delete('/:id', authMiddleware, authorizeModuleAction('user-directory', 'delete'), validateId, validate, userController.deleteUser);

export default router;

