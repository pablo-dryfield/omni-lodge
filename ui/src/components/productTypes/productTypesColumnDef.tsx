import { ResponseModifications } from "../../types/general/ResponseModifications";
import { ProductType } from '../../types/productTypes/ProductType';
import dayjs from 'dayjs';

export const productTypesColumnDef: ResponseModifications<Partial<ProductType>>[] = [
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
    accessorKey: 'add',
    modifications: {
      id: 'add',
      header: 'Add',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'sub',
    modifications: {
      id: 'sub',
      header: 'Sub',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'mul',
    modifications: {
      id: 'mul',
      header: 'Mul',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'div',
    modifications: {
      id: 'div',
      header: 'Div',
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