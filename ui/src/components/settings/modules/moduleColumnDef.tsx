import React from "react";
import dayjs from "dayjs";
import { Switch } from "@mantine/core";
import { ResponseModifications } from "../../../types/general/ResponseModifications";
import { Module } from "../../../types/modules/Module";
import CustomEditSwitch from "../../../utils/CustomEditSwitch";
import { resolveHeaderLabel } from "../../../utils/resolveHeaderLabel";
import CustomEditSelect, {
  EditSelectOption,
} from "../../../utils/CustomEditSelect";

export type ModuleColumnParams = {
  pageLabelById: Map<number, string>;
};

export const moduleColumnDef = (
  { pageLabelById }: ModuleColumnParams
): ResponseModifications<Partial<Module>>[] => {
  const pageOptions: EditSelectOption[] = Array.from(pageLabelById.entries()).map(
    ([id, label]) => ({
      value: String(id),
      label: `${label} (#${id})`,
    })
  );

  return [
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
      accessorKey: "pageId",
      modifications: {
        id: "pageId",
        header: "Page",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Cell: ({ cell }) => {
          const idValue = cell.getValue<number>();
          const pageLabel = pageLabelById.get(Number(idValue));
          return pageLabel ? `${pageLabel} (#${idValue})` : idValue;
        },
        Edit: ({ cell, row, table }) => (
          <CustomEditSelect
            cell={cell}
            row={row}
            table={table}
            options={pageOptions}
            placeholder="Select page"
          />
        ),
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
      accessorKey: "componentRef",
      modifications: {
        id: "componentRef",
        header: "Component Ref",
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
          min: 0,
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
};