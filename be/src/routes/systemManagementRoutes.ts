import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticateWorkspace } from "../middleware/databaseWorkspaceAuthentication.js";
import {
  actorAuthority,
  createLaunch,
  systemPolicy,
  ManagementError,
} from "../services/systemManagement/authority.js";
import type { AuthenticatedRequest } from "../types/AuthenticatedRequest.js";
const router = Router();
router.use(authenticateWorkspace, rateLimit({ windowMs: 60000, max: 20 }));
router.get("/capabilities", async (req: AuthenticatedRequest, res) => {
  try {
    await actorAuthority(req.authContext!.id);
    const policy = await systemPolicy();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      enabled: policy.enabled,
      origin: policy.origin,
      provisioned: Boolean(process.env.SYSTEM_MANAGEMENT_AUTHORITY_SOCKET),
    });
  } catch (error) {
    res
      .status(error instanceof ManagementError ? error.status : 503)
      .json({
        message:
          error instanceof ManagementError
            ? error.message
            : "Management authority unavailable.",
      });
  }
});
router.post("/launch", async (req: AuthenticatedRequest, res) => {
  try {
    const origin = req.headers.origin;
    const expected =
      process.env.NODE_ENV === "production"
        ? "https://omni-lodge.com"
        : "http://localhost:3000";
    if (origin !== expected)
      throw new ManagementError(
        403,
        "ORIGIN_REJECTED",
        "Open System Management from the application.",
      );
    res.setHeader("Cache-Control", "no-store");
    res.json(
      await createLaunch(
        req.authContext!.id,
        typeof req.user === "object" ? req.user.jti : null,
      ),
    );
  } catch (error) {
    res
      .status(error instanceof ManagementError ? error.status : 503)
      .json({
        code: error instanceof ManagementError ? error.code : "UNAVAILABLE",
        message:
          error instanceof ManagementError
            ? error.message
            : "Management launch unavailable.",
      });
  }
});
export default router;
