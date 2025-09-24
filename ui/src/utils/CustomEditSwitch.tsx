import { Switch } from "@mantine/core";
import { useState, ChangeEvent } from "react";
import {
  MRT_Cell,
  MRT_Row,
  MRT_RowData,
  MRT_TableInstance,
} from "mantine-react-table";

interface CustomEditSwitchProps<TData extends MRT_RowData> {
  cell: MRT_Cell<TData, boolean>;
  table: MRT_TableInstance<TData>;
  row: MRT_Row<TData>;
}

const resolveSwitchLabel = (labelCandidate: unknown, fallback: string) => {
  if (typeof labelCandidate === "string" || typeof labelCandidate === "number") {
    return String(labelCandidate);
  }

  return fallback;
};

const CustomEditSwitch = <TData extends MRT_RowData>({ cell, table, row }: CustomEditSwitchProps<TData>) => {
  const [value, setValue] = useState<boolean>(() => Boolean(cell.getValue()));

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.currentTarget.checked);
  };

  const handleBlur = () => {
    (row as any)._valuesCache[cell.column.id] = value;
  };

  const label = resolveSwitchLabel(cell.column.columnDef.header, cell.column.id);

  return (
    <Switch
      checked={value}
      onChange={handleChange}
      onBlur={handleBlur}
      onLabel="ON"
      offLabel="OFF"
      label={label}
      labelPosition="left"
    />
  );
};

export default CustomEditSwitch;