import { Switch } from '@mantine/core';
import { useState } from 'react';
import { MRT_Cell, MRT_TableInstance, MRT_Row, MRT_RowData } from 'mantine-react-table';

interface CustomEditSwitchProps<TData extends MRT_RowData> {
  cell: MRT_Cell<TData, boolean>;
  table: MRT_TableInstance<TData>;
  row: MRT_Row<TData>;
}

const CustomEditSwitch = <TData extends {}>({ cell, table, row }: CustomEditSwitchProps<TData>) => {
  // Get the initial value from the cell, ensuring it's a boolean.
  const [value, setValue] = useState<boolean>(() => Boolean(cell.getValue()));

  // When the switch is toggled, update local state.
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.currentTarget.checked);
  };

  // When the switch loses focus, save the new value to the row's cache.
  const handleBlur = () => {
    // Update the internal row cache for this cell.
    (row as any)._valuesCache[cell.column.id] = value;

  };

  return (
    <Switch
      checked={value}
      onChange={handleChange}
      onBlur={handleBlur}
      onLabel="ON" 
      offLabel="OFF"
      label="Status"
      labelPosition="left"
    />
  );
};

export default CustomEditSwitch;
