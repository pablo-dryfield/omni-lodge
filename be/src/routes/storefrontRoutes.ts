import { Router } from 'express';
import {
  getStorefrontProduct,
  listStorefrontProducts,
} from '../controllers/storefrontController.js';

const router = Router();

router.get('/products', listStorefrontProducts);
router.get('/products/:slug', getStorefrontProduct);

export default router;
