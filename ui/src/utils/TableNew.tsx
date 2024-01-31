import { useMemo } from 'react';
import {
  MantineReactTable,
  useMantineReactTable,
  MRT_TableOptions,
  type MRT_ColumnDef,
  MRT_GlobalFilterTextInput as MRTGlobalFilterTextInput,
  MRT_ToggleFiltersButton as MRTToggleFiltersButton ,
} from 'mantine-react-table';
import { Box, Button, Flex, Text, Title } from '@mantine/core';
import cloneDeep from 'lodash/cloneDeep';
type TableActions = {
  [actionName: string]: (...args: any[]) => void;
}

// Define the TableProps interface with the dynamic actions
type TableProps<T extends Record<string, any>> = {
  data: T[];
  columns: MRT_ColumnDef<T>[];
  actions: TableActions;
}

const Table = <T extends {}>({ data, columns, actions }: TableProps<T>) => {

  const handleCreateUser: MRT_TableOptions<T>['onCreatingRowSave'] =  ({
    values,
    exitCreatingMode,
  }) => {
    console.log(values)
    actions.createUser(values);
    exitCreatingMode();
  };
  
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
    onCreatingRowSave: handleCreateUser,
    initialState: { showColumnFilters: false, showGlobalFilter: true },
    mantineTableContainerProps: { sx: { maxHeight: '520px' } },
    paginationDisplayMode: 'pages',
    positionToolbarAlertBanner: 'bottom',
    mantinePaginationProps: {
      radius: 'xl',
      size: 'lg',
    },
    mantineSearchTextInputProps: {
      placeholder: 'Search Employees',
    },
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