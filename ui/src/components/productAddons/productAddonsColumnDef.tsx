import dayjs from "dayjs";
import { MRT_ColumnDef } from "mantine-react-table";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { ProductAddon } from "../../types/productAddons/ProductAddon";
import CustomEditSelect, { EditSelectOption } from "../../utils/CustomEditSelect";

export type ProductAddonColumnParams = {
  productLabelById: Map<number, string>;
  addonLabelById: Map<number, string>;
  productOptions: EditSelectOption[];
  addonOptions: EditSelectOption[];
};

export const productAddonsColumnDef = ({
  productLabelById,
  addonLabelById,
  productOptions,
  addonOptions,
}: ProductAddonColumnParams): ResponseModifications<Partial<ProductAddon>>[] => [
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
    accessorKey: "productId",
    modifications: {
      id: "productId",
      header: "Product",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => {
        const value = Number(cell.getValue<number>());
        const label = productLabelById.get(value) ?? `Product #${value}`;
        return `${label} (#${value})`;
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
    accessorKey: "addonId",
    modifications: {
      id: "addonId",
      header: "Add-On",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => {
        const value = Number(cell.getValue<number>());
        const label = addonLabelById.get(value) ?? `Add-On #${value}`;
        return `${label} (#${value})`;
      },
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={addonOptions}
          placeholder="Select add-on"
        />
      ),
    },
  },
  {
    accessorKey: "maxPerAttendee",
    modifications: {
      id: "maxPerAttendee",
      header: "Max Per Attendee",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        type: "number",
        min: 1,
        step: 1,
      },
    },
  },
  {
    accessorKey: "priceOverride",
    modifications: {
      id: "priceOverride",
      header: "Price Override",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        type: "number",
        min: 0,
        step: 0.01,
      },
      Cell: ({ cell }) => {
        const value = cell.getValue<number | null>();
        if (value === null || value === undefined) {
          return "";
        }
        return Number(value).toFixed(2);
      },
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
        min: 0,
        step: 1,
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
