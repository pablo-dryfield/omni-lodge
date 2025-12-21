import type { Request, Response } from "express";
import GameScore from "../models/GameScore.js";
import User from "../models/User.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const parseLimit = (value: unknown) => {
  if (typeof value !== "string") {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
};

const parseScore = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
  }
  return null;
};

const formatDisplayName = (user?: User | null) => {
  if (!user) {
    return "Unknown";
  }
  const composed = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  if (composed) {
    return composed;
  }
  return user.username ?? "Unknown";
};

export const getLeaderboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseLimit(req.query.limit);
    const rows = await GameScore.findAll({
      include: [{ model: User, as: "user", attributes: ["id", "firstName", "lastName", "username"] }],
      order: [
        ["bestScore", "DESC"],
        ["updatedAt", "ASC"],
        ["id", "ASC"],
      ],
      limit,
    });

    const payload = rows.map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      displayName: formatDisplayName(entry.user ?? null),
      score: entry.bestScore,
    }));

    res.status(200).json(payload);
  } catch (error) {
    console.error("Failed to load game leaderboard", error);
    res.status(500).json({ message: "Failed to load game leaderboard" });
  }
};

export const submitScore = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.authContext?.id ?? null;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const scoreValue = parseScore(req.body?.score);
    if (scoreValue === null) {
      res.status(400).json({ message: "Score must be a non-negative number" });
      return;
    }

    const existing = await GameScore.findOne({ where: { userId } });
    if (!existing) {
      const created = await GameScore.create({ userId, bestScore: scoreValue });
      res.status(201).json({ userId, score: created.bestScore, isNewBest: true });
      return;
    }

    let isNewBest = false;
    if (scoreValue > existing.bestScore) {
      await existing.update({ bestScore: scoreValue });
      isNewBest = true;
    }

    res.status(200).json({ userId, score: existing.bestScore, isNewBest });
  } catch (error) {
    console.error("Failed to submit game score", error);
    res.status(500).json({ message: "Failed to submit game score" });
  }
};
