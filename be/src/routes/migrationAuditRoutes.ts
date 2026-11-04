import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  listMigrationAuditRuns,
  migrationAuditDetails,
} from '../controllers/migrationAuditController.js';

const router = Router();

router.use(authMiddleware, requireRoles(['admin']));

router.get('/audit', listMigrationAuditRuns);
router.get('/audit/:runId', migrationAuditDetails);

export default router;
