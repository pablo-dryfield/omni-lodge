import { Select } from "@mantine/core";
import { useState } from "react";
import {
  MRT_Cell,
  MRT_Row,
  MRT_RowData,
  MRT_TableInstance,
} from "mantine-react-table";

export type EditSelectOption = {
  value: string;
  label: string;
};

interface CustomEditSelectProps<TData extends MRT_RowData> {
  cell: MRT_Cell<TData, unknown>;
  row: MRT_Row<TData>;
  table: MRT_TableInstance<TData>;
  options: EditSelectOption[];
  placeholder?: string;
  searchable?: boolean;
}

const CustomEditSelect = <TData extends MRT_RowData>(
  { cell, row, options, placeholder, searchable = true }: CustomEditSelectProps<TData>,
) => {
  const rawValue = cell.getValue<unknown>();
  const initialValue = rawValue === null || rawValue === undefined ? "" : String(rawValue);
  const [value, setValue] = useState(initialValue);

  const handleChange = (selected: string | null) => {
    const nextValue = selected ?? "";
    setValue(nextValue);
    (row as any)._valuesCache[cell.column.id] = nextValue === "" ? null : nextValue;
  };

  return (
    <Select
      data={options}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      searchable={searchable}
      withinPortal
      nothingFoundMessage="No options"
    />
  );
};

export default CustomEditSelect;
