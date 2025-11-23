import dayjs from "dayjs";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { VenueCompensationTermRate } from "../../types/venues/VenueCompensationTermRate";
import CustomEditSelect, { EditSelectOption } from "../../utils/CustomEditSelect";

type ColumnParams = {
  termOptions: EditSelectOption[];
  productOptions: EditSelectOption[];
};

export const venueCompensationTermRateColumnDef = ({
  termOptions,
  productOptions,
}: ColumnParams): ResponseModifications<Partial<VenueCompensationTermRate>>[] => [
  {
    accessorKey: "id",
    modifications: {
      header: "ID",
      enableEditing: false,
      size: 80,
      visibleInShowHideMenu: false,
    },
  },
  {
    accessorKey: "termId",
    modifications: {
      header: "Term",
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={termOptions}
          placeholder="Select term"
        />
      ),
      Cell: ({ row }) => row.original.termLabel ?? `Term #${row.original.termId}`,
    },
  },
  {
    accessorKey: "venueName",
    modifications: {
      header: "Venue",
      enableEditing: false,
    },
  },
  {
    accessorKey: "productId",
    modifications: {
      header: "Product",
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={[{ value: "", label: "All Products" }, ...productOptions]}
          placeholder="Select product"
        />
      ),
      Cell: ({ row }) => row.original.productName ?? "All Products",
    },
  },
  {
    accessorKey: "ticketType",
    modifications: {
      header: "Ticket Type",
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={[
            { value: "normal", label: "Normal" },
            { value: "cocktail", label: "Cocktail" },
            { value: "brunch", label: "Brunch" },
            { value: "generic", label: "Generic" },
          ]}
          placeholder="Select ticket type"
        />
      ),
      Cell: ({ cell }) => {
        const value = cell.getValue<string>();
        switch (value) {
          case "normal":
            return "Normal";
          case "cocktail":
            return "Cocktail";
          case "brunch":
            return "Brunch";
          default:
            return "Generic";
        }
      },
    },
  },
  {
    accessorKey: "rateAmount",
    modifications: {
      header: "Rate",
      mantineEditTextInputProps: {
        type: "number",
        min: 0,
        step: 0.01,
      },
    },
  },
  {
    accessorKey: "rateUnit",
    modifications: {
      header: "Unit",
      Edit: ({ cell, row, table }) => (
        <CustomEditSelect
          cell={cell}
          row={row}
          table={table}
          options={[
            { value: "per_person", label: "Per Person" },
            { value: "flat", label: "Flat" },
          ]}
          placeholder="Select unit"
        />
      ),
      Cell: ({ cell }) => (cell.getValue<string>() === "flat" ? "Flat" : "Per Person"),
    },
  },
  {
    accessorKey: "validFrom",
    modifications: {
      header: "Valid From",
      mantineEditTextInputProps: {
        type: "date",
      },
      Cell: ({ cell }) =>
        cell.getValue<string>() ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD") : "",
    },
  },
  {
    accessorKey: "validTo",
    modifications: {
      header: "Valid To",
      mantineEditTextInputProps: {
        type: "date",
      },
      Cell: ({ cell }) =>
        cell.getValue<string>() ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD") : "",
    },
  },
  {
    accessorKey: "isActive",
    modifications: {
      header: "Active",
      editVariant: "select",
      mantineEditSelectProps: {
        data: [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ],
      },
      Cell: ({ cell }) => (cell.getValue<boolean>() ? "Yes" : "No"),
    },
  },
  {
    accessorKey: "createdAt",
    modifications: {
      header: "Created",
      enableEditing: false,
      Cell: ({ cell }) =>
        cell.getValue<string>() ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss") : "",
    },
  },
  {
    accessorKey: "updatedAt",
    modifications: {
      header: "Updated",
      enableEditing: false,
      Cell: ({ cell }) =>
        cell.getValue<string>() ? dayjs(cell.getValue<string>()).format("YYYY-MM-DD HH:mm:ss") : "",
    },
  },
];
