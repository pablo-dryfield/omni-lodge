import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
const router=Router();
// Compatibility tombstone: release rollback is the only path that restores the
// old controller. No cookie-based root-process action remains in the main app.
router.use(authMiddleware,requireRoles(['admin']));
router.use((_req,res)=>{res.status(410).json({code:'SYSTEM_MANAGEMENT_REQUIRED',message:'Use Settings / System Management for service controls and logs.'});});
export default router;
