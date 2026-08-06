import { MultiSelect } from '@mantine/core';
import { useState } from 'react';
import type { MRT_Cell, MRT_Row, MRT_RowData } from 'mantine-react-table';
import type { EditSelectOption } from './CustomEditSelect';

type Props<TData extends MRT_RowData> = {
  cell: MRT_Cell<TData, unknown>;
  row: MRT_Row<TData>;
  options: EditSelectOption[];
  placeholder?: string;
};

export default function CustomEditMultiSelect<TData extends MRT_RowData>({ cell, row, options, placeholder }: Props<TData>) {
  const raw = cell.getValue<unknown>();
  const [value, setValue] = useState<string[]>(Array.isArray(raw) ? raw.map(String) : []);
  const handleChange = (next: string[]) => {
    setValue(next);
    (row as any)._valuesCache[cell.column.id] = next.map(Number);
  };
  return (
    <MultiSelect
      data={options}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      searchable
      clearable
      comboboxProps={{ withinPortal: true }}
    />
  );
}
