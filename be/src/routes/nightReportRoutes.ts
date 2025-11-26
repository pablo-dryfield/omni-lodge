import { Router } from 'express';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  listNightReports,
  createNightReport,
  getNightReport,
  updateNightReport,
  deleteNightReport,
  submitNightReport,
  uploadNightReportPhoto,
  deleteNightReportPhoto,
  downloadNightReportPhoto,
  getNightReportLeaderMetrics,
  getNightReportVenueSummary,
} from '../controllers/nightReportController.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB
  },
});

router.get('/', authMiddleware, listNightReports);
router.get('/metrics/leader-performance', authMiddleware, getNightReportLeaderMetrics);
router.get('/metrics/venue-summary', authMiddleware, getNightReportVenueSummary);
router.post('/', authMiddleware, createNightReport);
router.get('/:id', authMiddleware, getNightReport);
router.patch('/:id', authMiddleware, updateNightReport);
router.delete('/:id', authMiddleware, deleteNightReport);
router.post('/:id/submit', authMiddleware, submitNightReport);
router.post('/:id/photos', authMiddleware, upload.single('file'), uploadNightReportPhoto);
router.delete('/:id/photos/:photoId', authMiddleware, deleteNightReportPhoto);
router.get('/:id/photos/:photoId/download', authMiddleware, downloadNightReportPhoto);

export default router;
