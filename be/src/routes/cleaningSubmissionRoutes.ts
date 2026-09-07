import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';
import { getCleaningSubmissionDetail, getMyCleaningSubmissions, patchCleaningPhotoReview,
  postCleaningPhoto, streamCleaningPhoto, postWaiveCanceledCleaningTask } from '../controllers/cleaningSubmissionController.js';
import { CLEANING_PHOTO_MAX_BYTES } from '../services/cleaningSubmissionRulesService.js';

const router = Router();
// Busboy emits partsLimit when it reaches (not exceeds) this threshold.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CLEANING_PHOTO_MAX_BYTES, files: 1, fields: 1, parts: 3, fieldSize: 32 } }).single('file');
// Assignment-scoped authorization is enforced in the service, not broad Task Planner access.
router.use(authMiddleware);
router.get('/me', getMyCleaningSubmissions);
router.post('/tasks/:taskLogId/waive', postWaiveCanceledCleaningTask);
router.get('/:submissionId', getCleaningSubmissionDetail);
router.get('/:submissionId/photos/:photoId', streamCleaningPhoto);
router.post('/:submissionId/slots/:slotKey/photos', (req: Request, res: Response, next: NextFunction) => {
  upload(req, res, (error: unknown) => {
    if (!error) { next(); return; }
    const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({ message: tooLarge ? 'Cleaning photos must be no larger than 10 MiB.' : 'Upload one photo and its expected revision using multipart form data.' });
  });
}, postCleaningPhoto);
router.patch('/:submissionId/photos/:photoId/review', patchCleaningPhotoReview);
export default router;
