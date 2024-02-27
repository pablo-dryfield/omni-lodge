import express, { Request, Response, NextFunction, Router } from 'express';
import authenticateJWT from '../middleware/authMiddleware.js';
import { validationResult } from 'express-validator';
import * as sessionController from '../controllers/sessionController.js'; 

const router: Router = express.Router();

router.get('/', authenticateJWT, sessionController.checkSession);

export default router;