import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Channel } from '../../types/channels/Channel';
import dayjs from 'dayjs';

export const channelsColumnDef: ResponseModifications<Partial<Channel>>[] = [
  {
    accessorKey: 'id',
    modifications: {
      id: 'id',
      header: 'ID',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      visibleInShowHideMenu: false,
    }
  },
  {
    accessorKey: 'name',
    modifications: {
      id: 'name',
      header: 'Name',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'description',
    modifications: {
      id: 'description',
      header: 'Description',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'apiKey',
    modifications: {
      id: 'apiKey',
      header: 'API Key',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'apiSecret',
    modifications: {
      enableClickToCopy: true,
      id: 'apiSecret',
      header: 'API Secret',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'paymentMethodName',
    modifications: {
      id: 'paymentMethodName',
      header: 'Payment Method',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell, row }) => row.original.paymentMethod?.name ?? cell.getValue<string>() ?? '—',
      Edit: () => null,
    }
  },
  {
    accessorKey: 'paymentMethodId',
    modifications: {
      id: 'paymentMethodId',
      header: 'Payment Method ID',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      visibleInShowHideMenu: false,
      Edit: () => null,
      enableColumnFilter: false,
      enableSorting: false,
      Cell: () => null,
    }
  },
  {
    accessorKey: 'createdAt',
    modifications: {
      id: 'createdAt',
      header: 'Created Date',
      filterVariant: 'date-range',
      sortingFn: 'datetime',
      enableColumnFilterModes: false,
      Cell: ({ cell }) => dayjs(cell.getValue<Date>()).format('YYYY-MM-DD HH:mm:ss'),
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
  {
    accessorKey: 'updatedAt',
    modifications: {
      id: 'updatedAt',
      header: 'Updated Date',
      filterVariant: 'date-range',
      sortingFn: 'datetime',
      enableColumnFilterModes: false,
      Cell: ({ cell }) => dayjs(cell.getValue<Date>()).format('YYYY-MM-DD HH:mm:ss'),
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
  {
    accessorKey: 'createdBy',
    modifications: {
      id: 'createdBy',
      header: 'Created By',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
  {
    accessorKey: 'updatedBy',
    modifications: {
      id: 'updatedBy',
      header: 'Updated By',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
];
