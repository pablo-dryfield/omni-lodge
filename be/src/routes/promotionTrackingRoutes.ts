import { Router, type Response } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
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
  publishPromotionRouteVersion,
  respondToPromotionTeamChallenge,
  startPromotionSession,
  uploadPromotionLocationSamples,
} from '../services/promotionTrackingService.js';

const router = Router();

const actorId = (req: AuthenticatedRequest): number => {
  const id = req.authContext?.id;
  if (!id) {
    const error = new Error('Authentication is required.') as Error & { status?: number };
    error.status = 401;
    throw error;
  }
  return id;
};

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
    res.json(await getPromotionToday(actorId(req)));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/sessions/start', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await startPromotionSession({
      actorUserId: actorId(req),
      assignmentId: req.body?.assignmentId,
      routeVersionId: req.body?.routeVersionId,
      body: req.body ?? {},
      idempotencyKey: idempotencyKey(req),
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

router.post('/manager/route-plans', authMiddleware, requireRoles(MANAGER_ROLES), async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await createPromotionRoutePlan({
      actorUserId: actorId(req),
      body: req.body ?? {},
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/manager/route-plans/:routePlanId/versions', authMiddleware, requireRoles(MANAGER_ROLES), async (req: AuthenticatedRequest, res) => {
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

router.post('/manager/route-versions/:routeVersionId/publish', authMiddleware, requireRoles(MANAGER_ROLES), async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await publishPromotionRouteVersion({
      actorUserId: actorId(req),
      routeVersionId: req.params.routeVersionId,
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/manager/team-assignments', authMiddleware, requireRoles(MANAGER_ROLES), async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await assignPromotionRouteToShift({
      actorUserId: actorId(req),
      body: req.body ?? {},
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/manager/live-sessions', authMiddleware, requireRoles(MANAGER_ROLES), async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await listPromotionLiveSessions(actorId(req)));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/manager/sessions/:sessionId/playback', authMiddleware, requireRoles(MANAGER_ROLES), async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await getPromotionSessionPlayback({
      actorUserId: actorId(req),
      sessionId: req.params.sessionId,
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/manager/sessions/:sessionId/overrides', authMiddleware, requireRoles(MANAGER_ROLES), async (req: AuthenticatedRequest, res) => {
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
