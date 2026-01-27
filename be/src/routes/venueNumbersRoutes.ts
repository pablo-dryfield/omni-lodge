import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  getVenueNumbersEntriesBootstrap,
  getVenueNumbersSummaryBootstrap,
  getVenueNumbersSummary,
} from '../controllers/venueNumbersController.js';

const router = Router();

router.get('/bootstrap', authMiddleware, (req, res) => {
  const tab = typeof req.query.tab === 'string' ? req.query.tab.toLowerCase() : 'entries';
  if (tab === 'summary') {
    return getVenueNumbersSummaryBootstrap(req, res);
  }
  return getVenueNumbersEntriesBootstrap(req, res);
});
router.get('/summary', authMiddleware, getVenueNumbersSummary);

export default router;
