import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Table from './Table';

const mockRow = { id: '16', original: { id: 16, name: 'Food Tour Owner' } };
const mockSetEditingRow = jest.fn();
const mockSetRowSelection = jest.fn();
jest.mock('../hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ ready: true, canView: true, canCreate: true, canUpdate: true, canDelete: true }) }));
jest.mock('mantine-react-table', () => ({
  MRT_GlobalFilterTextInput: () => null, MRT_ToggleFiltersButton: () => null,
  useMantineReactTable: (options: any) => ({
    options, getSelectedRowModel: () => ({ flatRows: [mockRow], rowsById: { '16': mockRow } }),
    getIsSomeRowsSelected: () => true, getIsSomePageRowsSelected: () => true,
    getIsAllPageRowsSelected: () => false, getIsAllRowsSelected: () => false,
    setEditingRow: mockSetEditingRow, setRowSelection: mockSetRowSelection,
  }),
  MantineReactTable: ({ table }: any) => <>
    {table.options.renderTopToolbar({ table })}
    {table.options.renderEditRowModalContent({ table, row: mockRow, internalEditComponents: [] })}
  </>,
}));
jest.mock('./ModalContent', () => ({ ModalContent: ({ opened, table, row, saving, saveError }: any) => opened ? <div role="dialog">
  <span>Selected product: Food Tour</span>
  {saveError && <div role="alert">{saveError}</div>}
  <button disabled={saving} onClick={() => void table.options.onEditingRowSave({ values: { productTypeIds: [3] }, table, row })}>Save</button>
</div> : null }));

const renderTable = (handleUpdate: jest.Mock) => render(<MantineProvider><Table
  pageTitle="User Types" data={[mockRow.original]} loading={false} error={null} columns={[]}
  actions={{ handleUpdate, handleCreate: jest.fn(), handleDelete: jest.fn() }} initialState={{}}
/></MantineProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null,
    addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
});

it('keeps the editor and selected values visible after a rejected save', async () => {
  const update = jest.fn().mockRejectedValue('One or more product types do not exist');
  renderTable(update);
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('One or more product types do not exist');
  expect(screen.getByRole('dialog')).toHaveTextContent('Selected product: Food Tour');
  expect(mockSetEditingRow).not.toHaveBeenCalledWith(null);
  expect(mockSetRowSelection).not.toHaveBeenCalled();
});

it('waits for the request to finish before closing the editor', async () => {
  let complete!: () => void;
  const update = jest.fn().mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
  renderTable(update);
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(mockSetEditingRow).not.toHaveBeenCalledWith(null);
  await act(async () => complete());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mockSetEditingRow).toHaveBeenCalledWith(null);
});

it('allows retrying a failed save and closes after success', async () => {
  const update = jest.fn().mockRejectedValueOnce(new Error('Please retry')).mockResolvedValueOnce(undefined);
  renderTable(update);
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Please retry');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(update).toHaveBeenCalledTimes(2);
});
