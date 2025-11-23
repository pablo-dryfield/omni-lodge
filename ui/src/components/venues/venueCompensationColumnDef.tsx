import dayjs from "dayjs";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { VenueCompensationTerm } from "../../types/venues/VenueCompensationTerm";
import CustomEditSelect, { EditSelectOption } from "../../utils/CustomEditSelect";

const compensationTypeOptions: EditSelectOption[] = [
  { value: "open_bar", label: "Open Bar (we pay)" },
  { value: "commission", label: "Commission (we earn)" },
];

const rateUnitOptions: EditSelectOption[] = [
  { value: "per_person", label: "Per Person" },
  { value: "flat", label: "Flat (per night)" },
];

type VenueCompensationColumnParams = {
  venueOptions: EditSelectOption[];
};

export const venueCompensationColumnDef = ({
  venueOptions,
}: VenueCompensationColumnParams): ResponseModifications<Partial<VenueCompensationTerm>>[] => [
  {
    accessorKey: "id",
    modifications: {
      header: "ID",
      enableEditing: false,
      visibleInShowHideMenu: false,
      size: 60,
    },
  },
  {
    accessorKey: "venueId",
    modifications: {
      header: "Venue",
      Cell: ({ row }) => {
        const label = row.original.venueName;
        const idValue = row.original.venueId;
        return label ? `${label} (#${idValue})` : idValue;
      },
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={venueOptions}
          placeholder="Select venue"
        />
      ),
    },
  },
  {
    accessorKey: "compensationType",
    modifications: {
      header: "Type",
      Cell: ({ cell }) => {
        const value = cell.getValue<"open_bar" | "commission" | null>();
        if (value === "open_bar") {
          return "Open Bar";
        }
        if (value === "commission") {
          return "Commission";
        }
        return "";
      },
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={compensationTypeOptions}
          placeholder="Select type"
        />
      ),
    },
  },
  {
    accessorKey: "direction",
    modifications: {
      header: "Direction",
      enableEditing: false,
      Cell: ({ cell }) => {
        const value = cell.getValue<"payable" | "receivable" | null>();
        if (value === "payable") {
          return "We Pay";
        }
        if (value === "receivable") {
          return "We Collect";
        }
        return "";
      },
    },
  },
  {
    accessorKey: "rateAmount",
    modifications: {
      header: "Rate",
      Cell: ({ cell, row }) => {
        const value = Number(cell.getValue<number>());
        if (Number.isNaN(value)) {
          return "";
        }
        const unit = row.original.rateUnit === "flat" ? "flat" : "per person";
        return `${row.original.currencyCode ?? "USD"} ${value.toFixed(2)} ${unit === "flat" ? "(flat)" : "/person"}`;
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
    accessorKey: "rateUnit",
    modifications: {
      header: "Rate Unit",
      Cell: ({ cell }) => {
        const value = cell.getValue<"per_person" | "flat" | null>();
        if (value === "flat") {
          return "Flat per night";
        }
        if (value === "per_person") {
          return "Per person";
        }
        return "";
      },
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={rateUnitOptions}
          placeholder="Select unit"
        />
      ),
    },
  },
  {
    accessorKey: "currencyCode",
    modifications: {
      header: "Currency",
      mantineEditTextInputProps: {
        maxLength: 3,
        minLength: 3,
        style: { textTransform: "uppercase" },
      },
    },
  },
  {
    accessorKey: "validFrom",
    modifications: {
      header: "Valid From",
      Cell: ({ cell }) =>
        cell.getValue<string>() ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD") : "",
      mantineEditTextInputProps: {
        type: "date",
        required: true,
      },
    },
  },
  {
    accessorKey: "validTo",
    modifications: {
      header: "Valid To",
      Cell: ({ cell }) =>
        cell.getValue<string>() ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD") : "",
      mantineEditTextInputProps: {
        type: "date",
      },
    },
  },
  {
    accessorKey: "isActive",
    modifications: {
      header: "Active",
      Cell: ({ cell }) => (cell.getValue<boolean>() ? "Yes" : "No"),
      editVariant: "select",
      mantineEditSelectProps: {
        data: [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ],
      },
    },
  },
  {
    accessorKey: "notes",
    modifications: {
      header: "Notes",
    },
  },
  {
    accessorKey: "createdAt",
    modifications: {
      header: "Created At",
      enableEditing: false,
      Cell: ({ cell }) =>
        cell.getValue<string>() ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss") : "",
    },
  },
  {
    accessorKey: "updatedAt",
    modifications: {
      header: "Updated At",
      enableEditing: false,
      Cell: ({ cell }) =>
        cell.getValue<string>() ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss") : "",
    },
  },
  {
    accessorKey: "createdByName",
    modifications: {
      header: "Created By",
      enableEditing: false,
    },
  },
  {
    accessorKey: "updatedByName",
    modifications: {
      header: "Updated By",
      enableEditing: false,
    },
  },
];
