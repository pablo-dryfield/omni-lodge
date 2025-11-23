import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  listVenueCompensationTerms,
  createVenueCompensationTerm,
  updateVenueCompensationTerm,
  deleteVenueCompensationTerm,
} from '../controllers/venueCompensationTermController.js';

const router = Router();

router.get('/', authMiddleware, listVenueCompensationTerms);
router.post('/', authMiddleware, createVenueCompensationTerm);
router.put('/:id', authMiddleware, updateVenueCompensationTerm);
router.patch('/:id', authMiddleware, updateVenueCompensationTerm);
router.delete('/:id', authMiddleware, deleteVenueCompensationTerm);

export default router;

