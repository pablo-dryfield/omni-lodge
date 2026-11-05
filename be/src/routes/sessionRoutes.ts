import express, { Router } from 'express';
import authenticateJWT from '../middleware/authMiddleware.js';
import * as sessionController from '../controllers/sessionController.js';
import { myStaffFreeAccount } from '../controllers/staffFreeEntryController.js';

const router: Router = express.Router();

router.get('/', authenticateJWT, sessionController.checkSession);
router.get('/profile-photo', authenticateJWT, sessionController.streamSessionProfilePhoto);
router.get('/staff-free-entries', authenticateJWT, myStaffFreeAccount);

export default router;
