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

const router: Router = express.Router();

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
