import { Switch } from "@mantine/core";
import dayjs from "dayjs";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Action } from "../../types/actions/Action";
import CustomEditSwitch from "../../utils/CustomEditSwitch";
import { resolveHeaderLabel } from "../../utils/resolveHeaderLabel";

export const actionsColumnDef = (): ResponseModifications<Partial<Action>>[] => [
  {
    accessorKey: "id",
    modifications: {
      id: "id",
      header: "ID",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      visibleInShowHideMenu: false,
      enableColumnFilterModes: false,
      enableGrouping: false,
      enableSorting: true,
      size: 80,
    },
  },
  {
    accessorKey: "key",
    modifications: {
      id: "key",
      header: "Key",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
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
    },
  },
  {
    accessorKey: "isAssignable",
    modifications: {
      id: "isAssignable",
      header: "Assignable",
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
    accessorKey: "status",
    modifications: {
      id: "status",
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
