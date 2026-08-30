import express, { Router } from 'express';
import authenticateJWT from '../middleware/authMiddleware.js';
import * as sessionController from '../controllers/sessionController.js';

const router: Router = express.Router();

router.get('/', authenticateJWT, sessionController.checkSession);
router.get('/profile-photo', authenticateJWT, sessionController.streamSessionProfilePhoto);

export default router;
