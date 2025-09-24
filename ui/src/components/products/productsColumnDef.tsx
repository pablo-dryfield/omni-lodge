import { Switch } from "@mantine/core";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Product } from "../../types/products/Product";
import dayjs from "dayjs";
import CustomEditSwitch from "../../utils/CustomEditSwitch";
import CustomEditSelect, { EditSelectOption } from "../../utils/CustomEditSelect";
import { resolveHeaderLabel } from "../../utils/resolveHeaderLabel";

export type ProductColumnParams = {
  productTypeLabelById: Map<number, string>;
};

export const productsColumnDef = (
  { productTypeLabelById }: ProductColumnParams,
): ResponseModifications<Partial<Product>>[] => {
  const productTypeOptions: EditSelectOption[] = Array.from(productTypeLabelById.entries()).map(
    ([id, label]) => ({
      value: String(id),
      label: `${label} (#${id})`,
    }),
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
      accessorKey: "productTypeId",
      modifications: {
        id: "productTypeId",
        header: "Product Type",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        Cell: ({ cell }) => {
          const idValue = cell.getValue<number>();
          const label = productTypeLabelById.get(Number(idValue));
          return label ? `${label} (#${idValue})` : idValue;
        },
        Edit: ({ cell, row, table }) => (
          <CustomEditSelect
            cell={cell}
            row={row}
            table={table}
            options={productTypeOptions}
            placeholder="Select product type"
          />
        ),
      },
    },
    {
      accessorKey: "price",
      modifications: {
        id: "price",
        header: "Price",
        Header: ({ column }) => <div>{column.columnDef.header}</div>,
        mantineEditTextInputProps: {
          required: true,
          type: "number",
          min: 0,
          step: 0.01,
        },
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
        Edit: ({ cell, row, table }) => <CustomEditSwitch cell={cell} row={row} table={table} />,
      },
    },
  ];
};