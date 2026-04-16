import express, { Router } from 'express';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  listTaskTemplates,
  createTaskTemplate,
  updateTaskTemplate,
  deleteTaskTemplate,
  listTaskAssignments,
  createTaskAssignment,
  bulkCreateTaskAssignments,
  updateTaskAssignment,
  deleteTaskAssignment,
  listTaskLogs,
  syncTaskLogsWithCurrentTemplateConfig,
  updateTaskLogStatus,
  createManualTaskLog,
  updateTaskLogMeta,
  uploadTaskLogEvidenceImage,
} from '../controllers/assistantManagerTaskController.js';
import {
  deleteTaskPushSubscription,
  getTaskPushConfig,
  sendTaskPushTestNotification,
  upsertTaskPushSubscription,
} from '../controllers/assistantManagerTaskPushController.js';

const router: Router = express.Router();
const managerGuard = requireRoles(['admin', 'owner', 'manager', 'assistant-manager']);
const upload = multer({ storage: multer.memoryStorage() });

router.get('/templates', authMiddleware, managerGuard, listTaskTemplates);
router.post('/templates', authMiddleware, managerGuard, createTaskTemplate);
router.put('/templates/:id', authMiddleware, managerGuard, updateTaskTemplate);
router.delete('/templates/:id', authMiddleware, managerGuard, deleteTaskTemplate);

router.get('/templates/:id/assignments', authMiddleware, managerGuard, listTaskAssignments);
router.post('/templates/:id/assignments', authMiddleware, managerGuard, createTaskAssignment);
router.post('/templates/assignments/bulk', authMiddleware, managerGuard, bulkCreateTaskAssignments);
router.put('/templates/:id/assignments/:assignmentId', authMiddleware, managerGuard, updateTaskAssignment);
router.delete('/templates/:id/assignments/:assignmentId', authMiddleware, managerGuard, deleteTaskAssignment);

router.get('/logs', authMiddleware, managerGuard, listTaskLogs);
router.post('/logs/sync-template-config', authMiddleware, managerGuard, syncTaskLogsWithCurrentTemplateConfig);
router.put('/logs/:id', authMiddleware, managerGuard, updateTaskLogStatus);
router.post('/logs/manual', authMiddleware, managerGuard, createManualTaskLog);
router.patch('/logs/:id/meta', authMiddleware, managerGuard, updateTaskLogMeta);
router.post('/logs/:id/evidence-files', authMiddleware, managerGuard, upload.single('file'), uploadTaskLogEvidenceImage);

router.get('/push/config', authMiddleware, managerGuard, getTaskPushConfig);
router.put('/push/subscription', authMiddleware, managerGuard, upsertTaskPushSubscription);
router.delete('/push/subscription', authMiddleware, managerGuard, deleteTaskPushSubscription);
router.post('/push/test', authMiddleware, managerGuard, sendTaskPushTestNotification);

export default router;
