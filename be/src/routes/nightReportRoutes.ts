import { Router } from 'express';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireNightReportProductScope } from '../services/productScopeService.js';
import {
  listNightReports,
  createNightReport,
  getNightReport,
  updateNightReport,
  deleteNightReport,
  submitNightReport,
  confirmNightReportNoExtraCost,
  clearNightReportNoExtraCost,
  getNightReportAvailableCosts,
  getNightReportReceiptGroupCosts,
  createNightReportCost,
  createNightReportReceiptAllocations,
  updateNightReportReceiptAllocations,
  deleteNightReportReceiptAllocations,
  deleteNightReportReceiptAllocationsForReport,
  linkNightReportCost,
  unlinkNightReportCost,
  deleteNightReportCost,
  uploadNightReportPhoto,
  deleteNightReportPhoto,
  downloadNightReportPhoto,
  getNightReportLeaderMetrics,
  getNightReportVenueSummary,
  createVenueCompensationCollectionLog,
  deleteVenueCompensationCollectionLog,
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
router.post('/venue-collections', authMiddleware, createVenueCompensationCollectionLog);
router.delete('/venue-collections/:id', authMiddleware, deleteVenueCompensationCollectionLog);
router.post('/', authMiddleware, createNightReport);
router.get('/:id', authMiddleware, requireNightReportProductScope, getNightReport);
router.patch('/:id', authMiddleware, requireNightReportProductScope, updateNightReport);
router.delete('/:id', authMiddleware, requireNightReportProductScope, deleteNightReport);
router.post('/:id/submit', authMiddleware, requireNightReportProductScope, submitNightReport);
router.post('/:id/costs/no-extra-cost', authMiddleware, requireNightReportProductScope, confirmNightReportNoExtraCost);
router.delete('/:id/costs/no-extra-cost', authMiddleware, requireNightReportProductScope, clearNightReportNoExtraCost);
router.get('/:id/costs/available', authMiddleware, requireNightReportProductScope, getNightReportAvailableCosts);
router.post('/:id/costs', authMiddleware, requireNightReportProductScope, createNightReportCost);
router.post('/:id/costs/receipt-allocations', authMiddleware, requireNightReportProductScope, createNightReportReceiptAllocations);
router.get('/:id/costs/receipt-groups/:receiptGroupKey', authMiddleware, requireNightReportProductScope, getNightReportReceiptGroupCosts);
router.patch('/:id/costs/receipt-groups/:receiptGroupKey', authMiddleware, requireNightReportProductScope, updateNightReportReceiptAllocations);
router.delete('/:id/costs/receipt-groups/:receiptGroupKey', authMiddleware, requireNightReportProductScope, deleteNightReportReceiptAllocations);
router.delete('/:id/costs/receipt-groups/:receiptGroupKey/reports/:targetReportId', authMiddleware, requireNightReportProductScope, deleteNightReportReceiptAllocationsForReport);
router.post('/:id/costs/:transactionId/link', authMiddleware, requireNightReportProductScope, linkNightReportCost);
router.delete('/:id/costs/:transactionId/link', authMiddleware, requireNightReportProductScope, unlinkNightReportCost);
router.delete('/:id/costs/:transactionId', authMiddleware, requireNightReportProductScope, deleteNightReportCost);
router.post('/:id/photos', authMiddleware, requireNightReportProductScope, upload.single('file'), uploadNightReportPhoto);
router.delete('/:id/photos/:photoId', authMiddleware, requireNightReportProductScope, deleteNightReportPhoto);
router.get('/:id/photos/:photoId/download', authMiddleware, requireNightReportProductScope, downloadNightReportPhoto);

export default router;

