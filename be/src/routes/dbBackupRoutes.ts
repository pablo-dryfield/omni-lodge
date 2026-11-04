import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import {
  getDbBackups,
  downloadDbBackup,
  restoreDbBackup,
  uploadAndRestoreDbBackup,
  createDbBackup,
} from '../controllers/dbBackupController.js';

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const sanitized = path.basename(file.originalname).replace(/\s+/g, '_');
    cb(null, `${timestamp}_${sanitized}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1_500_000_000, // 1.5 GB
  },
});

router.use(authMiddleware, requireRoles(['admin']));

router.post('/create', createDbBackup);
router.get('/', getDbBackups);
const requireLocalRestore: import('express').RequestHandler = (_req,res,next) => {
  if(process.env.NODE_ENV === 'production') { res.status(410).json({code:'LEGACY_RESTORE_RETIRED',message:'Use Database Workspace for reviewed isolated restores. Production replacement requires the infrastructure recovery runbook.'}); return; }
  next();
};
router.post('/upload/restore', requireLocalRestore, upload.single('backup'), uploadAndRestoreDbBackup);
router.post('/:filename/restore', requireLocalRestore, restoreDbBackup);
router.get('/:filename/download', downloadDbBackup);

export default router;
