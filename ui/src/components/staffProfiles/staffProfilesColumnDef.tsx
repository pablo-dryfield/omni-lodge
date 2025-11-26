import { Badge, Switch } from "@mantine/core";
import dayjs from "dayjs";
import CustomEditSelect, { type EditSelectOption } from "../../utils/CustomEditSelect";
import CustomEditSwitch from "../../utils/CustomEditSwitch";
import { resolveHeaderLabel } from "../../utils/resolveHeaderLabel";
import type { ResponseModifications } from "../../types/general/ResponseModifications";
import type { StaffProfile } from "../../types/staffProfiles/StaffProfile";

export type StaffProfileColumnParams = {
  userLabelById: Map<number, string>;
  userOptions: EditSelectOption[];
  vendorOptions: EditSelectOption[];
  clientOptions: EditSelectOption[];
  vendorLookup: Record<number, string>;
  clientLookup: Record<number, string>;
};

const STAFF_TYPE_OPTIONS: EditSelectOption[] = [
  { value: "volunteer", label: "Volunteer" },
  { value: "long_term", label: "Long Term" },
];

const formatDateTime = (value: unknown) => {
  if (!value) {
    return "";
  }
  const parsed = dayjs(value as dayjs.ConfigType);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm:ss") : "";
};

const renderLookup = (value: unknown, lookup: Record<number, string>, fallbackLabel: string) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) {
    return "";
  }
  return lookup[id] ?? `${fallbackLabel} #${id}`;
};

export const staffProfilesColumnDef = ({
  userLabelById,
  userOptions,
  vendorOptions,
  clientOptions,
  vendorLookup,
  clientLookup,
}: StaffProfileColumnParams): ResponseModifications<Partial<StaffProfile>>[] => [
  {
    accessorKey: "userId",
    modifications: {
      id: "userId",
      header: "User",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => {
        const idValue = Number(cell.getValue<number>());
        const label = userLabelById.get(idValue);
        return label ? `${label} (#${idValue})` : idValue;
      },
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={userOptions}
          placeholder="Select user"
        />
      ),
    },
  },
  {
    accessorKey: "staffType",
    modifications: {
      id: "staffType",
      header: "Staff Type",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => {
        const value = cell.getValue<StaffProfile["staffType"]>();
        const option = STAFF_TYPE_OPTIONS.find((item) => item.value === value);
        return option ? (
          <Badge color={value === "volunteer" ? "blue" : "grape"} variant="light">
            {option.label}
          </Badge>
        ) : (
          value
        );
      },
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={STAFF_TYPE_OPTIONS}
          placeholder="Select staff type"
        />
      ),
    },
  },
  {
    accessorKey: "livesInAccom",
    modifications: {
      id: "livesInAccom",
      header: "Lives In Accommodation",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => {
        const label = resolveHeaderLabel(cell.column.columnDef.header);
        return (
          <Switch
            checked={Boolean(cell.getValue<boolean>() )}
            onLabel="Yes"
            offLabel="No"
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
            onLabel="Active"
            offLabel="Inactive"
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
    accessorKey: "financeVendorId",
    modifications: {
      header: "Finance Vendor",
      Cell: ({ cell }) => renderLookup(cell.getValue(), vendorLookup, "Vendor"),
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={[{ value: "", label: "No Vendor" }, ...vendorOptions]}
          placeholder="Select vendor"
        />
      ),
    },
  },
  {
    accessorKey: "financeClientId",
    modifications: {
      header: "Finance Client",
      Cell: ({ cell }) => renderLookup(cell.getValue(), clientLookup, "Client"),
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={[{ value: "", label: "No Client" }, ...clientOptions]}
          placeholder="Select client"
        />
      ),
    },
  },
  {
    accessorKey: "createdAt",
    modifications: {
      id: "createdAt",
      header: "Created At",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      enableColumnFilterModes: false,
      sortingFn: "datetime",
      filterVariant: "date-range",
      Cell: ({ cell }) => formatDateTime(cell.getValue()),
      Edit: () => null,
    },
  },
  {
    accessorKey: "updatedAt",
    modifications: {
      id: "updatedAt",
      header: "Updated At",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      enableColumnFilterModes: false,
      sortingFn: "datetime",
      filterVariant: "date-range",
      Cell: ({ cell }) => formatDateTime(cell.getValue()),
      Edit: () => null,
    },
  },
  {
    accessorKey: "userName",
    modifications: {
      id: "userName",
      header: "Name",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      enableColumnFilterModes: false,
      enableEditing: false,
    },
  },
  {
    accessorKey: "userEmail",
    modifications: {
      id: "userEmail",
      header: "Email",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      enableColumnFilterModes: false,
      enableEditing: false,
    },
  },
  {
    accessorKey: "userStatus",
    modifications: {
      id: "userStatus",
      header: "User Active",
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => {
        const label = resolveHeaderLabel(cell.column.columnDef.header);
        return (
          <Switch
            checked={Boolean(cell.getValue<boolean>())}
            readOnly
            onLabel="Active"
            offLabel="Inactive"
            label={label}
            labelPosition="left"
          />
        );
      },
      enableEditing: false,
    },
  },
];
