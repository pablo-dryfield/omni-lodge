import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  createCurrency,
  deleteCurrency,
  listCurrencies,
  listCurrencyExchangeRateHistory,
  listCurrencyOptions,
  updateCurrency,
} from '../controllers/currencyController.js';

const router: Router = express.Router();

router.get('/', authMiddleware, requireRoles(['admin']), listCurrencies);
router.get('/options', authMiddleware, listCurrencyOptions);
router.get('/:code/history', authMiddleware, requireRoles(['admin']), listCurrencyExchangeRateHistory);
router.post('/', authMiddleware, requireRoles(['admin']), createCurrency);
router.put('/:code', authMiddleware, requireRoles(['admin']), updateCurrency);
router.delete('/:code', authMiddleware, requireRoles(['admin']), deleteCurrency);

export default router;
