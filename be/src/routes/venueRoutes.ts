import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  listVenues,
  getVenueById,
  createVenue,
  updateVenue,
  deleteVenue,
} from '../controllers/venueController.js';

const router = Router();

router.get('/', authMiddleware, listVenues);
router.get('/:id', authMiddleware, getVenueById);
router.post('/', authMiddleware, createVenue);
router.put('/:id', authMiddleware, updateVenue);
router.patch('/:id', authMiddleware, updateVenue);
router.delete('/:id', authMiddleware, deleteVenue);

export default router;

