jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: {
    connectionManager: {
      getConnection: jest.fn(),
      releaseConnection: jest.fn(),
      destroyConnection: jest.fn(),
    },
  },
}));
jest.mock('../queryDiagnosticsService.js', () => ({
  queryDiagnosticsService: { recordQuery: jest.fn() },
}));
import sequelize from '../../config/database';
import {
  loadWorkspaceAccount,
  loadWorkspaceAuthority,
  WORKSPACE_ACCOUNT_SQL,
  WORKSPACE_AUTHORITY_SQL,
} from '../databaseWorkspace/appMetadata';
const manager = sequelize.connectionManager as unknown as {
  getConnection: jest.Mock;
  releaseConnection: jest.Mock;
  destroyConnection: jest.Mock;
};
const client = { query: jest.fn(), end: jest.fn() };
let actions: string[];
beforeEach(() => {
  jest.clearAllMocks();
  actions = ['view', 'read'];
  manager.getConnection.mockResolvedValue(client);
  manager.releaseConnection.mockResolvedValue(undefined);
  manager.destroyConnection.mockResolvedValue(undefined);
  client.query.mockImplementation(async (value) => ({
    rows:
      typeof value === 'object'
        ? value.name.includes('account')
          ? [
              {
                id: 17,
                status: true,
                approved: true,
                userTypeId: 2,
                role: { slug: 'admin', status: true },
              },
            ]
          : [{ page: true, actions: [...actions] }]
        : [],
  }));
});
it('uses only fixed bound metadata queries on the primary and caches plans rather than authorization rows', async () => {
  expect((await loadWorkspaceAccount(17))?.id).toBe(17);
  expect((await loadWorkspaceAuthority(2)).actions).toContain('read');
  actions = [];
  expect((await loadWorkspaceAuthority(2)).actions).toEqual([]);
  expect(manager.getConnection).toHaveBeenCalledWith({
    type: 'SELECT',
    useMaster: true,
  });
  expect(client.query).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'omnilodge-workspace-account-v1',
      text: WORKSPACE_ACCOUNT_SQL,
      values: [17],
    }),
  );
  expect(client.query).toHaveBeenCalledWith(
    expect.objectContaining({ text: WORKSPACE_AUTHORITY_SQL, values: [2] }),
  );
  expect(client.query).toHaveBeenCalledWith('BEGIN READ ONLY');
  expect(client.query).toHaveBeenCalledWith(
    expect.stringContaining('SET LOCAL plan_cache_mode'),
  );
  expect(manager.releaseConnection).toHaveBeenCalledTimes(3);
  expect(manager.destroyConnection).not.toHaveBeenCalled();
});
it('rolls back failed metadata reads before returning the application connection', async () => {
  client.query.mockImplementation(async (value) => {
    if (typeof value === 'object') throw new Error('Query unavailable');
    return { rows: [] };
  });
  await expect(loadWorkspaceAuthority(2)).rejects.toThrow('Query unavailable');
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(manager.releaseConnection).toHaveBeenCalledTimes(1);
});
it('destroys a connection if rollback cannot prove a clean state', async () => {
  client.query.mockImplementation(async (value) => {
    if (typeof value === 'object' || value === 'ROLLBACK')
      throw new Error('Connection lost');
    return { rows: [] };
  });
  await expect(loadWorkspaceAuthority(2)).rejects.toThrow();
  expect(manager.destroyConnection).toHaveBeenCalledWith(client);
  expect(manager.releaseConnection).not.toHaveBeenCalled();
});
it('rejects invalid identities without acquiring a connection', async () => {
  expect(await loadWorkspaceAccount(Number.NaN)).toBeUndefined();
  expect(await loadWorkspaceAuthority(0)).toEqual({ page: false, actions: [] });
  expect(manager.getConnection).not.toHaveBeenCalled();
});
