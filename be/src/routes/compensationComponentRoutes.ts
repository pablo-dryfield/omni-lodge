import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  listCompensationComponents,
  createCompensationComponent,
  updateCompensationComponent,
  deleteCompensationComponent,
  listCompensationComponentAssignments,
  createCompensationComponentAssignment,
  updateCompensationComponentAssignment,
  deleteCompensationComponentAssignment,
} from '../controllers/compensationComponentController.js';

const router: Router = express.Router();

const roleGuard = requireRoles(['admin', 'owner']);

router.get('/', authMiddleware, roleGuard, listCompensationComponents);
router.post('/', authMiddleware, roleGuard, createCompensationComponent);
router.put('/:id', authMiddleware, roleGuard, updateCompensationComponent);
router.delete('/:id', authMiddleware, roleGuard, deleteCompensationComponent);

router.get('/:id/assignments', authMiddleware, roleGuard, listCompensationComponentAssignments);
router.post('/:id/assignments', authMiddleware, roleGuard, createCompensationComponentAssignment);
router.put('/:id/assignments/:assignmentId', authMiddleware, roleGuard, updateCompensationComponentAssignment);
router.delete('/:id/assignments/:assignmentId', authMiddleware, roleGuard, deleteCompensationComponentAssignment);

export default router;
