import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  createOrLoadCounter,
  upsertCounterSetup,
  getCounterByDate,
  getCounterById,
  updateCounter,
  deleteCounter,
  updateCounterStaff,
  commitCounterRegistry,
  finalizeCounterReservations,
  upsertCounterMetrics,
} from '../controllers/counterController.js';
import { requireCounterProductScope } from '../services/productScopeService.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { addStaffFreeEntry, listStaffFreeEntries, removeStaffFreeEntry, staffFreeHistory } from '../controllers/staffFreeEntryController.js';

const router: Router = express.Router();
const staffFreeRoles = requireRoles(['admin', 'administrator', 'owner', 'manager', 'assistant-manager']);

router.get('/:id/staff-free-entries', authMiddleware, requireCounterProductScope, staffFreeRoles, listStaffFreeEntries);
router.get('/:id/staff-free-entries/history/:userId', authMiddleware, requireCounterProductScope, staffFreeRoles, staffFreeHistory);
router.post('/:id/staff-free-entries', authMiddleware, requireCounterProductScope, staffFreeRoles, addStaffFreeEntry);
router.post('/:id/staff-free-entries/:entryId/cancel', authMiddleware, requireCounterProductScope, staffFreeRoles, removeStaffFreeEntry);

router.post('/', authMiddleware, createOrLoadCounter);
router.post('/setup', authMiddleware, upsertCounterSetup);
router.get('/', authMiddleware, getCounterByDate);
router.get('/:id', authMiddleware, requireCounterProductScope, getCounterById);
router.put('/:id', authMiddleware, requireCounterProductScope, updateCounter);
router.patch('/:id', authMiddleware, requireCounterProductScope, updateCounter);
router.delete('/:id', authMiddleware, requireCounterProductScope, deleteCounter);
router.patch('/:id/staff', authMiddleware, requireCounterProductScope, updateCounterStaff);
router.post('/:id/commit', authMiddleware, requireCounterProductScope, commitCounterRegistry);
router.post('/:id/finalize-reservations', authMiddleware, requireCounterProductScope, finalizeCounterReservations);
router.put('/:id/metrics', authMiddleware, requireCounterProductScope, upsertCounterMetrics);

export default router;
