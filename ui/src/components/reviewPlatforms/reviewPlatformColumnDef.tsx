import { type ResponseModifications } from '../../types/general/ResponseModifications';
import type { ReviewPlatform } from '../../types/reviewPlatforms/ReviewPlatform';
import CustomEditSelect from '../../utils/CustomEditSelect';
import type { MRT_Row, MRT_TableInstance } from 'mantine-react-table';

const booleanOptions = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

const renderBooleanEdit = (
  cell: any,
  row: MRT_Row<Partial<ReviewPlatform>>,
  table: MRT_TableInstance<Partial<ReviewPlatform>>,
) => (
  <CustomEditSelect
    cell={cell}
    row={row}
    table={table}
    options={booleanOptions}
    placeholder="Select status"
  />
);

export const reviewPlatformColumnDef = (): ResponseModifications<Partial<ReviewPlatform>>[] => [
  {
    accessorKey: 'id',
    modifications: {
      id: 'id',
      header: 'ID',
      enableEditing: false,
      enableColumnFilterModes: false,
    },
  },
  {
    accessorKey: 'name',
    modifications: {
      id: 'name',
      header: 'Name',
      mantineEditTextInputProps: {
        required: true,
      },
    },
  },
  {
    accessorKey: 'slug',
    modifications: {
      id: 'slug',
      header: 'Slug',
      mantineEditTextInputProps: {
        required: true,
      },
    },
  },
  {
    accessorKey: 'description',
    modifications: {
      id: 'description',
      header: 'Description',
    },
  },
  {
    accessorKey: 'isActive',
    modifications: {
      id: 'isActive',
      header: 'Active',
      Cell: ({ cell }) => (cell.getValue<boolean>() ? 'Yes' : 'No'),
      Edit: renderBooleanEdit,
    },
  },
];
