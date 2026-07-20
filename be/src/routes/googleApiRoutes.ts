import { Router } from 'express';
import {
  completeGoogleOAuthCallback,
  getGoogleApiAccess,
  getGoogleApiScopes,
  startGoogleOAuthAuthorization,
} from '../controllers/googleApiController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';

const router = Router();

router.use(authMiddleware, requireRoles(['admin']));

router.get('/access', getGoogleApiAccess);
router.get('/scopes', getGoogleApiScopes);
router.post('/oauth/authorize', startGoogleOAuthAuthorization);
router.get('/oauth/callback', completeGoogleOAuthCallback);

export default router;
