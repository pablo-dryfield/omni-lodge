import type { ReactNode } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TableBrowser } from './TableBrowser';
import { api, type Capabilities } from './api';

type TableOptions = {
  enableRowActions: boolean;
  data: Record<string, string | null>[];
  renderTopToolbarCustomActions: () => ReactNode;
  renderRowActions: (input: {
    row: { original: Record<string, string | null> };
  }) => ReactNode;
};
jest.mock('mantine-react-table', () => ({
  useMantineReactTable: (options: TableOptions) => options,
  MantineReactTable: ({ table }: { table: TableOptions }) => (
    <div>
      {table.renderTopToolbarCustomActions()}
      {table.enableRowActions &&
        table.data.map((original, i) => (
          <div key={i}>{table.renderRowActions({ row: { original } })}</div>
        ))}
    </div>
  ),
}));
jest.mock('./ImportWizard', () => ({ ImportWizard: () => null }));
jest.mock('./api', () => ({
  api: {
    object: jest.fn(),
    browse: jest.fn(),
    tablePage: jest.fn(),
    changePlan: jest.fn(),
    commitChanges: jest.fn(),
    cancel: jest.fn(),
  },
  activeJob: (job?: { status: string }) =>
    Boolean(job && ['queued', 'running'].includes(job.status)),
  message: (error: Error) => error.message,
}));
const capabilities = {
  writesEnabled: true,
  actions: { write: true },
  limits: { resultPageRows: 200 },
  targets: [{ id: 'local' }],
} as unknown as Capabilities;
const clients: QueryClient[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    value: { randomUUID: jest.fn(() => 'synthetic-uuid') },
  });
  (api.object as jest.Mock).mockResolvedValue({
    schema: 'public',
    name: 'sample',
    qualifiedName: 'public.sample',
    kind: 'r',
    writable: true,
    constraints: [],
    columns: [
      { name: 'id', type: 'integer', primary_key: true, not_null: true },
      { name: 'value', type: 'text', primary_key: false, not_null: true },
    ],
  });
  (api.browse as jest.Mock).mockResolvedValue({
    job: { id: 'read-job', status: 'succeeded', outcomes: [] },
  });
  (api.tablePage as jest.Mock).mockResolvedValue({
    fields: [{ name: 'id' }, { name: 'value' }],
    rows: [['1', 'original']],
    stable: true,
  });
  (api.changePlan as jest.Mock).mockResolvedValue({
    token: 'single-use-review',
    statements: [
      { sql: 'UPDATE public.sample SET value=$1', parameters: ['changed'] },
    ],
  });
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
});
function mount(readOnly = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <TableBrowser
          targetId="local"
          objectId="1"
          capabilities={{
            ...capabilities,
            targets: [{ ...capabilities.targets[0], readOnly }],
          }}
          onSql={jest.fn()}
        />
      </MantineProvider>
    </QueryClientProvider>,
  );
}
async function stage() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit row' }));
  fireEvent.change(
    await screen.findByRole('textbox', { name: 'Value for value' }),
    {
      target: { value: 'changed' },
    },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Stage changes' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Review changes' }),
  );
  fireEvent.change(await screen.findByRole('textbox', { name: 'Reason' }), {
    target: { value: 'Synthetic correction' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare exact change review' }),
  );
}
it('returns from a failed write to the retained changes instead of leaving a consumed commit dialog open', async () => {
  (api.commitChanges as jest.Mock).mockResolvedValue({
    id: 'write-job',
    status: 'failed',
    transactionOutcome: 'rolled_back',
    error: { message: 'A selected row changed. Reload its current values.' },
  });
  mount();
  await stage();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Commit reviewed changes' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Review staged database changes' }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByText('A selected row changed. Reload its current values.'),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Review changes' })).toBeVisible();
  expect(api.commitChanges).toHaveBeenCalledTimes(1);
});
it('shows a rejected preparation inside the active review dialog', async () => {
  (api.changePlan as jest.Mock).mockRejectedValue(
    new Error('Target authority changed'),
  );
  mount();
  await stage();
  const dialog = screen.getByRole('dialog', {
    name: 'Review staged database changes',
  });
  await waitFor(() =>
    expect(within(dialog).getByText('Target authority changed')).toBeVisible(),
  );
  expect(
    within(dialog).queryByRole('button', { name: 'Commit reviewed changes' }),
  ).not.toBeInTheDocument();
});
it('does not offer table mutations for a registered read-only target', async () => {
  mount(true);
  await waitFor(() => expect(api.tablePage).toHaveBeenCalled());
  expect(
    screen.queryByRole('button', { name: 'Edit row' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Insert row' }),
  ).not.toBeInTheDocument();
});
