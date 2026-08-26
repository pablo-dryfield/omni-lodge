import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  getConfigList,
  getConfigByKey,
  updateConfigKey,
  revealConfigKey,
  getConfigHistoryByKey,
  restoreConfigDefaults,
  getConfigSeedRuns,
  runConfigSeed,
  getConfigSeedCatalog,
  getConfigSeedPreview,
  markConfigSeedRun,
  discoverAndSaveTripAdvisorQueryId,
  getStripeTestListener,
  authenticateStripeTestListener,
  startStripeTestWebhookListener,
  stopStripeTestWebhookListener,
} from '../controllers/configController.js';

const router = Router();

router.use(authMiddleware, requireRoles(['admin']));

router.get('/', getConfigList);
router.get('/seed/runs', getConfigSeedRuns);
router.get('/seed/catalog', getConfigSeedCatalog);
router.get('/seed/preview', getConfigSeedPreview);
router.post('/seed/restore', restoreConfigDefaults);
router.post('/seed/run', runConfigSeed);
router.post('/seed/mark', markConfigSeedRun);
router.post('/tripadvisor/discover-query-id', discoverAndSaveTripAdvisorQueryId);
router.get('/stripe-test-listener/status', getStripeTestListener);
router.post('/stripe-test-listener/authenticate', authenticateStripeTestListener);
router.post('/stripe-test-listener/start', startStripeTestWebhookListener);
router.post('/stripe-test-listener/stop', stopStripeTestWebhookListener);
router.get('/:key', getConfigByKey);
router.post('/:key', updateConfigKey);
router.post('/:key/reveal', revealConfigKey);
router.get('/:key/history', getConfigHistoryByKey);

export default router;
