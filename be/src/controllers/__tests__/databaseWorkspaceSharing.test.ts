import express, { type Response } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
jest.mock('../databaseWorkspaceController.js', () => ({
  workspaceHandler:
    (handler: (req: AuthenticatedRequest, res: Response) => Promise<void>) =>
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        await handler(req, res);
      } catch (e) {
        const error = e as { status?: number; code?: string };
        res.status(error.status || 503).json({ code: error.code });
      }
    },
}));
jest.mock('../../services/databaseWorkspace/access.js', () => ({
  workspaceAccess: jest.fn(),
  reauthorizeExecution: jest.fn(),
}));
jest.mock('../../services/databaseWorkspace/store.js', () => ({
  controlStore: jest.fn(),
  operationHash: jest.fn(),
}));
jest.mock('../../services/databaseWorkspace/config.js', () => ({
  workspaceConfiguration: jest.fn(),
}));
jest.mock('../../services/databaseWorkspace/resultAccess.js', () => ({
  authorizeResult: jest.fn(),
}));
jest.mock('../../services/databaseWorkspace/artifacts.js', () => ({
  readResult: jest.fn(),
}));
jest.mock('../../services/databaseWorkspace/parser.js', () => ({
  parseSql: jest.fn(),
}));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/UserType.js', () => ({
  __esModule: true,
  default: {},
}));
import {
  openShare,
  sharedResult,
  sharedExportAudit,
} from '../databaseWorkspaceExportController';
import {
  workspaceAccess,
  reauthorizeExecution,
} from '../../services/databaseWorkspace/access';
import { controlStore } from '../../services/databaseWorkspace/store';
import { authorizeResult } from '../../services/databaseWorkspace/resultAccess';
import { readResult } from '../../services/databaseWorkspace/artifacts';
import { WorkspaceError } from '../../services/databaseWorkspace/types';
const app = express();
app.use(express.json());
app.get('/shares/:id', openShare);
app.post('/shares/:id/result', sharedResult);
app.post('/shares/:id/export-audit', sharedExportAudit);
let share: Record<string, unknown>;
const store = {
  pool: { query: jest.fn() },
  documents: jest.fn(),
  get: jest.fn(),
  audit: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  (workspaceAccess as jest.Mock).mockResolvedValue(2);
  (reauthorizeExecution as jest.Mock).mockResolvedValue(undefined);
  (controlStore as jest.Mock).mockReturnValue(store);
  (authorizeResult as jest.Mock).mockResolvedValue({ mode: 'read' });
  (readResult as jest.Mock).mockResolvedValue({
    rows: [['permitted value']],
    fields: [],
    totalCaptured: 1,
  });
  share = {
    kind: 'result',
    recipients: [2],
    ownerId: 1,
    executionId: 'job',
    index: 1,
    title: 'Shared result',
    policyHash: 'policy',
  };
  store.pool.query.mockResolvedValue({
    rowCount: 1,
    rows: [{ actor_id: '1' }],
  });
  store.documents.mockImplementation(async (_actor, kind) =>
    kind === 'share'
      ? [{ id: 'link', value: share }]
      : [
          {
            id: 'query',
            revision: 4,
            value: { title: 'Query', sql: 'SELECT 1' },
          },
        ],
  );
  store.get.mockResolvedValue({
    id: 'job',
    actorId: 1,
    targetId: 'test',
    mode: 'read',
    status: 'succeeded',
    transactionOutcome: 'read_only',
    createdAt: '2026-11-03T00:00:00.000Z',
    outcomes: [
      {
        index: 0,
        sql: 'PRIVATE OTHER QUERY',
        result: { fields: [{ name: 'private column' }] },
      },
      {
        index: 1,
        sql: 'PRIVATE QUERY LITERAL',
        notices: ['PRIVATE NOTICE'],
        command: 'SELECT',
        durationMs: 10,
        result: { fields: [{ name: 'public column' }], capturedRows: 1 },
      },
    ],
  });
  store.audit.mockResolvedValue(undefined);
});
it('only exposes the selected result manifest without SQL, notices or other batch results', async () => {
  const response = await request(app).get('/shares/link');
  expect(response.status).toBe(200);
  expect(response.body.index).toBe(0);
  expect(response.body.job.outcomes).toHaveLength(1);
  expect(response.body.job.outcomes[0].result.fields[0].name).toBe(
    'public column',
  );
  expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|private column/);
  expect(reauthorizeExecution).toHaveBeenCalledWith(
    1,
    'read',
    'policy',
    'export',
  );
  expect(reauthorizeExecution).toHaveBeenCalledWith(
    2,
    'read',
    'policy',
    'export',
  );
});
it.each(['/shares/link', '/shares/link/result', '/shares/link/export-audit'])(
  'denies a nonrecipient on %s before reading artifacts',
  async (path) => {
    share.recipients = [3];
    const response =
      path === '/shares/link'
        ? await request(app).get(path)
        : await request(app).post(path).send({});
    expect(response.status).toBe(403);
    expect(readResult).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
  },
);
it('rejects an expired or revoked share before loading its document', async () => {
  store.pool.query.mockResolvedValue({ rowCount: 0, rows: [] });
  expect((await request(app).get('/shares/link')).status).toBe(410);
  expect(store.documents).not.toHaveBeenCalled();
});
it.each([1, 2])(
  'rejects current authority revocation for actor %i',
  async (actor) => {
    (reauthorizeExecution as jest.Mock).mockImplementation(async (id) => {
      if (id === actor) throw new WorkspaceError(403, 'REVOKED', 'Revoked');
    });
    expect(
      (await request(app).post('/shares/link/result').send({})).status,
    ).toBe(403);
    expect(readResult).not.toHaveBeenCalled();
  },
);
it('rejects changed database grant/RLS context and does not read the captured data', async () => {
  (authorizeResult as jest.Mock).mockRejectedValueOnce(
    new WorkspaceError(403, 'RESULT_AUTHORITY_CHANGED', 'Changed'),
  );
  expect((await request(app).post('/shares/link/result').send({})).status).toBe(
    403,
  );
  expect(readResult).not.toHaveBeenCalled();
});
it('ignores a forged result index and owner, and caps recipient pages', async () => {
  const response = await request(app)
    .post('/shares/link/result')
    .send({ index: 0, ownerId: 3, pageSize: 10000 });
  expect(response.status).toBe(200);
  expect(readResult).toHaveBeenCalledWith(
    store,
    'job',
    1,
    1,
    expect.objectContaining({ pageSize: 500 }),
  );
});
it('records recipient exports against the shared original result', async () => {
  expect(
    (
      await request(app)
        .post('/shares/link/export-audit')
        .send({ format: 'csv', scope: 'page' })
    ).status,
  ).toBe(204);
  expect(store.audit).toHaveBeenCalledWith(
    2,
    'shared_result_exported',
    expect.objectContaining({
      shareId: 'link',
      ownerId: 1,
      index: 1,
      format: 'csv',
    }),
    undefined,
    'job',
  );
});
it('requires a new link after its saved query revision changes', async () => {
  share = { ...share, kind: 'query', documentId: 'query', revision: 3 };
  const response = await request(app).get('/shares/link');
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('SHARED_QUERY_CHANGED');
});
