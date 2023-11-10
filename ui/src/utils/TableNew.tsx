import { useMemo } from 'react';
import {
  MantineReactTable,
  useMantineReactTable,
  type MRT_ColumnDef, //if using TypeScript (optional, but recommended)
} from 'mantine-react-table';

interface Person {
    name: string;
    age: number;
}


const data: Person[] = [
    {
      name: 'John',
      age: 30,
    },
    {
      name: 'Sara',
      age: 25,
    },
    {
        name: 'Sara',
        age: 25,
      },
      {
        name: 'Sara',
        age: 25,
      },
      {
        name: 'Sara',
        age: 25,
      },
      {
        name: 'Sara',
        age: 25,
      },
  ];

 

  const Table = (props: any) => {
    const columns = useMemo<MRT_ColumnDef<Person>[]>(
        () => [
          {
            accessorKey: 'name', //simple recommended way to define a column
            header: 'Name',
            mantineTableHeadCellProps: { style: { color: 'green' } }, //custom props
          },
          {
            accessorFn: (originalRow) => originalRow.age, //alternate way
            id: 'age', //id required if you use accessorFn instead of accessorKey
            header: 'Age',
            Header: <i style={{ color: 'red' }}>Age</i>, //optional custom markup
          },
        ],
        [],
      );

      const table = useMantineReactTable({
        columns,
        data, //must be memoized or stable (useState, useMemo, defined outside of this component, etc.)
        enableRowSelection: true, //enable some features
        enableColumnOrdering: true,
        enableGlobalFilter: false, //turn off a feature
      });
    

    return (
        <MantineReactTable table={table} />
    );
  }

  export default Table;