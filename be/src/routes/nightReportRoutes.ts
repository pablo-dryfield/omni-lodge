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
router.get('/:id', authMiddleware, getNightReport);
router.patch('/:id', authMiddleware, updateNightReport);
router.delete('/:id', authMiddleware, deleteNightReport);
router.post('/:id/submit', authMiddleware, submitNightReport);
router.post('/:id/costs/no-extra-cost', authMiddleware, confirmNightReportNoExtraCost);
router.delete('/:id/costs/no-extra-cost', authMiddleware, clearNightReportNoExtraCost);
router.get('/:id/costs/available', authMiddleware, getNightReportAvailableCosts);
router.post('/:id/costs', authMiddleware, createNightReportCost);
router.post('/:id/costs/receipt-allocations', authMiddleware, createNightReportReceiptAllocations);
router.get('/:id/costs/receipt-groups/:receiptGroupKey', authMiddleware, getNightReportReceiptGroupCosts);
router.patch('/:id/costs/receipt-groups/:receiptGroupKey', authMiddleware, updateNightReportReceiptAllocations);
router.delete('/:id/costs/receipt-groups/:receiptGroupKey', authMiddleware, deleteNightReportReceiptAllocations);
router.delete('/:id/costs/receipt-groups/:receiptGroupKey/reports/:targetReportId', authMiddleware, deleteNightReportReceiptAllocationsForReport);
router.post('/:id/costs/:transactionId/link', authMiddleware, linkNightReportCost);
router.delete('/:id/costs/:transactionId/link', authMiddleware, unlinkNightReportCost);
router.delete('/:id/costs/:transactionId', authMiddleware, deleteNightReportCost);
router.post('/:id/photos', authMiddleware, upload.single('file'), uploadNightReportPhoto);
router.delete('/:id/photos/:photoId', authMiddleware, deleteNightReportPhoto);
router.get('/:id/photos/:photoId/download', authMiddleware, downloadNightReportPhoto);

export default router;
