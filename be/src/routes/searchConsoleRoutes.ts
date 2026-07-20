import { Router } from 'express';
import {
  analyzeGoogleSerpController,
  createSeoActionLogController,
  getSeoActionLogs,
  getSearchConsolePerformanceRows,
  getSearchConsoleSites,
  inspectSearchConsoleUrlController,
} from '../controllers/searchConsoleController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';

const router = Router();

router.use(authMiddleware, requireRoles(['admin', 'owner', 'manager']));

router.get('/sites', getSearchConsoleSites);
router.get('/performance', getSearchConsolePerformanceRows);
router.post('/inspect-url', inspectSearchConsoleUrlController);
router.post('/serp-analysis', analyzeGoogleSerpController);
router.get('/actions', getSeoActionLogs);
router.post('/actions', createSeoActionLogController);

export default router;
