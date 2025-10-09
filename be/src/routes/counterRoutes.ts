import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  createOrLoadCounter,
  getCounterByDate,
  getCounterById,
  updateCounter,
  deleteCounter,
  updateCounterStaff,
  upsertCounterMetrics,
} from '../controllers/counterController.js';

const router: Router = express.Router();

router.post('/', authMiddleware, createOrLoadCounter);
router.get('/', authMiddleware, getCounterByDate);
router.get('/:id', authMiddleware, getCounterById);
router.put('/:id', authMiddleware, updateCounter);
router.patch('/:id', authMiddleware, updateCounter);
router.delete('/:id', authMiddleware, deleteCounter);
router.patch('/:id/staff', authMiddleware, updateCounterStaff);
router.put('/:id/metrics', authMiddleware, upsertCounterMetrics);

export default router;
