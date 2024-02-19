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

  // const openDeleteConfirmModal = (row: MRT_Row<T>) =>
  // modals.openConfirmModal({
  //   title: 'Are you sure you want to delete this user?',
  //   children: (
  //     <Text>
  //       Are you sure you want to delete {row.original.firstName}{' '}
  //       {row.original.lastName}? This action cannot be undone.
  //     </Text>
  //   ),
  //   labels: { confirm: 'Delete', cancel: 'Cancel' },
  //   confirmProps: { color: 'red' },
  //   onConfirm: () => deleteUser(row.original.id),
  // });
  
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
    editDisplayMode:'modal',
    enableEditing: true,
    onCreatingRowSave: handleCreate,
    initialState: { showColumnFilters: false, showGlobalFilter: true },
    mantineTableContainerProps: { style: { maxHeight: '520px' } },
    paginationDisplayMode: 'pages',
    positionToolbarAlertBanner: 'bottom',
    mantinePaginationProps: {
      radius: 'xl',
      size: 'lg',
    },
    mantineSearchTextInputProps: {
      placeholder: 'Search Employees',
    },
    renderCreateRowModalContent: ({
      internalEditComponents,
      row,
      table
    }) => (
       <Stack>
          <Title order={5}>My Custom Edit Modal</Title>
          {internalEditComponents}
          <Flex justify="flex-end">
            <MRT_EditActionButtons row={row} table={table} variant="text" />
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
      const handleDeactivate = () => {
        table.getSelectedRowModel().flatRows.map((row) => {  
          alert('deactivating ' + row.getValue('name'));
        });
      };

      const handleCreate = () => {
        table.setCreatingRow(true); 
      };

      const handleContact = () => {
        table.getSelectedRowModel().flatRows.map((row) => { 
          alert('contact ' + row.getValue('name'));
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
              disabled={table.getIsSomeRowsSelected()}
              onClick={handleCreate}
              variant="filled"
            >
              Add New
            </Button>
            <Button
              color="blue"
              disabled={!table.getIsSomeRowsSelected()}
              onClick={handleContact}
              variant="filled"
            >
              Update
            </Button>
            <Button
              color="red"
              disabled={!table.getIsSomeRowsSelected()}
              onClick={handleDeactivate}
              variant="filled"
            >
              Remove
            </Button>
          </Flex>
        </Flex>
      );
    },
  });

  return <MantineReactTable table={table} />;
};

export default Table;