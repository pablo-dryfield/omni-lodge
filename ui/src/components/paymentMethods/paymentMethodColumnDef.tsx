import dayjs from "dayjs";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { PaymentMethod } from "../../types/paymentMethods/PaymentMethod";

export const paymentMethodColumnDef = (): ResponseModifications<Partial<PaymentMethod>>[] => [
  {
    accessorKey: "id",
    modifications: {
      id: "id",
      header: "ID",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
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
      id: "name",
      header: "Name",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    },
  },
  {
    accessorKey: "description",
    modifications: {
      id: "description",
      header: "Description",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: false,
      },
    },
  },
  {
    accessorKey: "createdAt",
    modifications: {
      id: "createdAt",
      header: "Created At",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      Cell: ({ cell }) =>
        cell.getValue<Date>()
          ? dayjs(cell.getValue<Date>()).format("YYYY-MM-DD HH:mm:ss")
          : "",
      enableColumnFilterModes: false,
      enableGrouping: false,
      sortingFn: "datetime",
    },
  },
  {
    accessorKey: "updatedAt",
    modifications: {
      id: "updatedAt",
      header: "Updated At",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      Cell: ({ cell }) =>
        cell.getValue<Date>()
          ? dayjs(cell.getValue<Date>()).format("YYYY-MM-DD HH:mm:ss")
          : "",
      enableColumnFilterModes: false,
      enableGrouping: false,
      sortingFn: "datetime",
    },
  },
];
