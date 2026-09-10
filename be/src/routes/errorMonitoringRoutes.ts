import { Router } from 'express';

import {
  addIssueNote,
  deleteIssueNote,
  getIssue,
  getSummary,
  listIssues,
  patchIssue,
  runCleanup,
} from '../controllers/errorMonitoringController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction, requireRoles } from '../middleware/authorizationMiddleware.js';

const router = Router();

router.use(authMiddleware, requireRoles(['admin', 'administrator', 'owner']));

const canView = authorizeModuleAction('error-monitoring-dashboard', 'view');
const canUpdate = authorizeModuleAction('error-monitoring-dashboard', 'update');

router.get('/summary', canView, getSummary);
router.get('/issues', canView, listIssues);
router.get('/issues/:id', canView, getIssue);
router.patch('/issues/:id', canUpdate, patchIssue);
router.patch('/issues/:id/status', canUpdate, patchIssue);
router.post('/issues/:id/notes', canUpdate, addIssueNote);
router.delete('/issues/:id/notes/:noteId', canUpdate, deleteIssueNote);
router.post('/cleanup', canUpdate, runCleanup);

export default router;
