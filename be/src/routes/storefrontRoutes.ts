import { Router } from 'express';
import {
  getStorefrontProduct,
  listStorefrontProducts,
} from '../controllers/storefrontController.js';
import {
  confirmCheckout,
  createCheckout,
  getOrder,
  getStorefrontConfig,
  quoteCart,
} from '../controllers/storefrontCommerceController.js';
import { getPublicSavedCart } from '../controllers/storefrontSavedCartController.js';

const router = Router();

router.get('/config', getStorefrontConfig);
router.post('/cart/quote', quoteCart);
router.post('/checkout', createCheckout);
router.post('/orders/:publicId/confirm', confirmCheckout);
router.get('/orders/:publicId', getOrder);
router.get('/products', listStorefrontProducts);
router.get('/products/:slug', getStorefrontProduct);
router.get('/saved-carts/:publicId', getPublicSavedCart);

export default router;
