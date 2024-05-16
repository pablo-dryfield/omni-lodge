import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Counter } from '../../types/counters/Counter';
import dayjs from 'dayjs';
import CounterProductModal from "../counters/CounterProductModal";

export const countersColumnDef: ResponseModifications<Partial<Counter>>[] = [
  {
    accessorKey: 'id',
    modifications: {
      id: 'id',
      header: 'ID',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: ({ table, row, cell }) => <CounterProductModal table={table} row={row} cell={cell}/>,
      visibleInShowHideMenu: false,
    }
  },
  {
    accessorKey: 'date',
    modifications: {
      id: 'date',
      header: 'Take Date',
      filterVariant: 'date-range',
      sortingFn: 'datetime',
      enableColumnFilterModes: false,
      Cell: ({ cell }) => dayjs(cell.getValue<Date>()).format('YYYY-MM-DD'),
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
  {
    accessorKey: 'userId',
    modifications: {
      id: 'userId',
      header: 'User ID',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      visibleInShowHideMenu: false,
    }
  },
  {
    accessorKey: 'user',
    modifications: {
      id: 'user',
      header: 'Manager',
      Cell: ({ cell }) => {
        const user = cell.getValue() as { firstName: string } | null;
        return user ? <div>{user.firstName}</div> : null;
      },
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      visibleInShowHideMenu: false,
    }
  },
  {
    accessorKey: 'total',
    modifications: {
      id: 'total',
      header: 'Grand Total',
      Cell: ({ cell }) => {
        const total = cell.getValue<Number>();
        if (total !== undefined && total !== null) {
          return total.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2});
        } else {
          return '' // Or any default value you want to display if total is not available
        }
      },
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'createdBy',
    modifications: {
      id: 'createdBy',
      header: 'Created By ID',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
  {
    accessorKey: 'createdByUser',
    modifications: {
      id: 'createdByUser',
      header: 'Created By',
      Cell: ({ cell }) => {
        const user = cell.getValue() as { firstName: string } | null;
        return user ? <div>{user.firstName}</div> : null;
      },
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      visibleInShowHideMenu: false,
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
    accessorKey: 'updatedBy',
    modifications: {
      id: 'updatedBy',
      header: 'Updated By ID',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
  {
    accessorKey: 'updatedByUser',
    modifications: {
      id: 'updatedByUser',
      header: 'Updated By',
      Cell: ({ cell }) => {
        const user = cell.getValue() as { firstName: string } | null;
        return user ? <div>{user.firstName}</div> : null;
      },
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      visibleInShowHideMenu: false,
    }
  },
];