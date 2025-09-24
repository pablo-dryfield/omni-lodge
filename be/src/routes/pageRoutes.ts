import express, { Request, Response, NextFunction, Router } from 'express';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import * as pageController from '../controllers/pageController.js';

const router: Router = express.Router();

const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer'),
];

const validatePageCreateBody = [
  check('slug').isString().trim().notEmpty().withMessage('Slug is required'),
  check('name').isString().trim().notEmpty().withMessage('Name is required'),
];

const validatePageUpdateBody = [
  check('slug')
    .optional({ nullable: true })
    .isString()
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Slug is required'),
  check('name')
    .optional({ nullable: true })
    .isString()
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Name is required'),
];

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

router.get('/', authMiddleware, pageController.getAllPages);
router.get('/:id', authMiddleware, validateId, validate, pageController.getPageById);
router.post('/', authMiddleware, validatePageCreateBody, validate, pageController.createPage);
router.put(
  '/:id',
  authMiddleware,
  [...validateId, ...validatePageUpdateBody],
  validate,
  pageController.updatePage,
);
router.delete('/:id', authMiddleware, validateId, validate, pageController.deletePage);

export default router;
