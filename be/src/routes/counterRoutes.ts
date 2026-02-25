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

const router: Router = express.Router();

router.post('/', authMiddleware, createOrLoadCounter);
router.post('/setup', authMiddleware, upsertCounterSetup);
router.get('/', authMiddleware, getCounterByDate);
router.get('/:id', authMiddleware, getCounterById);
router.put('/:id', authMiddleware, updateCounter);
router.patch('/:id', authMiddleware, updateCounter);
router.delete('/:id', authMiddleware, deleteCounter);
router.patch('/:id/staff', authMiddleware, updateCounterStaff);
router.post('/:id/commit', authMiddleware, commitCounterRegistry);
router.post('/:id/finalize-reservations', authMiddleware, finalizeCounterReservations);
router.put('/:id/metrics', authMiddleware, upsertCounterMetrics);

export default router;
