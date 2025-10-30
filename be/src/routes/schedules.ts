import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { MANAGER_ROLES } from './schedulingRoles.js';
import {
  generateWeek,
  getWeekSummary,
  lockWeek,
  publishWeek,
  reopenWeek,
  listShiftTemplates,
  listShiftTypes,
  upsertShiftTemplate,
  deleteShiftTemplate,
  listShiftInstances,
  createShiftInstance,
  updateShiftInstance,
  deleteShiftInstance,
  upsertAvailability,
  getAvailabilityForUser,
  createShiftAssignmentsBulk,
  deleteShiftAssignment,
  createSwapRequest,
  swapPartnerResponse,
  swapManagerDecision,
  listSwapsByStatus,
  listSwapsForUser,
  listExports,
  listHistoricalAssignments,
  parseWeekParam,
  autoAssignWeek,
} from '../services/scheduleService.js';
import ScheduleWeek from '../models/ScheduleWeek.js';
import type { SwapRequestStatus } from '../models/SwapRequest.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const router = Router();


function getActorId(req: AuthenticatedRequest): number | null {
  return req.authContext?.id ?? null;
}

router.post('/weeks/generate', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const weekParam = typeof req.query.week === 'string' ? req.query.week : null;
    const result = await generateWeek({ week: weekParam, actorId: getActorId(req), autoSpawn: true });
    res.json(result);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.get('/weeks/lookup', authMiddleware, async (req, res) => {
  try {
    const weekParam = typeof req.query.week === 'string' ? req.query.week : null;
    const identifier = parseWeekParam(weekParam);
    const week = await ScheduleWeek.findOne({
      where: { year: identifier.year, isoWeek: identifier.isoWeek },
    });

    if (!week) {
      res.status(404).json({ error: 'Schedule week not found' });
      return;
    }

    res.json({ week, created: false });
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.get('/weeks/:id', authMiddleware, async (req, res) => {
  try {
    const summary = await getWeekSummary(Number(req.params.id));
    res.json(summary);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/weeks/:id/lock', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const summary = await lockWeek(Number(req.params.id), getActorId(req));
    res.json(summary);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/weeks/:id/publish', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const result = await publishWeek(Number(req.params.id), getActorId(req));
    res.json(result);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/weeks/:id/reopen', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const summary = await reopenWeek(Number(req.params.id), getActorId(req));
    res.json(summary);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/weeks/:id/auto-assign', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const result = await autoAssignWeek(Number(req.params.id), getActorId(req));
    res.json(result);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.get('/shift-types', authMiddleware, requireRoles(MANAGER_ROLES), async (_req, res) => {
  try {
    const types = await listShiftTypes();
    res.json(types);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.get('/shift-templates', authMiddleware, requireRoles(MANAGER_ROLES), async (_req, res) => {
  try {
    const templates = await listShiftTemplates();
    res.json(templates);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/shift-templates', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const template = await upsertShiftTemplate(req.body, getActorId(req));
    res.json(template);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.patch('/shift-templates/:id', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const template = await upsertShiftTemplate({ ...req.body, id: Number(req.params.id) }, getActorId(req));
    res.json(template);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.delete('/shift-templates/:id', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    await deleteShiftTemplate(Number(req.params.id), getActorId(req));
    res.status(204).send();
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.get('/shift-instances', authMiddleware, async (req, res) => {
  try {
    const weekId = Number(req.query.weekId);
    const shifts = await listShiftInstances(weekId);
    res.json(shifts);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/shift-instances', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const instance = await createShiftInstance(req.body, getActorId(req));
    res.json(instance);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.patch('/shift-instances/:id', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const instance = await updateShiftInstance(Number(req.params.id), req.body, getActorId(req));
    res.json(instance);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.delete('/shift-instances/:id', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    await deleteShiftInstance(Number(req.params.id), getActorId(req));
    res.status(204).send();
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/availability', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authContext?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { scheduleWeekId, entries } = req.body;
    const saved = await upsertAvailability(userId, scheduleWeekId, entries ?? []);
    res.json(saved);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.get('/availability/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.authContext?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const weekId = Number(req.query.weekId);
    const entries = await getAvailabilityForUser(userId, weekId);
    res.json(entries);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/shift-assignments/bulk', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const assignments = await createShiftAssignmentsBulk(req.body.assignments ?? [], getActorId(req));
    res.json(assignments);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.delete('/shift-assignments/:id', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    await deleteShiftAssignment(Number(req.params.id), getActorId(req));
    res.status(204).send();
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/swaps', authMiddleware, async (req, res) => {
  try {
    const requesterId = req.authContext?.id;
    if (!requesterId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const swap = await createSwapRequest({
      fromAssignmentId: req.body.fromAssignmentId,
      toAssignmentId: req.body.toAssignmentId,
      partnerId: req.body.partnerId,
      requesterId,
    });
    res.json(swap);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/swaps/:id/partner-response', authMiddleware, async (req, res) => {
  try {
    const partnerId = req.authContext?.id;
    if (!partnerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const swap = await swapPartnerResponse(Number(req.params.id), partnerId, Boolean(req.body.accept));
    res.json(swap);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.post('/swaps/:id/manager-decision', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const swap = await swapManagerDecision(
      Number(req.params.id),
      getActorId(req) ?? 0,
      Boolean(req.body.approve),
      req.body.reason,
    );
    res.json(swap);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.get('/swaps', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending_manager';
    const swaps = await listSwapsByStatus(status as SwapRequestStatus);
    res.json(swaps);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.get('/swaps/mine', authMiddleware, async (req, res) => {
  try {
    const userId = req.authContext?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const swaps = await listSwapsForUser(userId);
    res.json(swaps);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.get('/exports', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const weekId = Number(req.query.weekId);
    const exports = await listExports(weekId);
    res.json(exports);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

router.get('/reports/schedules', authMiddleware, requireRoles(MANAGER_ROLES), async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;
    if (!from || !to) {
      res.status(400).json({ error: 'from and to parameters are required (YYYY-WW)' });
      return;
    }

    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const assignments = await listHistoricalAssignments({
      from: { year: Number(from.split('-W')[0]), isoWeek: Number(from.split('-W')[1]) },
      to: { year: Number(to.split('-W')[0]), isoWeek: Number(to.split('-W')[1]) },
      userId,
    });
    res.json(assignments);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

export default router;
