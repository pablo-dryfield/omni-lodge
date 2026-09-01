import express, { type RequestHandler, type Response } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: ((req: AuthenticatedRequest, res: Response, next: () => void) => {
    if (!req.header('x-test-user')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.authContext = { id: 9, userTypeId: 2, roleSlug: 'manager' };
    next();
  }) as RequestHandler,
}));

jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  authorizeModuleAction: (moduleSlug: string, actionKey: string) => (
    req: AuthenticatedRequest,
    res: Response,
    next: () => void,
  ) => {
    const actions = String(req.header('x-test-actions') ?? '').split(',');
    if (moduleSlug !== 'social-media-content' || !actions.includes(actionKey)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    next();
  },
}));

jest.mock('../../controllers/socialMediaContentController.js', () => {
  const respond = jest.fn((_req: AuthenticatedRequest, res: Response) => res.status(204).send());
  return {
    archiveSocialMediaContent: jest.fn(respond),
    createSocialMediaContent: jest.fn(respond),
    getSocialMediaContent: jest.fn(respond),
    listSelectableSocialMediaContent: jest.fn(respond),
    listSocialMediaContent: jest.fn(respond),
    removeSocialMediaThumbnail: jest.fn(respond),
    streamSocialMediaThumbnail: jest.fn(respond),
    updateSocialMediaContent: jest.fn(respond),
    uploadSocialMediaThumbnail: jest.fn(respond),
  };
});

import {
  createSocialMediaContent,
  listSelectableSocialMediaContent,
  listSocialMediaContent,
  updateSocialMediaContent,
} from '../../controllers/socialMediaContentController';
import socialMediaRoutes from '../socialMediaRoutes';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/social-media', socialMediaRoutes);
  return app;
};

describe('Social Media route authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires an authenticated session before checking permissions', async () => {
    const response = await request(buildApp()).get('/api/social-media/content');
    expect(response.status).toBe(401);
    expect(listSocialMediaContent).not.toHaveBeenCalled();
  });

  it('requires the view action for board and selector reads', async () => {
    const forbidden = await request(buildApp())
      .get('/api/social-media/content')
      .set('x-test-user', '9');
    expect(forbidden.status).toBe(403);

    const board = await request(buildApp())
      .get('/api/social-media/content')
      .set('x-test-user', '9')
      .set('x-test-actions', 'view');
    const selector = await request(buildApp())
      .get('/api/social-media/content/selectable')
      .set('x-test-user', '9')
      .set('x-test-actions', 'view');
    expect(board.status).toBe(204);
    expect(selector.status).toBe(204);
    expect(listSocialMediaContent).toHaveBeenCalledTimes(1);
    expect(listSelectableSocialMediaContent).toHaveBeenCalledTimes(1);
  });

  it('uses separate create and update permissions for mutations', async () => {
    const createForbidden = await request(buildApp())
      .post('/api/social-media/content')
      .set('x-test-user', '9')
      .set('x-test-actions', 'view')
      .send({});
    expect(createForbidden.status).toBe(403);

    const createAllowed = await request(buildApp())
      .post('/api/social-media/content')
      .set('x-test-user', '9')
      .set('x-test-actions', 'create')
      .send({});
    const updateAllowed = await request(buildApp())
      .patch('/api/social-media/content/41')
      .set('x-test-user', '9')
      .set('x-test-actions', 'update')
      .send({});
    expect(createAllowed.status).toBe(204);
    expect(updateAllowed.status).toBe(204);
    expect(createSocialMediaContent).toHaveBeenCalledTimes(1);
    expect(updateSocialMediaContent).toHaveBeenCalledTimes(1);
  });
});
