import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  listVenueCompensationTermRates,
  createVenueCompensationTermRate,
  updateVenueCompensationTermRate,
  deleteVenueCompensationTermRate,
} from '../controllers/venueCompensationTermRateController.js';

const router = Router();

router.get('/', authMiddleware, listVenueCompensationTermRates);
router.post('/', authMiddleware, createVenueCompensationTermRate);
router.put('/:id', authMiddleware, updateVenueCompensationTermRate);
router.patch('/:id', authMiddleware, updateVenueCompensationTermRate);
router.delete('/:id', authMiddleware, deleteVenueCompensationTermRate);

export default router;

