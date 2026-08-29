import express, { type RequestHandler, type Response } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: ((req: AuthenticatedRequest, _res: Response, next: () => void) => {
    const roleSlug = req.header('x-test-role');
    req.authContext = roleSlug
      ? {
          id: 91,
          userTypeId: 6,
          roleSlug,
        }
      : undefined;
    next();
  }) as RequestHandler,
}));

jest.mock('../../controllers/assistantManagerTaskController.js', () => {
  const respond = jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.status(204).send();
  });

  return {
    __esModule: true,
    listTaskTemplates: jest.fn(respond),
    getTaskCerebroLinkOptions: jest.fn(respond),
    getTaskCerebroLinkItemDetail: jest.fn(respond),
    createTaskTemplate: jest.fn(respond),
    bulkUpdateTaskTemplateOptions: jest.fn(respond),
    updateTaskTemplate: jest.fn(respond),
    deleteTaskTemplate: jest.fn(respond),
    listTaskAssignments: jest.fn(respond),
    createTaskAssignment: jest.fn(respond),
    bulkCreateTaskAssignments: jest.fn(respond),
    updateTaskAssignment: jest.fn(respond),
    deleteTaskAssignment: jest.fn(respond),
    listTaskLogs: jest.fn(respond),
    generateTaskLogsForRange: jest.fn(respond),
    previewTaskLogsForRange: jest.fn(respond),
    clearTaskLogsForRange: jest.fn(respond),
    syncTaskLogsWithCurrentTemplateConfig: jest.fn(respond),
    updateTaskLogStatus: jest.fn(respond),
    deleteTaskLog: jest.fn(respond),
    createManualTaskLog: jest.fn(respond),
    downloadTaskLogEvidenceImage: jest.fn(respond),
    manageTaskLog: jest.fn(respond),
    updateTaskLogMeta: jest.fn(respond),
    uploadTaskLogEvidenceImage: jest.fn(respond),
    getTaskPlannerBootstrap: jest.fn(respond),
  };
});

jest.mock('../../controllers/assistantManagerTaskPushController.js', () => {
  const respond = jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.status(204).send();
  });

  return {
    __esModule: true,
    deleteTaskPushSubscription: jest.fn(respond),
    getTaskPushConfig: jest.fn(respond),
    sendTaskPushTestNotification: jest.fn(respond),
    upsertTaskPushSubscription: jest.fn(respond),
  };
});

import { getTaskPlannerBootstrap } from '../../controllers/assistantManagerTaskController';
import assistantManagerTaskRoutes from '../assistantManagerTaskRoutes';

const buildApp = () => {
  const app = express();
  app.use('/api/assistantManagerTasks', assistantManagerTaskRoutes);
  return app;
};

const bootstrapHandler = getTaskPlannerBootstrap as jest.Mock;

describe('assistant manager task bootstrap authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    'admin',
    'administrator',
    'owner',
    'manager',
    'mgr',
    'assistant-manager',
    'assistant_manager',
  ])('allows the %s role', async (roleSlug) => {
    const response = await request(buildApp())
      .get('/api/assistantManagerTasks/bootstrap')
      .set('x-test-role', roleSlug);

    expect(response.status).toBe(204);
    expect(bootstrapHandler).toHaveBeenCalledTimes(1);
  });

  it('rejects a guide before invoking the bootstrap controller', async () => {
    const response = await request(buildApp())
      .get('/api/assistantManagerTasks/bootstrap')
      .set('x-test-role', 'guide');

    expect(response.status).toBe(403);
    expect(response.body).toEqual([{ message: 'Forbidden' }]);
    expect(bootstrapHandler).not.toHaveBeenCalled();
  });

  it('rejects a request without an authenticated role', async () => {
    const response = await request(buildApp()).get('/api/assistantManagerTasks/bootstrap');

    expect(response.status).toBe(403);
    expect(response.body).toEqual([{ message: 'Forbidden' }]);
    expect(bootstrapHandler).not.toHaveBeenCalled();
  });
});
