import express, { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import * as gameScoreController from "../controllers/gameScoreController.js";

const router: Router = express.Router();

router.get("/leaderboard", gameScoreController.getLeaderboard);
router.post("/", authMiddleware, gameScoreController.submitScore);

export default router;
