import React from "react";
import dayjs from "dayjs";
import { Switch } from "@mantine/core";
import { ResponseModifications } from "../../../types/general/ResponseModifications";
import { Page } from "../../../types/pages/Page";
import CustomEditSwitch from "../../../utils/CustomEditSwitch";
import { resolveHeaderLabel } from "../../../utils/resolveHeaderLabel";

export const pageColumnDef: ResponseModifications<Partial<Page>>[] = [
  {
    accessorKey: "id",
    modifications: {
      id: "id",
      header: "ID",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      visibleInShowHideMenu: false,
    },
  },
  {
    accessorKey: "slug",
    modifications: {
      id: "slug",
      header: "Slug",
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
    accessorKey: "icon",
    modifications: {
      id: "icon",
      header: "Icon",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
    },
  },
  {
    accessorKey: "sortOrder",
    modifications: {
      id: "sortOrder",
      header: "Sort Order",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        type: "number",
        required: true,
      },
    },
  },
  {
    accessorKey: "status",
    modifications: {
      id: "status",
      header: "Status",
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
      Edit: ({ cell, row, table }) => (
        <CustomEditSwitch cell={cell} row={row} table={table} />
      ),
    },
  },
  {
    accessorKey: "createdAt",
    modifications: {
      id: "createdAt",
      header: "Created Date",
      filterVariant: "date-range",
      sortingFn: "datetime",
      enableColumnFilterModes: false,
      Cell: ({ cell }) =>
        cell.getValue<Date>()
          ? dayjs(cell.getValue<Date>()).format("YYYY-MM-DD HH:mm:ss")
          : "",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    },
  },
  {
    accessorKey: "updatedAt",
    modifications: {
      id: "updatedAt",
      header: "Updated Date",
      filterVariant: "date-range",
      sortingFn: "datetime",
      enableColumnFilterModes: false,
      Cell: ({ cell }) =>
        cell.getValue<Date>()
          ? dayjs(cell.getValue<Date>()).format("YYYY-MM-DD HH:mm:ss")
          : "",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    },
  },
  {
    accessorKey: "createdBy",
    modifications: {
      id: "createdBy",
      header: "Created By",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    },
  },
  {
    accessorKey: "updatedBy",
    modifications: {
      id: "updatedBy",
      header: "Updated By",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    },
  },
];