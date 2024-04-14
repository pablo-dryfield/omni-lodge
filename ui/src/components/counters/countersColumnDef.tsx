import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Counter } from '../../types/counters/Counter';
import dayjs from 'dayjs';

export const countersColumnDef: ResponseModifications<Partial<Counter>>[] = [
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
    accessorKey: 'test',
    modifications: {
      id: 'test',
      header: 'test',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      visibleInShowHideMenu: false,
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
    accessorKey: 'date',
    modifications: {
      id: 'date',
      header: 'Date',
      filterVariant: 'date-range',
      sortingFn: 'datetime',
      enableColumnFilterModes: false,
      Cell: ({ cell }) => dayjs(cell.getValue<Date>()).format('YYYY-MM-DD HH:mm:ss'),
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
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