import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  listTaskTemplates,
  createTaskTemplate,
  updateTaskTemplate,
  deleteTaskTemplate,
  listTaskAssignments,
  createTaskAssignment,
  updateTaskAssignment,
  deleteTaskAssignment,
  listTaskLogs,
  updateTaskLogStatus,
} from '../controllers/assistantManagerTaskController.js';

const router: Router = express.Router();
const managerGuard = requireRoles(['admin', 'owner', 'manager']);

router.get('/templates', authMiddleware, managerGuard, listTaskTemplates);
router.post('/templates', authMiddleware, managerGuard, createTaskTemplate);
router.put('/templates/:id', authMiddleware, managerGuard, updateTaskTemplate);
router.delete('/templates/:id', authMiddleware, managerGuard, deleteTaskTemplate);

router.get('/templates/:id/assignments', authMiddleware, managerGuard, listTaskAssignments);
router.post('/templates/:id/assignments', authMiddleware, managerGuard, createTaskAssignment);
router.put('/templates/:id/assignments/:assignmentId', authMiddleware, managerGuard, updateTaskAssignment);
router.delete('/templates/:id/assignments/:assignmentId', authMiddleware, managerGuard, deleteTaskAssignment);

router.get('/logs', authMiddleware, managerGuard, listTaskLogs);
router.put('/logs/:id', authMiddleware, managerGuard, updateTaskLogStatus);

export default router;
