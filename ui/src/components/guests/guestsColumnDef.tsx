import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Guest } from '../../types/guests/Guest';
import dayjs from 'dayjs';

export const guestsColumnDef: ResponseModifications<Guest>[] = [
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
    accessorKey: 'email',
    modifications: {
      enableClickToCopy: true,
      id: 'email',
      header: 'Email',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        type: 'email',
        required: true,
      },
    }
  },
  {
    accessorKey: 'phoneNumber',
    modifications: {
      id: 'phoneNumber',
      header: 'Phone Number',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'address',
    modifications: {
      id: 'address',
      header: 'Address',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'paymentStatus',
    modifications: {
      id: 'paymentStatus',
      header: 'Payment Status',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'deposit',
    modifications: {
      id: 'deposit',
      header: 'Deposit',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'notes',
    modifications: {
      enableClickToCopy: true,
      id: 'notes',
      header: 'Notes',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
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