import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';

const router = Router();

router.post(
  '/execute',
  authMiddleware,
  requireRoles(['admin']),
  (_req, res) => { res.status(410).json({ code: 'SQL_HELPER_REPLACED', message: 'SQL Helper has been replaced by Database Workspace. Reload the application to use reviewed, isolated execution.' }); },
);

export default router;
