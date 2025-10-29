import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { MANAGER_ROLES } from './schedulingRoles.js';
import {
  listShiftRoles,
  createShiftRole,
  updateShiftRole,
  deleteShiftRole,
  listUserShiftRoleAssignments,
  updateUserShiftRoles,
} from '../controllers/shiftRoleController.js';

const router = Router();

router.get('/', authMiddleware, requireRoles(MANAGER_ROLES), listShiftRoles);
router.post('/', authMiddleware, requireRoles(MANAGER_ROLES), createShiftRole);
router.patch('/:id', authMiddleware, requireRoles(MANAGER_ROLES), updateShiftRole);
router.delete('/:id', authMiddleware, requireRoles(MANAGER_ROLES), deleteShiftRole);

router.get('/assignments', authMiddleware, requireRoles(MANAGER_ROLES), listUserShiftRoleAssignments);
router.put('/assignments/:userId', authMiddleware, requireRoles(MANAGER_ROLES), updateUserShiftRoles);

export default router;

