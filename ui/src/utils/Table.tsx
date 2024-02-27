import {
  MantineReactTable,
  useMantineReactTable,
  MRT_GlobalFilterTextInput as MRTGlobalFilterTextInput,
  MRT_ToggleFiltersButton as MRTToggleFiltersButton, 
  MRT_Row,
} from 'mantine-react-table';
import { Box, Button, Flex, Text, Title } from '@mantine/core';
import { ModalsProvider, modals } from '@mantine/modals';
import { ModalContent } from './ModalContent';
import cloneDeep from 'lodash/cloneDeep';
import { useState } from 'react';
import { TableProps } from '../types/general/TableProps';

const Table = <T extends {}>({ pageTitle, data, loading, error, columns, actions, initialState }: TableProps<T>) => {

  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [updateModalOpened, setUpdateModalOpened] = useState(false);

  const openDeleteConfirmModal = (rows: MRT_Row<T>[]) => {
    const count = rows.length;
    let iterator = 1;
    modals.openConfirmModal({
      title: 'Are you sure you want to delete this row?',
      children: (
        <Text>
          Are you sure you want to delete? This action cannot be undone.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      centered: true,
      onConfirm: () => rows.forEach((row) => {
        actions.handleDelete(row.original, count, iterator);
        iterator += 1;
      }),
    });
  }
  
  const table = useMantineReactTable({
    columns: cloneDeep(columns),
    data,
    enableColumnFilterModes: true,
    enableColumnOrdering: true,
    enableFacetedValues: true,
    enableGrouping: true,
    enablePinning: true,
    mantineTableBodyProps:{
      style: {
        '& tr:nthOfType(odd)': {
          backgroundColor: '#f5f5f5',
        },
        borderTop: '2px solid #e0e0e0',
      },
    },
    enableRowSelection: true,
    enableStickyHeader: true,
    enableStickyFooter: true,
    initialState: initialState,
    enableColumnResizing: true,
    layoutMode: 'grid',
    onCreatingRowSave: ({ values, exitCreatingMode, }) => {
      actions.handleCreate(values);
      exitCreatingMode();
    },
    onEditingRowSave: ({ values, table, row}) => {
      actions.handleUpdate(row.original, values);
      table.setEditingRow(null); 
    },
    mantineProgressProps: ({ isTopToolbar }) => ({
      color: 'orange',
      sx: { display: isTopToolbar ? 'block' : 'none' }, //only show top toolbar progress bar
      value: 100, 
      striped: true,
      animated: true,
    }),
    state: {
      isLoading:loading,
      showProgressBars:loading,
      showAlertBanner: error !== null || columns.length === 0,
    },
    mantineToolbarAlertBannerProps: (error!== null || (columns.length === 0)) && !loading ?  {
        color: 'red',
        children: error !== null ? error : "Error processing the data",
      }
    : undefined,
    mantineTableHeadCellProps: {
      style: {
        flex: '0 0 auto',
      },
    },
    mantineTableBodyCellProps: {
      style: {
        flex: '0 0 auto',
      },
    },
    mantineTableContainerProps: { style: { maxHeight: '570px', minHeight: '570px',} },
    mantinePaperProps: { shadow:'none', style: { border: '0px'} },
    paginationDisplayMode: 'pages',
    positionToolbarAlertBanner: 'bottom',
    mantinePaginationProps: {
      radius: 'xl',
      size: 'lg',
    },
    mantineSearchTextInputProps: {
      placeholder: 'Search',
    },
    renderCreateRowModalContent: ({ internalEditComponents, row, table }) => (<ModalContent
      internalEditComponents={internalEditComponents}
      row={row}
      table={table}
      opened={createModalOpened}
      setOpened={setCreateModalOpened}
      title={"Create " + pageTitle}
    />),
    renderEditRowModalContent: ({ table, row, internalEditComponents }) => (<ModalContent
      internalEditComponents={internalEditComponents}
      row={row}
      table={table}
      opened={updateModalOpened}
      setOpened={setUpdateModalOpened}
      title={"Edit " + pageTitle}
    />),
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
        table.getSelectedRowModel().flatRows.forEach((row) => { 
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