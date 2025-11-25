import { Switch } from "@mantine/core";
import dayjs from "dayjs";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { Venue } from "../../types/venues/Venue";
import CustomEditSelect, { EditSelectOption } from "../../utils/CustomEditSelect";

type ColumnParams = {
  vendorOptions: EditSelectOption[];
  clientOptions: EditSelectOption[];
  vendorLookup: Record<number, string>;
  clientLookup: Record<number, string>;
};

const renderCounterparty = (value: unknown, lookup: Record<number, string>, fallbackPrefix: string) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) {
    return "";
  }

  return lookup[id] ?? `${fallbackPrefix} #${id}`;
};

export const venuesColumnDef = ({
  vendorOptions,
  clientOptions,
  vendorLookup,
  clientLookup,
}: ColumnParams): ResponseModifications<Partial<Venue>>[] => [
  {
    accessorKey: "id",
    modifications: {
      header: "ID",
      enableEditing: false,
      enableColumnFilterModes: false,
      enableGrouping: false,
      enableSorting: true,
      size: 80,
      visibleInShowHideMenu: false,
    },
  },
  {
    accessorKey: "name",
    modifications: {
      header: "Name",
      mantineEditTextInputProps: {
        required: true,
      },
    },
  },
  {
    accessorKey: "sortOrder",
    modifications: {
      header: "Sort Order",
      mantineEditTextInputProps: {
        type: "number",
        min: 0,
      },
      enableSorting: true,
    },
  },
  {
    accessorKey: "allowsOpenBar",
    modifications: {
      header: "Open Bar Eligible",
      Cell: ({ cell }) => (cell.getValue<boolean>() ? "Yes" : "No"),
      Edit: ({ cell, row }) => {
        const currentValue = Boolean(cell.getValue<boolean>());
        return (
          <Switch
            checked={currentValue}
            onChange={(event) => {
              (row as any)._valuesCache[cell.column.id] = event.currentTarget.checked;
            }}
            label={currentValue ? "Yes" : "No"}
          />
        );
      },
      enableSorting: true,
    },
  },
  {
    accessorKey: "financeVendorId",
    modifications: {
      header: "Finance Vendor",
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={[{ value: "", label: "No Vendor" }, ...vendorOptions]}
          placeholder="Select vendor"
        />
      ),
      Cell: ({ cell }) => renderCounterparty(cell.getValue<unknown>(), vendorLookup, "Vendor"),
    },
  },
  {
    accessorKey: "financeClientId",
    modifications: {
      header: "Finance Client",
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={[{ value: "", label: "No Client" }, ...clientOptions]}
          placeholder="Select client"
        />
      ),
      Cell: ({ cell }) => renderCounterparty(cell.getValue<unknown>(), clientLookup, "Client"),
    },
  },
  {
    accessorKey: "isActive",
    modifications: {
      header: "Active",
      Cell: ({ cell }) => (cell.getValue<boolean>() ? "Yes" : "No"),
      Edit: ({ cell, row }) => {
        const currentValue = Boolean(cell.getValue<boolean>());
        return (
          <Switch
            checked={currentValue}
            onChange={(event) => {
              (row as any)._valuesCache[cell.column.id] = event.currentTarget.checked;
            }}
            label={currentValue ? "Yes" : "No"}
          />
        );
      },
      enableSorting: true,
    },
  },
  {
    accessorKey: "createdAt",
    modifications: {
      header: "Created At",
      enableEditing: false,
      enableColumnFilterModes: false,
      enableGrouping: false,
      sortingFn: "datetime",
      Cell: ({ cell }) =>
        cell.getValue<Date>() ? dayjs(cell.getValue<Date>()).format("YYYY-MM-DD HH:mm:ss") : "",
    },
  },
  {
    accessorKey: "updatedAt",
    modifications: {
      header: "Updated At",
      enableEditing: false,
      enableColumnFilterModes: false,
      enableGrouping: false,
      sortingFn: "datetime",
      Cell: ({ cell }) =>
        cell.getValue<Date>() ? dayjs(cell.getValue<Date>()).format("YYYY-MM-DD HH:mm:ss") : "",
    },
  },
];
