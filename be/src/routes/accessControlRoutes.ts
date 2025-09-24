import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { getCurrentUserAccess } from "../controllers/accessControlController.js";

const router = express.Router();

router.get('/me', authMiddleware, getCurrentUserAccess);

export default router;
