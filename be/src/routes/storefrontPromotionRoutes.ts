import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import {
  createPromotion,
  deletePromotion,
  importEcwidPromotions,
  listPromotions,
  pushPromotionToEcwid,
  updatePromotion,
} from '../controllers/storefrontPromotionController.js';

const router = express.Router();
const moduleSlug = 'storefront-promotion-management';

router.get('/', authMiddleware, authorizeModuleAction(moduleSlug, 'view'), listPromotions);
router.post('/', authMiddleware, authorizeModuleAction(moduleSlug, 'create'), createPromotion);
router.put('/:id', authMiddleware, authorizeModuleAction(moduleSlug, 'update'), updatePromotion);
router.delete('/:id', authMiddleware, authorizeModuleAction(moduleSlug, 'delete'), deletePromotion);
router.post('/:id/sync-ecwid', authMiddleware, authorizeModuleAction(moduleSlug, 'update'), pushPromotionToEcwid);
router.post('/sync/ecwid-import', authMiddleware, authorizeModuleAction(moduleSlug, 'create'), importEcwidPromotions);

export default router;
