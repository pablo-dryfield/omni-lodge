import express, { type RequestHandler, type Response } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: ((req: AuthenticatedRequest, res: Response, next: () => void) => {
    const roleSlug = req.header('x-test-role');
    if (!roleSlug) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    req.authContext = { id: 91, userTypeId: 6, roleSlug };
    next();
  }) as RequestHandler,
}));

jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  authorizeModuleAction: (_moduleSlug: string, actionKey: string) => (
    req: AuthenticatedRequest,
    res: Response,
    next: () => void,
  ) => {
    const actions = String(req.header('x-test-actions') ?? '').split(',');
    if (!actions.includes(actionKey)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    next();
  },
  requireRoles: (roleSlugs: readonly string[]) => {
    const normalized = new Set(roleSlugs.map((role) => role.toLowerCase().replace(/_/gu, '-')));
    return (req: AuthenticatedRequest, res: Response, next: () => void) => {
      const role = req.authContext?.roleSlug?.toLowerCase().replace(/_/gu, '-');
      if (!role || !normalized.has(role)) {
        res.status(403).json([{ message: 'Forbidden' }]);
        return;
      }
      next();
    };
  },
}));

jest.mock('../../controllers/reviewController.js', () => ({
  getTripAdvisorReviews: jest.fn(),
  getAirbnbReviews: jest.fn(),
  getAllGoogleReviews: jest.fn(),
  getGetYourGuideReviewLink: jest.fn(),
  getGetYourGuideReviews: jest.fn(),
}));

jest.mock('../../controllers/reviewArchiveController.js', () => {
  const respond = jest.fn((_req: AuthenticatedRequest, res: Response) => res.status(204).send());
  return {
    completeFastReviewSync: jest.fn(respond),
    completeReviewSync: jest.fn(respond),
    createManualReviewCredit: jest.fn(respond),
    deleteManualReviewCredit: jest.fn(respond),
    getReviewCreditSummary: jest.fn(respond),
    getReviewMonthLock: jest.fn(respond),
    getReviewTrends: jest.fn(respond),
    ingestReviewSyncPage: jest.fn(respond),
    listArchivedReviews: jest.fn(respond),
    lockReviewMonth: jest.fn(respond),
    replaceReviewAssignments: jest.fn(respond),
    startReviewSync: jest.fn(respond),
    unlockReviewMonth: jest.fn(respond),
    updateManualReviewCredit: jest.fn(respond),
    updateReviewCreditMonth: jest.fn(respond),
    updateReviewFlags: jest.fn(respond),
  };
});

import { replaceReviewAssignments } from '../../controllers/reviewArchiveController.js';
import reviewRoutes from '../reviewRoutes.js';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/reviews', reviewRoutes);
  return app;
};

describe('review assignment authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['assistant-manager', 'assistant_manager'])(
    'allows the %s role to assign an archived review with update permission',
    async (roleSlug) => {
      const response = await request(buildApp())
        .put('/api/reviews/archive/42/assignments')
        .set('x-test-role', roleSlug)
        .set('x-test-actions', 'update')
        .send({ userIds: [7, 8] });

      expect(response.status).toBe(204);
      expect(replaceReviewAssignments).toHaveBeenCalledTimes(1);
    },
  );

  it('still requires the module update permission', async () => {
    const response = await request(buildApp())
      .put('/api/reviews/archive/42/assignments')
      .set('x-test-role', 'assistant-manager')
      .set('x-test-actions', 'view')
      .send({ userIds: [7] });

    expect(response.status).toBe(403);
    expect(replaceReviewAssignments).not.toHaveBeenCalled();
  });

  it('does not allow a non-management role to assign a review', async () => {
    const response = await request(buildApp())
      .put('/api/reviews/archive/42/assignments')
      .set('x-test-role', 'guide')
      .set('x-test-actions', 'update')
      .send({ userIds: [7] });

    expect(response.status).toBe(403);
    expect(replaceReviewAssignments).not.toHaveBeenCalled();
  });
});
