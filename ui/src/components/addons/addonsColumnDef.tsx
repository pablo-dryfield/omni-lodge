import { Switch } from "@mantine/core";
import dayjs from "dayjs";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Addon } from "../../types/addons/Addon";
import CustomEditSwitch from "../../utils/CustomEditSwitch";
import { resolveHeaderLabel } from "../../utils/resolveHeaderLabel";

const formatNumber = (value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return String(value);
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
    accessorKey: "description",
    modifications: {
      id: "description",
      header: "Description",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => (
        <div style={{ maxWidth: 360, whiteSpace: "normal" }}>
          {String(cell.getValue() ?? "")}
        </div>
      ),
      mantineEditTextInputProps: {
        placeholder: "Add-on details shown to customers",
      },
      size: 360,
    },
  },
  {
    accessorKey: "imageUrl",
    modifications: {
      id: "imageUrl",
      header: "Image",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => {
        const imageUrl = String(cell.getValue() ?? "").trim();
        return imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            style={{ display: "block", width: 72, height: 54, objectFit: "cover" }}
          />
        ) : null;
      },
      mantineEditTextInputProps: {
        type: "url",
        placeholder: "https://media.example.com/addon.webp",
      },
      size: 120,
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
