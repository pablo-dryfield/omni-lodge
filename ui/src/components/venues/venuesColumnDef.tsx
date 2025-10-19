import dayjs from "dayjs";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Venue } from "../../types/venues/Venue";

export const venuesColumnDef = (): ResponseModifications<Partial<Venue>>[] => [
  {
    accessorKey: "id",
    modifications: {
      header: "ID",
      enableEditing: false,
      enableColumnFilterModes: false,
      enableGrouping: false,
      enableSorting: true,
      size: 80,
      visibleInShowHideMenu: false,
    },
  },
  {
    accessorKey: "name",
    modifications: {
      header: "Name",
      mantineEditTextInputProps: {
        required: true,
      },
    },
  },
  {
    accessorKey: "sortOrder",
    modifications: {
      header: "Sort Order",
      mantineEditTextInputProps: {
        type: "number",
        min: 0,
      },
      enableSorting: true,
    },
  },
  {
    accessorKey: "allowsOpenBar",
    modifications: {
      header: "Open Bar Eligible",
      Cell: ({ cell }) => (cell.getValue<boolean>() ? "Yes" : "No"),
      editVariant: "checkbox",
      enableSorting: true,
    },
  },
  {
    accessorKey: "isActive",
    modifications: {
      header: "Active",
      Cell: ({ cell }) => (cell.getValue<boolean>() ? "Yes" : "No"),
      editVariant: "checkbox",
      enableSorting: true,
    },
  },
  {
    accessorKey: "createdAt",
    modifications: {
      header: "Created At",
      enableEditing: false,
      enableColumnFilterModes: false,
      enableGrouping: false,
      sortingFn: "datetime",
      Cell: ({ cell }) =>
        cell.getValue<Date>() ? dayjs(cell.getValue<Date>()).format("YYYY-MM-DD HH:mm:ss") : "",
    },
  },
  {
    accessorKey: "updatedAt",
    modifications: {
      header: "Updated At",
      enableEditing: false,
      enableColumnFilterModes: false,
      enableGrouping: false,
      sortingFn: "datetime",
      Cell: ({ cell }) =>
        cell.getValue<Date>() ? dayjs(cell.getValue<Date>()).format("YYYY-MM-DD HH:mm:ss") : "",
    },
  },
];
