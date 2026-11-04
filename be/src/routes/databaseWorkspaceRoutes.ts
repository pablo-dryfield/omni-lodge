import { Router } from 'express';
import { authenticateWorkspace as authMiddleware } from '../middleware/databaseWorkspaceAuthentication.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { workspaceViewGate } from '../services/databaseWorkspace/access.js';
import * as controller from '../controllers/databaseWorkspaceController.js';
import * as sessions from '../controllers/databaseWorkspaceSessionController.js';
import { monitorSnapshot } from '../controllers/databaseWorkspaceMonitorController.js';
import {
  importStage,
  importReview,
} from '../controllers/databaseWorkspaceImportController.js';
import {
  adminOperation,
  schemaInspect,
  schemaCompare,
  privilegesInspect,
} from '../controllers/databaseWorkspaceAdminController.js';
import {
  exportQuery,
  recordExport,
  shareRecipients,
  createShare,
  openShare,
  sharedResult,
  sharedExportAudit,
  downloadResult,
} from '../controllers/databaseWorkspaceExportController.js';
import {
  schedulesList,
  scheduleCreate,
  scheduleAction,
} from '../controllers/databaseWorkspaceScheduleController.js';
import {
  backupInventory,
  backupCreate,
  restoreStage,
  restoreReview,
  backupDelete,
  backupDownload,
} from '../controllers/databaseWorkspaceRecoveryController.js';

const router = Router();
router.use(authMiddleware, requireRoles(['admin']), workspaceViewGate);
router.get('/capabilities', controller.workspaceCapabilities);
router.post('/validate', controller.workspaceValidate);
router.post('/reviews', controller.workspaceReview);
router.post('/executions', controller.workspaceExecute);
router.get('/executions/:id', controller.workspaceStatus);
router.post('/executions/:id/cancel', controller.workspaceCancel);
router.post('/executions/:id/results/:index', controller.workspaceResult);
router.get('/history', controller.workspaceHistory);
router.get('/catalog', controller.workspaceCatalog);
router.get('/completion-schema', controller.workspaceCompletions);
router.get('/catalog/:oid', controller.workspaceObject);
router.get('/documents', controller.workspaceDocuments);
router.post('/documents', controller.workspaceSaveDocument);
router.delete('/documents/:id', controller.workspaceDeleteDocument);
router.get('/documents/:id/revisions', controller.workspaceDocumentRevisions);
router.get('/audit', controller.workspaceAudit);
router.get('/administration/executions/:id', controller.workspaceAdminJob);
router.post(
  '/administration/executions/:id/cancel',
  controller.workspaceAdminCancel,
);
router.post('/table-views', controller.workspaceTableView);
router.get('/table-views/:id/page', controller.workspaceTablePage);
router.post('/data-changes', controller.workspaceDataChange);
router.get('/sessions', sessions.sessionList);
router.get('/activity', monitorSnapshot);
router.post('/imports', importStage);
router.post('/imports/:id', importReview);
router.post('/administration/operations', adminOperation);
router.get('/schema', schemaInspect);
router.get('/privileges', privilegesInspect);
router.post('/exports', exportQuery);
router.get('/executions/:id/download', downloadResult);
router.post('/executions/:id/export-audit', recordExport);
router.get('/share-recipients', shareRecipients);
router.post('/shares', createShare);
router.get('/shares/:id', openShare);
router.post('/shares/:id/results', sharedResult);
router.post('/shares/:id/export-audit', sharedExportAudit);
router.get('/schedules', schedulesList);
router.post('/schedules', scheduleCreate);
router.post('/schedules/:id', scheduleAction);
router.get('/backups', backupInventory);
router.get('/backups/:id/download', backupDownload);
router.post('/backups', backupCreate);
router.post('/backups/delete', backupDelete);
router.post('/restores/stage', restoreStage);
router.post('/restores/review', restoreReview);
router.post('/schema/compare', schemaCompare);
router.post('/sessions', sessions.sessionOpen);
router.get('/sessions/:id', sessions.sessionStatus);
router.post('/sessions/:id/commands', sessions.sessionCommand);
export default router;
