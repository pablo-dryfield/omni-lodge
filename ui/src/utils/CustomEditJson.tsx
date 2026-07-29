import { Textarea } from "@mantine/core";
import { useState } from "react";
import { MRT_Cell, MRT_Row, MRT_RowData } from "mantine-react-table";

interface CustomEditJsonProps<TData extends MRT_RowData> {
  cell: MRT_Cell<TData, unknown>;
  row: MRT_Row<TData>;
  minRows?: number;
}

const CustomEditJson = <TData extends MRT_RowData>({
  cell,
  row,
  minRows = 8,
}: CustomEditJsonProps<TData>) => {
  const initialValue = JSON.stringify(cell.getValue<unknown>() ?? {}, null, 2);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (nextValue: string) => {
    setValue(nextValue);
    try {
      const parsed = JSON.parse(nextValue);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Configuration must be a JSON object.");
      }
      (row as any)._valuesCache[cell.column.id] = parsed;
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid JSON.");
    }
  };

  return (
    <Textarea
      value={value}
      onChange={(event) => handleChange(event.currentTarget.value)}
      error={error}
      minRows={minRows}
      autosize
      styles={{ input: { fontFamily: "monospace", minWidth: 360 } }}
    />
  );
};

export default CustomEditJson;
