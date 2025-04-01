import { Switch } from "@mantine/core";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Product } from "../../types/products/Product";
import dayjs from 'dayjs';
import CustomEditSwitch from "../../utils/CustomEditSwitch";

export const productsColumnDef: ResponseModifications<Partial<Product>>[] = [
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
    accessorKey: 'productTypeId',
    modifications: {
      id: 'productTypeId',
      header: 'Product Type ID',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'price',
    modifications: {
      id: 'price',
      header: 'Price',
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
  {
    accessorKey: 'status',
    modifications: {
      id: 'status',
      header: 'Status',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => <Switch
                            checked={Boolean(cell.getValue<boolean>())}
                            onLabel="ON" 
                            offLabel="OFF"
                            />,
      Edit: ({ cell, row, table }) => <CustomEditSwitch cell={cell} row={row} table={table} />
    }
  },
];