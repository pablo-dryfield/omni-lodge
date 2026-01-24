import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { getPm2Processes, restartPm2Process, getPm2Logs, getLogFile } from '../controllers/pm2Controller.js';

const router = Router();

router.use(authMiddleware, requireRoles(['admin']));

router.get('/processes', getPm2Processes);
router.get('/processes/:id/logs', getPm2Logs);
router.get('/log-files/:target', getLogFile);
router.post('/processes/:id/restart', restartPm2Process);

export default router;
