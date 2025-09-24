import React from "react";
import dayjs from "dayjs";
import { Switch } from "@mantine/core";
import { ResponseModifications } from "../../../types/general/ResponseModifications";
import { RoleModulePermission } from "../../../types/permissions/RoleModulePermission";
import CustomEditSwitch from "../../../utils/CustomEditSwitch";
import { resolveHeaderLabel } from "../../../utils/resolveHeaderLabel";
import CustomEditSelect, {
  EditSelectOption,
} from "../../../utils/CustomEditSelect";

export type RoleModulePermissionColumnParams = {
  userTypeLabelById: Map<number, string>;
  moduleLabelById: Map<number, string>;
  actionLabelById: Map<number, string>;
};

export const roleModulePermissionColumnDef = (
  { userTypeLabelById, moduleLabelById, actionLabelById }: RoleModulePermissionColumnParams
): ResponseModifications<Partial<RoleModulePermission>>[] => {
  const userTypeOptions: EditSelectOption[] = Array.from(
    userTypeLabelById.entries()
  ).map(([id, label]) => ({
    value: String(id),
    label: `${label} (#${id})`,
  }));

  const moduleOptions: EditSelectOption[] = Array.from(moduleLabelById.entries()).map(
    ([id, label]) => ({
      value: String(id),
      label: `${label} (#${id})`,
    })
  );

  const actionOptions: EditSelectOption[] = Array.from(actionLabelById.entries()).map(
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
      accessorKey: "userTypeId",
      modifications: {
        id: "userTypeId",
        header: "User Type",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Cell: ({ cell }) => {
          const idValue = cell.getValue<number>();
          const label = userTypeLabelById.get(Number(idValue));
          return label ? `${label} (#${idValue})` : idValue;
        },
        Edit: ({ cell, row, table }) => (
          <CustomEditSelect
            cell={cell}
            row={row}
            table={table}
            options={userTypeOptions}
            placeholder="Select user type"
          />
        ),
      },
    },
    {
      accessorKey: "moduleId",
      modifications: {
        id: "moduleId",
        header: "Module",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Cell: ({ cell }) => {
          const idValue = cell.getValue<number>();
          const label = moduleLabelById.get(Number(idValue));
          return label ? `${label} (#${idValue})` : idValue;
        },
        Edit: ({ cell, row, table }) => (
          <CustomEditSelect
            cell={cell}
            row={row}
            table={table}
            options={moduleOptions}
            placeholder="Select module"
          />
        ),
      },
    },
    {
      accessorKey: "actionId",
      modifications: {
        id: "actionId",
        header: "Action",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Cell: ({ cell }) => {
          const idValue = cell.getValue<number>();
          const label = actionLabelById.get(Number(idValue));
          return label ? `${label} (#${idValue})` : idValue;
        },
        Edit: ({ cell, row, table }) => (
          <CustomEditSelect
            cell={cell}
            row={row}
            table={table}
            options={actionOptions}
            placeholder="Select action"
          />
        ),
      },
    },
    {
      accessorKey: "allowed",
      modifications: {
        id: "allowed",
        header: "Allowed",
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