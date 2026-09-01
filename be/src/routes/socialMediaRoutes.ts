import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
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

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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

router.use(authMiddleware);
router.get('/content', viewGuard, listSocialMediaContent);
router.get('/content/selectable', viewGuard, listSelectableSocialMediaContent);
router.get('/content/:id/thumbnail', viewGuard, streamSocialMediaThumbnail);
router.get('/content/:id', viewGuard, getSocialMediaContent);
router.post('/content', createGuard, createSocialMediaContent);
router.put('/content/:id', updateGuard, updateSocialMediaContent);
router.patch('/content/:id', updateGuard, updateSocialMediaContent);
router.delete('/content/:id/thumbnail', updateGuard, removeSocialMediaThumbnail);
router.post('/content/:id/thumbnail', updateGuard, receiveThumbnail, uploadSocialMediaThumbnail);
router.delete('/content/:id', deleteGuard, archiveSocialMediaContent);

export default router;
