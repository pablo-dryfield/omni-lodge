import { Badge, Switch } from "@mantine/core";
import dayjs from "dayjs";
import type { ResponseModifications } from "../../types/general/ResponseModifications";
import type { ProductAlias } from "../../types/products/ProductAlias";
import CustomEditSelect, { type EditSelectOption } from "../../utils/CustomEditSelect";
import CustomEditSwitch from "../../utils/CustomEditSwitch";
import { resolveHeaderLabel } from "../../utils/resolveHeaderLabel";

export type ProductAliasColumnParams = {
  productOptions: EditSelectOption[];
  productLabelById: Map<number, string>;
};

export const productAliasesColumnDef = (
  { productOptions, productLabelById }: ProductAliasColumnParams,
): ResponseModifications<Partial<ProductAlias>>[] => {
  const matchTypeOptions: EditSelectOption[] = [
    { value: "contains", label: "Contains" },
    { value: "exact", label: "Exact" },
    { value: "regex", label: "Regex" },
  ];

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
      accessorKey: "label",
      modifications: {
        id: "label",
        header: "Incoming Label",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        mantineEditTextInputProps: { required: true },
      },
    },
    {
      accessorKey: "normalizedLabel",
      modifications: {
        id: "normalizedLabel",
        header: "Normalized",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Edit: () => null,
      },
    },
    {
      accessorKey: "productId",
      modifications: {
        id: "productId",
        header: "Product",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Cell: ({ cell }) => {
          const value = cell.getValue<number | null>();
          if (!value) {
            return <Badge color="gray" variant="light">Unassigned</Badge>;
          }
          const label = productLabelById.get(Number(value));
          return label ?? `#${value}`;
        },
        Edit: ({ cell, row, table }) => (
          <CustomEditSelect
            cell={cell}
            row={row}
            table={table}
            options={productOptions}
            placeholder="Select product"
          />
        ),
      },
    },
    {
      accessorKey: "matchType",
      modifications: {
        id: "matchType",
        header: "Match Type",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Cell: ({ cell }) => {
          const value = cell.getValue<string>();
          const label = matchTypeOptions.find((option) => option.value === value)?.label ?? value;
          return <Badge variant="light">{label}</Badge>;
        },
        Edit: ({ cell, row, table }) => (
          <CustomEditSelect
            cell={cell}
            row={row}
            table={table}
            options={matchTypeOptions}
            placeholder="Select match type"
          />
        ),
      },
    },
    {
      accessorKey: "priority",
      modifications: {
        id: "priority",
        header: "Priority",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        mantineEditTextInputProps: {
          type: "number",
          min: 0,
          step: 1,
        },
      },
    },
    {
      accessorKey: "active",
      modifications: {
        id: "active",
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
      accessorKey: "hitCount",
      modifications: {
        id: "hitCount",
        header: "Hits",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Edit: () => null,
      },
    },
    {
      accessorKey: "source",
      modifications: {
        id: "source",
        header: "Source",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Edit: () => null,
      },
    },
    {
      accessorKey: "firstSeenAt",
      modifications: {
        id: "firstSeenAt",
        header: "First Seen",
        filterVariant: "date-range",
        sortingFn: "datetime",
        enableColumnFilterModes: false,
        Cell: ({ cell }) =>
          cell.getValue<string | null>()
            ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss")
            : "",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Edit: () => null,
      },
    },
    {
      accessorKey: "lastSeenAt",
      modifications: {
        id: "lastSeenAt",
        header: "Last Seen",
        filterVariant: "date-range",
        sortingFn: "datetime",
        enableColumnFilterModes: false,
        Cell: ({ cell }) =>
          cell.getValue<string | null>()
            ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss")
            : "",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Edit: () => null,
      },
    },
    {
      accessorKey: "createdAt",
      modifications: {
        id: "createdAt",
        header: "Created At",
        filterVariant: "date-range",
        sortingFn: "datetime",
        enableColumnFilterModes: false,
        Cell: ({ cell }) =>
          cell.getValue<string | null>()
            ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss")
            : "",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Edit: () => null,
      },
    },
    {
      accessorKey: "updatedAt",
      modifications: {
        id: "updatedAt",
        header: "Updated At",
        filterVariant: "date-range",
        sortingFn: "datetime",
        enableColumnFilterModes: false,
        Cell: ({ cell }) =>
          cell.getValue<string | null>()
            ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss")
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
