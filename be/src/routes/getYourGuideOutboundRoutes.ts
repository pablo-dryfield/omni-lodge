import express, { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { getOutboundDefaults, runOutboundSelfTest } from '../controllers/getYourGuideOutboundController.js';

const router: Router = express.Router();
const managerGuard = requireRoles(['admin', 'owner', 'manager']);

router.get('/defaults', authMiddleware, managerGuard, getOutboundDefaults);
router.post('/self-test', authMiddleware, managerGuard, runOutboundSelfTest);

export default router;
