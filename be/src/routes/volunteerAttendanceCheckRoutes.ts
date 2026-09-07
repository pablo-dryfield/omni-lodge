import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction, requireRoles } from '../middleware/authorizationMiddleware.js';
import { getTaskAttendanceCheck, putTaskAttendanceCheck } from '../controllers/volunteerAttendanceCheckController.js';
import { MANAGER_ROLES } from './schedulingRoles.js';

const router = Router();
router.get('/logs/:logId/attendance-check', authMiddleware, requireRoles(MANAGER_ROLES),
  authorizeModuleAction('volunteer-progress', 'view'), getTaskAttendanceCheck);
router.put('/logs/:logId/attendance-check/:assignmentId', authMiddleware, requireRoles(MANAGER_ROLES),
  authorizeModuleAction('volunteer-progress', 'update'), putTaskAttendanceCheck);
export default router;
