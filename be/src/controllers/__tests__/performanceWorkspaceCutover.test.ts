import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
jest.mock('../../services/performanceMonitorService.js', () => ({
  performanceMonitorService: {},
}));
jest.mock('../../services/heapDiagnosticsService.js', () => ({
  heapDiagnosticsService: {},
}));
import { runPerformanceExplainController } from '../performanceController';
it('retires the application-pool EXPLAIN endpoint without executing a writable CTE', async () => {
  const json = jest.fn(),
    status = jest.fn().mockReturnValue({ json });
  await runPerformanceExplainController(
    {
      body: {
        sql: 'WITH change AS (DELETE FROM protected RETURNING *) SELECT * FROM change',
      },
    } as AuthenticatedRequest,
    { status } as unknown as Response,
  );
  expect(status).toHaveBeenCalledWith(410);
  expect(json).toHaveBeenCalledWith(
    expect.objectContaining({
      code: 'DATABASE_WORKSPACE_REQUIRED',
      path: '/settings/sql-helper',
    }),
  );
});
