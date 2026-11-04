jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
import database from '../../config/database';
import { migrationAuditDetails } from '../migrationAuditController';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import type { Response } from 'express';
const query = database.query as jest.Mock;
const runId = '11111111-1111-4111-8111-111111111111';
function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}
beforeEach(() => query.mockReset());
test('invalid run identifiers, directions and pages never reach the database', async () => {
  for (const input of [
    { runId: 'invalid', direction: 'up', offset: 0 },
    { runId, direction: 'drop', offset: 0 },
    { runId, direction: 'up', offset: -1 },
  ]) {
    const res = response();
    await migrationAuditDetails(
      {
        params: { runId: input.runId },
        query: { direction: input.direction, offset: input.offset },
      } as unknown as AuthenticatedRequest,
      res as unknown as Response,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  }
  expect(query).not.toHaveBeenCalled();
});
test('migration details are paged and bound to the exact run and direction', async () => {
  const steps = Array.from({ length: 101 }, (_, i) => ({
    id: i + 1,
    migrationName: `migration-${i}.ts`,
  }));
  query
    .mockResolvedValueOnce([{ name: 'migration_audit_runs' }])
    .mockResolvedValueOnce([{ run_id: runId }])
    .mockResolvedValueOnce([{ name: 'migration_audit_steps' }])
    .mockResolvedValueOnce(steps);
  const res = response();
  await migrationAuditDetails(
    {
      params: { runId },
      query: { direction: 'down', offset: '100' },
    } as unknown as AuthenticatedRequest,
    res as unknown as Response,
  );
  expect(query.mock.calls[3][1].replacements).toEqual({
    runId,
    direction: 'down',
    offset: 100,
  });
  expect(res.json).toHaveBeenCalledWith({
    steps: steps.slice(0, 100),
    nextOffset: 200,
  });
});
test('missing runs return a clear 404 without reading unrelated steps', async () => {
  query
    .mockResolvedValueOnce([{ name: 'migration_audit_runs' }])
    .mockResolvedValueOnce([]);
  const res = response();
  await migrationAuditDetails(
    {
      params: { runId },
      query: { direction: 'up' },
    } as unknown as AuthenticatedRequest,
    res as unknown as Response,
  );
  expect(res.status).toHaveBeenCalledWith(404);
  expect(query).toHaveBeenCalledTimes(2);
});
