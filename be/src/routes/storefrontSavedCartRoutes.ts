import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  createSavedCart,
  disableSavedCart,
  listSavedCarts,
  previewSavedCart,
} from '../controllers/storefrontSavedCartController.js';

const router = Router();

router.use(authMiddleware);
router.get('/', listSavedCarts);
router.post('/preview', previewSavedCart);
router.post('/', createSavedCart);
router.patch('/:publicId/disable', disableSavedCart);

export default router;
