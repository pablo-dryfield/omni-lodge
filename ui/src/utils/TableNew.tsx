import {
  MantineReactTable,
  useMantineReactTable,
  MRT_TableOptions,
  type MRT_ColumnDef,
  MRT_GlobalFilterTextInput as MRTGlobalFilterTextInput,
  MRT_ToggleFiltersButton as MRTToggleFiltersButton, 
  MRT_EditActionButtons,
  MRT_Row,
} from 'mantine-react-table';
import { Box, Button, Flex, Stack, Text, Title } from '@mantine/core';
import { ModalsProvider, modals } from '@mantine/modals';
import cloneDeep from 'lodash/cloneDeep';
type TableActions = {
  [actionName: string]: (...args: any[]) => void;
}

// Define the TableProps interface with the dynamic actions
type TableProps<T extends Record<string, any>> = {
  data: T[];
  loading: boolean;
  error: string | null;
  columns: MRT_ColumnDef<T>[];
  actions: TableActions;
}

const Table = <T extends {}>({ data, loading, error, columns, actions }: TableProps<T>) => {

  const handleCreate: MRT_TableOptions<T>['onCreatingRowSave'] =  ({
    values,
    exitCreatingMode,
  }) => {
    actions.handleCreate(values);
    exitCreatingMode();
  };

   const handleUpdate: MRT_TableOptions<T>['onEditingRowSave'] = async ({
    values,
    table,
  }) => {
    await actions.handleUpdate(values);
    table.setEditingRow(null); //exit editing mode
  };

  const openDeleteConfirmModal = (rows: MRT_Row<T>[]) => {
    const count = rows.length;
    let iterator = 1;
    modals.openConfirmModal({
      title: 'Are you sure you want to delete this user?',
      children: (
        <Text>
          Are you sure you want to delete? This action cannot be undone.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => rows.map((row) => {
        actions.handleDelete(row.original, count, iterator);
        iterator += 1;
      }),
    });
  }
  
  const table = useMantineReactTable({
    columns: cloneDeep(columns),
    data, //must be memoized or stable (useState, useMemo, defined outside of this component, etc.)
    enableColumnFilterModes: true,
    enableColumnOrdering: true,
    enableFacetedValues: true,
    enableGrouping: true,
    enablePinning: true,
    enableRowActions: true,
    enableRowSelection: true,
    enableStickyHeader: true,
    enableStickyFooter: true,
    createDisplayMode: 'modal', 
    editDisplayMode:'modal',
    enableEditing: true,
    onCreatingRowSave: handleCreate,
    onEditingRowSave: handleUpdate,
    initialState: { showColumnFilters: false, showGlobalFilter: true },
    mantineTableContainerProps: { style: { maxHeight: '520px' } },
    paginationDisplayMode: 'pages',
    positionToolbarAlertBanner: 'bottom',
    mantinePaginationProps: {
      radius: 'xl',
      size: 'lg',
    },
    mantineSearchTextInputProps: {
      placeholder: 'Search',
    },
    renderCreateRowModalContent: ({
      internalEditComponents,
      row,
      table
    }) => (
       <Stack>
          {internalEditComponents}
          <Flex justify="flex-end">
            <MRT_EditActionButtons row={row} table={table} variant="text" />
          </Flex>
        </Stack>
    ),
    renderEditRowModalContent: ({ table, row, internalEditComponents }) => (
      <Stack>
        {internalEditComponents}
        <Flex justify="flex-end" mt="xl">
          <MRT_EditActionButtons variant="text" table={table} row={row} />
        </Flex>
      </Stack>
    ),
    renderDetailPanel: ({ row }) => (
      <Box
        style={{
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: '16px',
          padding: '16px',
        }}
      >
        <img
          alt="avatar"
          height={200}
          src="https://cloudflare-ipfs.com/ipfs/Qmd3W5DuhgHirLHGVixi6V76LhCkZUz6pnFt5AJBiyvHye/avatar/528.jpg"
          style={{ borderRadius: '50%' }}
        />
        <Box style={{ textAlign: 'center' }}>
          <Title>Signature Catch Phrase:</Title>
          <Text>&quot;Front-line logistical service-desk&quot;</Text>
        </Box>
      </Box>
    ),
    renderTopToolbar: ({ table }) => {
      const handleDelete = () => {
        openDeleteConfirmModal(table.getSelectedRowModel().flatRows);
      };

      const handleCreate = () => {
        table.setCreatingRow(true); 
      };

      const handleUpdate = () => {
        table.getSelectedRowModel().flatRows.map((row) => { 
          table.setEditingRow(row);
        });  
      };

      return (
        <Flex p="md" justify="space-between">
          <Flex gap="xs">
            {/* import MRT sub-components */}
            <MRTGlobalFilterTextInput table={table} />
            <MRTToggleFiltersButton table={table} />
          </Flex>
          <Flex style={{ gap: '8px' }}>
            <Button
              color="green"
              disabled={table.getIsSomeRowsSelected() || table.getIsSomePageRowsSelected() || table.getIsAllPageRowsSelected() || table.getIsAllRowsSelected()}
              onClick={handleCreate}
              variant="filled"
            >
              Add New
            </Button>
            <Button
              color="blue"
              disabled={Object.keys(table.getSelectedRowModel().rowsById).length !== 1}
              onClick={handleUpdate}
              variant="filled"
            >
              Update
            </Button>
            <Button
              color="red"
              disabled={!table.getIsSomeRowsSelected() && !table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected() && !table.getIsAllRowsSelected()}
              onClick={handleDelete}
              variant="filled"
            >
              Remove
            </Button>
          </Flex>
        </Flex>
      );
    },
  });

  return (<ModalsProvider>
            <MantineReactTable table={table} />
          </ModalsProvider>);
};

export default Table;