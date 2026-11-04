import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MigrationRunHistory } from './MigrationRunHistory';
import { fetchMigrationAuditDetails } from '../../api/maintenance';
jest.mock('../../api/maintenance', () => ({
  useMigrationAuditRuns: () => ({
    data: [
      {
        runId: 'run-1',
        direction: 'up',
        status: 'failed',
        stepCount: 1,
        successSteps: 0,
        failedSteps: 1,
        runningSteps: 0,
        startedAt: '2026-11-04T10:00:00Z',
        finishedAt: '2026-11-04T10:00:02Z',
        nodeEnv: 'production',
        dbName: 'app',
      },
    ],
    refetch: jest.fn(),
  }),
  fetchMigrationAuditDetails: jest.fn(),
}));
test('expanding a migration run loads its migration, verification details and errors on demand', async () => {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = jest
    .fn()
    .mockImplementation(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
  (fetchMigrationAuditDetails as jest.Mock).mockResolvedValue({
    steps: [
      {
        id: '1',
        migrationName: '20261104-example.ts',
        status: 'failed',
        startedAt: '2026-11-04T10:00:00Z',
        finishedAt: '2026-11-04T10:00:02Z',
        verifyStatus: 'failed',
        verifyDetails: { missingIndex: 'example_idx' },
        errorMessage: 'Expected index missing',
        errorStack: 'Fixture stack',
      },
    ],
    nextOffset: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MigrationRunHistory />
      </QueryClientProvider>
    </MantineProvider>,
  );
  expect(fetchMigrationAuditDetails).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Show details for migration run run-1',
    }),
  );
  expect(await screen.findByText('20261104-example.ts')).toBeInTheDocument();
  expect(screen.getByText('Expected index missing')).toBeInTheDocument();
  expect(screen.getByText(/example_idx/)).toBeInTheDocument();
  expect(fetchMigrationAuditDetails).toHaveBeenCalledWith('run-1', 'up', 0);
  expect(
    screen.getByRole('link', { name: 'View migration source' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/pablo-dryfield/omni-lodge/blob/master/be/src/migrations/20261104-example.ts',
  );
  client.clear();
});
