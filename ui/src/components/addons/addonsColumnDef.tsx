import { Switch } from "@mantine/core";
import dayjs from "dayjs";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Addon } from "../../types/addons/Addon";
import CustomEditSwitch from "../../utils/CustomEditSwitch";
import { resolveHeaderLabel } from "../../utils/resolveHeaderLabel";

const formatNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return value;
  }

  return numeric.toFixed(2);
};

export const addonsColumnDef = (): ResponseModifications<Partial<Addon>>[] => [
  {
    accessorKey: "id",
    modifications: {
      id: "id",
      header: "ID",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      enableColumnFilterModes: false,
      enableEditing: false,
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
    accessorKey: "basePrice",
    modifications: {
      id: "basePrice",
      header: "Base Price",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => formatNumber(cell.getValue()),
      mantineEditTextInputProps: {
        type: "number",
        min: 0,
        step: 0.01,
      },
    },
  },
  {
    accessorKey: "taxRate",
    modifications: {
      id: "taxRate",
      header: "Tax Rate",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => formatNumber(cell.getValue()),
      mantineEditTextInputProps: {
        type: "number",
        min: 0,
        step: 0.0001,
      },
    },
  },
  {
    accessorKey: "isActive",
    modifications: {
      id: "isActive",
      header: "Active",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => {
        const label = resolveHeaderLabel(cell.column.columnDef.header);
        return (
          <Switch
            checked={Boolean(cell.getValue<boolean>())}
            onLabel="ON"
            offLabel="OFF"
            readOnly
            label={label}
            labelPosition="left"
          />
        );
      },
      Edit: ({ cell, row, table }) => <CustomEditSwitch cell={cell} row={row} table={table} />,
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
