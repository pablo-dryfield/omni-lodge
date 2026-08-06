import { ResponseModifications } from "../../types/general/ResponseModifications";
import { UserType } from '../../types/userTypes/UserType';
import dayjs from 'dayjs';
import CustomEditMultiSelect from '../../utils/CustomEditMultiSelect';
import type { EditSelectOption } from '../../utils/CustomEditSelect';

export const userTypesColumnDef = (productTypeOptions: EditSelectOption[]): ResponseModifications<Partial<UserType>>[] => [
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
    accessorKey: 'productTypeIds',
    modifications: {
      id: 'productTypeIds',
      header: 'Allowed Product Types',
      Cell: ({ cell }) => {
        const ids = cell.getValue<number[]>() ?? [];
        if (ids.length === 0) return 'All product types';
        const names = new Map(productTypeOptions.map((option) => [Number(option.value), option.label]));
        return ids.map((id) => names.get(id) ?? `#${id}`).join(', ');
      },
      Edit: ({ cell, row }) => (
        <CustomEditMultiSelect cell={cell} row={row} options={productTypeOptions} placeholder="Empty means all product types" />
      ),
    },
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
