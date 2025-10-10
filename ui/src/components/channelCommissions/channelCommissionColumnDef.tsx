import dayjs from "dayjs";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { ChannelCommission } from "../../types/channels/ChannelCommission";
import CustomEditSelect, { EditSelectOption } from "../../utils/CustomEditSelect";

export type ChannelCommissionColumnParams = {
  channelOptions: EditSelectOption[];
};

export const channelCommissionColumnDef = ({
  channelOptions,
}: ChannelCommissionColumnParams): ResponseModifications<Partial<ChannelCommission>>[] => [
  {
    accessorKey: "id",
    modifications: {
      id: "id",
      header: "ID",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      enableSorting: true,
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
    accessorKey: "rate",
    modifications: {
      id: "rate",
      header: "Commission Rate",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => {
        const rateValue = Number(cell.getValue<number>());
        if (Number.isNaN(rateValue)) {
          return "";
        }
        return `${(rateValue * 100).toFixed(2)}%`;
      },
      mantineEditTextInputProps: {
        type: "number",
        min: 0,
        step: 0.0001,
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
      Cell: ({ cell }) =>
        cell.getValue<string>()
          ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss")
          : "",
      enableColumnFilterModes: false,
      enableGrouping: false,
      enableEditing: false,
    },
  },
  {
    accessorKey: "updatedAt",
    modifications: {
      id: "updatedAt",
      header: "Updated At",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) =>
        cell.getValue<string>()
          ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss")
          : "",
      enableColumnFilterModes: false,
      enableGrouping: false,
      enableEditing: false,
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
