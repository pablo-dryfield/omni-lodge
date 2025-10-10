import dayjs from "dayjs";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { ChannelProductPrice } from "../../types/channels/ChannelProductPrice";
import CustomEditSelect, { EditSelectOption } from "../../utils/CustomEditSelect";

export type ChannelProductPriceColumnParams = {
  channelOptions: EditSelectOption[];
  productOptions: EditSelectOption[];
};

export const channelProductPriceColumnDef = ({
  channelOptions,
  productOptions,
}: ChannelProductPriceColumnParams): ResponseModifications<Partial<ChannelProductPrice>>[] => [
  {
    accessorKey: "id",
    modifications: {
      id: "id",
      header: "ID",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      enableSorting: true,
      Edit: () => null,
      visibleInShowHideMenu: false,
    },
  },
  {
    accessorKey: "channelId",
    modifications: {
      id: "channelId",
      header: "Channel",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ row }) => {
        const label = row.original.channelName;
        const idValue = row.original.channelId;
        return label ? `${label} (#${idValue})` : idValue;
      },
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={channelOptions}
          placeholder="Select channel"
        />
      ),
    },
  },
  {
    accessorKey: "productId",
    modifications: {
      id: "productId",
      header: "Product",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ row }) => {
        const label = row.original.productName;
        const idValue = row.original.productId;
        return label ? `${label} (#${idValue})` : idValue;
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
    accessorKey: "price",
    modifications: {
      id: "price",
      header: "Price",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => {
        const value = Number(cell.getValue<number>());
        if (Number.isNaN(value)) {
          return "";
        }
        return value.toFixed(2);
      },
      mantineEditTextInputProps: {
        type: "number",
        min: 0,
        step: 0.01,
        required: true,
      },
    },
  },
  {
    accessorKey: "validFrom",
    modifications: {
      id: "validFrom",
      header: "Valid From",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) =>
        cell.getValue<string>()
          ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD")
          : "",
      mantineEditTextInputProps: {
        type: "date",
        required: true,
      },
    },
  },
  {
    accessorKey: "validTo",
    modifications: {
      id: "validTo",
      header: "Valid To",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) =>
        cell.getValue<string>()
          ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD")
          : "",
      mantineEditTextInputProps: {
        type: "date",
      },
    },
  },
  {
    accessorKey: "createdAt",
    modifications: {
      id: "createdAt",
      header: "Created At",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      enableEditing: false,
      enableColumnFilterModes: false,
      enableGrouping: false,
      Cell: ({ cell }) =>
        cell.getValue<string>()
          ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss")
          : "",
    },
  },
  {
    accessorKey: "updatedAt",
    modifications: {
      id: "updatedAt",
      header: "Updated At",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      enableEditing: false,
      enableColumnFilterModes: false,
      enableGrouping: false,
      Cell: ({ cell }) =>
        cell.getValue<string>()
          ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss")
          : "",
    },
  },
  {
    accessorKey: "createdByName",
    modifications: {
      id: "createdByName",
      header: "Created By",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      enableEditing: false,
    },
  },
  {
    accessorKey: "updatedByName",
    modifications: {
      id: "updatedByName",
      header: "Updated By",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      enableEditing: false,
    },
  },
];
