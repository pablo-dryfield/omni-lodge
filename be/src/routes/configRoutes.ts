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
} from '../controllers/configController.js';

const router = Router();

router.use(authMiddleware, requireRoles(['admin']));

router.get('/', getConfigList);
router.get('/seed/runs', getConfigSeedRuns);
router.post('/seed/restore', restoreConfigDefaults);
router.get('/:key', getConfigByKey);
router.post('/:key', updateConfigKey);
router.post('/:key/reveal', revealConfigKey);
router.get('/:key/history', getConfigHistoryByKey);

export default router;
