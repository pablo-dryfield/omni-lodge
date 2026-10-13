import { Router, type Response } from 'express';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeModuleAction, requireRoles } from '../middleware/authorizationMiddleware.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { MANAGER_ROLES } from './schedulingRoles.js';
import {
  abortPromotionSession,
  acceptPromotionCheckpoint,
  assignPromotionRouteToShift,
  createPromotionManagerOverride,
  createPromotionRoutePlan,
  createPromotionRouteVersion,
  createPromotionTeamChallenge,
  finishPromotionSession,
  getPromotionSessionPlayback,
  getPromotionToday,
  listPromotionLiveSessions,
  listPromotionManagerSessions,
  listPromotionRoutePlans,
  listPromotionTeamAssignments,
  openPromotionTeamMemberProfilePhoto,
  publishPromotionRouteVersion,
  respondToPromotionTeamChallenge,
  startPromotionSession,
  uploadPromotionGroupSelfieEvidence,
  uploadPromotionLocationSamples,
} from '../services/promotionTrackingService.js';

const router = Router();
const managerRoleGuard = requireRoles(MANAGER_ROLES);
const managerViewGuard = authorizeModuleAction('scheduling-promotion-routes', 'view');
const managerCreateGuard = authorizeModuleAction('scheduling-promotion-routes', 'create');
const managerUpdateGuard = authorizeModuleAction('scheduling-promotion-routes', 'update');
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 6, parts: 8 },
});

const ALLOWED_PROFILE_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const actorId = (req: AuthenticatedRequest): number => {
  const id = req.authContext?.id;
  if (!id) {
    const error = new Error('Authentication is required.') as Error & { status?: number };
    error.status = 401;
    throw error;
  }
  return id;
};

const actorContext = (req: AuthenticatedRequest) => ({
  actorUserId: actorId(req),
  roleSlug: req.authContext?.roleSlug ?? null,
  roleName: req.authContext?.roleName ?? null,
  userTypeSlug: req.authContext?.userTypeSlug ?? null,
});

const fail = (res: Response, error: unknown): void => {
  const status = (error as { status?: number }).status ?? 500;
  const details = (error as { details?: unknown }).details;
  res.status(status).json({
    error: (error as Error).message,
    ...(details == null ? {} : { details }),
  });
};

const idempotencyKey = (req: AuthenticatedRequest): string | undefined => {
  const header = req.headers['idempotency-key'];
  return Array.isArray(header) ? header[0] : header;
};

const expectedVersionHeader = (req: AuthenticatedRequest): string | undefined => {
  const header = req.headers['x-expected-session-version'];
  return Array.isArray(header) ? header[0] : header;
};

router.get('/me/today', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await getPromotionToday(actorContext(req)));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/team-members/:assignmentId/profile-photo', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { stream, mimeType } = await openPromotionTeamMemberProfilePhoto(actorContext(req), req.params.assignmentId);
    const normalizedMimeType = mimeType.trim().toLowerCase();
    if (!ALLOWED_PROFILE_PHOTO_MIME_TYPES.has(normalizedMimeType)) {
      stream.destroy();
      res.status(415).json({ error: 'Stored profile photo is not a supported image.' });
      return;
    }
    res.setHeader('Content-Type', normalizedMimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');
    res.vary('Authorization');
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Unable to read profile photo.' });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (error) {
    fail(res, error);
  }
});

router.post('/sessions/start', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await startPromotionSession({
      actor: actorContext(req),
      assignmentId: req.body?.assignmentId,
      routeVersionId: req.body?.routeVersionId,
      body: req.body ?? {},
      idempotencyKey: idempotencyKey(req),
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/evidence/group-selfie', authMiddleware, evidenceUpload.single('file'), async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await uploadPromotionGroupSelfieEvidence({
      actor: actorContext(req),
      assignmentId: req.body?.assignmentId,
      body: req.body ?? {},
      file: req.file,
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/sessions/:sessionId/checkpoints/:checkpointId/accept', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await acceptPromotionCheckpoint({
      actorUserId: actorId(req),
      sessionId: req.params.sessionId,
      checkpointId: req.params.checkpointId,
      expectedSessionVersion: expectedVersionHeader(req),
      body: req.body ?? {},
      idempotencyKey: idempotencyKey(req),
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/sessions/:sessionId/finish', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await finishPromotionSession({
      actorUserId: actorId(req),
      sessionId: req.params.sessionId,
      expectedSessionVersion: expectedVersionHeader(req),
      body: req.body ?? {},
      idempotencyKey: idempotencyKey(req),
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/sessions/:sessionId/abort', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await abortPromotionSession({
      actorUserId: actorId(req),
      sessionId: req.params.sessionId,
      expectedSessionVersion: expectedVersionHeader(req),
      reason: req.body?.reason,
      body: req.body ?? {},
      idempotencyKey: idempotencyKey(req),
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/location-samples/batch', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await uploadPromotionLocationSamples({
      actorUserId: actorId(req),
      body: req.body ?? {},
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/team-challenges', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await createPromotionTeamChallenge({
      actorUserId: actorId(req),
      assignmentId: req.body?.assignmentId,
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/team-challenges/:nonce/respond', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await respondToPromotionTeamChallenge({
      actorUserId: actorId(req),
      nonce: req.params.nonce,
      body: req.body ?? {},
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/manager/route-plans', authMiddleware, managerRoleGuard, managerCreateGuard, async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await createPromotionRoutePlan({
      actorUserId: actorId(req),
      body: req.body ?? {},
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/manager/route-plans', authMiddleware, managerRoleGuard, managerViewGuard, async (_req: AuthenticatedRequest, res) => {
  try {
    res.json(await listPromotionRoutePlans());
  } catch (error) {
    fail(res, error);
  }
});

router.post('/manager/route-plans/:routePlanId/versions', authMiddleware, managerRoleGuard, managerCreateGuard, async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await createPromotionRouteVersion({
      actorUserId: actorId(req),
      routePlanId: req.params.routePlanId,
      body: req.body ?? {},
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/manager/route-versions/:routeVersionId/publish', authMiddleware, managerRoleGuard, managerUpdateGuard, async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await publishPromotionRouteVersion({
      actorUserId: actorId(req),
      routeVersionId: req.params.routeVersionId,
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/manager/team-assignments', authMiddleware, managerRoleGuard, managerCreateGuard, async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await assignPromotionRouteToShift({
      actorUserId: actorId(req),
      body: req.body ?? {},
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/manager/team-assignments', authMiddleware, managerRoleGuard, managerViewGuard, async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await listPromotionTeamAssignments({
      weekId: req.query.weekId,
      shiftInstanceId: req.query.shiftInstanceId,
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/manager/live-sessions', authMiddleware, managerRoleGuard, managerViewGuard, async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await listPromotionLiveSessions(actorId(req)));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/manager/sessions', authMiddleware, managerRoleGuard, managerViewGuard, async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await listPromotionManagerSessions({
      actorUserId: actorId(req),
      lifecycle: req.query.lifecycle,
      limit: req.query.limit,
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/manager/sessions/:sessionId/playback', authMiddleware, managerRoleGuard, managerViewGuard, async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await getPromotionSessionPlayback({
      actorUserId: actorId(req),
      sessionId: req.params.sessionId,
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/manager/sessions/:sessionId/overrides', authMiddleware, managerRoleGuard, managerUpdateGuard, async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await createPromotionManagerOverride({
      actorUserId: actorId(req),
      sessionId: req.params.sessionId,
      body: req.body ?? {},
    }));
  } catch (error) {
    fail(res, error);
  }
});

export default router;
