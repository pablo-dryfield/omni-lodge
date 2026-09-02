import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import os from 'os';
import { randomUUID } from 'crypto';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction } from '../middleware/authorizationMiddleware.js';
import {
  archiveSocialMediaContent,
  createSocialMediaContent,
  getSocialMediaContent,
  listSelectableSocialMediaContent,
  listSocialMediaContent,
  removeSocialMediaThumbnail,
  streamSocialMediaThumbnail,
  updateSocialMediaContent,
  uploadSocialMediaThumbnail,
} from '../controllers/socialMediaContentController.js';
import {
  createSocialMediaProjectFolder,
  finalizeSocialMediaAssetUpload,
  initiateSocialMediaAssetUpload,
  markSocialMediaReady,
  planSocialMediaContent,
  publishSocialMediaContent,
  removeSocialMediaAsset,
  startSocialMediaProduction,
  uploadSocialMediaAsset,
} from '../controllers/socialMediaWorkflowController.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
const assetUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, callback) => callback(null, `omni-social-${randomUUID()}.upload`),
  }),
  // Kept as a small-file compatibility fallback. Current clients use direct,
  // chunked Drive resumable sessions for production media.
  limits: { files: 1, fileSize: 25 * 1024 * 1024 },
});
const viewGuard = authorizeModuleAction('social-media-content', 'view');
const createGuard = authorizeModuleAction('social-media-content', 'create');
const updateGuard = authorizeModuleAction('social-media-content', 'update');
const deleteGuard = authorizeModuleAction('social-media-content', 'delete');

const receiveThumbnail = (req: Request, res: Response, next: NextFunction): void => {
  upload.single('thumbnail')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ message: 'Thumbnail files cannot be larger than 5 MB.' });
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
};

const receiveAsset = (req: Request, res: Response, next: NextFunction): void => {
  assetUpload.single('file')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ message: 'Use the resumable upload for files larger than 25 MB.' });
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({ message: `Unable to receive the Social Media file: ${error.message}` });
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
};

router.use(authMiddleware);
router.get('/content', viewGuard, listSocialMediaContent);
router.get('/content/selectable', viewGuard, listSelectableSocialMediaContent);
router.get('/content/:id/thumbnail', viewGuard, streamSocialMediaThumbnail);
router.get('/content/:id', viewGuard, getSocialMediaContent);
router.post('/content', createGuard, createSocialMediaContent);
router.put('/content/:id', updateGuard, updateSocialMediaContent);
router.patch('/content/:id', updateGuard, updateSocialMediaContent);
router.post('/content/:id/plan', updateGuard, planSocialMediaContent);
router.post('/content/:id/start-production', updateGuard, startSocialMediaProduction);
router.post('/content/:id/project-folder', updateGuard, createSocialMediaProjectFolder);
router.post('/content/:id/assets/resumable-session', updateGuard, initiateSocialMediaAssetUpload);
router.post('/content/:id/assets/resumable-complete', updateGuard, finalizeSocialMediaAssetUpload);
router.post('/content/:id/assets', updateGuard, receiveAsset, uploadSocialMediaAsset);
router.delete('/content/:id/assets/:assetId', updateGuard, removeSocialMediaAsset);
router.post('/content/:id/ready', updateGuard, markSocialMediaReady);
router.post('/content/:id/publish', updateGuard, publishSocialMediaContent);
router.delete('/content/:id/thumbnail', updateGuard, removeSocialMediaThumbnail);
router.post('/content/:id/thumbnail', updateGuard, receiveThumbnail, uploadSocialMediaThumbnail);
router.delete('/content/:id', deleteGuard, archiveSocialMediaContent);

export default router;
